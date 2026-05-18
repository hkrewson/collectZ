'use strict';

async function listEventsByTitle(requestContext, title) {
  const response = await requestContext.get(`/api/events?q=${encodeURIComponent(title)}&limit=50`);
  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to list events for "${title}" (${response.status()}): ${text}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function fetchCsrfToken(requestContext) {
  const response = await requestContext.get('/api/auth/csrf-token');
  if (!response.ok()) return null;
  const payload = await response.json().catch(() => ({}));
  return payload?.csrfToken || null;
}

async function deleteEventsByExactTitle(requestContext, title) {
  const items = await listEventsByTitle(requestContext, title);
  const matches = items.filter((item) => String(item?.title || '') === String(title));
  const csrfToken = matches.length ? await fetchCsrfToken(requestContext) : null;
  for (const item of matches) {
    const response = await requestContext.delete(`/api/events/${item.id}`, {
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined
    });
    if (!response.ok() && response.status() !== 404) {
      const text = await response.text();
      throw new Error(`Failed to delete event #${item.id} for "${title}" (${response.status()}): ${text}`);
    }
  }
  return matches.length;
}

async function listCollectiblesByTitle(requestContext, title) {
  const response = await requestContext.get(`/api/collectibles?q=${encodeURIComponent(title)}&limit=50`);
  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to list collectibles for "${title}" (${response.status()}): ${text}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function deleteCollectiblesByExactTitle(requestContext, title) {
  const items = await listCollectiblesByTitle(requestContext, title);
  const matches = items.filter((item) => String(item?.title || '') === String(title));
  const csrfToken = matches.length ? await fetchCsrfToken(requestContext) : null;
  for (const item of matches) {
    const response = await requestContext.delete(`/api/collectibles/${item.id}`, {
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined
    });
    if (!response.ok() && response.status() !== 404) {
      const text = await response.text();
      throw new Error(`Failed to delete collectible #${item.id} for "${title}" (${response.status()}): ${text}`);
    }
  }
  return matches.length;
}

async function listArtByTitle(requestContext, title) {
  const response = await requestContext.get(`/api/art?q=${encodeURIComponent(title)}&limit=50`);
  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to list art for "${title}" (${response.status()}): ${text}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function deleteArtByExactTitle(requestContext, title) {
  const items = await listArtByTitle(requestContext, title);
  const matches = items.filter((item) => String(item?.title || '') === String(title));
  const csrfToken = matches.length ? await fetchCsrfToken(requestContext) : null;
  for (const item of matches) {
    const response = await requestContext.delete(`/api/art/${item.id}`, {
      headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined
    });
    if (!response.ok() && response.status() !== 404) {
      const text = await response.text();
      throw new Error(`Failed to delete art #${item.id} for "${title}" (${response.status()}): ${text}`);
    }
  }
  return matches.length;
}

module.exports = {
  listEventsByTitle,
  deleteEventsByExactTitle,
  listCollectiblesByTitle,
  deleteCollectiblesByExactTitle,
  listArtByTitle,
  deleteArtByExactTitle
};
