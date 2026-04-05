import React, { useCallback, useEffect, useRef, useState } from 'react';

export function routeFromPath(p) {
  if (p === '/register') return 'register';
  if (p === '/reset-password') return 'reset';
  if (
    p === '/dashboard' ||
    p.startsWith('/dashboard/') ||
    p.startsWith('/admin/') ||
    p.startsWith('/library/')
  ) return 'dashboard';
  return 'login';
}

export function posterUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/uploads/') || path.startsWith('/')) {
    if (path.startsWith('/t/') || path.match(/\/p\//)) return `https://image.tmdb.org/t/p/w500${path}`;
    if (path.startsWith('/uploads/')) return path;
    return `https://image.tmdb.org/t/p/w500${path}`;
  }
  return path;
}

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function inferTmdbSearchType(mediaType) {
  return mediaType === 'tv_series' || mediaType === 'tv_episode' ? 'tv' : 'movie';
}

export const MEDIA_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV Series' },
  { value: 'book', label: 'Book' },
  { value: 'audio', label: 'Audio' },
  { value: 'game', label: 'Game' },
  { value: 'comic_book', label: 'Comic Book' }
];

export function mediaTypeLabel(value) {
  return MEDIA_TYPES.find((m) => m.value === value)?.label || 'Comic Book';
}

export function readCookie(name) {
  const raw = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.split('=').slice(1).join('='));
  } catch (_) {
    return raw.split('=').slice(1).join('=');
  }
}

export function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('button,a,input,select,textarea,label,[role="button"]'));
}

function getBarcodeDetectorClass() {
  if (typeof window === 'undefined') return null;
  return window.BarcodeDetector || null;
}

function canAttemptBrowserBarcodeDecode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  return typeof Image !== 'undefined' && typeof URL?.createObjectURL === 'function';
}

export function supportsBarcodeCapture() {
  return canAttemptBrowserBarcodeDecode();
}

async function loadImageForBarcodeDetection(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load captured image'));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function normalizeBarcodeInput(rawValue = '') {
  return String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^0-9A-Za-z-]/g, '')
    .trim();
}

export function inferBookBarcodeIdentifier(rawValue = '') {
  const digits = normalizeBarcodeInput(rawValue).replace(/\D+/g, '');
  if (digits.length === 13 && (digits.startsWith('978') || digits.startsWith('979'))) {
    return digits;
  }
  return '';
}

export function isLikelyRetailBookBarcode(rawValue = '') {
  const digits = normalizeBarcodeInput(rawValue).replace(/\D+/g, '');
  return digits.length === 12;
}

export function normalizeIsbnCandidate(rawValue = '') {
  const token = String(rawValue || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
  if (!token) return '';

  const computeIsbn13CheckDigit = (core) => {
    let sum = 0;
    for (let index = 0; index < core.length; index += 1) {
      sum += Number(core[index]) * (index % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
  };

  if (/^\d{13}$/.test(token) && (token.startsWith('978') || token.startsWith('979'))) {
    return computeIsbn13CheckDigit(token.slice(0, 12)) === Number(token[12]) ? token : '';
  }

  if (!/^\d{9}[\dX]$/.test(token)) return '';

  let isbn10Checksum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = token[index];
    const digit = char === 'X' ? 10 : Number(char);
    isbn10Checksum += digit * (10 - index);
  }
  if (isbn10Checksum % 11 !== 0) return '';

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
    const replacements = substitutions[char] || [];
    if (char === 'X' && token.length === 10 && index === 9) {
      options.push(['X']);
      continue;
    }
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

function normalizeDetectedBarcode(rawValue = '') {
  return normalizeBarcodeInput(rawValue);
}

async function detectFirstBarcode(detector, source) {
  const detections = await detector.detect(source);
  const first = detections?.find((item) => item?.rawValue);
  const rawValue = normalizeDetectedBarcode(first?.rawValue || '');
  return rawValue
    ? {
        rawValue,
        boundingBox: first?.boundingBox || null
      }
    : null;
}

let zxingDecoderPromise = null;
let tesseractWorkerPromise = null;

async function loadZxingDecoder() {
  if (!zxingDecoderPromise) {
    zxingDecoderPromise = Promise.all([
      import('@zxing/browser'),
      import('@zxing/library')
    ]).then(([browserModule, libraryModule]) => {
      const BrowserMultiFormatReader = browserModule?.BrowserMultiFormatReader || browserModule?.default?.BrowserMultiFormatReader;
      const BarcodeFormat = browserModule?.BarcodeFormat || libraryModule?.BarcodeFormat;
      const DecodeHintType = libraryModule?.DecodeHintType;
      if (!BrowserMultiFormatReader || !BarcodeFormat || !DecodeHintType) {
        throw new Error('unsupported');
      }

      const formats = [
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODABAR
      ].filter(Boolean);

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(DecodeHintType.TRY_HARDER, true);

      return new BrowserMultiFormatReader(hints);
    }).catch((error) => {
      zxingDecoderPromise = null;
      throw error;
    });
  }

  return zxingDecoderPromise;
}

async function loadTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = import('tesseract.js')
      .then(async (module) => {
        const createWorker = module?.createWorker || module?.default?.createWorker;
        const PSM = module?.PSM || module?.default?.PSM || {};
        if (typeof createWorker !== 'function') {
          throw new Error('unsupported');
        }
        const worker = await createWorker('eng', 1, {
          logger: () => {},
          errorHandler: () => {}
        });
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: '1',
          tessedit_char_whitelist: '0123456789XxABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-: '
        });
        return { worker, PSM };
      })
      .catch((error) => {
        tesseractWorkerPromise = null;
        throw error;
      });
  }

  return tesseractWorkerPromise;
}

function createBarcodeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function drawBarcodeVariant(source, {
  rotate = 0,
  crop = null,
  grayscale = false,
  contrast = 1,
  maxDimension = 1600
} = {}) {
  const sourceWidth = source.naturalWidth || source.videoWidth || source.width;
  const sourceHeight = source.naturalHeight || source.videoHeight || source.height;
  if (!sourceWidth || !sourceHeight) return null;

  const cropRect = crop
    ? {
        x: Math.max(0, Math.round(sourceWidth * crop.x)),
        y: Math.max(0, Math.round(sourceHeight * crop.y)),
        width: Math.max(1, Math.round(sourceWidth * crop.width)),
        height: Math.max(1, Math.round(sourceHeight * crop.height))
      }
    : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };

  const aspectScale = Math.min(1, maxDimension / Math.max(cropRect.width, cropRect.height));
  const drawWidth = Math.max(1, Math.round(cropRect.width * aspectScale));
  const drawHeight = Math.max(1, Math.round(cropRect.height * aspectScale));
  const isQuarterTurn = Math.abs(rotate) % 180 === 90;
  const canvas = createBarcodeCanvas(isQuarterTurn ? drawHeight : drawWidth, isQuarterTurn ? drawWidth : drawHeight);
  const context = canvas.getContext('2d', { willReadFrequently: false });
  if (!context) return null;

  context.save();
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (grayscale || contrast !== 1) {
    const filters = [];
    if (grayscale) filters.push('grayscale(1)');
    if (contrast !== 1) filters.push(`contrast(${contrast})`);
    context.filter = filters.join(' ');
  }

  if (rotate === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotate === -90) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  } else if (rotate === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  }

  context.drawImage(
    source,
    cropRect.x,
    cropRect.y,
    cropRect.width,
    cropRect.height,
    0,
    0,
    drawWidth,
    drawHeight
  );
  context.restore();
  return canvas;
}

function createBarcodeDetectionVariants(source) {
  const variants = [];
  const pushVariant = (label, options) => {
    const canvas = drawBarcodeVariant(source, options);
    if (canvas) variants.push({ label, source: canvas });
  };

  pushVariant('full-resized', { maxDimension: 1800 });
  pushVariant('full-contrast', { maxDimension: 1800, grayscale: true, contrast: 1.6 });
  pushVariant('bottom-half', { crop: { x: 0, y: 0.45, width: 1, height: 0.55 }, maxDimension: 1800 });
  pushVariant('bottom-half-contrast', { crop: { x: 0, y: 0.45, width: 1, height: 0.55 }, maxDimension: 1800, grayscale: true, contrast: 1.8 });
  pushVariant('bottom-third', { crop: { x: 0.05, y: 0.58, width: 0.9, height: 0.32 }, maxDimension: 1800, grayscale: true, contrast: 1.9 });
  pushVariant('rotated-right', { rotate: 90, maxDimension: 1800 });
  pushVariant('rotated-left', { rotate: -90, maxDimension: 1800 });

  return variants;
}

