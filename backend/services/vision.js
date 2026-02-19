const VISION_PRESETS = {
  ocrspace: {
    provider: 'ocrspace',
    apiUrl: 'https://api.ocr.space/parse/image',
    apiKeyHeader: 'apikey'
  },
  custom: {
    provider: 'custom',
    apiUrl: '',
    apiKeyHeader: 'x-api-key'
  }
};

const resolveVisionPreset = (presetName) =>
  VISION_PRESETS[presetName] || VISION_PRESETS.ocrspace;

/**
 * Extract plain text from vision provider response payloads.
 * Handles OCR.Space, Google Vision, and generic text shapes.
 */
const extractVisionText = (payload) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (payload?.text) return payload.text;
  if (payload?.fullText) return payload.fullText;
  if (payload?.ParsedResults && Array.isArray(payload.ParsedResults)) {
    return payload.ParsedResults.map((r) => r.ParsedText || '').join('\n');
  }
  if (payload?.responses?.[0]?.fullTextAnnotation?.text) {
    return payload.responses[0].fullTextAnnotation.text;
  }
  if (payload?.data?.text) return payload.data.text;
  return '';
};

/**
 * Extract title candidates from raw OCR text.
 * Returns up to 12 unique lines that look like they could be titles.
 */
const extractTitleCandidates = (rawText) => {
  const lines = String(rawText || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 3 && line.length <= 90)
    .filter((line) => /[A-Za-z]/.test(line))
    .filter((line) => !/^\d+$/.test(line));

  const unique = [];
  const seen = new Set();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(line);
    }
  }
  return unique.slice(0, 12);
};

module.exports = {
  VISION_PRESETS,
  resolveVisionPreset,
  extractVisionText,
  extractTitleCandidates
};
