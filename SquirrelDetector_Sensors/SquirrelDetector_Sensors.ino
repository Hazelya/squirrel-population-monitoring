/// ============================================================
//  SQUIRREL DETECTOR v2.1 — ESP32-S3 + OV3660 + SD + PIR
//  Freenove WROOM | Arduino esp32 >= 2.0.14
// ============================================================
//
//  CORRECTIFS v2.2 :
//    [M5] Filtre blob : rejette scène entière (trop %), bruit (trop petit),
//         main proche (trop grand), mouvement uniforme (toutes zones).
//    [M6] Copie JPEG avant deinit caméra — fin des fichiers SD à 0 octet.
//    [M7] IMMEDIATE_WIFI_UPLOAD : upload Supabase à chaque capture (tests).
//
//  CORRECTIFS v2.1 (vs v2 cassée) :
//    [M1] Analyse mouvement : fb_count=2, flush frames, copie luminance
//         sous-échantillonnée — fin du "0% changé" systématique.
//    [M2] Après rejet PIR/mouvement : sleep TIMER (PIR désarmé), pas EXT1.
//    [M3] Cooldown post-capture comme v1 (60 s timer only).
//    [M4] Logs [INFO]/[OK] lisibles + métriques motion (maxDiff, checksum).
//
//  CÂBLAGE PIR : GPIO 2 (RTC)
//  SD_MMC Freenove (par défaut) : CLK 39, CMD 38, D0 40
//
// ============================================================

#include "esp_camera.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "driver/rtc_io.h"
#include "esp_bt.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "FS.h"
#include "SD_MMC.h"

// ─── CONFIGURATION UTILISATEUR ──────────────────────────────

#define WIFI_SSID           ""    // À COMPLETER POUR FAIRE FONCTIONNER LE CODE
#define WIFI_PASSWORD       ""    // À COMPLETER POUR FAIRE FONCTIONNER LE CODE

#define SUPABASE_URL        "https://zajkfzkibiearswvzogr.supabase.co"
#define SUPABASE_BUCKET     "photos-detection"
#define SUPABASE_API_KEY    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphamtmemtpYmllYXJzd3Z6b2dyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTA4MTE3OSwiZXhwIjoyMDk0NjU3MTc5fQ.6NYExjJFu31L0wl_VTY2_f_42WGIU-a9-OxD-vst64c"

// 1 = upload WiFi après chaque capture (tests) | 0 = batch 12h/20h seulement
#define IMMEDIATE_WIFI_UPLOAD      1

// Logs web embarqués pour debug sur batterie.
// Mettre WEB_LOG_WINDOW_MS à 0 une fois le debug terminé.
#define WEB_LOGS_ENABLED           1
#define WEB_LOG_HOSTNAME           "squirrel-detector"
#define WEB_LOG_PORT               80
#define WEB_LOG_WINDOW_MS          15000
#define WEB_LOG_BUFFER_SIZE        4096

#define PIR_PIN             GPIO_NUM_2

// Timings généraux
#define COOLDOWN_SECONDS           30    // Après capture réussie (comme v1)
#define FALSE_ALARM_COOLDOWN_SEC   10    // Après rejet PIR/motion — évite boucle EXT1
#define PIR_CONFIRM_DELAY_MS       80
#define PIR_LOW_POLL_MS            50
#define WIFI_TIMEOUT_MS            20000
#define MOTION_CAMERA_WARMUP_MS    80
#define FINAL_CAMERA_WARMUP_MS     0
#define MOTION_FRAME_GAP_MS        30    // Écart court entre 2 mini-frames (sujet rapide)
#define MOTION_FLUSH_FRAMES        2     // Frames jetées avant chaque capture
#define FINAL_CAPTURE_BURST        1     // Capture immédiate — garde la première JPEG valide
#define FINAL_BURST_GAP_MS         0

// PIR — plus strict pour ignorer vibrations du boîtier
#define PIR_CONFIRM_SAMPLES        3
#define PIR_CONFIRM_MIN_HIGH       2
#define PIR_CONFIRM_INTERVAL_MS    25

// Analyse mouvement — grille 60×45
// Accepte : sujet compact devant la caméra (main, écureuil proche/loin).
// Rejette : mur, déplacement de la caméra seule (zones partout, peu concentré).
#define MOTION_GRID_W              60
#define MOTION_GRID_H              45
#define MOTION_DIFF_THRESHOLD      20
#define MOTION_SIGN_MIN            10    // Seuil pour mesurer le sens du changement
#define MOTION_LIGHT_SAME_SIGN_PCT 76    // Lumière : presque toutes les cellules +/- pareil
#define MOTION_LIGHT_GLOBAL_SHIFT  7     // Décalage moyen de luminance (exposition)
#define MOTION_LIGHT_MAX_LOCAL_GRAD 22   // Lumière : peu de contours locaux
#define MOTION_SUBJECT_MIN_LOCAL_GRAD 18 // Sujet : bords / texture locale
#define MOTION_MIN_CHANGED_PCT     2
#define MOTION_MAX_CHANGED_PCT     42
#define MOTION_MIN_CLUSTER_CELLS   24
#define MOTION_MIN_BLOB_W          4
#define MOTION_MIN_BLOB_H          3
#define MOTION_SMALL_CLUSTER_CELLS 6     // Sujet rapide : peu de %, mais structure nette
#define MOTION_SMALL_MAX_CHANGED_PCT 5
#define MOTION_SMALL_MIN_MAXDIFF   70
#define MOTION_SMALL_MIN_GRAD      55
#define MOTION_MIN_CONCENTRATION_PCT 18
#define MOTION_GLOBAL_ZONE_MIN     10    // Zones actives = mouvement partout (caméra)
#define MOTION_GLOBAL_CONC_MAX     25    // Concentration max si mouvement global
#define MOTION_GLOBAL_CLUSTER_MAX  78    // Au-dessus = vrai gros sujet malgré zones
#define MOTION_SUBJECT_MIN_CONC    22    // Sujet moyen : concentration mini
#define MOTION_SUBJECT_MIN_CLUSTER 40
#define MOTION_SUBJECT_MAX_ZONES   9     // Sujet local : pas toutes les zones
#define MOTION_SUBJECT_MIN_MAXDIFF 155
#define MOTION_SUBJECT_MIN_AVGDIFF 14
#define MOTION_UNIFORM_ZONE_MIN    10
#define MOTION_UNIFORM_CLUSTER_MAX 18
#define MOTION_UNIFORM_PCT_MAX     12
#define MOTION_ZONE_COLS           4
#define MOTION_ZONE_ROWS           3

// Caméra — pins Freenove OV3660
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define SIOD_GPIO_NUM      4
#define SIOC_GPIO_NUM      5
#define Y9_GPIO_NUM       16
#define Y8_GPIO_NUM       17
#define Y7_GPIO_NUM       18
#define Y6_GPIO_NUM       12
#define Y5_GPIO_NUM       10
#define Y4_GPIO_NUM        8
#define Y3_GPIO_NUM        9
#define Y2_GPIO_NUM       11
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7
#define PCLK_GPIO_NUM     13

#define CAM_MOTION_SIZE     FRAMESIZE_QQVGA   // 160×120
#define CAM_FINAL_SIZE      FRAMESIZE_SVGA
#define JPEG_FINAL_QUALITY  10

// SD_MMC — broches courantes Freenove ESP32-S3 WROOM CAM
#define SD_MMC_CLK        39
#define SD_MMC_CMD        38
#define SD_MMC_D0         40

