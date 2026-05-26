import { fetchDetections, fetchAlertes } from "./fetch.js";
import { imgTag } from "./helpers.js";

// ─── PAGE: ACCUEIL ────────────────────────────────────────────────────────────

export async function initAccueil() {
  const [detections, alertes] = await Promise.all([fetchDetections(), fetchAlertes()]);
  const malades = detections.filter(d => d.malade).length;

  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${detections.length}</div>
      <div class="stat-label">Détections totales</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${alertes.length}</div>
      <div class="stat-label">Alertes sanitaires</div>
    </div>
    <div class="stat-card ${malades > 0 ? 'stat-card--danger' : ''}">
      <div class="stat-value">${malades}</div>
      <div class="stat-label">Individus malades</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${detections.length > 0 ? Math.round((detections.length - malades) / detections.length * 100) : 0}%</div>
      <div class="stat-label">Individus sains</div>
    </div>
  `;

  const recent = detections.slice(0, 8);
  const grid = document.getElementById('recent-detections');
  if (recent.length === 0) {
    grid.innerHTML = '<p class="empty-state">Aucune détection enregistrée.</p>';
  } else {
    grid.innerHTML = `
      <div class="detections-grid">
        ${recent.map(d => `
          <div class="detection-card" data-id="${d.id_detection}" role="button" tabindex="0">
            <div class="detection-card__img">${imgTag(d.image_path, `#${d.id_detection}`)}</div>
            <div class="detection-card__info">
              <span class="detection-id">#${d.id_detection}</span>
              ${d.malade ? '<span class="badge badge--danger">Malade</span>' : '<span class="badge badge--ok">Sain</span>'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    document.querySelectorAll('.detection-card').forEach(card => {
      card.addEventListener('click', () => {
        window.location.href = `/analyse-page/${card.dataset.id}`;
      });
    });
  }

  initUpload();
}

// ─── UPLOAD CLIP ─────────────────────────────────────────────────────────────

function initUpload() {
  const zone        = document.getElementById('upload-zone');
  const fileInput   = document.getElementById('file-input');
  const folderInput = document.getElementById('folder-input');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('upload-zone--over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('upload-zone--over'));
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('upload-zone--over');
    const files = await collectDroppedFiles(e.dataTransfer);
    if (files.length === 1) processFile(files[0]);
    else if (files.length > 1) processBatch(files);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processFile(fileInput.files[0]);
  });

  folderInput.addEventListener('change', () => {
    const files = Array.from(folderInput.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 1) processFile(files[0]);
    else if (files.length > 1) processBatch(files);
  });
}

// Récupère tous les fichiers image depuis un drop (fichiers + dossiers)
async function collectDroppedFiles(dataTransfer) {
  const files = [];
  const items = dataTransfer.items;

  if (items && items[0] && items[0].webkitGetAsEntry) {
    const entries = Array.from(items).map(i => i.webkitGetAsEntry()).filter(Boolean);
    for (const entry of entries) {
      await readEntry(entry, files);
    }
  } else {
    for (const f of dataTransfer.files) {
      if (f.type.startsWith('image/')) files.push(f);
    }
  }
  return files;
}

function readEntry(entry, files) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(f => { if (f.type.startsWith('image/')) files.push(f); resolve(); }, resolve);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => {
        reader.readEntries(async entries => {
          if (!entries.length) return resolve();
          for (const e of entries) await readEntry(e, files);
          readAll();
        }, resolve);
      };
      readAll();
    } else {
      resolve();
    }
  });
}

async function processBatch(files) {
  const zone   = document.getElementById('upload-zone');
  const panel  = document.getElementById('upload-panel');
  const result = document.getElementById('upload-result');

  zone.classList.add('hidden');
  panel.classList.remove('hidden');
  document.getElementById('upload-preview-img').src = '';
  document.getElementById('upload-preview').style.visibility = 'hidden';

  const total   = files.length;
  const results = [];

  const showBatchProgress = (done) => {
    result.innerHTML = `
      <div class="clip-progress">
        <div class="clip-progress__bar-track">
          <div class="clip-progress__bar-fill" id="progress-fill" style="width:${Math.round(done/total*100)}%"></div>
        </div>
        <div class="clip-progress__info">
          <span>Analyse en cours… ${done} / ${total} photos</span>
          <span>${Math.round(done/total*100)}%</span>
        </div>
      </div>
      ${results.length ? renderBatchMini(results) : ''}
    `;
  };

  showBatchProgress(0);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res  = await fetch('/upload', { method: 'POST', body: formData });
      const data = await res.json();
      results.push({ file: file.name, ...data });
    } catch {
      results.push({ file: file.name, error: 'Erreur réseau' });
    }
    showBatchProgress(i + 1);
  }

  // Résumé final
  const sains   = results.filter(r => r.top && !r.malade).length;
  const malades = results.filter(r => r.malade).length;
  const erreurs = results.filter(r => r.error).length;

  result.innerHTML = `
    <div class="batch-summary">
      <div class="batch-summary__stats">
        <span class="batch-stat batch-stat--ok">✓ ${sains} sain${sains > 1 ? 's' : ''}</span>
        ${malades ? `<span class="batch-stat batch-stat--danger">⚠ ${malades} malade${malades > 1 ? 's' : ''}</span>` : ''}
        ${erreurs ? `<span class="batch-stat batch-stat--err">✕ ${erreurs} erreur${erreurs > 1 ? 's' : ''}</span>` : ''}
        <span class="batch-stat batch-stat--total">${total} photos au total</span>
      </div>
      ${renderBatchMini(results)}
      <div class="clip-result__actions" style="margin-top:1rem">
        <button class="btn btn--secondary" onclick="resetUpload()">Analyser un autre dossier</button>
        <a href="/photos-page" class="btn btn--ghost">Voir toutes les photos</a>
      </div>
    </div>
  `;

  document.getElementById('upload-preview').style.visibility = '';
}

