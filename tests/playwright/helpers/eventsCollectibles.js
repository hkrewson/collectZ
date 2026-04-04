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

async function deleteEventsByExactTitle(requestContext, title) {
  const items = await listEventsByTitle(requestContext, title);
  const matches = items.filter((item) => String(item?.title || '') === String(title));
  for (const item of matches) {
    const response = await requestContext.delete(`/api/events/${item.id}`);
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
  for (const item of matches) {
    const response = await requestContext.delete(`/api/collectibles/${item.id}`);
    if (!response.ok() && response.status() !== 404) {
      const text = await response.text();
      throw new Error(`Failed to delete collectible #${item.id} for "${title}" (${response.status()}): ${text}`);
    }
  }
  return matches.length;
}

module.exports = {
  listEventsByTitle,
  deleteEventsByExactTitle,
  listCollectiblesByTitle,
  deleteCollectiblesByExactTitle
};
