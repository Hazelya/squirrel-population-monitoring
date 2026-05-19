import { fetchDetections, fetchOneDetection, fetchAlertes, fetchAlertesByDetection } from "./fetch.js";
import { getImageUrl, formatDate, imgTag, goToAnalyse } from "./helpers.js";

// ─── POPUP D'ALERTE ───────────────────────────────────────────────────────────

export async function checkAlertPopup() {
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

export function closePopup() {
  document.getElementById('alert-popup').classList.add('hidden');
}