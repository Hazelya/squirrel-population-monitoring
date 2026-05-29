import { fetchDetections, fetchAlertes } from "./fetch.js";
import { imgTag } from "./helpers.js";


// ─── PAGE: ACCUEIL ────────────────────────────────────────────────────

export async function initAccueil() {

  const [detections, alertes] = await Promise.all([
    fetchDetections(),
    fetchAlertes()
  ]);

  document.getElementById('stats-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${detections.length}</div>
      <div class="stat-label">Images uploadées</div>
    </div>

    <div class="stat-card">
      <div class="stat-value">${alertes.length}</div>
      <div class="stat-label">Alertes</div>
    </div>
  `;

  const recent = [...detections]
  .sort((a, b) => {
    return new Date(b.date_detection) - new Date(a.date_detection);
  })
  .slice(0, 8);

  const grid = document.getElementById('recent-detections');

  if (recent.length === 0) {

    grid.innerHTML = `
      <p class="empty-state">Aucune image enregistrée.</p>
    `;

  } else {

    grid.innerHTML = `
      <div class="detections-grid">
        ${recent.map(d => `
          <div class="detection-card">
            <div class="detection-card__img">
              ${imgTag(d.image_path, `Image`)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  initUpload();
}


function initUpload() {

  const zone        = document.getElementById('upload-zone');
  const fileInput   = document.getElementById('file-input');
  const folderInput = document.getElementById('folder-input');

  // ─── DRAG & DROP ─────────────────────────────

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('upload-zone--over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('upload-zone--over');
  });

  zone.addEventListener('drop', e => {

    e.preventDefault();

    zone.classList.remove('upload-zone--over');

    const files = Array.from(e.dataTransfer.files)
      .filter(file => file.type.startsWith('image/'));

    if (files.length === 1) {

      processFile(files[0]);

    } else if (files.length > 1) {

      processFiles(files);
    }
  });

  // ─── IMAGE SIMPLE ────────────────────────────

  fileInput.addEventListener('change', () => {

    const files = Array.from(fileInput.files)
      .filter(file => file.type.startsWith('image/'));

    console.log(files)
    
    if (files.length === 1) {
      processFile(files[0], "file");
    } else if (files.length > 1) {
      processFiles(files, "file");
    }
  });

  // ─── DOSSIER ─────────────────────────────────

  folderInput.addEventListener('change', async () => {
    const files = Array.from(folderInput.files).filter(file =>
      file.type.startsWith('image/')
      || /\.(jpg|jpeg|png|webp)$/i.test(file.name)
    );

    const results = [];

    for (const file of files) {

      const data = await processFile(file, "folder");

      results.push({
        file: file.name,
        image: URL.createObjectURL(file)
      });
    }

    document.getElementById('upload-result').innerHTML =
      renderBatchMini(results);
  });
}

// ─── TRAITEMENT IMAGE ─────────────────────────────────────────

async function processFile(file, uploadType) {

  const panel   = document.getElementById('upload-panel');
  const preview = document.getElementById('upload-preview-img');
  const result  = document.getElementById('upload-result');
  const zone    = document.getElementById('upload-zone');

  // Preview
  preview.src = URL.createObjectURL(file);

  panel.classList.remove('hidden');
  zone.classList.add('hidden');

  // Loader
  result.innerHTML = `
    <p>Upload en cours...</p>
  `;

  // Envoi serveur
  const formData = new FormData();
  formData.append('image', file);

  try {

    const res = await fetch('/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (uploadType == "file") {
      result.innerHTML = `
      <div class="upload-result">
        <p><strong>Nom :</strong> ${file.name}</p>
        <p><strong>Taille :</strong> ${(file.size / 1024 / 1024).toFixed(2)} MB</p>

        <p style="color:green">
          Upload réussi
        </p>

        <div class="clip-result__actions">
          <button class="btn btn--secondary" onclick="resetUpload()">
            Choisir une autre image
          </button>
        </div>
      </div>
    `;
    }

  } catch (err) {

    console.error(err);

    result.innerHTML = `
      <p class="error">
        Erreur upload serveur
      </p>
    `;
  }
}


function renderBatchMini(results) {

  return `
    <div class="batch-grid">
      ${results.map(r => `

        <div class="batch-card">

          <div class="batch-card__img">
            <img src="${r.image}" alt="${r.file}">
          </div>

          <div class="batch-card__name">
            ${r.file}
          </div>

        </div>

      `).join('')}
    </div>
  `;
}


// ─── RESET ────────────────────────────────────────────────────

window.resetUpload = function () {
  document.getElementById('upload-panel').classList.add('hidden');
  document.getElementById('upload-zone').classList.remove('hidden');
  document.getElementById('file-input').value = '';
}