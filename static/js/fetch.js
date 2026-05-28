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

export async function fetchRemove(id) {
  const res = await fetch(`http://localhost:5000/remove/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  return data || null;
}

export async function fetchRunIA(id) {
  const res = await fetch(`http://localhost:5000/run-ia`, {
    method: 'POST'
  });
  const data = await res.json();
  return data || null;
}


export async function fetchSetAlerte(id_detection, type_alerte, date_alerte, statut) {
      const res = await fetch(
        `http://localhost:5000/set-alerte/${id_detection}/${type_alerte}/${date_alerte}/${statut}`, {
            method: 'POST'
        });
    const data = await res.json();
    return data || null;
}


export async function fetchWorkflowStatus() {
    const response = await fetch("http://127.0.0.1:5000/workflow-status");
    return await response.json();
}