#define SD_PENDING_DIR    "/pending"
#define SD_UPLOADED_DIR   "/uploaded"
#define SD_FAILED_DIR     "/failed"

// Upload batch : 2 envois / 24 h (toutes les 12 h, horloge relative getNow())
#define UPLOAD_INTERVAL_HOURS   12
#define SECONDS_PER_DAY         86400ULL

// ─── RTC ─────────────────────────────────────────────────────

RTC_DATA_ATTR uint32_t bootCount              = 0;
RTC_DATA_ATTR uint64_t rtcTimeBaseUs          = 0;
RTC_DATA_ATTR uint32_t nextAllowedCaptureTime = 0;
RTC_DATA_ATTR uint32_t eventCount             = 0;
RTC_DATA_ATTR uint32_t nextUploadAtSec        = 0;   // epoch relatif getNow()
RTC_DATA_ATTR uint32_t dayStartSec            = 0;   // début « jour » courant
RTC_DATA_ATTR char     webLogBuffer[WEB_LOG_BUFFER_SIZE] = {0};
RTC_DATA_ATTR uint16_t webLogLen = 0;

void appendToWebLogBuffer(const uint8_t* data, size_t len);

class BufferedSerial : public Print {
 public:
  explicit BufferedSerial(HardwareSerial& serial) : serial_(serial) {}

  void begin(unsigned long baud) {
    serial_.begin(baud);
  }

  void flush() {
    serial_.flush();
  }

  using Print::write;

  size_t write(uint8_t c) override {
    serial_.write(c);
    appendToWebLogBuffer(&c, 1);
    return 1;
  }

  size_t write(const uint8_t* buffer, size_t size) override {
    serial_.write(buffer, size);
    appendToWebLogBuffer(buffer, size);
    return size;
  }

 private:
  HardwareSerial& serial_;
};

BufferedSerial bufferedSerial(::Serial);
#define Serial bufferedSerial

WebServer webLogServer(WEB_LOG_PORT);
bool webLogRoutesReady = false;
bool webLogServerStarted = false;

static const char WEB_LOG_PAGE[] PROGMEM = R"HTML(
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Squirrel Detector Logs</title>
  <style>
    body { font-family: Arial, sans-serif; background: #111827; color: #e5e7eb; margin: 0; }
    header { padding: 16px 20px; border-bottom: 1px solid #374151; }
    h1 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0; color: #9ca3af; }
    pre {
      margin: 0;
      padding: 20px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: Consolas, monospace;
      font-size: 13px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <header>
    <h1>Logs ESP32 en direct</h1>
    <p>Rafraichissement automatique toutes les secondes.</p>
  </header>
  <pre id="logs">Chargement...</pre>
  <script>
    async function refreshLogs() {
      try {
        const response = await fetch('/logs', { cache: 'no-store' });
        const text = await response.text();
        const pre = document.getElementById('logs');
        const shouldStick = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 40);
        pre.textContent = text || 'Aucun log pour le moment.';
        if (shouldStick) window.scrollTo(0, document.body.scrollHeight);
      } catch (error) {
        document.getElementById('logs').textContent = 'ESP32 hors ligne ou en deep sleep...';
      }
    }
    refreshLogs();
    setInterval(refreshLogs, 1000);
  </script>
</body>
</html>
)HTML";

// ─── Prototypes ──────────────────────────────────────────────

void     logBootHeader();
const char* wakeCauseStr(esp_sleep_wakeup_cause_t c);
void     saveBootElapsedTimeToRTC();
uint32_t getNow();
void     goToDeepSleepPIR();
void     goToDeepSleepTimer(uint32_t seconds, const char* reason);
bool     waitForPirToGoLow(uint32_t timeoutMs);
bool     pirReadFirst();
bool     pirConfirm();
bool     initCameraMotion();
bool     initCameraFinal();
void     deinitCamera();
void     cameraFlushFrames(int n);
bool     fillLumaFromFb(camera_fb_t* fb, uint8_t* grid);
bool     captureMotionFrame(const char* label, uint8_t* grid, uint32_t* checksum, int flushFrames);
bool     captureMotionPair(uint8_t* g1, uint8_t* g2, uint32_t* chk1, uint32_t* chk2);
bool     analyzeMotion(const uint8_t* g1, const uint8_t* g2,
                       uint32_t chk1, uint32_t chk2,
                       uint16_t* outChangedPct, uint16_t* outMaxDiff);
bool     captureFinalJpeg(camera_fb_t** outFb);
bool     initSD();
bool     saveEventToSD(const uint8_t* buf, size_t len, const char* destDir,
                       bool uploadedToCloud, const char* imageBase);
bool     insertDetectionRow(const String& publicUrl);
bool     uploadJpegNow(const uint8_t* buf, size_t len, const char* imageBase);
void     buildImageBasename(char* out, size_t len);
void     unmountSD();
bool     connectWiFi();
bool     uploadPendingBatch();
uint32_t secondsUntilNextUpload();
void     scheduleNextUploadFromNow();
void     powerOffRadios();
void     startWebLogServer();
void     stopWebLogServer();
void     serviceWebLogServer();
void     keepWebLogWindowOpen(uint32_t ms, const char* reason);

// Grilles réutilisées (pas d'allocation heap)
static uint8_t g_luma1[MOTION_GRID_W * MOTION_GRID_H];
static uint8_t g_luma2[MOTION_GRID_W * MOTION_GRID_H];
static uint8_t g_changedMask[MOTION_GRID_W * MOTION_GRID_H];

// ============================================================
//  SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(200);
  setCpuFrequencyMhz(80);

  bootCount++;
  logBootHeader();

  esp_sleep_wakeup_cause_t wakeup = esp_sleep_get_wakeup_cause();
  Serial.printf("[INFO] Cause réveil : %s\n", wakeCauseStr(wakeup));

  // ── CAS A : Timer (cooldown OU fenêtre upload) ─────────────
  if (wakeup == ESP_SLEEP_WAKEUP_TIMER) {
    uint32_t now = getNow();

    // Fenêtre upload ?
    if (now >= nextUploadAtSec) {
      Serial.println("[INFO] Réveil timer — fenêtre upload.");
      if (initSD()) {
        if (connectWiFi()) {
          uploadPendingBatch();
        } else {
          Serial.println("[WARN] WiFi indisponible — upload reporté.");
        }
      } else {
        Serial.println("[WARN] SD absente — upload impossible.");
      }
      scheduleNextUploadFromNow();
      now = getNow();
    } else {
      Serial.println("[INFO] Réveil timer — fin cooldown / anti-boucle.");
    }

    // Attente PIR LOW avant ré-armement EXT1 (comme v1)
    pinMode((uint8_t)PIR_PIN, INPUT);
    if (digitalRead((uint8_t)PIR_PIN) == HIGH) {
      Serial.println("[INFO] PIR encore HIGH — attente LOW...");
      if (!waitForPirToGoLow(5000)) {
        Serial.println("[WARN] PIR bloqué HIGH — timer 10 s.");
        goToDeepSleepTimer(10, "PIR bloqué");
        return;
      }
    }
    Serial.println("[OK] PIR LOW — surveillance mouvement réactivée.");
    goToDeepSleepPIR();
    return;
  }

  // ── CAS B : Premier boot ───────────────────────────────────
  if (wakeup != ESP_SLEEP_WAKEUP_EXT1) {
    Serial.println("[INFO] Premier boot — init planning upload.");
    if (nextUploadAtSec == 0) {
      scheduleNextUploadFromNow();
    }
    Serial.printf("[INFO] Prochain upload dans ~%lu s (~%lu min).\n",
                  secondsUntilNextUpload(), secondsUntilNextUpload() / 60);
    goToDeepSleepPIR();
    return;
  }

  // ── CAS C : Réveil PIR ─────────────────────────────────────
  Serial.println("[OK] Réveil par PIR détecté.");
  Serial.printf("[DEBUG] EXT1 wake mask = 0x%llX\n",
                (unsigned long long)esp_sleep_get_ext1_wakeup_status());

  uint32_t now = getNow();
  if (now < nextAllowedCaptureTime) {
    uint32_t rem = nextAllowedCaptureTime - now;
    Serial.printf("[WARN] Cooldown actif (%lu s restantes) — sleep timer.\n", rem);
    goToDeepSleepTimer(rem, "cooldown capture");
    return;
  }

  if (!pirReadFirst()) {
    Serial.println("[INFO] PIR bas au réveil — faux EXT1 → timer court.");
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "faux EXT1");
    return;
  }
  Serial.println("[OK] PIR #1 confirmé — init caméra analyse.");
  unmountSD();   // libère bus SD avant caméra (évite conflit / mount fail)

  unsigned long t0 = millis();
  if (!initCameraMotion()) {
    Serial.println("[ERREUR] Caméra (motion) — sleep timer.");
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "caméra KO");
    return;
  }
  unsigned long elapsed = millis() - t0;
  if (elapsed < PIR_CONFIRM_DELAY_MS) {
    delay(PIR_CONFIRM_DELAY_MS - elapsed);
  }

  if (!pirConfirm()) {
    Serial.println("[INFO] PIR #2 non confirmé — timer anti-boucle.");
    deinitCamera();
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "PIR non confirmé");
    return;
  }
  Serial.println("[OK] PIR validé — capture paire motion, puis EARLY SVGA.");

  unsigned long motionStartMs = millis();
  uint32_t chk1 = 0, chk2 = 0;
  if (!captureMotionPair(g_luma1, g_luma2, &chk1, &chk2)) {
    Serial.println("[ERREUR] Capture motion — timer.");
    deinitCamera();
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "capture motion");
    return;
  }
  unsigned long motionDoneMs = millis();

  // ── EARLY : JPEG SVGA juste après la paire motion (aligné sur le passage) ─
  deinitCamera();
  if (!initCameraFinal()) {
    Serial.println("[ERREUR] Caméra (early SVGA) — timer.");
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "caméra early");
    return;
  }

  camera_fb_t* earlyFb = nullptr;
  if (!captureFinalJpeg(&earlyFb) || !earlyFb) {
    Serial.println("[ERREUR] JPEG early — timer.");
    deinitCamera();
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "JPEG early");
    return;
  }

  size_t earlyLen = earlyFb->len;
  unsigned long earlyDoneMs = millis();
  Serial.printf("[OK] Image EARLY — %u octets (%ux%u) | motion=%lu ms, JPEG après motion=%lu ms.\n",
                (unsigned)earlyLen, earlyFb->width, earlyFb->height,
                (unsigned long)(motionDoneMs - motionStartMs),
                (unsigned long)(earlyDoneMs - motionDoneMs));

  uint8_t* earlyCopy = (uint8_t*)malloc(earlyLen);
  if (!earlyCopy) {
    Serial.println("[ERREUR] malloc JPEG early — timer.");
    esp_camera_fb_return(earlyFb);
    deinitCamera();
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "malloc JPEG early");
    return;
  }
  memcpy(earlyCopy, earlyFb->buf, earlyLen);
  esp_camera_fb_return(earlyFb);
  deinitCamera();

  uint16_t changedPct = 0, maxDiff = 0;
  bool motionOk = analyzeMotion(g_luma1, g_luma2, chk1, chk2, &changedPct, &maxDiff);

  if (!motionOk) {
    Serial.println("[INFO] Motion rejetée — timer (PIR désarmé).");
    free(earlyCopy);
    goToDeepSleepTimer(FALSE_ALARM_COOLDOWN_SEC, "motion rejetée");
    return;
  }
  Serial.println("[OK] Motion validée — on conserve l'image EARLY.");

  now = getNow();
  nextAllowedCaptureTime = now + COOLDOWN_SECONDS;
  Serial.printf("[INFO] Cooldown capture armé jusqu'à t=%lu\n", nextAllowedCaptureTime);

  eventCount++;
  char imageBase[48];
  buildImageBasename(imageBase, sizeof(imageBase));
  Serial.printf("[INFO] Nom image : %s.jpg\n", imageBase);

  bool cloudOk = false;