function clampCropRect(rect = {}) {
  const x = Math.max(0, Math.min(1, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(1, Number(rect.y) || 0));
  const width = Math.max(0.02, Math.min(1 - x, Number(rect.width) || 0));
  const height = Math.max(0.02, Math.min(1 - y, Number(rect.height) || 0));
  return { x, y, width, height };
}

function normalizeBoundingBoxToCrop(source, boundingBox) {
  const sourceWidth = source?.naturalWidth || source?.videoWidth || source?.width || 0;
  const sourceHeight = source?.naturalHeight || source?.videoHeight || source?.height || 0;
  if (!sourceWidth || !sourceHeight || !boundingBox) return null;
  const x = Number(boundingBox.x);
  const y = Number(boundingBox.y);
  const width = Number(boundingBox.width);
  const height = Number(boundingBox.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return clampCropRect({
    x: x / sourceWidth,
    y: y / sourceHeight,
    width: width / sourceWidth,
    height: height / sourceHeight
  });
}

function createIdentifierOcrVariants(source, focusCrop = null) {
  const variants = [];
  const pushVariant = (label, options, ocrMode = 'block') => {
    const canvas = drawBarcodeVariant(source, options);
    if (canvas) variants.push({ label, source: canvas, ocrMode });
  };

  if (focusCrop) {
    const paddedFocus = clampCropRect({
      x: focusCrop.x - 0.08,
      y: focusCrop.y - 0.08,
      width: focusCrop.width + 0.16,
      height: focusCrop.height + 0.16
    });
    const belowFocus = clampCropRect({
      x: focusCrop.x - 0.06,
      y: focusCrop.y + focusCrop.height - 0.02,
      width: focusCrop.width + 0.12,
      height: Math.max(focusCrop.height * 0.7, 0.12)
    });
    const aboveAndBelowFocus = clampCropRect({
      x: focusCrop.x - 0.08,
      y: focusCrop.y - Math.max(focusCrop.height * 0.3, 0.05),
      width: focusCrop.width + 0.16,
      height: focusCrop.height + Math.max(focusCrop.height * 0.9, 0.18)
    });

    pushVariant('barcode-focus', { crop: paddedFocus, maxDimension: 2200, grayscale: true, contrast: 2.4 });
    pushVariant('barcode-focus-below', { crop: belowFocus, maxDimension: 2200, grayscale: true, contrast: 2.6 });
    pushVariant('barcode-focus-context', { crop: aboveAndBelowFocus, maxDimension: 2200, grayscale: true, contrast: 2.3 });

    const isbnStrip = clampCropRect({
      x: focusCrop.x - 0.03,
      y: focusCrop.y - Math.max(focusCrop.height * 0.34, 0.07),
      width: focusCrop.width + 0.08,
      height: Math.max(focusCrop.height * 0.18, 0.08)
    });
    const isbnStripLeft = clampCropRect({
      x: focusCrop.x - 0.02,
      y: focusCrop.y - Math.max(focusCrop.height * 0.34, 0.07),
      width: Math.max(focusCrop.width * 0.72, 0.22),
      height: Math.max(focusCrop.height * 0.18, 0.08)
    });

    pushVariant('barcode-focus-isbn-strip', { crop: isbnStrip, maxDimension: 2600, grayscale: true, contrast: 3.0 }, 'single-line');
    pushVariant('barcode-focus-isbn-strip-left', { crop: isbnStripLeft, maxDimension: 2600, grayscale: true, contrast: 3.1 }, 'single-line');
  }

  pushVariant('bottom-third-contrast', { crop: { x: 0.02, y: 0.55, width: 0.96, height: 0.36 }, maxDimension: 2000, grayscale: true, contrast: 2.2 });
  pushVariant('bottom-half-contrast', { crop: { x: 0, y: 0.42, width: 1, height: 0.58 }, maxDimension: 2000, grayscale: true, contrast: 2.0 });
  pushVariant('bottom-quarter-tight', { crop: { x: 0.08, y: 0.68, width: 0.84, height: 0.2 }, maxDimension: 2200, grayscale: true, contrast: 2.5 });
  pushVariant('bottom-right-quarter', { crop: { x: 0.45, y: 0.58, width: 0.5, height: 0.3 }, maxDimension: 2200, grayscale: true, contrast: 2.4 });
  pushVariant('full-contrast', { maxDimension: 1800, grayscale: true, contrast: 1.8 });
  pushVariant('bottom-third-rotated-right', { crop: { x: 0.02, y: 0.55, width: 0.96, height: 0.36 }, maxDimension: 2000, grayscale: true, contrast: 2.2, rotate: 90 });
  pushVariant('bottom-third-rotated-left', { crop: { x: 0.02, y: 0.55, width: 0.96, height: 0.36 }, maxDimension: 2000, grayscale: true, contrast: 2.2, rotate: -90 });

  return variants;
}

function uniqueNonEmpty(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
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
    const isbn10Slice = tokenStream.slice(start, start + 10);
    const isbn10Normalized = normalizeIsbnCandidate(isbn10Slice);
    if (isbn10Normalized) {
      candidates.add(isbn10Normalized);
    }
  }

  for (let start = 0; start <= tokenStream.length - 13; start += 1) {
    const isbn13Slice = tokenStream.slice(start, start + 13);
    const isbn13Normalized = normalizeIsbnCandidate(isbn13Slice);
    if (isbn13Normalized) {
      candidates.add(isbn13Normalized);
    }
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

  const isbnLabelPattern = /ISBN(?:-1[03])?[\s:]*([0-9A-Za-z\- ]{10,20})/gi;
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

  const asinPattern = /\bASIN[\s:]*([A-Z0-9]{10})\b/gi;
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

async function runIdentifierOcr(source, options = {}) {
  const { worker, PSM } = await loadTesseractWorker();
  const aggregate = {
    isbnCandidates: [],
    strictIsbnCandidates: [],
    labeledIsbnCandidates: [],
    upcCandidates: [],
    asinCandidates: [],
    rawText: []
  };
  const focusCrop = normalizeBoundingBoxToCrop(source, options?.boundingBox);

  for (const variant of createIdentifierOcrVariants(source, focusCrop)) {
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: variant.ocrMode === 'single-line' ? (PSM.SINGLE_LINE || PSM.SINGLE_BLOCK) : (PSM.SINGLE_BLOCK || 6),
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: '0123456789XxABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-: '
      });
      const { data } = await worker.recognize(variant.source, { rotateAuto: true }, { text: true });
      const parsed = extractIdentifierCandidatesFromText(data?.text || '');
      aggregate.isbnCandidates.push(...parsed.isbnCandidates);
      aggregate.strictIsbnCandidates.push(...parsed.strictIsbnCandidates);
      aggregate.labeledIsbnCandidates.push(...parsed.labeledIsbnCandidates);
      aggregate.upcCandidates.push(...parsed.upcCandidates);
      aggregate.asinCandidates.push(...parsed.asinCandidates);
      if (parsed.rawText) aggregate.rawText.push(parsed.rawText);
    } catch (_) {
      // Keep trying OCR variants before giving up.
    } finally {
      if (variant?.source?.width) {
        variant.source.width = 1;
        variant.source.height = 1;
      }
    }
  }

  return {
    isbnCandidates: uniqueNonEmpty(aggregate.isbnCandidates),
    strictIsbnCandidates: uniqueNonEmpty(aggregate.strictIsbnCandidates),
    labeledIsbnCandidates: uniqueNonEmpty(aggregate.labeledIsbnCandidates),
    upcCandidates: uniqueNonEmpty(aggregate.upcCandidates),
    asinCandidates: uniqueNonEmpty(aggregate.asinCandidates),
    rawText: aggregate.rawText.join('\n').trim()
  };
}

