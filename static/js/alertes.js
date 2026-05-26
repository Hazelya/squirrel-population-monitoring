import { fetchAlertes } from "./fetch.js";
import { getImageUrl, formatDate } from "./helpers.js";

// ─── PAGE: ALERTES (alertes.html) ────────────────────────────────────────────

export async function initAlertes() {
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

