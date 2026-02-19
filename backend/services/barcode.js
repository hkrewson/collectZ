const BARCODE_PRESETS = {
  upcitemdb: {
    provider: 'upcitemdb',
    apiUrl: 'https://api.upcitemdb.com/prod/trial/lookup',
    apiKeyHeader: 'x-api-key',
    queryParam: 'upc'
  },
  barcodelookup: {
    provider: 'barcodelookup',
    apiUrl: 'https://api.barcodelookup.com/v3/products',
    apiKeyHeader: 'Authorization',
    queryParam: 'barcode'
  }
};

const resolveBarcodePreset = (presetName) =>
  BARCODE_PRESETS[presetName] || BARCODE_PRESETS.upcitemdb;

/**
 * Normalize barcode API responses from different providers into a
 * consistent shape: [{ title, description, image, raw }]
 */
const normalizeBarcodeMatches = (payload) => {
  const list =
    payload?.items ||
    payload?.products ||
    payload?.results ||
    payload?.data ||
    [];

  if (!Array.isArray(list)) return [];

  return list.map((entry) => ({
    title: entry?.title || entry?.name || entry?.product_name || null,
    description: entry?.description || entry?.brand || entry?.manufacturer || null,
    image: entry?.image || entry?.image_url || entry?.images?.[0] || null,
    raw: entry
  }));
};

module.exports = { BARCODE_PRESETS, resolveBarcodePreset, normalizeBarcodeMatches };
