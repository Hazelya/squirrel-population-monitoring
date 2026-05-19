
import { fetchDetections, fetchOneDetection, fetchAlertes, fetchAlertesByDetection } from "./fetch.js";
import { getImageUrl, formatDate, imgTag, goToAnalyse } from "./helpers.js";

// ─── PAGE: ACCUEIL (main.html) ────────────────────────────────────────────────

export async function initAccueil() {
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
        <div class="detection-card"
              data-id="${d.id_detection}"
              role="button"
              tabindex="0">
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
      const id = card.dataset.id;
      window.location.href = `/analyse-page/${id}`;
    });
  });
}