#if IMMEDIATE_WIFI_UPLOAD
  Serial.println("[INFO] Mode test — upload WiFi immédiat.");
  if (connectWiFi()) {
    cloudOk = uploadJpegNow(earlyCopy, earlyLen, imageBase);
    if (cloudOk) {
      Serial.println("[OK] Upload Supabase immédiat.");
    } else {
      Serial.println("[WARN] Upload immédiat échoué.");
    }
  } else {
    Serial.println("[WARN] WiFi indisponible — fichier SD dans /failed.");
  }
#else
  Serial.println("[INFO] Upload différé (toutes les 12h).");
#endif

  if (initSD()) {
    const char* destDir = SD_PENDING_DIR;
#if IMMEDIATE_WIFI_UPLOAD
    destDir = cloudOk ? SD_UPLOADED_DIR : SD_FAILED_DIR;
#endif
    if (saveEventToSD(earlyCopy, earlyLen, destDir, cloudOk, imageBase)) {
      Serial.printf("[OK] Sauvegarde SD %s.\n", destDir);
    } else {
      Serial.println("[WARN] Échec écriture SD.");
    }
  } else {
    Serial.println("[WARN] SD non disponible.");
  }

  free(earlyCopy);
  Serial.printf("[INFO] Deep sleep cooldown %d s (timer only, PIR off).\n", COOLDOWN_SECONDS);
  goToDeepSleepTimer(COOLDOWN_SECONDS, "post-capture");
}

void loop() {}

// ============================================================
//  MOTION — luminance + diff
// ============================================================

static inline uint8_t rgb565ToLuma(uint16_t p) {
  uint8_t r = ((p >> 11) & 0x1F) << 3;
  uint8_t g = ((p >> 5) & 0x3F) << 2;
  uint8_t b = (p & 0x1F) << 3;
  return (uint8_t)((r * 77 + g * 150 + b * 29) >> 8);
}

static inline uint16_t readRgb565Pixel(const uint8_t* buf, int w, int x, int y) {
  size_t o = ((size_t)y * (size_t)w + (size_t)x) * 2;
  return (uint16_t)(buf[o] | (buf[o + 1] << 8));
}

static inline uint8_t samplePatchLuma(const uint8_t* buf, int w, int h, int cx, int cy) {
  int x0 = cx - 1;
  int y0 = cy - 1;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  int x1 = cx + 1;
  int y1 = cy + 1;
  if (x1 >= w) x1 = w - 1;
  if (y1 >= h) y1 = h - 1;

  uint32_t sum = 0;
  uint32_t n = 0;
  for (int y = y0; y <= y1; y++) {
    for (int x = x0; x <= x1; x++) {
      sum += rgb565ToLuma(readRgb565Pixel(buf, w, x, y));
      n++;
    }
  }
  return (uint8_t)(sum / n);
}

