const dns = require('dns');
const net = require('net');

const PRIVATE_HOST_ALLOW_ENV = 'ALLOW_PRIVATE_ICS_FEEDS';

function trimTrailingSlashes(value) {
  let text = String(value || '');
  while (text.endsWith('/')) {
    text = text.slice(0, -1);
  }
  return text;
}

function parseHttpUrl(rawUrl = '', { allowWebcal = false } = {}) {
  const normalized = String(rawUrl || '').trim();
  const value = allowWebcal ? normalized.replace(/^webcal:/i, 'https:') : normalized;
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed;
  } catch (_) {
    return null;
  }
}

function normalizeTrustedConnectorHttpUrl(rawUrl = '') {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) return '';
  return parsed.origin + trimTrailingSlashes(parsed.pathname);
}

function isPrivateIpv4(address = '') {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateIpv6(address = '') {
  const value = String(address || '').toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
}

function isPrivateAddress(address = '') {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

function isLocalhostName(hostname = '') {
  const value = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return value === 'localhost' || value.endsWith('.localhost');
}

async function assertPublicHttpUrl(rawUrl = '', {
  allowWebcal = false,
  allowPrivateHosts = false,
  lookup = dns.promises.lookup
} = {}) {
  const parsed = parseHttpUrl(rawUrl, { allowWebcal });
  if (!parsed) {
    throw new Error('URL must use http or https and must not include credentials');
  }

  if (allowPrivateHosts) return parsed.toString();

  const hostname = parsed.hostname;
  if (isLocalhostName(hostname)) {
    throw new Error('URL host must not be localhost');
  }
  if (isPrivateAddress(hostname)) {
    throw new Error('URL host must not be private, loopback, or link-local');
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  const resolved = Array.isArray(addresses) ? addresses : [addresses];
  if (resolved.some((entry) => isPrivateAddress(entry?.address))) {
    throw new Error('URL host resolves to a private, loopback, or link-local address');
  }
  return parsed.toString();
}

function shouldAllowPrivateIcsFeeds() {
  return String(process.env[PRIVATE_HOST_ALLOW_ENV] || '').trim().toLowerCase() === 'true';
}

module.exports = {
  PRIVATE_HOST_ALLOW_ENV,
  parseHttpUrl,
  normalizeTrustedConnectorHttpUrl,
  isPrivateAddress,
  isLocalhostName,
  assertPublicHttpUrl,
  shouldAllowPrivateIcsFeeds
};
