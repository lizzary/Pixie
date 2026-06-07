const BASE_URL = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000';

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

// ── Groups ────────────────────────────────────────────

export function listGroups() {
  return request('/api/groups');
}

export function createGroup(name) {
  return request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function getGroup(groupId) {
  return request(`/api/groups/${groupId}`);
}

export function updateGroup(groupId, data) {
  return request(`/api/groups/${groupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteGroup(groupId) {
  return request(`/api/groups/${groupId}`, { method: 'DELETE' });
}

// ── Illustrations ──────────────────────────────────────

export function listIllustrations(groupId, offset = 0, limit = 200) {
  return request(`/api/groups/${groupId}/illustrations?offset=${offset}&limit=${limit}`);
}

export function uploadIllustrations(groupId, files) {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  return request(
    `/api/groups/${groupId}/illustrations/upload`,
    { method: 'POST', body: formData },
  );
}

export function uploadSingleIllustration(groupId, file) {
  const formData = new FormData();
  formData.append('files', file);
  return request(
    `/api/groups/${groupId}/illustrations/upload`,
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

export function getIllustrationMetadata(illustrationId) {
  return request(`/api/illustrations/${illustrationId}/metadata`);
}

// ── Tags & Prompts ─────────────────────────────────────

export function listTags() {
  return request('/api/tags');
}

export function listPrompts() {
  return request('/api/prompts');
}

// ── Search ─────────────────────────────────────────────

export function searchIllustrations(query, offset = 0, limit = 100) {
  const q = encodeURIComponent(query);
  return request(`/api/search?q=${q}&offset=${offset}&limit=${limit}`);
}