bool fillLumaFromFb(camera_fb_t* fb, uint8_t* grid) {
  if (!fb || !fb->buf || fb->format != PIXFORMAT_RGB565) return false;
  int w = fb->width;
  int h = fb->height;
  if (w <= 0 || h <= 0) return false;

  for (int gy = 0; gy < MOTION_GRID_H; gy++) {
    int y = (gy * h) / MOTION_GRID_H;
    if (y >= h) y = h - 1;
    for (int gx = 0; gx < MOTION_GRID_W; gx++) {
      int x = (gx * w) / MOTION_GRID_W;
      if (x >= w) x = w - 1;
      grid[gy * MOTION_GRID_W + gx] = samplePatchLuma(fb->buf, w, h, x, y);
    }
  }
  return true;
}

static inline uint8_t localGradAt(const uint8_t* grid, int gx, int gy) {
  size_t i = (size_t)gy * MOTION_GRID_W + gx;
  uint8_t c = grid[i];
  uint8_t g = 0;
  if (gx > 0) {
    uint8_t d = (c > grid[i - 1]) ? (c - grid[i - 1]) : (grid[i - 1] - c);
    if (d > g) g = d;
  }
  if (gx + 1 < MOTION_GRID_W) {
    uint8_t d = (c > grid[i + 1]) ? (c - grid[i + 1]) : (grid[i + 1] - c);
    if (d > g) g = d;
  }
  if (gy > 0) {
    uint8_t d = (c > grid[i - MOTION_GRID_W]) ? (c - grid[i - MOTION_GRID_W])
                                              : (grid[i - MOTION_GRID_W] - c);
    if (d > g) g = d;
  }
  if (gy + 1 < MOTION_GRID_H) {
    uint8_t d = (c > grid[i + MOTION_GRID_W]) ? (c - grid[i + MOTION_GRID_W])
                                              : (grid[i + MOTION_GRID_W] - c);
    if (d > g) g = d;
  }
  return g;
}

static bool isUniformLighting(uint16_t pct, uint16_t globalShift, uint16_t sameSignPct,
                              uint16_t avgLocalGrad, uint16_t concentration,
                              uint8_t activeZones, int largestCluster) {
  if (largestCluster >= MOTION_GLOBAL_CLUSTER_MAX) return false;

  if (sameSignPct < MOTION_LIGHT_SAME_SIGN_PCT) return false;
  if (avgLocalGrad >= MOTION_LIGHT_MAX_LOCAL_GRAD) return false;

  if (globalShift >= MOTION_LIGHT_GLOBAL_SHIFT) return true;

  if (activeZones >= MOTION_GLOBAL_ZONE_MIN && concentration <= MOTION_GLOBAL_CONC_MAX + 8) {
    return true;
  }

  if (pct >= MOTION_MIN_CHANGED_PCT && pct <= (MOTION_UNIFORM_PCT_MAX + 6) &&
      largestCluster < (MOTION_UNIFORM_CLUSTER_MAX + 6)) {
    return true;
  }

  return false;
}

void cameraFlushFrames(int n) {
  for (int i = 0; i < n; i++) {
    camera_fb_t* f = esp_camera_fb_get();
    if (f) esp_camera_fb_return(f);
    delay(5);
  }
}

bool captureMotionFrame(const char* label, uint8_t* grid, uint32_t* checksum, int flushFrames) {
  if (!grid || !checksum) return false;
  *checksum = 0;

  cameraFlushFrames(flushFrames);

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.printf("[ERREUR] esp_camera_fb_get %s null.\n", label ? label : "?");
    return false;
  }
  Serial.printf("[INFO] Motion frame %s : %u oct (%ux%u) fmt=%d\n",
                label ? label : "?", (unsigned)fb->len, fb->width, fb->height, fb->format);

  if (!fillLumaFromFb(fb, grid)) {
    esp_camera_fb_return(fb);
    Serial.printf("[ERREUR] Conversion luma %s.\n", label ? label : "?");
    return false;
  }
  for (size_t i = 0; i < MOTION_GRID_W * MOTION_GRID_H; i++) *checksum += grid[i];
  esp_camera_fb_return(fb);
  return true;
}

bool captureMotionPair(uint8_t* g1, uint8_t* g2, uint32_t* chk1, uint32_t* chk2) {
  if (!captureMotionFrame("A", g1, chk1, MOTION_FLUSH_FRAMES)) {
    return false;
  }

  delay(MOTION_FRAME_GAP_MS);
  if (!captureMotionFrame("B", g2, chk2, 1)) {
    return false;
  }

  Serial.printf("[DEBUG] Checksum luma A=%lu B=%lu (identiques si A==B)\n",
                (unsigned long)*chk1, (unsigned long)*chk2);
  return true;
}

static int largestClusterSize(const uint8_t* mask, uint16_t* outW, uint16_t* outH) {
  static bool vis[MOTION_GRID_W * MOTION_GRID_H];
  memset(vis, 0, sizeof(vis));
  int best = 0;
  *outW = *outH = 0;
  const int total = MOTION_GRID_W * MOTION_GRID_H;
  static int queue[MOTION_GRID_W * MOTION_GRID_H];

  for (int start = 0; start < total; start++) {
    if (!mask[start] || vis[start]) continue;

    int head = 0, tail = 0;
    queue[tail++] = start;
    vis[start] = true;
    int size = 0;
    int minX = MOTION_GRID_W, maxX = 0, minY = MOTION_GRID_H, maxY = 0;

    while (head < tail) {
      int idx = queue[head++];
      size++;
      int gx = idx % MOTION_GRID_W;
      int gy = idx / MOTION_GRID_W;
      if (gx < minX) minX = gx;
      if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy;
      if (gy > maxY) maxY = gy;

      static const int dx[] = {-1, 1, 0, 0};
      static const int dy[] = {0, 0, -1, 1};
      for (int k = 0; k < 4; k++) {
        int nx = gx + dx[k];
        int ny = gy + dy[k];
        if (nx < 0 || nx >= MOTION_GRID_W || ny < 0 || ny >= MOTION_GRID_H) continue;
        int ni = ny * MOTION_GRID_W + nx;
        if (mask[ni] && !vis[ni]) {
          vis[ni] = true;
          queue[tail++] = ni;
        }
      }
    }

    if (size > best) {
      best = size;
      *outW = (uint16_t)(maxX - minX + 1);
      *outH = (uint16_t)(maxY - minY + 1);
    }
  }
  return best;
}