async function detectBarcodeWithZxing(source) {
  const reader = await loadZxingDecoder();
  for (const variant of createBarcodeDetectionVariants(source)) {
    try {
      const result = reader.decodeFromCanvas(variant.source);
      const detected = normalizeDetectedBarcode(result?.getText?.() || result?.text || '');
      if (detected) {
        return detected;
      }
    } catch (_) {
      // Keep trying transformed variants before giving up.
    } finally {
      if (variant?.source?.width) {
        variant.source.width = 1;
        variant.source.height = 1;
      }
    }
  }

  throw new Error('not-found');
}

export async function detectBarcodeCapturePayloadFromFile(file) {
  const source = await loadImageForBarcodeDetection(file);

  try {
    const BarcodeDetectorClass = getBarcodeDetectorClass();
    if (BarcodeDetectorClass) {
      const preferredFormats = [
        'upc_a',
        'upc_e',
        'ean_13',
        'ean_8',
        'code_128',
        'code_39',
        'codabar'
      ];

      let formats = preferredFormats;
      if (typeof BarcodeDetectorClass.getSupportedFormats === 'function') {
        try {
          const supported = await BarcodeDetectorClass.getSupportedFormats();
          const filtered = preferredFormats.filter((format) => supported.includes(format));
          if (filtered.length) formats = filtered;
        } catch (_) {
          // Keep preferred defaults when the browser refuses supported-format probing.
        }
      }

      const detector = new BarcodeDetectorClass({ formats });
      const rawDetected = await detectFirstBarcode(detector, source);
      if (rawDetected?.rawValue) {
        return {
          code: rawDetected.rawValue,
          boundingBox: rawDetected.boundingBox || null,
          detectedBy: 'barcode-detector'
        };
      }

      for (const variant of createBarcodeDetectionVariants(source)) {
        try {
          const detected = await detectFirstBarcode(detector, variant.source);
          if (detected?.rawValue) {
            return {
              code: detected.rawValue,
              boundingBox: null,
              detectedBy: 'barcode-detector-variant'
            };
          }
        } catch (_) {
          // Keep trying transformed variants before giving up.
        } finally {
          if (variant?.source?.width) {
            variant.source.width = 1;
            variant.source.height = 1;
          }
        }
      }
    }

    if (!canAttemptBrowserBarcodeDecode()) {
      throw new Error('unsupported');
    }

    return {
      code: await detectBarcodeWithZxing(source),
      boundingBox: null,
      detectedBy: 'zxing'
    };
  } finally {
    if (source && typeof source.close === 'function') {
      source.close();
    }
  }
}

