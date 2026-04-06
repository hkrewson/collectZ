'use strict';

async function findMediaByTitle(requestContext, title) {
  const response = await requestContext.get(`/api/media?search=${encodeURIComponent(title)}&limit=50`);
  if (!response.ok()) {
    const text = await response.text();
    throw new Error(`Failed to list media for "${title}" (${response.status()}): ${text}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function deleteMediaByExactTitle(requestContext, title) {
  const items = await findMediaByTitle(requestContext, title);
  const matches = items.filter((item) => String(item?.title || '') === String(title));
  for (const item of matches) {
    const response = await requestContext.delete(`/api/media/${item.id}`);
    if (!response.ok() && response.status() !== 404) {
      const text = await response.text();
      throw new Error(`Failed to delete media #${item.id} for "${title}" (${response.status()}): ${text}`);
    }
  }
  return matches.length;
}

async function findExactMediaByTitle(requestContext, title) {
  const items = await findMediaByTitle(requestContext, title);
  return items.find((item) => String(item?.title || '') === String(title)) || null;
}

module.exports = {
  findMediaByTitle,
  findExactMediaByTitle,
  deleteMediaByExactTitle
};
