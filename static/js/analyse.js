import { fetchDetections, fetchOneDetection, fetchAlertes, fetchAlertesByDetection, fetchRemove } from "./fetch.js";
import { getImageUrl, formatDate, imgTag, goToAnalyse } from "./helpers.js";


// ─── PAGE: ANALYSE (analyse.html) ────────────────────────────────────────────

export async function initAnalyse() {
  const pathParts = window.location.pathname.split('/');
  const id = pathParts[pathParts.length - 1];

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

  const d = detection[0];

  const metaFields = Object.entries(d)
    .filter(([k]) => k !== 'image_path')
    .filter(([k]) => k !== 'clip_labels')
    .map(([k, v]) => `
      <tr>
        <th>${k}</th>
        <td>${v === null || v === undefined ? '—' : String(v)}</td>
      </tr>
    `)
    .join('');

  
  let clipLabel = `<tr> <th>Clip Label</th> <td>`
  d.clip_labels.forEach(element => {
    clipLabel += 
    `${element === null || element === undefined ? '—' : String(element.confidence + " % :  " + element.species)} <br>`
  });
  clipLabel += `</td></tr>`

  container.innerHTML = `
    <section class="section">
      <div class="analyse-header">
        <a href="/photos-page" class="btn btn--ghost">← Retour aux photos</a>
        <h2>Détection #${d.id_detection}</h2>
        ${d.malade
          ? '<span class="badge badge--danger badge--lg">Individu malade</span>'
          : '<span class="badge badge--ok badge--lg">Individu sain</span>'}
      </div>

      <div class="analyse-grid">
        <div class="analyse-image">
          ${imgTag(d.image_ia_path, `#${d.id_detection}`)}
        </div>
        <div class="analyse-details">
          <h3>Métadonnées</h3>
          <table class="data-table meta-table">
            <tbody>${clipLabel}${metaFields}</tbody>
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
            <button class="btn btn--danger btn-remove" data-id="${d.id_detection}">
              Supprimer cette détection
            </button>
          </div>
        </div>
      </div>
    </section>
  `;

  document.querySelectorAll('.btn-remove').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      fetchRemove(id);
      window.location.href = `/photos-page`;
    });
  });

}