export async function detectBarcodeFromFile(file) {
  const payload = await detectBarcodeCapturePayloadFromFile(file);
  return payload?.code || '';
}

export async function extractIdentifierCandidatesFromFile(file, options = {}) {
  if (!canAttemptBrowserBarcodeDecode()) {
    throw new Error('unsupported');
  }

  const source = await loadImageForBarcodeDetection(file);
  try {
    return await runIdentifierOcr(source, options);
  } finally {
    if (source && typeof source.close === 'function') {
      source.close();
    }
  }
}

const Icon = ({ d, size = 20, className = '', strokeWidth = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
    strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);

export const Icons = {
  Library:     () => <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />,
  Plus:        () => <Icon d="M12 5v14M5 12h14" />,
  Search:      () => <Icon d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />,
  Settings:    () => <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />,
  Users:       () => <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  Activity:    () => <Icon d="M3 12h4l2.5-7 4 14 2.5-7H21" />,
  List:        () => <Icon d="M4 7h16M4 12h16M4 17h16" />,
  Profile:     () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  Integrations:() => <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6" />,
  ChevronDown: () => <Icon d="M6 9l6 6 6-6" size={16} />,
  ChevronRight:() => <Icon d="M9 18l6-6-6-6" size={16} />,
  ChevronLeft: () => <Icon d="M15 18l-6-6 6-6" size={16} />,
  Menu:        () => <Icon d="M3 12h18M3 6h18M3 18h18" />,
  X:           () => <Icon d="M18 6L6 18M6 6l12 12" />,
  Trash:       () => <Icon d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M9 6V4h6v2" />,
  Edit:        () => <Icon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />,
  Film:        () => <Icon d="M2 8h20M2 16h20M7 2v20M17 2v20M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" />,
  Barcode:     () => <Icon d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" />,
  Camera:      () => <Icon d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  Eye:         () => <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  EyeOff:      () => <Icon d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />,
  Upload:      () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  Download:    () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  Star:        () => <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
  LogOut:      () => <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  Copy:        () => <Icon d="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 0 2 2v1" />,
  Check:       () => <Icon d="M20 6L9 17l-5-5" />,
  Refresh:     () => <Icon d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />,
  Play:        () => <Icon d="M5 3l14 9-14 9V3z" />,
  Link:        () => <Icon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />,
  ArrowUp:     () => <Icon d="M12 19V5M5 12l7-7 7 7" />,
  ArrowDown:   () => <Icon d="M12 5v14M19 12l-7 7-7-7" />,
};

export function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-gold" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}

export function CameraCaptureModal({
  open = false,
  title = 'Capture image',
  description = 'Use your device camera to capture an image.',
  onClose,
  onCapture,
  confirmLabel = 'Use capture'
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedUrl, setCapturedUrl] = useState('');
  const capturedUrlRef = useRef('');

  useEffect(() => {
    capturedUrlRef.current = capturedUrl;
  }, [capturedUrl]);

  const releaseCapturedUrl = useCallback(() => {
    if (capturedUrlRef.current) {
      URL.revokeObjectURL(capturedUrlRef.current);
      capturedUrlRef.current = '';
    }
  }, []);

  useEffect(() => {
    const stopStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    if (!open) {
      stopStream();
      setStarting(false);
      setError('');
      releaseCapturedUrl();
      setCapturedBlob(null);
      setCapturedUrl('');
      return stopStream;
    }

    let cancelled = false;
    setStarting(true);
    setError('');
    releaseCapturedUrl();
    setCapturedBlob(null);
    setCapturedUrl('');

    const startCamera = async () => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setError('Camera access is not supported in this browser.');
          setStarting(false);
        }
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack?.applyConstraints) {
          try {
            await videoTrack.applyConstraints({
              advanced: [
                { width: 1920, height: 1080 },
                { focusMode: 'continuous' }
              ]
            });
          } catch (_) {
            // Keep the best-effort camera stream when the browser rejects advanced constraints.
          }
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Unable to access the device camera.');
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, releaseCapturedUrl]);

  if (!open) return null;

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('Camera preview is not ready yet.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setError('Capture is not available in this browser.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Failed to capture image.');
        return;
      }
      releaseCapturedUrl();
      setCapturedBlob(blob);
      setCapturedUrl(URL.createObjectURL(blob));
      setError('');
    }, 'image/png');
  };

  const useCapture = async () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    await onCapture?.(file);
    onClose?.();
  };

  const resetCapture = () => {
    releaseCapturedUrl();
    setCapturedBlob(null);
    setCapturedUrl('');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-void/85 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl rounded-2xl border border-edge bg-abyss shadow-deep overflow-hidden">
        <div className="flex items-start gap-3 border-b border-edge px-5 py-4">
          <div className="flex-1">
            <h3 className="section-title !text-lg">{title}</h3>
            <p className="mt-1 text-sm text-ghost">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="aspect-video w-full overflow-hidden rounded-2xl border border-edge bg-black">
            {capturedUrl ? (
              <img src={capturedUrl} alt="Captured frame" className="h-full w-full object-cover" />
            ) : (
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
            )}
          </div>
          {starting ? (
            <div className="flex items-center gap-2 text-sm text-dim"><Spinner size={14} />Starting camera…</div>
          ) : null}
          {error ? <p className="text-sm text-err">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            {!capturedBlob ? (
              <button type="button" onClick={captureFrame} className="btn-primary" disabled={starting}>
                <Icons.Camera />Capture
              </button>
            ) : (
              <>
                <button type="button" onClick={resetCapture} className="btn-secondary">
                  <Icons.Refresh />Retake
                </button>
                <button type="button" onClick={useCapture} className="btn-primary">
                  <Icons.Check />{confirmLabel}
                </button>
              </>
            )}
            <button type="button" onClick={onClose} className="btn-ghost ml-auto">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ObjectPosterCard({
  title,
  imagePath,
  fallbackIcon = <Icons.Library />,
  supportsHover = true,
  onOpen,
  onPointerUp,
  selected = false,
  leftBadges = [],
  rightBadge = null,
  overlayChildren = null,
  subtitle = null,
  meta = null,
  titleClassName = '',
  articleClassName = '',
  actionBar = null,
  onEdit,
  onDelete
}) {
  return (
    <article
      className={cx(
        'group relative animate-fade-in',
        onOpen && 'cursor-pointer',
        selected && 'rounded-xl ring-2 ring-brand/70 ring-offset-2 ring-offset-void',
        articleClassName
      )}
      onClick={onOpen}
      onPointerUp={onPointerUp}
    >
      <div className={cx('poster rounded-lg overflow-hidden shadow-card border transition-colors', selected ? 'border-brand/60' : 'border-transparent', !selected && 'group-hover:border-muted')}>
        {posterUrl(imagePath)
          ? <img src={posterUrl(imagePath)} alt={title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
          : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ghost">
              {fallbackIcon}
              <span className="px-3 text-center text-xs leading-tight">{title}</span>
            </div>
          )}
        <div className={cx('absolute inset-0 transition-opacity duration-300', selected ? 'bg-brand/20 opacity-100' : 'bg-card-fade', supportsHover ? (selected ? '' : 'opacity-0 group-hover:opacity-100') : (selected ? '' : 'opacity-10'))} />
        {leftBadges.length > 0 ? (
          <div className="absolute left-2 top-2 flex max-w-[70%] flex-wrap gap-2">
            {leftBadges.map((badge, index) => (
              <span key={`${title}-badge-${index}`} className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">
                {badge}
              </span>
            ))}
          </div>
        ) : null}
        {rightBadge ? (
          <div className="absolute right-2 top-2">
            {rightBadge}
          </div>
        ) : null}
        {overlayChildren}
        {(actionBar || onEdit || onDelete) ? (
          <div className={cx('absolute bottom-0 left-0 right-0 p-3 transition-all duration-300', supportsHover ? 'pointer-events-none translate-y-2 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100' : 'pointer-events-auto translate-y-0 opacity-100')}>
            {actionBar || (
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm flex-1 backdrop-blur-sm bg-void/60 border-ghost/30" onClick={(e) => { e.stopPropagation(); onEdit?.(e); }}><Icons.Edit />Edit</button>
                <button className="btn-icon btn-sm backdrop-blur-sm bg-void/60 border-ghost/30 text-err hover:bg-err/20" onClick={(e) => { e.stopPropagation(); onDelete?.(e); }}><Icons.Trash /></button>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <p className={cx('truncate text-sm font-medium text-ink', titleClassName)}>{title}</p>
        {subtitle ? <p className="text-xs text-ghost">{subtitle}</p> : null}
        {meta ? <div className="mt-1 flex flex-wrap gap-2">{meta}</div> : null}
      </div>
    </article>
  );
}

export function Toast({ message, type = 'ok', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const styles = {
    ok: 'border-ok/30 bg-ok/10 text-ok',
    error: 'border-err/30 bg-err/10 text-err',
    info: 'border-gold/30 bg-gold/10 text-gold'
  };
  return (
    <div className={cx('fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-deep animate-slide-up', styles[type] || styles.ok)}>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100"><Icons.X /></button>
    </div>
  );
}

export function ImportStatusDock({ jobs = [], onDismiss }) {
  if (!jobs.length) return null;
  return (
    <div className="fixed bottom-6 left-6 z-50 w-96 max-w-[calc(100vw-3rem)] space-y-2">
      {jobs.map((job) => {
        const provider = String(job.provider || '').toLowerCase();
        const label = provider === 'plex'
          ? 'Plex Import'
          : provider === 'csv_delicious'
            ? 'Delicious CSV Import'
            : provider === 'csv_generic'
              ? 'CSV Import'
              : 'Import Job';
        const isDone = job.status === 'succeeded' || job.status === 'failed';
        const p = job.progress || {};
        const s = job.summary || {};
        return (
          <div key={job.id} className="card p-3 border border-edge shadow-deep">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-dim font-medium">{label} #{job.id} · {job.status}</p>
                {isDone ? (
                  <p className="text-xs text-ghost mt-1">Created {s.created || 0} · Updated {s.updated || 0} · Errors {s.errorCount || 0}</p>
                ) : (
                  <p className="text-xs text-ghost mt-1">Processed {p.processed || 0}/{p.total || 0} · Created {p.created || 0} · Updated {p.updated || 0} · Errors {p.errorCount || 0}</p>
                )}
                {job.error && <p className="text-xs text-err mt-1">{job.error}</p>}
              </div>
              {isDone && <button onClick={() => onDismiss(job.id)} className="btn-icon btn-sm shrink-0"><Icons.X /></button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
