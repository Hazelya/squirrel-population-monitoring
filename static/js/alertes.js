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
  console.log(alertes);

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>#Alerte</th>
          <th>#Photo</th>
          <th>Type d'alerte</th>
          <th>Date</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>
        ${alertes.map(a => `
          <tr class="alertes" data-id="${a.detection_id}">
            <td>${a.id_alerte}</td>
            <td class="td-img">
              ${a.detection_id}
            </td>
            <td><span class="badge badge--warning">${a.type_alerte || '—'}</span></td>
            <td>${formatDate(a.date_alerte)}</td>
            <td>${a.statut || '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.querySelectorAll('.alertes').forEach(alerte => {
    alerte.addEventListener('click', () => {
      const id = alerte.dataset.id;
      window.location.href = `/analyse-page/${id}`;
    });
  });
}

