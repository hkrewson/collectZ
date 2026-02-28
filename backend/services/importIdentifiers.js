function normalizeDigits(value) {
  const cleaned = String(value || '').replace(/\D+/g, '');
  return cleaned || '';
}

function extractAsinFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/\b([A-Z0-9]{10})\b/i);
  if (!direct) return '';
  return direct[1].toUpperCase();
}

function normalizeIsbn(value) {
  const digits = normalizeDigits(value);
  if (!digits) return '';
  if (digits.length === 13) return digits;
  if (digits.length !== 10) return '';

  // Convert ISBN-10 -> ISBN-13 (978 prefix) to keep one canonical shape.
  const core = `978${digits.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < core.length; i += 1) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${core}${check}`;
}

function normalizeIdentifierSet(input = {}) {
  const isbnRaw = input.isbn || input.isbn13 || '';
  const eanRaw = input.ean_upc || input.ean || input.upc || '';
  const asinRaw = input.asin || input.amazon_item_id || input.amazonLink || '';
  const isbn = normalizeIsbn(isbnRaw);
  const eanUpc = normalizeDigits(eanRaw);
  const asin = extractAsinFromUrl(asinRaw);
  return { isbn, eanUpc, asin };
}

module.exports = {
  normalizeDigits,
  extractAsinFromUrl,
  normalizeIsbn,
  normalizeIdentifierSet
};
