
// ─── SUPABASE CLIENT ─────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://doqxtwvpchqzyatwpnfs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MQ-9tSe5oNpUvrpkr9e5rA_al23yVbX';
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getImageUrl(imagePath) {
  if (!imagePath) return null;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  return `${SUPABASE_URL}/storage/v1/object/public/images/${imagePath}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function imgTag(imagePath, alt = 'Détection') {
  const url = getImageUrl(imagePath);
  if (!url) return `<div class="no-image"><span>Pas d'image</span></div>`;
  return `<img src="${url}" alt="${alt}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-image\\'><span>Indisponible</span></div>'">`;
}

function goToAnalyse(id) {
  window.location.href = `analyse.html?id=${id}`;
}

// ─── DATA FETCHERS ────────────────────────────────────────────────────────────

async function fetchDetections(limit = null) {
  let query = db.from('detections').select('*').order('id_detection', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) { console.error('fetchDetections:', error); return []; }
  return data || [];
}

async function fetchOneDetection(id) {
  const { data, error } = await db
    .from('detections').select('*').eq('id_detection', id).single();
  if (error) { console.error('fetchOneDetection:', error); return null; }
  return data;
}

async function fetchAlertes() {
  const { data, error } = await db
    .from('alertes')
    .select('*, detections(image_path)')
    .order('id_alerte', { ascending: false });
  if (error) { console.error('fetchAlertes:', error); return []; }
  return data || [];
}

async function fetchAlertesByDetection(detectionId) {
  const { data, error } = await db
    .from('alertes').select('*').eq('detection_id', detectionId);
  if (error) { console.error('fetchAlertesByDetection:', error); return []; }
  return data || [];
}

// ─── PAGE: ACCUEIL (main.html) ────────────────────────────────────────────────

