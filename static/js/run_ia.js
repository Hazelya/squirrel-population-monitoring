import { fetchRunIA, fetchAlertes, fetchDetections, fetchWorkflowStatus, fetchSetAlerte } from "./fetch.js";


// Dors le temps du workflow IA
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// Barre de progression

function injectLoader() {
    if (document.getElementById('run-ia-loader')) return;

    const el = document.createElement('div');
    el.id = 'run-ia-loader';
    el.className = 'run-ia-loader hidden';
    el.innerHTML = `
      <div class="run-ia-loader__box">
        <h2 class="run-ia-loader__title">Analyse IA en cours…</h2>
        <p class="run-ia-loader__status" id="run-ia-status">Lancement de l'analyse…</p>
        <div class="run-ia-loader__track">
          <div class="run-ia-loader__fill" id="run-ia-bar"></div>
        </div>
        <p class="run-ia-loader__pct" id="run-ia-pct">0 %</p>
      </div>
    `;
    document.body.appendChild(el);
}

function setProgress(pct, statusText) {
    const bar = document.getElementById('run-ia-bar');
    const pctEl = document.getElementById('run-ia-pct');
    const status = document.getElementById('run-ia-status');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + ' %';
    if (status) status.textContent = statusText;
}

function showLoader() {
    injectLoader();
    document.getElementById('run-ia-loader').classList.remove('hidden');
    setProgress(0, "Lancement de l'analyse…");
}

function hideLoader() {
    document.getElementById('run-ia-loader')?.classList.add('hidden');
}


// Popup de fin

function injectPopup() {
    if (document.getElementById('run-ia-popup')) return;

    const el = document.createElement('div');
    el.className = 'popup-overlay hidden';
    el.id = 'run-ia-popup';
    el.innerHTML = `
      <div class="popup">
        <div class="popup__header">
          <span class="popup__icon" id="run-ia-icon">✅</span>
          <h2 id="run-ia-title">Analyse IA</h2>
          <button class="popup__close" id="run-ia-close">✕</button>
        </div>
        <div class="popup__body">
          <p id="run-ia-message"></p>
          <div id="run-ia-details"></div>
        </div>
        <div class="popup__footer">
          <button class="btn btn--primary" id="run-ia-ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('run-ia-close').onclick = closeRunIAPopup;
    document.getElementById('run-ia-ok').onclick    = closeRunIAPopup;
}

function closeRunIAPopup() {
    document.getElementById('run-ia-popup')?.classList.add('hidden');
}

function showPopup(icon, title, message, alertes = []) {
    injectPopup();
    document.getElementById('run-ia-icon').textContent = icon;
    document.getElementById('run-ia-title').textContent = title;
    document.getElementById('run-ia-message').textContent = message;

    document.getElementById('run-ia-popup').classList.remove('hidden');
}


export async function runIA() {
    try {
        // Affiche le loader et bloque le site
        showLoader();
        setProgress(5, "Envoi de la requête au serveur…");

        const response = await fetchRunIA();

        if (!response.success) {
            hideLoader();
            showPopup('❌', 'Erreur', `Impossible de lancer l'analyse (code : ${response.status_code}).`);
            return;
        }

        setProgress(15, "Analyse lancée — en attente des résultats GitHub Actions…");

        // Polling jusqu'à la fin du workflow
        let finished = false;
        let pollCount = 0;
        while (!finished) {
            await sleep(5000);
            pollCount++;

            // Progression de 15 à 80 %
            const pct = Math.min(15 + pollCount * 5, 78);
            setProgress(pct, "Analyse IA en cours sur le serveur…");

            const status = await fetchWorkflowStatus();
            if (status.status === 'completed') {
                finished = true;
                if (status.conclusion !== 'success') {
                    hideLoader();
                    showPopup('❌', 'Erreur IA', "Une erreur est survenue durant l'analyse IA.");
                    return;
                }
            }
        }

        setProgress(85, "Création des alertes en base de données…");
        const nouvelles = await createAlertes();

        setProgress(100, "Terminé !");
        await sleep(500);
        hideLoader();

        // Popup résultat final
        if (nouvelles.length > 0) {
            showPopup(
                '⚠️',
                'Analyse terminée',
                `${nouvelles.length} nouvelle(s) alerte(s) créée(s) !`,
                nouvelles
            );
        } else {
            showPopup(
                '✅',
                'Analyse terminée',
                'Aucune nouvelle alerte. Tous les individus détectés sont sains.'
            );
        }

    } catch (e) {
        console.error(e);
        hideLoader();
        showPopup('❌', 'Erreur réseau', 'Impossible de contacter le serveur.');
    }
}


// Création des alertes

export async function createAlertes() {
    const nouvelles = [];

    try {
        const detections = await fetchDetections();
        const alertes = await fetchAlertes();

        // Clé unique = detection_id + type_alerte
        const existingAlertes = new Set(
            alertes.map(a => `${a.detection_id}-${a.type_alerte}`)
        );

        for (const detection of detections) {

            // malade
            if (detection.malade) {
                const key = `${detection.id_detection}-individu malade`;
                if (!existingAlertes.has(key)) {
                    await fetchSetAlerte(
                        detection.id_detection,
                        'individu malade',
                        new Date().toISOString().split('T')[0],
                        'nouvelle'
                    );
                    existingAlertes.add(key);
                    nouvelles.push({ id: detection.id_detection, type: 'Individu malade' });
                }
            }

            // Tamia de corée
            if (detection.clip_labels && detection.clip_labels.length > 0) {
                const best = detection.clip_labels.reduce(
                    (max, item) => item.confidence > max.confidence ? item : max,
                    detection.clip_labels[0]
                );

                if (best.species.toLowerCase().includes('écureuil de corée')) {
                    const key = `${detection.id_detection}-Tamia de corée`;
                    if (!existingAlertes.has(key)) {
                        await fetchSetAlerte(
                            detection.id_detection,
                            'Tamia de corée',
                            new Date().toISOString().split('T')[0],
                            'nouvelle'
                        );
                        existingAlertes.add(key);
                        nouvelles.push({ id: detection.id_detection, type: 'Tamia de Corée' });
                    }
                }
            }
        }

    } catch (e) {
        console.error(e);
        showPopup('❌', 'Erreur', 'Une erreur est survenue lors de la création des alertes.');
    }

    return nouvelles;
}
