function uniqueNonEmpty(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeBarcodeInput(rawValue = '') {
  return String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z-]/g, '')
    .trim();
}

function computeIsbn13CheckDigit(core) {
  let sum = 0;
  for (let index = 0; index < core.length; index += 1) {
    sum += Number(core[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function normalizeIsbnCandidate(rawValue = '') {
  const token = String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
  if (!token) return '';

  if (/^\d{13}$/.test(token) && (token.startsWith('978') || token.startsWith('979'))) {
    return computeIsbn13CheckDigit(token.slice(0, 12)) === Number(token[12]) ? token : '';
  }

  if (!/^\d{9}[\dX]$/.test(token)) return '';

  let checksum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = token[index];
    const digit = char === 'X' ? 10 : Number(char);
    checksum += digit * (10 - index);
  }
  if (checksum % 11 !== 0) return '';

  const core = `978${token.slice(0, 9)}`;
  return `${core}${computeIsbn13CheckDigit(core)}`;
}

function expandOcrIsbnCandidates(rawValue = '') {
  const token = String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s-]+/g, '')
    .toUpperCase();
  if (!(token.length === 10 || token.length === 13)) return [];

  const substitutions = {
    O: ['0'],
    Q: ['0'],
    D: ['0'],
    I: ['1'],
    L: ['1'],
    T: ['1'],
    Z: ['2'],
    A: ['4'],
    S: ['5'],
    G: ['6'],
    B: ['8'],
    X: token.length === 10 ? ['X'] : []
  };

  const options = [];
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (/\d/.test(char)) {
      options.push([char]);
      continue;
    }
    if (char === 'X' && token.length === 10 && index === 9) {
      options.push(['X']);
      continue;
    }
    const replacements = substitutions[char] || [];
    if (!replacements.length) return [];
    options.push(replacements);
  }

  const variants = new Set();
  const walk = (index, built) => {
    if (variants.size >= 24) return;
    if (index >= options.length) {
      const normalized = normalizeIsbnCandidate(built);
      if (normalized) variants.add(normalized);
      return;
    }
    for (const candidate of options[index]) {
      walk(index + 1, `${built}${candidate}`);
      if (variants.size >= 24) return;
    }
  };

  walk(0, '');
  return Array.from(variants);
}

