
// ─── HELPERS ─────────────────────────────────────────────────────────────────

export function getImageUrl(imagePath) {
  if (!imagePath) return null;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  return `${SUPABASE_URL}/storage/v1/object/public/images/${imagePath}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function imgTag(imagePath, alt = 'Détection') {
  const url = getImageUrl(imagePath);
  if (!url) return `<div class="no-image"><span>Pas d'image</span></div>`;
  return `<img src="${url}" alt="${alt}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-image\\'><span>Indisponible</span></div>'">`;
}

export function goToAnalyse(id) {
  window.location.href = `analyse.html?id=${id}`;
}