function renderBatchMini(results) {
  return `
    <div class="batch-grid">
      ${results.map(r => `
        <div class="batch-card ${r.malade ? 'batch-card--danger' : r.error ? 'batch-card--err' : ''}">
          <div class="batch-card__name">${r.file}</div>
          <div class="batch-card__result">
            ${r.error
              ? `<span class="badge badge--danger">Erreur</span>`
              : `<span class="badge ${r.malade ? 'badge--danger' : 'badge--ok'}">${r.top.species}</span>
                 <span class="batch-card__conf">${r.top.confidence}%</span>`
            }
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function processFile(file) {
  const panel   = document.getElementById('upload-panel');
  const preview = document.getElementById('upload-preview-img');
  const result  = document.getElementById('upload-result');
  const zone    = document.getElementById('upload-zone');

  preview.src = URL.createObjectURL(file);
  panel.classList.remove('hidden');
  zone.classList.add('hidden');

  // ── Barre de progression ──
  result.innerHTML = `
    <div class="clip-progress">
      <div class="clip-progress__bar-track">
        <div class="clip-progress__bar-fill" id="progress-fill" style="width:0%"></div>
      </div>
      <div class="clip-progress__info">
        <span id="progress-label">Lecture de l'image…</span>
        <span id="progress-pct">0%</span>
      </div>
    </div>
  `;

  const fill  = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  const pct   = document.getElementById('progress-pct');

  // Phases animées
  let stopped = false;
  const setProgress = (value, text) => {
    if (stopped) return;
    fill.style.width  = value + '%';
    pct.textContent   = value + '%';
    label.textContent = text;
  };

  setTimeout(() => setProgress(15, 'Envoi au serveur…'),      200);
  setTimeout(() => setProgress(40, 'Chargement du modèle CLIP…'), 700);

  // Progression lente pendant l'attente serveur
  let current = 40;
  const crawl = setInterval(() => {
    if (stopped || current >= 85) { clearInterval(crawl); return; }
    current += 1;
    setProgress(current, 'Analyse CLIP en cours…');
  }, 300);

  // Envoyer au serveur
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res  = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();

    stopped = true;
    clearInterval(crawl);

    if (data.error) {
      setProgress(100, 'Erreur');
      fill.style.background = 'var(--danger)';
      setTimeout(() => {
        result.innerHTML = `<p class="error">${data.error}</p>
          <button class="btn btn--ghost" onclick="resetUpload()">Réessayer</button>`;
      }, 400);
      return;
    }

    setProgress(100, 'Analyse terminée !');
    fill.style.background = 'var(--success)';
    setTimeout(() => renderClipResult(result, data), 500);

  } catch {
    stopped = true;
    clearInterval(crawl);
    result.innerHTML = `<p class="error">Erreur de connexion au serveur.</p>
      <button class="btn btn--ghost" onclick="resetUpload()">Réessayer</button>`;
  }
}

function renderClipResult(container, data) {
  const top    = data.top;
  const all    = data.all;
  const malade = data.malade;

  const badgeClass = malade ? 'badge--danger' : 'badge--ok';

  container.innerHTML = `
    <div class="clip-result">
      <div class="clip-result__top">
        <div class="clip-result__species">
          <span class="badge ${badgeClass} badge--lg">${top.species}</span>
          ${malade ? '<span class="clip-alert-tag">⚠️ Alerte sanitaire</span>' : ''}
        </div>
        <div class="clip-confidence-main">${top.confidence}%</div>
      </div>

      <div class="clip-bars">
        ${all.map(item => `
          <div class="clip-bar-row">
            <span class="clip-bar-label">${item.species}</span>
            <div class="clip-bar-track">
              <div class="clip-bar-fill" style="width: ${item.confidence}%; background: ${barColor(item.species, malade)}"></div>
            </div>
            <span class="clip-bar-value">${item.confidence}%</span>
          </div>
        `).join('')}
      </div>

      <div class="clip-save-status">
        ${data.saved
          ? `<span class="save-tag save-tag--ok">✓ Enregistré en base${data.detection_id ? ` <a href="/analyse-page/${data.detection_id}">#${data.detection_id}</a>` : ''}</span>`
          : `<span class="save-tag save-tag--err">⚠ Non enregistré${data.db_error ? ` — ${data.db_error}` : ''}</span>`
        }
      </div>

      <div class="clip-result__actions">
        <button class="btn btn--secondary" onclick="resetUpload()">Analyser une autre image</button>
        <a href="/photos-page" class="btn btn--ghost">Voir toutes les photos</a>
      </div>
    </div>
  `;
}

function barColor(species, malade) {
  if (species === 'Individu malade') return '#f87171';
  if (species === 'Ecureuil roux')   return '#f97316';
  if (species === 'Ecureuil gris')   return '#94a3b8';
  if (species === 'Tamia de Sibérie') return '#f59e0b';
  return '#64748b';
}

window.resetUpload = function () {
  document.getElementById('upload-panel').classList.add('hidden');
  document.getElementById('upload-zone').classList.remove('hidden');
  document.getElementById('file-input').value = '';
};