bool analyzeMotion(const uint8_t* g1, const uint8_t* g2,
                   uint32_t chk1, uint32_t chk2,
                   uint16_t* outChangedPct, uint16_t* outMaxDiff) {
  uint32_t total = MOTION_GRID_W * MOTION_GRID_H;
  uint32_t changed = 0;
  uint16_t maxDiff = 0;
  uint32_t sumDiff = 0;
  uint32_t sumG1 = 0;
  uint32_t sumG2 = 0;
  uint32_t signPos = 0;
  uint32_t signNeg = 0;
  uint32_t signTotal = 0;
  uint32_t localGradSum = 0;

  uint8_t zones[MOTION_ZONE_COLS * MOTION_ZONE_ROWS] = {0};
  int zw = MOTION_GRID_W / MOTION_ZONE_COLS;
  int zh = MOTION_GRID_H / MOTION_ZONE_ROWS;
  if (zw < 1) zw = 1;
  if (zh < 1) zh = 1;

  memset(g_changedMask, 0, sizeof(g_changedMask));

  for (int gy = 0; gy < MOTION_GRID_H; gy++) {
    for (int gx = 0; gx < MOTION_GRID_W; gx++) {
      size_t i = (size_t)gy * MOTION_GRID_W + gx;
      sumG1 += g1[i];
      sumG2 += g2[i];

      int rawDiff = (int)g2[i] - (int)g1[i];
      int d = rawDiff;
      if (d < 0) d = -d;
      if ((uint16_t)d > maxDiff) maxDiff = (uint16_t)d;
      sumDiff += (uint32_t)d;

      if (d >= MOTION_SIGN_MIN) {
        signTotal++;
        if (rawDiff > 0) signPos++;
        else if (rawDiff < 0) signNeg++;
      }

      if (d >= MOTION_DIFF_THRESHOLD) {
        changed++;
        g_changedMask[i] = 1;
        localGradSum += localGradAt(g2, gx, gy);
        int zx = gx / zw;
        int zy = gy / zh;
        if (zx >= MOTION_ZONE_COLS) zx = MOTION_ZONE_COLS - 1;
        if (zy >= MOTION_ZONE_ROWS) zy = MOTION_ZONE_ROWS - 1;
        zones[zy * MOTION_ZONE_COLS + zx] = 1;
      }
    }
  }

  uint8_t activeZones = 0;
  for (int z = 0; z < MOTION_ZONE_COLS * MOTION_ZONE_ROWS; z++) {
    if (zones[z]) activeZones++;
  }

  uint16_t pct = (uint16_t)((changed * 100) / total);
  uint16_t avgDiff = (uint16_t)(sumDiff / total);
  uint16_t blobW = 0, blobH = 0;
  int largestCluster = largestClusterSize(g_changedMask, &blobW, &blobH);
  uint16_t concentration = (changed > 0)
      ? (uint16_t)((largestCluster * 100) / changed) : 0;

  uint16_t meanG1 = (uint16_t)(sumG1 / total);
  uint16_t meanG2 = (uint16_t)(sumG2 / total);
  uint16_t globalShift = (meanG2 > meanG1) ? (meanG2 - meanG1) : (meanG1 - meanG2);
  uint16_t sameSignPct = 0;
  if (signTotal > 0) {
    uint32_t dominant = (signPos > signNeg) ? signPos : signNeg;
    sameSignPct = (uint16_t)((dominant * 100) / signTotal);
  }
  uint16_t avgLocalGrad = (changed > 0) ? (uint16_t)(localGradSum / changed) : 0;

  *outChangedPct = pct;
  *outMaxDiff = maxDiff;

  Serial.printf("[INFO] Motion : %u%% (%lu/%lu) | maxDiff=%u avgDiff=%u | blob=%dx%d (%d) | conc=%u%% | zones=%u | shift=%u sign=%u%% grad=%u\n",
                pct, (unsigned long)changed, (unsigned long)total, maxDiff, avgDiff,
                blobW, blobH, largestCluster, concentration, activeZones,
                globalShift, sameSignPct, avgLocalGrad);

  if (chk1 == chk2 && maxDiff == 0) {
    Serial.println("[INFO] Rejet : frames identiques.");
    return false;
  }
  if (pct > MOTION_MAX_CHANGED_PCT) {
    Serial.printf("[INFO] Rejet : %u%% > max %d%% (changement global excessif)\n",
                  pct, MOTION_MAX_CHANGED_PCT);
    return false;
  }

  bool structuredSmallSubject =
      largestCluster >= MOTION_SMALL_CLUSTER_CELLS &&
      maxDiff >= MOTION_SMALL_MIN_MAXDIFF &&
      avgLocalGrad >= MOTION_SMALL_MIN_GRAD &&
      sameSignPct < MOTION_LIGHT_SAME_SIGN_PCT &&
      blobW >= 2 && blobH >= 2;

  if (isUniformLighting(pct, globalShift, sameSignPct, avgLocalGrad, concentration,
                        activeZones, largestCluster)) {
    Serial.printf("[INFO] Rejet : variation lumiere (shift=%u sign=%u%% grad=%u)\n",
                  globalShift, sameSignPct, avgLocalGrad);
    return false;
  }

  if (structuredSmallSubject && pct <= MOTION_SMALL_MAX_CHANGED_PCT) {
    Serial.printf("[OK] Motion acceptée — petit sujet structuré (pct=%u%%, blob=%d, maxDiff=%u, grad=%u).\n",
                  pct, largestCluster, maxDiff, avgLocalGrad);
    return true;
  }

  // Mur statique : petit blob, peu de %, zones dispersées
  if (activeZones >= MOTION_UNIFORM_ZONE_MIN &&
      largestCluster < MOTION_UNIFORM_CLUSTER_MAX &&
      pct <= MOTION_UNIFORM_PCT_MAX) {
    Serial.printf("[INFO] Rejet : bruit fond diffus (zones=%u, blob=%d, %u%%)\n",
                  activeZones, largestCluster, pct);
    return false;
  }

  // Déplacement caméra seule : changement sur presque toutes les zones, peu concentré
  if (activeZones >= MOTION_GLOBAL_ZONE_MIN &&
      concentration <= MOTION_GLOBAL_CONC_MAX &&
      largestCluster < MOTION_GLOBAL_CLUSTER_MAX) {
    Serial.printf("[INFO] Rejet : mouvement global caméra/fond (zones=%u, conc=%u%%, blob=%d)\n",
                  activeZones, concentration, largestCluster);
    return false;
  }

  if (pct < MOTION_MIN_CHANGED_PCT) {
    if (!structuredSmallSubject) {
      Serial.printf("[INFO] Rejet : %u%% < min %d%% (mouvement trop faible)\n",
                    pct, MOTION_MIN_CHANGED_PCT);
      return false;
    }

    Serial.printf("[OK] Motion acceptée — petit sujet rapide (blob=%d, maxDiff=%u, grad=%u).\n",
                  largestCluster, maxDiff, avgLocalGrad);
    return true;
  }

  if (largestCluster < MOTION_MIN_CLUSTER_CELLS) {
    if (structuredSmallSubject) {
      Serial.printf("[OK] Motion acceptée — sujet structuré local (blob=%d, maxDiff=%u, grad=%u).\n",
                    largestCluster, maxDiff, avgLocalGrad);
      return true;
    }
    Serial.printf("[INFO] Rejet : blob %d cellules < min %d (bruit/feuilles)\n",
                  largestCluster, MOTION_MIN_CLUSTER_CELLS);
    return false;
  }

  if (blobW < MOTION_MIN_BLOB_W || blobH < MOTION_MIN_BLOB_H) {
    Serial.printf("[INFO] Rejet : blob %ux%u trop fin (min %dx%d)\n",
                  blobW, blobH, MOTION_MIN_BLOB_W, MOTION_MIN_BLOB_H);
    return false;
  }

  // Gros sujet proche (main/écureuil) malgré zones nombreuses
  if (largestCluster >= MOTION_GLOBAL_CLUSTER_MAX) {
    Serial.printf("[OK] Motion acceptée — gros sujet (cluster %d).\n", largestCluster);
    return true;
  }

  // Sujet compact devant l'objectif
  if (largestCluster >= MOTION_SUBJECT_MIN_CLUSTER &&
      concentration >= MOTION_SUBJECT_MIN_CONC &&
      activeZones <= MOTION_SUBJECT_MAX_ZONES) {
    Serial.printf("[OK] Motion acceptée — sujet local (cluster %d, conc %u%%, zones %u).\n",
                  largestCluster, concentration, activeZones);
    return true;
  }

  // Sujet moyen avec contraste net (évite micro-tremblements faibles)
  if (largestCluster >= MOTION_SUBJECT_MIN_CLUSTER &&
      concentration >= MOTION_MIN_CONCENTRATION_PCT &&
      maxDiff >= MOTION_SUBJECT_MIN_MAXDIFF &&
      avgDiff >= MOTION_SUBJECT_MIN_AVGDIFF &&
      avgLocalGrad >= MOTION_SUBJECT_MIN_LOCAL_GRAD) {
    Serial.printf("[OK] Motion acceptée — sujet contrasté (maxDiff=%u, grad=%u).\n",
                  maxDiff, avgLocalGrad);
    return true;
  }

  // Main/objet : changement local avec contours (sign mixte ou gradient local)
  if (largestCluster >= MOTION_MIN_CLUSTER_CELLS &&
      avgLocalGrad >= MOTION_SUBJECT_MIN_LOCAL_GRAD &&
      sameSignPct < MOTION_LIGHT_SAME_SIGN_PCT) {
    Serial.printf("[OK] Motion acceptée — sujet structure (blob=%d, grad=%u, sign=%u%%).\n",
                  largestCluster, avgLocalGrad, sameSignPct);
    return true;
  }

  Serial.printf("[INFO] Rejet : pas de sujet compact (blob=%d, conc=%u%%, grad=%u)\n",
                largestCluster, concentration, avgLocalGrad);
  return false;
}

