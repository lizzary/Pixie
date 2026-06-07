const BASE_URL = 'http://localhost:8000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ── Artists ────────────────────────────────────────────

export function listArtists() {
  return request('/api/artists');
}

export function createArtist(name) {
  return request('/api/artists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function getArtist(artistId) {
  return request(`/api/artists/${artistId}`);
}

export function updateArtist(artistId, data) {
  return request(`/api/artists/${artistId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteArtist(artistId) {
  return request(`/api/artists/${artistId}`, { method: 'DELETE' });
}

// ── Illustrations ──────────────────────────────────────

export function listIllustrations(artistId, offset = 0, limit = 200) {
  return request(`/api/artists/${artistId}/illustrations?offset=${offset}&limit=${limit}`);
}

export function uploadIllustrations(artistId, files, isAiGenerated = false) {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  return request(
    `/api/artists/${artistId}/illustrations/upload?is_ai_generated=${isAiGenerated}`,
    { method: 'POST', body: formData },
  );
}

export function getIllustration(illustrationId) {
  return request(`/api/illustrations/${illustrationId}`);
}

export function updateIllustration(illustrationId, data) {
  return request(`/api/illustrations/${illustrationId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteIllustration(illustrationId) {
  return request(`/api/illustrations/${illustrationId}`, { method: 'DELETE' });
}

// ── Search ─────────────────────────────────────────────

export function searchIllustrations(query, offset = 0, limit = 100) {
  const q = encodeURIComponent(query);
  return request(`/api/search?q=${q}&offset=${offset}&limit=${limit}`);
}
