import { fetchAlertes } from "./fetch.js";
import { formatDate } from "./helpers.js";

const ALERTES_PER_PAGE = 10;
let alertesAllData = [];

export async function initAlertes() {
  alertesAllData = await fetchAlertes();
  renderAlertespage(0);
}

export async function renderAlertespage(page = 0) {

  // Trier du plus récent au plus ancien
  alertesAllData.sort((a, b) => {
    return new Date(b.date_alerte) - new Date(a.date_alerte);
  });

  const total = alertesAllData.length;
  const totalPages = Math.ceil(total / ALERTES_PER_PAGE);

  // Pagination
  const start = page * ALERTES_PER_PAGE;
  const end = start + ALERTES_PER_PAGE;

  const slice = alertesAllData.slice(start, end);

  document.getElementById('alertes-count').textContent =
    `${total} alerte${total > 1 ? 's' : ''} enregistrée${total > 1 ? 's' : ''}`;

  const container = document.getElementById('alertes-table');

  if (slice.length === 0) {
    container.innerHTML =
      '<p class="empty-state">Aucune alerte sanitaire enregistrée.</p>';
    return;
  }

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
        ${slice.map(a => `
          <tr class="alertes" data-id="${a.detection_id}">
            <td>${a.id_alerte}</td>
            <td class="td-img">
              ${a.detection_id}
            </td>
            <td>
              <span class="badge badge--warning">
                ${a.type_alerte || '—'}
              </span>
            </td>
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

  document.getElementById('alertes-pagination').innerHTML =
    totalPages > 1
      ? `
      <div class="pagination">
        <button
          class="btn btn--primary"
          onclick="window.changeAlertesPage(${page - 1})"
          ${page === 0 ? 'disabled' : ''}
        >
          ← Précédent
        </button>

        <span class="pagination-info">
          Page ${page + 1} / ${totalPages}
        </span>

        <button
          class="btn btn--primary"
          onclick="window.changeAlertesPage(${page + 1})"
          ${page >= totalPages - 1 ? 'disabled' : ''}
        >
          Suivant →
        </button>
      </div>
    `
      : '';
}

window.changeAlertesPage = renderAlertespage;