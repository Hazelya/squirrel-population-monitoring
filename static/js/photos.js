import { fetchDetections, fetchOneDetection, fetchAlertes, fetchAlertesByDetection } from "./fetch.js";
import { getImageUrl, formatDate, imgTag, goToAnalyse } from "./helpers.js";

// ─── PAGE: PHOTOS (photos.html) ───────────────────────────────────────────────

const PHOTOS_PER_PAGE = 24;
let photosAllData = [];

export async function initPhotos() {
  photosAllData = await fetchDetections();
  renderPhotosPage(0);
}

export function renderPhotosPage(page) {
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
          <div class="detection-card"
              data-id="${d.id_detection}"
              role="button"
              tabindex="0">
            <div class="detection-card__img">
              ${imgTag(d.image_path, `#${d.id_detection}`)}
            </div>
            <div class="detection-card__info">
              <span class="detection-id">#${d.id_detection}</span>
              ${d.malade
                ? '<span class="badge badge--danger">Malade</span>'
                : '<span class="badge badge--ok">Sain</span>'}
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

  document.querySelectorAll('.detection-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      window.location.href = `/analyse-page/${id}`;
    });
  });
}
