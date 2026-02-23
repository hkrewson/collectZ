const crypto = require('crypto');

const resolveIntegrationKeyMaterial = () => {
  const explicitKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (explicitKey) return explicitKey;

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be set in production');
  }

  const devFallback = process.env.SESSION_SECRET || 'dev-only-secret';
  // Dev fallback is allowed for local iteration only.
  console.warn('[crypto] INTEGRATION_ENCRYPTION_KEY missing; using development fallback key material');
  return devFallback;
};

const integrationEncryptionKey = crypto
  .createHash('sha256')
  .update(resolveIntegrationKeyMaterial())
  .digest();

const encryptSecret = (plaintext) => {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', integrationEncryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decryptSecret = (encryptedText, contextLabel = '') => {
  if (!encryptedText) return '';
  try {
    const [ivB64, tagB64, dataB64] = encryptedText.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      integrationEncryptionKey,
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    const suffix = contextLabel ? ` (${contextLabel})` : '';
    console.warn(`[crypto] Failed to decrypt integration secret${suffix}: ${error.message}`);
    return '';
  }
};

const maskSecret = (secret) => {
  if (!secret) return '';
  const value = String(secret);
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
};

module.exports = { encryptSecret, decryptSecret, maskSecret };
