function normalizeDigits(value) {
  const cleaned = String(value || '').replace(/\D+/g, '');
  return cleaned || '';
}

function normalizeIsbnToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
}

function isValidIsbn10(value) {
  const token = normalizeIsbnToken(value);
  if (!/^\d{9}[\dX]$/.test(token)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = token[index];
    const digit = char === 'X' ? 10 : Number(char);
    sum += digit * (10 - index);
  }
  return sum % 11 === 0;
}

function computeIsbn13CheckDigit(core) {
  let sum = 0;
  for (let index = 0; index < core.length; index += 1) {
    sum += Number(core[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function isValidIsbn13(value) {
  const digits = normalizeDigits(value);
  if (!/^\d{13}$/.test(digits)) return false;
  if (!/^97[89]/.test(digits)) return false;
  return computeIsbn13CheckDigit(digits.slice(0, 12)) === Number(digits[12]);
}

function extractAsinFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/\b([A-Z0-9]{10})\b/i);
  if (!direct) return '';
  return direct[1].toUpperCase();
}

function normalizeIsbn(value) {
  const token = normalizeIsbnToken(value);
  if (!token) return '';

  if (/^\d{13}$/.test(token) && isValidIsbn13(token)) {
    return token;
  }

  if (!isValidIsbn10(token)) return '';

  // Convert ISBN-10 -> ISBN-13 (978 prefix) to keep one canonical shape.
  const core = `978${token.slice(0, 9)}`;
  return `${core}${computeIsbn13CheckDigit(core)}`;
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