// ============================================================
//  CAMÉRA
// ============================================================

static void lockCameraExposure() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  cameraFlushFrames(2);
  s->set_exposure_ctrl(s, 0);
  s->set_gain_ctrl(s, 0);
}

static bool cameraInitCommon(framesize_t size, pixformat_t fmt, int jpegQ, int fbCount, int warmupMs) {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = fmt;
  config.frame_size   = size;
  config.jpeg_quality = jpegQ;
  config.fb_count     = fbCount;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.grab_mode    = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ERREUR] esp_camera_init : 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_gain_ctrl(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_hmirror(s, 0);
    s->set_vflip(s, 0);
  }
  delay((unsigned long)warmupMs);
  return true;
}

bool initCameraMotion() {
  if (!cameraInitCommon(CAM_MOTION_SIZE, PIXFORMAT_RGB565, 12, 2, MOTION_CAMERA_WARMUP_MS)) {
    return false;
  }
  lockCameraExposure();
  return true;
}

bool initCameraFinal() {
  return cameraInitCommon(CAM_FINAL_SIZE, PIXFORMAT_JPEG, JPEG_FINAL_QUALITY, 1,
                         FINAL_CAMERA_WARMUP_MS);
}

void deinitCamera() {
  esp_camera_deinit();
}

bool captureFinalJpeg(camera_fb_t** outFb) {
  *outFb = nullptr;

  for (int i = 0; i < FINAL_CAPTURE_BURST; i++) {
    if (i > 0) {
      delay(FINAL_BURST_GAP_MS);
    }

    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb || fb->format != PIXFORMAT_JPEG) {
      if (fb) esp_camera_fb_return(fb);
      continue;
    }
    *outFb = fb;
    return true;
  }

  return false;
}

// ============================================================
//  SD
// ============================================================

bool initSD() {
  SD_MMC.setPins(SD_MMC_CLK, SD_MMC_CMD, SD_MMC_D0);
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("[WARN] SD_MMC mount échoué.");
    return false;
  }
  uint64_t total = SD_MMC.totalBytes();
  uint64_t used  = SD_MMC.usedBytes();
  Serial.printf("[INFO] SD OK — %llu Mo libres / %llu Mo\n",
                (unsigned long long)((total - used) / (1024 * 1024)),
                (unsigned long long)(total / (1024 * 1024)));

  if (!SD_MMC.exists(SD_PENDING_DIR))   SD_MMC.mkdir(SD_PENDING_DIR);
  if (!SD_MMC.exists(SD_UPLOADED_DIR)) SD_MMC.mkdir(SD_UPLOADED_DIR);
  if (!SD_MMC.exists(SD_FAILED_DIR))    SD_MMC.mkdir(SD_FAILED_DIR);
  return true;
}

static void formatTimestamp(char* buf, size_t len, uint32_t t) {
  uint32_t h = (t / 3600) % 24;
  uint32_t m = (t / 60) % 60;
  uint32_t s = t % 60;
  uint32_t days = t / 86400;
  snprintf(buf, len, "D%lu_%02lu%02lu%02lu", (unsigned long)days, (unsigned long)h,
           (unsigned long)m, (unsigned long)s);
}

void unmountSD() {
  SD_MMC.end();
}

bool saveEventToSD(const uint8_t* buf, size_t len, const char* destDir,
                   bool uploadedToCloud, const char* imageBase) {
  if (!buf || len == 0 || !destDir || !imageBase || imageBase[0] == '\0') {
    Serial.println("[ERREUR] Buffer JPEG vide.");
    return false;
  }
  char ts[32];
  formatTimestamp(ts, sizeof(ts), getNow());

  char jpgPath[96];
  snprintf(jpgPath, sizeof(jpgPath), "%s/%s.jpg", destDir, imageBase);

  File f = SD_MMC.open(jpgPath, FILE_WRITE);
  if (!f) {
    Serial.printf("[ERREUR] Ouverture %s\n", jpgPath);
    return false;
  }
  size_t written = f.write(buf, len);
  f.close();
  if (written != len) {
    Serial.printf("[ERREUR] Écriture incomplète %u/%u oct\n", (unsigned)written, (unsigned)len);
    return false;
  }

  char metaPath[96];
  snprintf(metaPath, sizeof(metaPath), "%s/%s.json", destDir, imageBase);
  File m = SD_MMC.open(metaPath, FILE_WRITE);
  if (m) {
    m.printf("{\"timestamp\":\"%s\",\"uploaded\":%s,\"bytes\":%u}\n",
             ts, uploadedToCloud ? "true" : "false", (unsigned)len);
    m.close();
  }
  Serial.printf("[INFO] Fichier : %s (%u oct)\n", jpgPath, (unsigned)len);
  return true;
}

bool insertDetectionRow(const String& publicUrl) {
  if (publicUrl.length() == 0) return false;

  WiFiClientSecure dbClient;
  dbClient.setInsecure();

  HTTPClient db;
  String dbUrl = String(SUPABASE_URL) + "/rest/v1/detection";
  bool ok = false;

  if (db.begin(dbClient, dbUrl)) {
    db.addHeader("Content-Type", "application/json");
    db.addHeader("Authorization", "Bearer " + String(SUPABASE_API_KEY));
    db.addHeader("apikey", String(SUPABASE_API_KEY));
    db.addHeader("Prefer", "return=minimal");

    // Conserve une forme de ligne stable pour le front, meme avant traitement IA.
    String json = "{\"image_path\":\"" + publicUrl
                + "\",\"clip_labels\":[],\"image_ia_path\":null}";

    Serial.println("[INFO] Insertion ligne detection...");
    int dbCode = db.POST(json);
    String dbResp = db.getString();
    Serial.printf("[DEBUG] DB %d — %s\n", dbCode, dbResp.c_str());
    ok = (dbCode == 200 || dbCode == 201);
    db.end();
  } else {
    Serial.println("[ERREUR] Connexion API detection impossible.");
  }

  return ok;
}

