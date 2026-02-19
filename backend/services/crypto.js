const crypto = require('crypto');

const integrationEncryptionKey = crypto
  .createHash('sha256')
  .update(
    process.env.INTEGRATION_ENCRYPTION_KEY
    || process.env.SESSION_SECRET
    || 'dev-only-secret'
  )
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

const decryptSecret = (encryptedText) => {
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
  } catch (_) {
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
