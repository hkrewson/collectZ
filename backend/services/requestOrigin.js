function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function getRequestOrigin(req) {
  const configuredOrigin = trimTrailingSlash(
    process.env.APP_PUBLIC_URL
      || process.env.PUBLIC_APP_ORIGIN
      || process.env.PUBLIC_BASE_URL
      || ''
  );
  if (configuredOrigin) return configuredOrigin;

  const originHeader = trimTrailingSlash(req.get('origin'));
  if (originHeader) return originHeader;

  const forwardedProto = firstHeaderValue(req.get('x-forwarded-proto')) || req.protocol || 'http';
  const forwardedHost = firstHeaderValue(req.get('x-forwarded-host')) || req.get('host') || '';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return trimTrailingSlash(`${req.protocol}://${req.get('host') || ''}`);
}

module.exports = {
  getRequestOrigin
};