function extractSlidingWindowIsbnCandidates(rawText = '') {
  const tokenStream = String(rawText || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  if (tokenStream.length < 10) return [];

  const candidates = new Set();
  for (let start = 0; start <= tokenStream.length - 10; start += 1) {
    const isbn10 = normalizeIsbnCandidate(tokenStream.slice(start, start + 10));
    if (isbn10) candidates.add(isbn10);
  }
  for (let start = 0; start <= tokenStream.length - 13; start += 1) {
    const isbn13 = normalizeIsbnCandidate(tokenStream.slice(start, start + 13));
    if (isbn13) candidates.add(isbn13);
  }
  return Array.from(candidates);
}

function extractIdentifierCandidatesFromText(rawText = '') {
  const text = String(rawText || '');
  if (!text.trim()) {
    return {
      isbnCandidates: [],
      strictIsbnCandidates: [],
      labeledIsbnCandidates: [],
      upcCandidates: [],
      asinCandidates: [],
      rawText: ''
    };
  }

  const isbnCandidates = [];
  const strictIsbnCandidates = [];
  const labeledIsbnCandidates = [];
  const upcCandidates = [];
  const asinCandidates = [];

  const normalizedText = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1');
  const ocrNormalizedText = normalizedText
    .replace(/(?<=\d)[Ss](?=[\dXx])/g, '5')
    .replace(/(?<=\d)[Bb](?=[\dXx])/g, '8')
    .replace(/(?<=\d)[Gg](?=[\dXx])/g, '6')
    .replace(/(?<=\d)[Zz](?=[\dXx])/g, '2')
    .replace(/(?<=\d)[Qq](?=[\dXx])/g, '0');

  const isbnLabelPattern = /[I1]SBN(?:-1[03])?[\s:]*([0-9A-Za-z\- ]{10,20})/gi;
  let isbnMatch = isbnLabelPattern.exec(ocrNormalizedText);
  while (isbnMatch) {
    const rawCandidate = isbnMatch[1] || '';
    const normalized = normalizeIsbnCandidate(rawCandidate);
    if (normalized) {
      isbnCandidates.push(normalized);
      strictIsbnCandidates.push(normalized);
      labeledIsbnCandidates.push(normalized);
    } else {
      const expanded = expandOcrIsbnCandidates(rawCandidate);
      isbnCandidates.push(...expanded);
      labeledIsbnCandidates.push(...expanded);
    }
    isbnMatch = isbnLabelPattern.exec(ocrNormalizedText);
  }

  const asinPattern = /\bAS[I1]N[\s:]*([A-Z0-9]{10})\b/gi;
  let asinMatch = asinPattern.exec(ocrNormalizedText.toUpperCase());
  while (asinMatch) {
    const candidate = String(asinMatch[1] || '').trim().toUpperCase();
    if (candidate) asinCandidates.push(candidate);
    asinMatch = asinPattern.exec(ocrNormalizedText.toUpperCase());
  }

  const bareDigitRuns = ocrNormalizedText.match(/\b[0-9A-Za-z][0-9A-Za-z\- ]{8,22}\b/g) || [];
  for (const candidate of bareDigitRuns) {
    const normalizedIsbn = normalizeIsbnCandidate(candidate);
    if (normalizedIsbn) {
      isbnCandidates.push(normalizedIsbn);
      strictIsbnCandidates.push(normalizedIsbn);
    } else {
      isbnCandidates.push(...expandOcrIsbnCandidates(candidate));
    }

    const digits = normalizeBarcodeInput(candidate).replace(/\D+/g, '');
    if (digits.length === 12 || digits.length === 13) {
      upcCandidates.push(digits);
    }
  }

  for (const candidate of extractSlidingWindowIsbnCandidates(ocrNormalizedText)) {
    isbnCandidates.push(candidate);
    strictIsbnCandidates.push(candidate);
  }

  return {
    isbnCandidates: uniqueNonEmpty(isbnCandidates),
    strictIsbnCandidates: uniqueNonEmpty(strictIsbnCandidates),
    labeledIsbnCandidates: uniqueNonEmpty(labeledIsbnCandidates),
    upcCandidates: uniqueNonEmpty(upcCandidates),
    asinCandidates: uniqueNonEmpty(asinCandidates),
    rawText: ocrNormalizedText
  };
}

function buildCaptureOcrCandidates(rawText = '') {
  const extracted = extractIdentifierCandidatesFromText(rawText);
  const candidates = [];

  extracted.labeledIsbnCandidates.forEach((value, index) => {
    candidates.push({
      id: `ocr:isbn:labeled:${value}`,
      source: 'ocr',
      match_type: 'isbn',
      value,
      barcode: value,
      symbology: 'ISBN',
      media_type: 'book',
      label: `ISBN ${value}`,
      rank: index,
      context: 'labeled'
    });
  });

  extracted.strictIsbnCandidates
    .filter((value) => !extracted.labeledIsbnCandidates.includes(value))
    .forEach((value, index) => {
      candidates.push({
        id: `ocr:isbn:${value}`,
        source: 'ocr',
        match_type: 'isbn',
        value,
        barcode: value,
        symbology: 'ISBN',
        media_type: 'book',
        label: `ISBN ${value}`,
        rank: extracted.labeledIsbnCandidates.length + index,
        context: 'strict'
      });
    });

  extracted.upcCandidates
    .filter((value) => !extracted.isbnCandidates.includes(value))
    .forEach((value, index) => {
      candidates.push({
        id: `ocr:upc:${value}`,
        source: 'ocr',
        match_type: value.length === 13 ? 'ean' : 'upc',
        value,
        barcode: value,
        symbology: value.length === 13 ? 'EAN-13' : 'UPC-A',
        media_type: value.length === 13 && (value.startsWith('978') || value.startsWith('979')) ? 'book' : 'other',
        label: `${value.length === 13 ? 'EAN' : 'UPC'} ${value}`,
        rank: index,
        context: 'digit_run'
      });
    });

  extracted.asinCandidates.forEach((value, index) => {
    candidates.push({
      id: `ocr:asin:${value}`,
      source: 'ocr',
      match_type: 'asin',
      value,
      barcode: value,
      symbology: 'ASIN',
      media_type: 'book',
      label: `ASIN ${value}`,
      rank: index,
      context: 'labeled'
    });
  });

  return {
    ...extracted,
    candidates
  };
}

module.exports = {
  normalizeBarcodeInput,
  normalizeIsbnCandidate,
  extractIdentifierCandidatesFromText,
  buildCaptureOcrCandidates
};