bool uploadJpegNow(const uint8_t* buf, size_t len, const char* imageBase) {
  if (!buf || len == 0 || !imageBase || imageBase[0] == '\0') return false;

  char filename[64];
  snprintf(filename, sizeof(filename), "%s.jpg", imageBase);

  String uploadUrl = String(SUPABASE_URL) + "/storage/v1/object/"
                   + SUPABASE_BUCKET + "/" + filename;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  bool ok = false;

  if (http.begin(client, uploadUrl)) {
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("Authorization", "Bearer " + String(SUPABASE_API_KEY));
    http.addHeader("apikey", String(SUPABASE_API_KEY));
    Serial.println("[INFO] Upload image...");
    int code = http.POST((uint8_t*)buf, len);
    Serial.printf("[DEBUG] HTTP %d — %s\n", code, http.getString().c_str());
    ok = (code == 200 || code == 201);
    http.end();
  }

  if (ok) {
    String publicUrl = String(SUPABASE_URL) + "/storage/v1/object/public/"
                     + SUPABASE_BUCKET + "/" + filename;
    ok = insertDetectionRow(publicUrl);
  }
  return ok;
}

// ============================================================
//  WiFi / Upload
// ============================================================

void powerOffRadios() {
  stopWebLogServer();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  btStop();
}

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
#if WEB_LOGS_ENABLED
    startWebLogServer();
#endif
    return true;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(WEB_LOG_HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[INFO] Connexion WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) {
      Serial.println(" — TIMEOUT.");
      return false;
    }
    delay(250);
    Serial.print(".");
    serviceWebLogServer();
  }
  Serial.printf("\n[OK] WiFi — IP : %s\n", WiFi.localIP().toString().c_str());
#if WEB_LOGS_ENABLED
  startWebLogServer();
#endif
  return true;
}

static bool uploadOneFile(const char* path, const char* filename) {
  File f = SD_MMC.open(path, FILE_READ);
  if (!f) return false;
  size_t len = f.size();
  if (len == 0 || len > 512000) { f.close(); return false; }

  uint8_t* buf = (uint8_t*)malloc(len);
  if (!buf) { f.close(); return false; }
  f.read(buf, len);
  f.close();

  String uploadUrl = String(SUPABASE_URL) + "/storage/v1/object/"
                   + SUPABASE_BUCKET + "/" + filename;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  bool ok = false;

  if (http.begin(client, uploadUrl)) {
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("Authorization", "Bearer " + String(SUPABASE_API_KEY));
    http.addHeader("apikey", String(SUPABASE_API_KEY));
    int code = http.POST(buf, len);
    Serial.printf("[DEBUG] HTTP %d — %s\n", code, http.getString().c_str());
    ok = (code == 200 || code == 201);
    http.end();
  }

  if (ok) {
    String publicUrl = String(SUPABASE_URL) + "/storage/v1/object/public/"
                     + SUPABASE_BUCKET + "/" + filename;
    ok = insertDetectionRow(publicUrl);
  }

  free(buf);
  return ok;
}

bool uploadPendingBatch() {
  File dir = SD_MMC.open(SD_PENDING_DIR);
  if (!dir || !dir.isDirectory()) return false;

  int sent = 0, fail = 0;
  for (;;) {
    File entry = dir.openNextFile();
    if (!entry) break;
    if (entry.isDirectory()) { entry.close(); continue; }

    String name = entry.name();
    entry.close();
    if (!name.endsWith(".jpg")) continue;

    String src = String(SD_PENDING_DIR) + "/" + name;
    Serial.printf("[INFO] Upload : %s\n", src.c_str());

    if (uploadOneFile(src.c_str(), name.c_str())) {
      sent++;
      String dst = String(SD_UPLOADED_DIR) + "/" + name;
      if (SD_MMC.exists(dst.c_str())) SD_MMC.remove(dst.c_str());
      SD_MMC.rename(src.c_str(), dst.c_str());

      int dot = name.lastIndexOf('.');
      if (dot > 0) {
        String meta = name.substring(0, dot) + ".json";
        String metaSrc = String(SD_PENDING_DIR) + "/" + meta;
        String metaDst = String(SD_UPLOADED_DIR) + "/" + meta;
        if (SD_MMC.exists(metaSrc.c_str())) {
          File mf = SD_MMC.open(metaSrc.c_str(), FILE_WRITE);
          if (mf) {
            mf.printf("{\"uploaded\":true}\n");
            mf.close();
          }
          if (SD_MMC.exists(metaDst.c_str())) SD_MMC.remove(metaDst.c_str());
          SD_MMC.rename(metaSrc.c_str(), metaDst.c_str());
        }
      }
      Serial.println("[OK] Upload + copie /uploaded.");
    } else {
      fail++;
      String dst = String(SD_FAILED_DIR) + "/" + name;
      if (SD_MMC.exists(dst.c_str())) SD_MMC.remove(dst.c_str());
      SD_MMC.rename(src.c_str(), dst.c_str());

      int dot = name.lastIndexOf('.');
      if (dot > 0) {
        String meta = name.substring(0, dot) + ".json";
        String metaSrc = String(SD_PENDING_DIR) + "/" + meta;
        String metaDst = String(SD_FAILED_DIR) + "/" + meta;
        if (SD_MMC.exists(metaSrc.c_str())) {
          if (SD_MMC.exists(metaDst.c_str())) SD_MMC.remove(metaDst.c_str());
          SD_MMC.rename(metaSrc.c_str(), metaDst.c_str());
        }
      }
      Serial.println("[WARN] Upload échoué — fichier déplacé dans /failed.");
    }
  }
  dir.close();
  Serial.printf("[INFO] Batch terminé — OK:%d FAIL:%d\n", sent, fail);
  return sent > 0;
}

// ============================================================
//  Temps / Sleep
// ============================================================

void saveBootElapsedTimeToRTC() {
  rtcTimeBaseUs += (uint64_t)esp_timer_get_time();
}

uint32_t getNow() {
  return (uint32_t)((rtcTimeBaseUs + (uint64_t)esp_timer_get_time()) / 1000000ULL);
}

uint32_t secondsUntilNextUpload() {
  uint32_t now = getNow();
  if (nextUploadAtSec <= now) return 0;
  return nextUploadAtSec - now;
}

void buildImageBasename(char* out, size_t len) {
  if (!out || len < 16) return;
  snprintf(out, len, "Img_squirrel_%lu", (unsigned long)eventCount);
}

void scheduleNextUploadFromNow() {
  uint32_t now = getNow();
  uint32_t nextIn = (uint32_t)UPLOAD_INTERVAL_HOURS * 3600U;

  nextUploadAtSec = now + nextIn;
  Serial.printf("[INFO] Prochain upload dans %lu s (~%lu h %lu min)\n",
                (unsigned long)nextIn, (unsigned long)(nextIn / 3600),
                (unsigned long)((nextIn % 3600) / 60));
}

