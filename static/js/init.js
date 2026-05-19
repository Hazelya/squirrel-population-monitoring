import { checkAlertPopup, closePopup } from "./popup_alerte.js";
import { initAccueil } from "./main.js";
import { initStats } from "./stats.js";
import { initPhotos, renderPhotosPage } from "./photos.js";
import { initAnalyse } from "./analyse.js";
import { initAlertes } from "./alertes.js";


// ─── INITIALISATION ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Lien actif dans la navbar
  const currentFile = window.location.pathname.split('/').pop() || 'main.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('href') === currentFile) link.classList.add('active');
  });

  // Menu mobile
  const toggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => navLinks.classList.toggle('navbar__links--open'));
  }

  // Fermer popup en cliquant sur l'overlay
  const overlay = document.getElementById('alert-popup');
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closePopup(); });

  // Vérifier popup d'alerte
  checkAlertPopup();

  // Lancer la fonction de la page courante
  const page = document.body.dataset.page;
  switch (page) {
    case 'accueil':  initAccueil(); break;
    case 'stats':    initStats();   break;
    case 'photos':   initPhotos();  break;
    case 'analyse':  initAnalyse(); break;
    case 'alertes':  initAlertes(); break;
    // projet et infos sont statiques, rien à charger
  }
});