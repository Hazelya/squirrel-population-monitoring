// ─── DATA FETCHERS PYTHON ────────────────────────────────────────────────────────────

export async function fetchOneDetection(id) {
  const res = await fetch(`http://localhost:5000/detections/${id}`);
  const data = await res.json();
  return data || [];
}

export async function fetchDetections() {
  const res = await fetch('http://localhost:5000/detections');
  const data = await res.json();
  return data || [];
}

export async function fetchAlertes() {
  const res = await fetch('http://localhost:5000/alertes');
  const data = await res.json();
  return data || [];
}

export async function fetchAlertesByDetection(id) {
  const res = await fetch(`http://localhost:5000/detections/${id}/alertes`);
  const data = await res.json();
  return data || null;
}