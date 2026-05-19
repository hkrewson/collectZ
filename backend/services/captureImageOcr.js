const axios = require('axios');

function normalizeVisionPreset(value = '') {
  const preset = String(value || '').trim().toLowerCase();
  if (!preset || preset === 'ocrspace' || preset === 'ocr.space') {
    return {
      preset: 'ocrspace',
      provider: 'ocrspace',
      apiUrl: 'https://api.ocr.space/parse/image',
      apiKeyHeader: 'apikey'
    };
  }
  if (preset === 'mock' || preset === 'fixture') {
    return {
      preset,
      provider: preset,
      apiUrl: '',
      apiKeyHeader: ''
    };
  }
  return {
    preset,
    provider: preset,
    apiUrl: '',
    apiKeyHeader: ''
  };
}

function extractOcrSpaceText(payload = {}) {
  const results = Array.isArray(payload?.ParsedResults) ? payload.ParsedResults : [];
  return results
    .map((result) => String(result?.ParsedText || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildOcrProviderConfig(config = {}) {
  const preset = normalizeVisionPreset(config.visionPreset || config.visionProvider || process.env.VISION_PRESET || process.env.VISION_PROVIDER);
  return {
    preset: preset.preset,
    provider: config.visionProvider || preset.provider,
    apiUrl: config.visionApiUrl || preset.apiUrl || process.env.VISION_API_URL || '',
    apiKey: config.visionApiKey || process.env.VISION_API_KEY || '',
    apiKeyHeader: config.visionApiKeyHeader || preset.apiKeyHeader || process.env.VISION_API_KEY_HEADER || 'apikey'
  };
}

async function extractTextFromImageBuffer(buffer, { filename = 'capture-image', mimeType = 'application/octet-stream', config = {} } = {}) {
  const providerConfig = buildOcrProviderConfig(config);
  if (providerConfig.provider === 'mock' || providerConfig.provider === 'fixture') {
    return {
      provider: providerConfig.provider,
      text: String(process.env.CAPTURE_OCR_FIXTURE_TEXT || providerConfig.apiUrl || '').trim(),
      raw: { fixture: true }
    };
  }

  if (providerConfig.provider !== 'ocrspace') {
    const error = new Error('Configured vision provider does not support capture OCR.');
    error.status = 409;
    error.code = 'unsupported_vision_provider';
    throw error;
  }
  if (!providerConfig.apiUrl) {
    const error = new Error('Vision OCR API URL is not configured.');
    error.status = 409;
    error.code = 'vision_not_configured';
    throw error;
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append('language', 'eng');
  form.append('isOverlayRequired', 'false');
  form.append('scale', 'true');
  form.append('OCREngine', '2');

  const headers = {};
  if (providerConfig.apiKey) headers[providerConfig.apiKeyHeader || 'apikey'] = providerConfig.apiKey;

  const response = await axios.post(providerConfig.apiUrl, form, {
    headers,
    timeout: 30000,
    maxContentLength: 20 * 1024 * 1024,
    maxBodyLength: 20 * 1024 * 1024
  });

  const text = extractOcrSpaceText(response.data);
  return {
    provider: providerConfig.provider,
    text,
    raw: response.data || {}
  };
}

module.exports = {
  normalizeVisionPreset,
  buildOcrProviderConfig,
  extractOcrSpaceText,
  extractTextFromImageBuffer
};