void goToDeepSleepPIR() {
  saveBootElapsedTimeToRTC();

  uint32_t uploadIn = secondsUntilNextUpload();
  Serial.println("[INFO] Deep sleep — PIR armé (EXT1).");
  if (uploadIn > 0) {
    Serial.printf("[INFO] Timer upload parallèle dans %lu s (~%lu min).\n",
                  (unsigned long)uploadIn, (unsigned long)(uploadIn / 60));
  }
  // Ne pas attendre les logs ici : EXT1 n'est réellement armé qu'à esp_deep_sleep_start().
  // Une fenêtre web avant la veille PIR crée donc une période aveugle pour les passages rapides.
  keepWebLogWindowOpen(0, "avant deep sleep PIR");
  Serial.flush();
  delay(50);

  powerOffRadios();
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);

  gpio_reset_pin(PIR_PIN);
  rtc_gpio_init(PIR_PIN);
  rtc_gpio_set_direction(PIR_PIN, RTC_GPIO_MODE_INPUT_ONLY);
  rtc_gpio_pulldown_en(PIR_PIN);
  rtc_gpio_pullup_dis(PIR_PIN);

#if ESP_IDF_VERSION_MAJOR >= 5
  esp_sleep_enable_ext1_wakeup_io(1ULL << PIR_PIN, ESP_EXT1_WAKEUP_ANY_HIGH);
#else
  esp_sleep_enable_ext1_wakeup(1ULL << PIR_PIN, ESP_EXT1_WAKEUP_ANY_HIGH);
#endif

  if (uploadIn > 0) {
    esp_sleep_enable_timer_wakeup((uint64_t)uploadIn * 1000000ULL);
  }

  esp_deep_sleep_start();
}

void goToDeepSleepTimer(uint32_t seconds, const char* reason) {
  saveBootElapsedTimeToRTC();
  rtcTimeBaseUs += (uint64_t)seconds * 1000000ULL;

  Serial.printf("[INFO] Deep sleep TIMER %lu s — %s (PIR désarmé).\n",
                (unsigned long)seconds, reason ? reason : "-");
  keepWebLogWindowOpen(WEB_LOG_WINDOW_MS, "avant deep sleep TIMER");
  Serial.flush();
  delay(50);

  powerOffRadios();
  esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL);
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  esp_deep_sleep_start();
}

bool waitForPirToGoLow(uint32_t timeoutMs) {
  uint32_t start = millis();
  while ((millis() - start) < timeoutMs) {
    if (digitalRead((uint8_t)PIR_PIN) == LOW) {
      Serial.println("[INFO] PIR revenu à LOW.");
      return true;
    }
    serviceWebLogServer();
    delay(PIR_LOW_POLL_MS);
  }
  Serial.println("[WARN] Timeout attente PIR LOW.");
  return false;
}

bool pirReadFirst() {
  pinMode((uint8_t)PIR_PIN, INPUT);
  int val = digitalRead((uint8_t)PIR_PIN);
  Serial.printf("[INFO] PIR lecture #1 = %d\n", val);
  return val == HIGH;
}

bool pirConfirm() {
  uint8_t high = 0;
  for (uint8_t i = 0; i < PIR_CONFIRM_SAMPLES; i++) {
    if (digitalRead((uint8_t)PIR_PIN) == HIGH) high++;
    serviceWebLogServer();
    if (i < PIR_CONFIRM_SAMPLES - 1) delay(PIR_CONFIRM_INTERVAL_MS);
  }
  Serial.printf("[INFO] PIR confirmation : %d/%d HIGH (min %d)\n",
                high, PIR_CONFIRM_SAMPLES, PIR_CONFIRM_MIN_HIGH);
  return high >= PIR_CONFIRM_MIN_HIGH;
}

// ============================================================
//  Logs
// ============================================================

void appendToWebLogBuffer(const uint8_t* data, size_t len) {
  if (!data || len == 0) return;

  if (len >= (WEB_LOG_BUFFER_SIZE - 1)) {
    data += (len - (WEB_LOG_BUFFER_SIZE - 1));
    len = WEB_LOG_BUFFER_SIZE - 1;
  }

  size_t freeSpace = (WEB_LOG_BUFFER_SIZE - 1) - webLogLen;
  if (len > freeSpace) {
    size_t drop = len - freeSpace;
    if (drop > webLogLen) drop = webLogLen;
    if (drop > 0) {
      memmove(webLogBuffer, webLogBuffer + drop, webLogLen - drop);
      webLogLen -= drop;
    }
  }

  memcpy(webLogBuffer + webLogLen, data, len);
  webLogLen += (uint16_t)len;
  webLogBuffer[webLogLen] = '\0';
}

void startWebLogServer() {
#if WEB_LOGS_ENABLED
  if (WiFi.status() != WL_CONNECTED) return;

  if (!webLogRoutesReady) {
    webLogServer.on("/", HTTP_GET, []() {
      webLogServer.send_P(200, "text/html; charset=utf-8", WEB_LOG_PAGE);
    });
    webLogServer.on("/logs", HTTP_GET, []() {
      webLogServer.send(200, "text/plain; charset=utf-8", webLogBuffer);
    });
    webLogServer.on("/health", HTTP_GET, []() {
      String body = "{\"boot\":";
      body += String(bootCount);
      body += ",\"ip\":\"";
      body += WiFi.localIP().toString();
      body += "\"}";
      webLogServer.send(200, "application/json", body);
    });
    webLogRoutesReady = true;
  }

  if (webLogServerStarted) return;

  webLogServer.begin();
  webLogServerStarted = true;

  if (MDNS.begin(WEB_LOG_HOSTNAME)) {
    Serial.printf("[OK] Logs web : http://%s.local/\n", WEB_LOG_HOSTNAME);
  } else {
    Serial.println("[WARN] mDNS indisponible — utiliser l'IP.");
  }
  Serial.printf("[OK] Logs web : http://%s/\n", WiFi.localIP().toString().c_str());
#endif
}

void stopWebLogServer() {
#if WEB_LOGS_ENABLED
  if (webLogServerStarted) {
    webLogServer.stop();
    webLogServerStarted = false;
  }
  MDNS.end();
#endif
}

void serviceWebLogServer() {
#if WEB_LOGS_ENABLED
  if (webLogServerStarted) {
    webLogServer.handleClient();
  }
#endif
}

void keepWebLogWindowOpen(uint32_t ms, const char* reason) {
#if WEB_LOGS_ENABLED
  if (ms == 0 || WiFi.status() != WL_CONNECTED || !webLogServerStarted) return;

  Serial.printf("[INFO] Logs web accessibles %lu ms — %s\n",
                (unsigned long)ms, reason ? reason : "debug");
  uint32_t start = millis();
  while ((millis() - start) < ms) {
    serviceWebLogServer();
    delay(10);
  }
#endif
}

void logBootHeader() {
  Serial.println();
  Serial.printf("=== SQUIRREL DETECTOR v2.2 — Réveil #%lu ===\n", (unsigned long)bootCount);
#if IMMEDIATE_WIFI_UPLOAD
  Serial.println("[INFO] Mode TEST : upload WiFi après chaque capture.");
#endif
  Serial.printf("[INFO] PSRAM: %u  Heap: %u\n", ESP.getPsramSize(), ESP.getFreeHeap());
}

const char* wakeCauseStr(esp_sleep_wakeup_cause_t c) {
  switch (c) {
    case ESP_SLEEP_WAKEUP_EXT0:  return "EXT0";
    case ESP_SLEEP_WAKEUP_EXT1:  return "EXT1 (PIR)";
    case ESP_SLEEP_WAKEUP_TIMER: return "TIMER";
    case ESP_SLEEP_WAKEUP_TOUCHPAD: return "TOUCH";
    case ESP_SLEEP_WAKEUP_ULP: return "ULP";
    case ESP_SLEEP_WAKEUP_GPIO: return "GPIO";
    default: return "RESET/POWERON";
  }
}