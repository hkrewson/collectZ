const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const provider = String(process.env.STORAGE_PROVIDER || 'local').toLowerCase();
const localUploadsDir = path.resolve(process.cwd(), 'uploads');
const LOCAL_UPLOAD_KEY_PATTERN = /^\d{13}-[a-f0-9]{12}(?:\.[a-z0-9]{1,9})?$/;

function sanitizeExt(originalName = '') {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!ext || ext.length > 10) return '';
  return ext.replace(/[^a-z0-9.]/g, '');
}

function buildKey(originalName = '') {
  const ext = sanitizeExt(originalName);
  const stamp = Date.now();
  const rand = crypto.randomBytes(6).toString('hex');
  return `${stamp}-${rand}${ext}`;
}

function assertLocalUploadKey(key = '') {
  const value = String(key || '');
  if (!LOCAL_UPLOAD_KEY_PATTERN.test(value)) {
    throw new Error('Invalid local upload key');
  }
  return value;
}

function resolveLocalUploadPath(key = '') {
  const uploadKey = assertLocalUploadKey(key);
  const fullPath = path.resolve(localUploadsDir, uploadKey);
  const uploadsRoot = `${localUploadsDir}${path.sep}`;
  if (!fullPath.startsWith(uploadsRoot)) {
    throw new Error('Invalid local upload path');
  }
  return fullPath;
}

async function ensureLocalDir() {
  await fs.promises.mkdir(localUploadsDir, { recursive: true });
}

function localPublicUrl(key) {
  return `/uploads/${key}`;
}

function resolveS3PublicUrl(key) {
  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/+$/, '')}/${key}`;
  }

  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || 'us-east-1';

  if (endpoint) {
    return `${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function createS3Client() {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || 'true') === 'true';

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3 storage requires S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY');
  }

  return {
    bucket,
    client: new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey }
    })
  };
}

async function uploadBuffer(buffer, originalName, contentType = 'application/octet-stream') {
  const key = buildKey(originalName);
  const uploadBody = Buffer.isBuffer(buffer) ? Buffer.from(buffer) : Buffer.from(buffer || '');

  if (provider !== 's3') {
    await ensureLocalDir();
    await fs.promises.writeFile(resolveLocalUploadPath(key), uploadBody);
    return { key, url: localPublicUrl(key), provider: 'local' };
  }

  const { client, bucket } = createS3Client();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: uploadBody,
    ContentType: contentType
  }));
  return { key, url: resolveS3PublicUrl(key), provider: 's3' };
}

async function readLocalUploadBuffer(publicPath = '') {
  const value = String(publicPath || '').trim();
  if (!value.startsWith('/uploads/')) return null;
  const key = path.basename(value);
  if (!key || key !== value.slice('/uploads/'.length)) return null;
  const fullPath = resolveLocalUploadPath(key);
  return fs.promises.readFile(fullPath);
}

module.exports = {
  uploadBuffer,
  readLocalUploadBuffer
};
