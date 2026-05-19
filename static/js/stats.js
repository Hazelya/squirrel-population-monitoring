import { fetchDetections, fetchOneDetection, fetchAlertes, fetchAlertesByDetection } from "./fetch.js";
import { getImageUrl, formatDate, imgTag, goToAnalyse } from "./helpers.js";


// ─── PAGE: STATISTIQUES (stats.html) ─────────────────────────────────────────

export async function initStats() {
  const alertes = await fetchAlertes();
  const detections = await fetchDetections();
  //const [detections, alertes] = await Promise.all([fetchDetections(), fetchAlertes()]);

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