async function initAccueil() {
  const [detections, alertes] = await Promise.all([fetchDetections(), fetchAlertes()]);

  const malades = detections.filter(d => d.malade).length;

  // Stats cards
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

  // 8 dernières détections
  const recent = detections.slice(0, 8);
  const grid = document.getElementById('recent-detections');
  if (recent.length === 0) {
    grid.innerHTML = '<p class="empty-state">Aucune détection enregistrée.</p>';
    return;
  }
  grid.innerHTML = `
    <div class="detections-grid">
      ${recent.map(d => `
        <div class="detection-card" onclick="goToAnalyse(${d.id_detection})" role="button" tabindex="0">
          <div class="detection-card__img">${imgTag(d.image_path, `#${d.id_detection}`)}</div>
          <div class="detection-card__info">
            <span class="detection-id">#${d.id_detection}</span>
            ${d.malade ? '<span class="badge badge--danger">Malade</span>' : '<span class="badge badge--ok">Sain</span>'}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ─── PAGE: STATISTIQUES (stats.html) ─────────────────────────────────────────

async function initStats() {
  const [detections, alertes] = await Promise.all([fetchDetections(), fetchAlertes()]);

  const malades = detections.filter(d => d.malade).length;
  const sains = detections.length - malades;

  // Summary cards
  document.getElementById('stats-summary').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${detections.length}</div>
      <div class="stat-label">Total détections</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${malades}</div>
      <div class="stat-label">Malades</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${alertes.length}</div>
      <div class="stat-label">Alertes</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${detections.length > 0 ? Math.round(malades / detections.length * 100) : 0}%</div>
      <div class="stat-label">Taux de maladie</div>
    </div>
  `;

  // Alerts recap table
  const tableEl = document.getElementById('stats-table');
  if (alertes.length === 0) {
    tableEl.innerHTML = '<p class="empty-state">Aucune alerte enregistrée.</p>';
  } else {
    tableEl.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>#</th><th>Type</th><th>Date</th><th>Statut</th></tr>
        </thead>
        <tbody>
          ${alertes.slice(0, 10).map(a => `
            <tr>
              <td>${a.id_alerte}</td>
              <td><span class="badge badge--warning">${a.type_alerte || '—'}</span></td>
              <td>${formatDate(a.date_alerte)}</td>
              <td>${a.statut || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${alertes.length > 10 ? `<p class="table-note">10 premières sur ${alertes.length}. <a href="alertes.html" class="link">Voir toutes →</a></p>` : ''}
    `;
  }

  // Charts
  if (typeof Chart === 'undefined') return;

  const santeCtx = document.getElementById('chart-sante');
  if (santeCtx) {
    new Chart(santeCtx, {
      type: 'pie',
      data: {
        labels: ['Sains', 'Malades'],
        datasets: [{ data: [sains, malades], backgroundColor: ['#4ade80', '#f87171'], borderColor: ['#166534', '#991b1b'], borderWidth: 1 }]
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#e2e8f0' } } } }
    });
  }

  const alertTypes = {};
  alertes.forEach(a => { alertTypes[a.type_alerte] = (alertTypes[a.type_alerte] || 0) + 1; });
  const alertesCtx = document.getElementById('chart-alertes');
  if (alertesCtx) {
    const labels = Object.keys(alertTypes);
    new Chart(alertesCtx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Aucune alerte'],
        datasets: [{ label: "Nombre d'alertes", data: labels.length ? Object.values(alertTypes) : [0], backgroundColor: '#f97316', borderColor: '#c2410c', borderWidth: 1 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#e2e8f0' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: '#1e293b' } }
        }
      }
    });
  }
}

// ─── PAGE: PHOTOS (photos.html) ───────────────────────────────────────────────

const PHOTOS_PER_PAGE = 24;
let photosAllData = [];

async function initPhotos() {
  photosAllData = await fetchDetections();
  renderPhotosPage(0);
}

function renderPhotosPage(page) {
  const total = photosAllData.length;
  const totalPages = Math.ceil(total / PHOTOS_PER_PAGE);
  const slice = photosAllData.slice(page * PHOTOS_PER_PAGE, (page + 1) * PHOTOS_PER_PAGE);

  document.getElementById('photos-count').textContent = `${total} détection${total > 1 ? 's' : ''} au total`;

  const grid = document.getElementById('photos-grid');
  if (slice.length === 0) {
    grid.innerHTML = '<p class="empty-state">Aucune photo disponible.</p>';
  } else {
    grid.innerHTML = `
      <div class="detections-grid detections-grid--large">
        ${slice.map(d => `
          <div class="detection-card" onclick="goToAnalyse(${d.id_detection})" role="button" tabindex="0">
            <div class="detection-card__img">${imgTag(d.image_path, `#${d.id_detection}`)}</div>
            <div class="detection-card__info">
              <span class="detection-id">#${d.id_detection}</span>
              ${d.malade ? '<span class="badge badge--danger">Malade</span>' : '<span class="badge badge--ok">Sain</span>'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  document.getElementById('photos-pagination').innerHTML = totalPages > 1 ? `
    <div class="pagination">
      <button class="btn btn--secondary" onclick="renderPhotosPage(${page - 1})" ${page === 0 ? 'disabled' : ''}>← Précédent</button>
      <span class="pagination-info">Page ${page + 1} / ${totalPages}</span>
      <button class="btn btn--secondary" onclick="renderPhotosPage(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}>Suivant →</button>
    </div>
  ` : '';
}

// ─── PAGE: ANALYSE (analyse.html) ────────────────────────────────────────────

async function initAnalyse() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const container = document.getElementById('analyse-content');

  if (!id) {
    container.innerHTML = `
      <section class="section">
        <h2>Analyse de détection</h2>
        <p class="empty-state">Aucune détection sélectionnée. <a href="photos.html">Choisissez une photo</a>.</p>
      </section>`;
    return;
  }

  const [detection, alertes] = await Promise.all([
    fetchOneDetection(id),
    fetchAlertesByDetection(id),
  ]);

  if (!detection) {
    container.innerHTML = '<p class="error">Détection introuvable.</p>';
    return;
  }

  const metaFields = Object.entries(detection)
    .filter(([k]) => k !== 'image_path')
    .map(([k, v]) => `<tr><th>${k}</th><td>${v === null || v === undefined ? '—' : String(v)}</td></tr>`)
    .join('');

  container.innerHTML = `
    <section class="section">
      <div class="analyse-header">
        <a href="photos.html" class="btn btn--ghost">← Retour aux photos</a>
        <h2>Détection #${detection.id_detection}</h2>
        ${detection.malade
          ? '<span class="badge badge--danger badge--lg">Individu malade</span>'
          : '<span class="badge badge--ok badge--lg">Individu sain</span>'}
      </div>

      <div class="analyse-grid">
        <div class="analyse-image">
          ${imgTag(detection.image_path, `Détection #${detection.id_detection}`)}
        </div>
        <div class="analyse-details">
          <h3>Métadonnées</h3>
          <table class="data-table meta-table">
            <tbody>${metaFields}</tbody>
          </table>

          ${alertes.length > 0 ? `
            <h3>Alertes liées</h3>
            <table class="data-table">
              <thead><tr><th>Type</th><th>Date</th><th>Statut</th></tr></thead>
              <tbody>
                ${alertes.map(a => `
                  <tr>
                    <td><span class="badge badge--warning">${a.type_alerte || '—'}</span></td>
                    <td>${formatDate(a.date_alerte)}</td>
                    <td>${a.statut || '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          ` : ''}

          <div class="analyse-actions">
            <button class="btn btn--danger" onclick="deleteDetection(${detection.id_detection})">
              Supprimer cette détection
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

async function deleteDetection(id) {
  if (!confirm(`Supprimer la détection #${id} et ses alertes ? Cette action est irréversible.`)) return;
  const { error: e1 } = await db.from('alertes').delete().eq('detection_id', id);
  if (e1) { alert('Erreur lors de la suppression des alertes.'); return; }
  const { error: e2 } = await db.from('detections').delete().eq('id_detection', id);
  if (e2) { alert('Erreur lors de la suppression de la détection.'); return; }
  window.location.href = 'photos.html';
}

// ─── PAGE: ALERTES (alertes.html) ────────────────────────────────────────────

async function initAlertes() {
  const alertes = await fetchAlertes();

  document.getElementById('alertes-count').textContent =
    `${alertes.length} alerte${alertes.length > 1 ? 's' : ''} enregistrée${alertes.length > 1 ? 's' : ''}`;

  const container = document.getElementById('alertes-table');
  if (alertes.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucune alerte sanitaire enregistrée.</p>';
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Photo</th>
          <th>Type d'alerte</th>
          <th>Date</th>
          <th>Statut</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${alertes.map(a => `
          <tr>
            <td>${a.id_alerte}</td>
            <td class="td-img">
              ${a.detections?.image_path
                ? `<img src="${getImageUrl(a.detections.image_path)}" alt="alerte" loading="lazy" class="table-thumb" onerror="this.style.display='none'">`
                : '—'}
            </td>
            <td><span class="badge badge--warning">${a.type_alerte || '—'}</span></td>
            <td>${formatDate(a.date_alerte)}</td>
            <td>${a.statut || '—'}</td>
            <td>
              ${a.detection_id
                ? `<button class="btn btn--sm btn--primary" onclick="goToAnalyse(${a.detection_id})">Voir</button>`
                : '—'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ─── POPUP D'ALERTE ───────────────────────────────────────────────────────────

async function checkAlertPopup() {
  if (sessionStorage.getItem('alertPopupShown')) return;
  const alertes = await fetchAlertes();
  if (alertes.length === 0) return;

  const latest = alertes[0];
  document.getElementById('popup-type').textContent = latest.type_alerte || 'Alerte sanitaire';
  document.getElementById('popup-date').textContent = formatDate(latest.date_alerte);

  const btn = document.getElementById('popup-link');
  if (latest.detection_id) {
    btn.style.display = 'inline-flex';
    btn.onclick = () => { closePopup(); goToAnalyse(latest.detection_id); };
  } else {
    btn.style.display = 'none';
  }

  document.getElementById('alert-popup').classList.remove('hidden');
  sessionStorage.setItem('alertPopupShown', '1');
}

function closePopup() {
  document.getElementById('alert-popup').classList.add('hidden');
}

// ─── INITIALISATION ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Lien actif dans la navbar
  const currentFile = window.location.pathname.split('/').pop() || 'main.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('href') === currentFile) link.classList.add('active');
  });

  // Menu mobile
  const toggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => navLinks.classList.toggle('navbar__links--open'));
  }

  // Fermer popup en cliquant sur l'overlay
  const overlay = document.getElementById('alert-popup');
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });

  // Vérifier popup d'alerte
  checkAlertPopup();

  // Lancer la fonction de la page courante
  const page = document.body.dataset.page;
  switch (page) {
    case 'accueil':  initAccueil(); break;
    case 'stats':    initStats();   break;
    case 'photos':   initPhotos();  break;
    case 'analyse':  initAnalyse(); break;
    case 'alertes':  initAlertes(); break;
    // projet et infos sont statiques, rien à charger
  }
});
