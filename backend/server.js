const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Pool } = require('pg');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const APP_VERSION = process.env.APP_VERSION || '1.6.3';
const GIT_SHA = process.env.GIT_SHA || 'dev';
const BUILD_DATE = process.env.BUILD_DATE || 'unknown';
const BUILD_LABEL = `v${APP_VERSION}+${GIT_SHA}`;
app.set('trust proxy', 1);
const useDatabaseSSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
const integrationEncryptionKey = crypto
  .createHash('sha256')
  .update(process.env.INTEGRATION_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-only-secret')
  .digest();

const BARCODE_PRESETS = {
  upcitemdb: {
    provider: 'upcitemdb',
    apiUrl: 'https://api.upcitemdb.com/prod/trial/lookup',
    apiKeyHeader: 'x-api-key',
    queryParam: 'upc'
  },
  barcodelookup: {
    provider: 'barcodelookup',
    apiUrl: 'https://api.barcodelookup.com/v3/products',
    apiKeyHeader: 'Authorization',
    queryParam: 'barcode'
  }
};

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

const TMDB_PRESETS = {
  tmdb: {
    provider: 'tmdb',
    apiUrl: 'https://api.themoviedb.org/3/search/movie',
    apiKeyHeader: '',
    apiKeyQueryParam: 'api_key'
  },
  custom: {
    provider: 'custom',
    apiUrl: '',
    apiKeyHeader: '',
    apiKeyQueryParam: 'api_key'
  }
};

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useDatabaseSSL ? { rejectUnauthorized: false } : false
});

// Redis connection
const redisClient = createClient({
  url: process.env.REDIS_URL
});
redisClient.connect().catch(console.error);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use('/api/', limiter);

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const encryptSecret = (plaintext) => {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', integrationEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
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

const resolveBarcodePreset = (presetName) => BARCODE_PRESETS[presetName] || BARCODE_PRESETS.upcitemdb;
const resolveVisionPreset = (presetName) => VISION_PRESETS[presetName] || VISION_PRESETS.ocrspace;
const resolveTmdbPreset = (presetName) => TMDB_PRESETS[presetName] || TMDB_PRESETS.tmdb;

const normalizeIntegrationRecord = (row) => {
  const envBarcodePreset = process.env.BARCODE_PRESET || process.env.BARCODE_PROVIDER || 'upcitemdb';
  const envVisionPreset = process.env.VISION_PRESET || process.env.VISION_PROVIDER || 'ocrspace';
  const barcodePreset = resolveBarcodePreset(row?.barcode_preset || envBarcodePreset);
  const visionPreset = resolveVisionPreset(row?.vision_preset || envVisionPreset);
  const envTmdbPreset = process.env.TMDB_PRESET || 'tmdb';
  const tmdbPreset = resolveTmdbPreset(row?.tmdb_preset || envTmdbPreset);
  const barcodeApiKey = decryptSecret(row?.barcode_api_key_encrypted) || process.env.BARCODE_API_KEY || '';
  const visionApiKey = decryptSecret(row?.vision_api_key_encrypted) || process.env.VISION_API_KEY || '';
  const tmdbApiKey = decryptSecret(row?.tmdb_api_key_encrypted) || process.env.TMDB_API_KEY || '';

  return {
    barcodePreset: row?.barcode_preset || envBarcodePreset,
    barcodeProvider: row?.barcode_provider || barcodePreset.provider,
    barcodeApiUrl: row?.barcode_api_url || barcodePreset.apiUrl || process.env.BARCODE_API_URL || '',
    barcodeApiKeyHeader: row?.barcode_api_key_header || barcodePreset.apiKeyHeader || process.env.BARCODE_API_KEY_HEADER || 'x-api-key',
    barcodeQueryParam: row?.barcode_query_param || barcodePreset.queryParam || process.env.BARCODE_QUERY_PARAM || 'upc',
    barcodeApiKey,
    visionPreset: row?.vision_preset || envVisionPreset,
    visionProvider: row?.vision_provider || visionPreset.provider,
    visionApiUrl: row?.vision_api_url || visionPreset.apiUrl || process.env.VISION_API_URL || '',
    visionApiKeyHeader: row?.vision_api_key_header || visionPreset.apiKeyHeader || process.env.VISION_API_KEY_HEADER || 'apikey',
    visionApiKey,
    tmdbPreset: row?.tmdb_preset || envTmdbPreset,
    tmdbProvider: row?.tmdb_provider || tmdbPreset.provider,
    tmdbApiUrl: row?.tmdb_api_url || tmdbPreset.apiUrl || process.env.TMDB_API_URL || 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKeyHeader: row?.tmdb_api_key_header || tmdbPreset.apiKeyHeader || process.env.TMDB_API_KEY_HEADER || '',
    tmdbApiKeyQueryParam: row?.tmdb_api_key_query_param || tmdbPreset.apiKeyQueryParam || process.env.TMDB_API_KEY_QUERY_PARAM || 'api_key',
    tmdbApiKey
  };
};

const loadAdminIntegrationConfig = async () => {
  const result = await pool.query('SELECT * FROM app_integrations WHERE id = 1');
  return normalizeIntegrationRecord(result.rows[0]);
};

const loadGeneralSettings = async () => {
  const result = await pool.query('SELECT * FROM app_settings WHERE id = 1');
  const row = result.rows[0] || {};
  return {
    theme: row.theme || 'system',
    density: row.density || 'comfortable'
  };
};

const ensureSchema = async () => {
  await pool.query(`ALTER TABLE media ADD COLUMN IF NOT EXISTS original_title VARCHAR(500)`);
  await pool.query(`ALTER TABLE media ADD COLUMN IF NOT EXISTS release_date DATE`);
  await pool.query(`ALTER TABLE media ADD COLUMN IF NOT EXISTS user_rating DECIMAL(2,1)`);
  await pool.query(`ALTER TABLE media ADD COLUMN IF NOT EXISTS tmdb_url TEXT`);
  await pool.query(`ALTER TABLE media ADD COLUMN IF NOT EXISTS trailer_url TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_integrations (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      barcode_preset VARCHAR(100) DEFAULT 'upcitemdb',
      barcode_provider VARCHAR(100),
      barcode_api_url TEXT,
      barcode_api_key_encrypted TEXT,
      barcode_api_key_header VARCHAR(100),
      barcode_query_param VARCHAR(100),
      vision_preset VARCHAR(100) DEFAULT 'ocrspace',
      vision_provider VARCHAR(100),
      vision_api_url TEXT,
      vision_api_key_encrypted TEXT,
      vision_api_key_header VARCHAR(100),
      tmdb_preset VARCHAR(100) DEFAULT 'tmdb',
      tmdb_provider VARCHAR(100),
      tmdb_api_url TEXT,
      tmdb_api_key_encrypted TEXT,
      tmdb_api_key_header VARCHAR(100),
      tmdb_api_key_query_param VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      theme VARCHAR(20) DEFAULT 'system',
      density VARCHAR(20) DEFAULT 'comfortable',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_integrations (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      barcode_preset VARCHAR(100) DEFAULT 'upcitemdb',
      barcode_provider VARCHAR(100),
      barcode_api_url TEXT,
      barcode_api_key_encrypted TEXT,
      barcode_api_key_header VARCHAR(100),
      barcode_query_param VARCHAR(100),
      vision_preset VARCHAR(100) DEFAULT 'ocrspace',
      vision_provider VARCHAR(100),
      vision_api_url TEXT,
      vision_api_key_encrypted TEXT,
      vision_api_key_header VARCHAR(100),
      tmdb_preset VARCHAR(100) DEFAULT 'tmdb',
      tmdb_provider VARCHAR(100),
      tmdb_api_url TEXT,
      tmdb_api_key_encrypted TEXT,
      tmdb_api_key_header VARCHAR(100),
      tmdb_api_key_query_param VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS tmdb_preset VARCHAR(100) DEFAULT 'tmdb'`);
  await pool.query(`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS tmdb_provider VARCHAR(100)`);
  await pool.query(`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS tmdb_api_url TEXT`);
  await pool.query(`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS tmdb_api_key_encrypted TEXT`);
  await pool.query(`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS tmdb_api_key_header VARCHAR(100)`);
  await pool.query(`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS tmdb_api_key_query_param VARCHAR(100)`);
  await pool.query(`ALTER TABLE app_integrations ADD COLUMN IF NOT EXISTS tmdb_preset VARCHAR(100) DEFAULT 'tmdb'`);
  await pool.query(`ALTER TABLE app_integrations ADD COLUMN IF NOT EXISTS tmdb_provider VARCHAR(100)`);
  await pool.query(`ALTER TABLE app_integrations ADD COLUMN IF NOT EXISTS tmdb_api_url TEXT`);
  await pool.query(`ALTER TABLE app_integrations ADD COLUMN IF NOT EXISTS tmdb_api_key_encrypted TEXT`);
  await pool.query(`ALTER TABLE app_integrations ADD COLUMN IF NOT EXISTS tmdb_api_key_header VARCHAR(100)`);
  await pool.query(`ALTER TABLE app_integrations ADD COLUMN IF NOT EXISTS tmdb_api_key_query_param VARCHAR(100)`);
  await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'system'`);
  await pool.query(`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS density VARCHAR(20) DEFAULT 'comfortable'`);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'update_app_integrations_updated_at'
        ) THEN
          CREATE TRIGGER update_app_integrations_updated_at
          BEFORE UPDATE ON app_integrations
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'update_app_settings_updated_at'
        ) THEN
          CREATE TRIGGER update_app_settings_updated_at
          BEFORE UPDATE ON app_settings
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'update_user_integrations_updated_at'
        ) THEN
          CREATE TRIGGER update_user_integrations_updated_at
          BEFORE UPDATE ON user_integrations
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END IF;
    END;
    $$;
  `);

  await pool.query(`
    INSERT INTO app_integrations (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO app_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
};

const searchTmdbMovie = async (title, year, integrationConfig = null) => {
  if (!title) return [];
  const config = integrationConfig || normalizeIntegrationRecord(null);
  const apiUrl = config.tmdbApiUrl || 'https://api.themoviedb.org/3/search/movie';
  const apiKey = config.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = config.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = config.tmdbApiKeyHeader || '';

  if (!apiKey) {
    throw new Error('TMDB API key is not configured');
  }

  const params = { query: title, year: year || undefined };
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;

  const response = await axios.get(apiUrl, {
    params,
    headers
  });
  return response.data?.results || [];
};

const tmdbBaseUrlFromSearchUrl = (searchUrl) => {
  try {
    const parsed = new URL(searchUrl || 'https://api.themoviedb.org/3/search/movie');
    parsed.pathname = '/3';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return 'https://api.themoviedb.org/3';
  }
};

const fetchTmdbMovieDetails = async (movieId, integrationConfig = null) => {
  if (!movieId) return {};
  const config = integrationConfig || normalizeIntegrationRecord(null);
  const apiKey = config.tmdbApiKey || process.env.TMDB_API_KEY || '';
  const apiKeyQueryParam = config.tmdbApiKeyQueryParam || 'api_key';
  const apiKeyHeader = config.tmdbApiKeyHeader || '';
  const apiBaseUrl = tmdbBaseUrlFromSearchUrl(config.tmdbApiUrl);

  if (!apiKey) {
    throw new Error('TMDB API key is not configured');
  }

  const params = { append_to_response: 'credits,videos' };
  const headers = {};
  if (apiKeyHeader) headers[apiKeyHeader] = apiKey;
  else params[apiKeyQueryParam] = apiKey;

  const response = await axios.get(`${apiBaseUrl}/movie/${movieId}`, { params, headers });
  const details = response.data || {};
  const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
  const director = crew.find((person) => person.job === 'Director')?.name
    || crew.find((person) => person.department === 'Directing')?.name
    || '';

  const videos = Array.isArray(details.videos?.results) ? details.videos.results : [];
  const trailer = videos.find((video) => video.type === 'Trailer' && video.site === 'YouTube' && video.official)
    || videos.find((video) => video.type === 'Trailer' && video.site === 'YouTube')
    || videos.find((video) => video.site === 'YouTube')
    || null;
  const trailerUrl = trailer?.key ? `https://www.youtube.com/watch?v=${trailer.key}` : '';

  return {
    director,
    runtime: details.runtime || null,
    trailer_url: trailerUrl,
    tmdb_url: `https://www.themoviedb.org/movie/${movieId}`
  };
};

const normalizeBarcodeMatches = (payload) => {
  const list = payload?.items
    || payload?.products
    || payload?.results
    || payload?.data
    || [];

  if (!Array.isArray(list)) return [];

  return list.map((entry) => {
    const title = entry?.title || entry?.name || entry?.product_name || null;
    const description = entry?.description || entry?.brand || entry?.manufacturer || null;
    const image = entry?.image || entry?.image_url || entry?.images?.[0] || null;
    return {
      title,
      description,
      image,
      raw: entry
    };
  });
};

const extractVisionText = (payload) => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (payload?.text) return payload.text;
  if (payload?.fullText) return payload.fullText;
  if (payload?.ParsedResults && Array.isArray(payload.ParsedResults)) {
    return payload.ParsedResults.map((result) => result.ParsedText || '').join('\n');
  }
  if (payload?.responses?.[0]?.fullTextAnnotation?.text) {
    return payload.responses[0].fullTextAnnotation.text;
  }
  if (payload?.data?.text) return payload.data.text;
  return '';
};

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

const extractRequestIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    return first || null;
  }
  return req.ip || req.socket?.remoteAddress || null;
};

const logActivity = async (req, action, entityType = null, entityId = null, details = null) => {
  try {
    const userId = req.user?.id || null;
    const ipAddress = extractRequestIp(req);
    await pool.query(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        userId,
        action,
        entityType,
        entityId,
        details ? JSON.stringify(details) : null,
        ipAddress
      ]
    );
  } catch (error) {
    logError('Activity log write', error);
  }
};

const logError = (context, error) => {
  const message = error?.message || String(error);
  const status = error?.response?.status;
  if (status) {
    console.error(`${context}: ${message} (status ${status})`);
  } else {
    console.error(`${context}: ${message}`);
  }
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Authorization middleware
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// ============ AUTH ROUTES ============

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, inviteToken } = req.body;
    const userCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const existingUserCount = userCountResult.rows[0]?.count || 0;

    // Validate invite token if provided
    if (inviteToken) {
      const invite = await pool.query(
        'SELECT * FROM invites WHERE token = $1 AND used = false AND expires_at > NOW()',
        [inviteToken]
      );
      if (invite.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
      }
    } else if (existingUserCount > 0) {
      return res.status(400).json({ error: 'Invite required for registration' });
    }

    // Check if user exists
    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const role = existingUserCount === 0 ? 'admin' : 'user';

    const result = await pool.query(
      'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [email, hashedPassword, name, role]
    );

    // Mark invite as used
    if (inviteToken) {
      await pool.query('UPDATE invites SET used = true WHERE token = $1', [inviteToken]);
    }

    const token = jwt.sign(
      { id: result.rows[0].id, email: result.rows[0].email, role: result.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ user: result.rows[0], token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch current user' });
  }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    logError('Load profile', error);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.patch('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const updates = [];
    const values = [];

    if (name) {
      values.push(name);
      updates.push(`name = $${values.length}`);
    }

    if (email) {
      const emailCheck = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [email, req.user.id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Email is already in use' });
      }
      values.push(email);
      updates.push(`email = $${values.length}`);
    }

    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      values.push(hashed);
      updates.push(`password = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No profile fields provided' });
    }

    values.push(req.user.id);
    const result = await pool.query(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, email, name, role, created_at, updated_at`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    logError('Update profile', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.get('/api/settings/general', authenticateToken, async (req, res) => {
  try {
    const settings = await loadGeneralSettings();
    res.json(settings);
  } catch (error) {
    logError('Load general settings', error);
    res.status(500).json({ error: 'Failed to load general settings' });
  }
});

app.put('/api/admin/settings/general', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const themeOptions = new Set(['system', 'light', 'dark']);
    const densityOptions = new Set(['comfortable', 'compact']);
    const incomingTheme = String(req.body?.theme || '').trim();
    const incomingDensity = String(req.body?.density || '').trim();
    const settings = await loadGeneralSettings();
    const theme = themeOptions.has(incomingTheme) ? incomingTheme : settings.theme;
    const density = densityOptions.has(incomingDensity) ? incomingDensity : settings.density;

    const result = await pool.query(
      `INSERT INTO app_settings (id, theme, density)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET
         theme = EXCLUDED.theme,
         density = EXCLUDED.density
       RETURNING theme, density`,
      [theme, density]
    );
    await logActivity(req, 'admin.settings.general.update', 'app_settings', 1, { theme, density });
    res.json(result.rows[0]);
  } catch (error) {
    logError('Update general settings', error);
    res.status(500).json({ error: 'Failed to update general settings' });
  }
});

app.get('/api/admin/settings/integrations', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const config = await loadAdminIntegrationConfig();
    res.json({
      barcodePreset: config.barcodePreset,
      barcodeProvider: config.barcodeProvider,
      barcodeApiUrl: config.barcodeApiUrl,
      barcodeApiKeyHeader: config.barcodeApiKeyHeader,
      barcodeQueryParam: config.barcodeQueryParam,
      barcodeApiKeySet: Boolean(config.barcodeApiKey),
      barcodeApiKeyMasked: maskSecret(config.barcodeApiKey),
      visionPreset: config.visionPreset,
      visionProvider: config.visionProvider,
      visionApiUrl: config.visionApiUrl,
      visionApiKeyHeader: config.visionApiKeyHeader,
      visionApiKeySet: Boolean(config.visionApiKey),
      visionApiKeyMasked: maskSecret(config.visionApiKey),
      tmdbPreset: config.tmdbPreset,
      tmdbProvider: config.tmdbProvider,
      tmdbApiUrl: config.tmdbApiUrl,
      tmdbApiKeyHeader: config.tmdbApiKeyHeader,
      tmdbApiKeyQueryParam: config.tmdbApiKeyQueryParam,
      tmdbApiKeySet: Boolean(config.tmdbApiKey),
      tmdbApiKeyMasked: maskSecret(config.tmdbApiKey)
    });
  } catch (error) {
    logError('Load integration profile', error);
    res.status(500).json({ error: 'Failed to load integration settings' });
  }
});

app.put('/api/admin/settings/integrations', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const {
      barcodePreset,
      barcodeProvider,
      barcodeApiUrl,
      barcodeApiKeyHeader,
      barcodeQueryParam,
      barcodeApiKey,
      clearBarcodeApiKey,
      visionPreset,
      visionProvider,
      visionApiUrl,
      visionApiKeyHeader,
      visionApiKey,
      clearVisionApiKey,
      tmdbPreset,
      tmdbProvider,
      tmdbApiUrl,
      tmdbApiKeyHeader,
      tmdbApiKeyQueryParam,
      tmdbApiKey,
      clearTmdbApiKey
    } = req.body;

    const selectedBarcodePreset = resolveBarcodePreset(barcodePreset || 'upcitemdb');
    const selectedVisionPreset = resolveVisionPreset(visionPreset || 'ocrspace');
    const selectedTmdbPreset = resolveTmdbPreset(tmdbPreset || 'tmdb');
    const existingRow = await pool.query('SELECT * FROM app_integrations WHERE id = 1');
    const existing = existingRow.rows[0] || null;
    const pick = (incoming, existingValue, fallback) => (
      incoming !== undefined ? incoming : (existingValue ?? fallback)
    );

    const finalBarcodeApiKey = clearBarcodeApiKey
      ? null
      : (barcodeApiKey ? encryptSecret(barcodeApiKey) : existing?.barcode_api_key_encrypted || null);
    const finalVisionApiKey = clearVisionApiKey
      ? null
      : (visionApiKey ? encryptSecret(visionApiKey) : existing?.vision_api_key_encrypted || null);
    const finalTmdbApiKey = clearTmdbApiKey
      ? null
      : (tmdbApiKey ? encryptSecret(tmdbApiKey) : existing?.tmdb_api_key_encrypted || null);

    const result = await pool.query(
      `INSERT INTO app_integrations (
         id,
         barcode_preset,
         barcode_provider,
         barcode_api_url,
         barcode_api_key_encrypted,
         barcode_api_key_header,
         barcode_query_param,
         vision_preset,
         vision_provider,
         vision_api_url,
         vision_api_key_encrypted,
         vision_api_key_header,
         tmdb_preset,
         tmdb_provider,
         tmdb_api_url,
         tmdb_api_key_encrypted,
         tmdb_api_key_header,
         tmdb_api_key_query_param
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
       )
       ON CONFLICT (id) DO UPDATE SET
         barcode_preset = EXCLUDED.barcode_preset,
         barcode_provider = EXCLUDED.barcode_provider,
         barcode_api_url = EXCLUDED.barcode_api_url,
         barcode_api_key_encrypted = EXCLUDED.barcode_api_key_encrypted,
         barcode_api_key_header = EXCLUDED.barcode_api_key_header,
         barcode_query_param = EXCLUDED.barcode_query_param,
         vision_preset = EXCLUDED.vision_preset,
         vision_provider = EXCLUDED.vision_provider,
         vision_api_url = EXCLUDED.vision_api_url,
         vision_api_key_encrypted = EXCLUDED.vision_api_key_encrypted,
         vision_api_key_header = EXCLUDED.vision_api_key_header,
         tmdb_preset = EXCLUDED.tmdb_preset,
         tmdb_provider = EXCLUDED.tmdb_provider,
         tmdb_api_url = EXCLUDED.tmdb_api_url,
         tmdb_api_key_encrypted = EXCLUDED.tmdb_api_key_encrypted,
         tmdb_api_key_header = EXCLUDED.tmdb_api_key_header,
         tmdb_api_key_query_param = EXCLUDED.tmdb_api_key_query_param
       RETURNING *`,
      [
        1,
        pick(barcodePreset, existing?.barcode_preset, 'upcitemdb'),
        pick(barcodeProvider, existing?.barcode_provider, selectedBarcodePreset.provider),
        pick(barcodeApiUrl, existing?.barcode_api_url, selectedBarcodePreset.apiUrl),
        finalBarcodeApiKey,
        pick(barcodeApiKeyHeader, existing?.barcode_api_key_header, selectedBarcodePreset.apiKeyHeader),
        pick(barcodeQueryParam, existing?.barcode_query_param, selectedBarcodePreset.queryParam),
        pick(visionPreset, existing?.vision_preset, 'ocrspace'),
        pick(visionProvider, existing?.vision_provider, selectedVisionPreset.provider),
        pick(visionApiUrl, existing?.vision_api_url, selectedVisionPreset.apiUrl),
        finalVisionApiKey,
        pick(visionApiKeyHeader, existing?.vision_api_key_header, selectedVisionPreset.apiKeyHeader),
        pick(tmdbPreset, existing?.tmdb_preset, 'tmdb'),
        pick(tmdbProvider, existing?.tmdb_provider, selectedTmdbPreset.provider),
        pick(tmdbApiUrl, existing?.tmdb_api_url, selectedTmdbPreset.apiUrl),
        finalTmdbApiKey,
        pick(tmdbApiKeyHeader, existing?.tmdb_api_key_header, selectedTmdbPreset.apiKeyHeader),
        pick(tmdbApiKeyQueryParam, existing?.tmdb_api_key_query_param, selectedTmdbPreset.apiKeyQueryParam)
      ]
    );

    const config = normalizeIntegrationRecord(result.rows[0]);
    await logActivity(req, 'admin.settings.integrations.update', 'app_integrations', 1, {
      barcodePreset: config.barcodePreset,
      barcodeProvider: config.barcodeProvider,
      barcodeApiUrl: config.barcodeApiUrl,
      barcodeApiKeySet: Boolean(config.barcodeApiKey),
      visionPreset: config.visionPreset,
      visionProvider: config.visionProvider,
      visionApiUrl: config.visionApiUrl,
      visionApiKeySet: Boolean(config.visionApiKey),
      tmdbPreset: config.tmdbPreset,
      tmdbProvider: config.tmdbProvider,
      tmdbApiUrl: config.tmdbApiUrl,
      tmdbApiKeySet: Boolean(config.tmdbApiKey),
      keyUpdates: {
        barcode: Boolean(barcodeApiKey),
        vision: Boolean(visionApiKey),
        tmdb: Boolean(tmdbApiKey)
      },
      keyClears: {
        barcode: Boolean(clearBarcodeApiKey),
        vision: Boolean(clearVisionApiKey),
        tmdb: Boolean(clearTmdbApiKey)
      }
    });
    res.json({
      barcodePreset: config.barcodePreset,
      barcodeProvider: config.barcodeProvider,
      barcodeApiUrl: config.barcodeApiUrl,
      barcodeApiKeyHeader: config.barcodeApiKeyHeader,
      barcodeQueryParam: config.barcodeQueryParam,
      barcodeApiKeySet: Boolean(config.barcodeApiKey),
      barcodeApiKeyMasked: maskSecret(config.barcodeApiKey),
      visionPreset: config.visionPreset,
      visionProvider: config.visionProvider,
      visionApiUrl: config.visionApiUrl,
      visionApiKeyHeader: config.visionApiKeyHeader,
      visionApiKeySet: Boolean(config.visionApiKey),
      visionApiKeyMasked: maskSecret(config.visionApiKey),
      tmdbPreset: config.tmdbPreset,
      tmdbProvider: config.tmdbProvider,
      tmdbApiUrl: config.tmdbApiUrl,
      tmdbApiKeyHeader: config.tmdbApiKeyHeader,
      tmdbApiKeyQueryParam: config.tmdbApiKeyQueryParam,
      tmdbApiKeySet: Boolean(config.tmdbApiKey),
      tmdbApiKeyMasked: maskSecret(config.tmdbApiKey)
    });
  } catch (error) {
    logError('Update integration profile', error);
    res.status(500).json({ error: 'Failed to update integration settings' });
  }
});

app.post('/api/admin/settings/integrations/test-barcode', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { upc } = req.body || {};
    const config = await loadAdminIntegrationConfig();
    const testUpc = String(upc || '012569828708').trim();

    if (!config.barcodeApiUrl) {
      return res.status(400).json({
        ok: false,
        authenticated: false,
        detail: 'Barcode API URL is not configured'
      });
    }

    const headers = {};
    if (config.barcodeApiKey) headers[config.barcodeApiKeyHeader || 'x-api-key'] = config.barcodeApiKey;

    const response = await axios.get(config.barcodeApiUrl, {
      params: { [config.barcodeQueryParam || 'upc']: testUpc },
      headers,
      timeout: 15000,
      validateStatus: () => true
    });

    const status = response.status;
    const authenticated = status !== 401 && status !== 403;
    const detail = response.data?.message
      || response.data?.error
      || `Provider returned status ${status}`;

    res.json({
      ok: authenticated,
      authenticated,
      status,
      provider: config.barcodeProvider,
      detail
    });
  } catch (error) {
    logError('Test barcode integration', error);
    res.status(502).json({
      ok: false,
      authenticated: false,
      detail: error.message
    });
  }
});

app.post('/api/admin/settings/integrations/test-vision', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    const config = await loadAdminIntegrationConfig();
    const provider = config.visionProvider || 'ocrspace';

    if (!config.visionApiUrl) {
      return res.status(400).json({
        ok: false,
        authenticated: false,
        detail: 'Vision API URL is not configured'
      });
    }

    let response;
    if (provider === 'ocrspace') {
      const body = new FormData();
      body.append('url', imageUrl || 'https://upload.wikimedia.org/wikipedia/en/c/c1/The_Matrix_Poster.jpg');
      body.append('language', 'eng');
      body.append('isOverlayRequired', 'false');

      const headers = { ...body.getHeaders() };
      if (config.visionApiKey) headers[config.visionApiKeyHeader || 'apikey'] = config.visionApiKey;

      response = await axios.post(config.visionApiUrl, body, {
        headers,
        timeout: 20000,
        validateStatus: () => true
      });
    } else {
      const headers = {};
      if (config.visionApiKey) headers[config.visionApiKeyHeader || 'x-api-key'] = config.visionApiKey;
      response = await axios.get(config.visionApiUrl, {
        headers,
        timeout: 15000,
        validateStatus: () => true
      });
    }

    const status = response.status;
    const authenticated = status !== 401 && status !== 403;
    const detail = response.data?.ErrorMessage
      || response.data?.message
      || response.data?.error
      || `Provider returned status ${status}`;

    res.json({
      ok: authenticated,
      authenticated,
      status,
      provider: config.visionProvider,
      detail
    });
  } catch (error) {
    logError('Test vision integration', error);
    res.status(502).json({
      ok: false,
      authenticated: false,
      detail: error.message
    });
  }
});

app.post('/api/admin/settings/integrations/test-tmdb', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { title, year } = req.body || {};
    const config = await loadAdminIntegrationConfig();
    const testTitle = String(title || 'The Matrix').trim();
    const testYear = year || '1999';

    const results = await searchTmdbMovie(testTitle, testYear, config);
    res.json({
      ok: true,
      authenticated: true,
      status: 200,
      provider: config.tmdbProvider || 'tmdb',
      detail: `Received ${results.length} result(s)`,
      resultCount: results.length
    });
  } catch (error) {
    logError('Test tmdb integration', error);
    const status = error.response?.status || 502;
    const authenticated = status !== 401 && status !== 403;
    const providerDetail = typeof error.response?.data === 'string'
      ? error.response.data
      : error.response?.data?.status_message || error.response?.data?.message || error.message;
    res.status(200).json({
      ok: false,
      authenticated,
      status,
      provider: process.env.TMDB_PRESET || 'tmdb',
      detail: providerDetail
    });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============ USER MANAGEMENT ROUTES ============

// Get all users (admin only)
app.get('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user role (admin only)
app.patch('/api/users/:id/role', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const targetBefore = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
    if (targetBefore.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, name, role',
      [role, id]
    );
    await logActivity(req, 'admin.user.role.update', 'user', Number(id), {
      email: result.rows[0]?.email || targetBefore.rows[0].email,
      previousRole: targetBefore.rows[0].role,
      nextRole: result.rows[0]?.role || role
    });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const target = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (target.rows[0]) {
      await logActivity(req, 'admin.user.delete', 'user', Number(id), {
        email: target.rows[0].email,
        role: target.rows[0].role
      });
    }
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Create invite (admin only)
app.post('/api/invites', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { email } = req.body;
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const result = await pool.query(
      'INSERT INTO invites (email, token, expires_at, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [email, token, expiresAt, req.user.id]
    );
    await logActivity(req, 'admin.invite.create', 'invite', result.rows[0].id, {
      email: result.rows[0].email,
      expiresAt: result.rows[0].expires_at
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

app.get('/api/invites', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, token, used, expires_at, created_at
       FROM invites
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

app.get('/api/admin/activity', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    const result = await pool.query(
      `SELECT id, user_id, action, entity_type, entity_id, details, ip_address, created_at
       FROM activity_log
       ORDER BY id DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (error) {
    logError('Load admin activity', error);
    res.status(500).json({ error: 'Failed to load activity log' });
  }
});

// ============ MEDIA ROUTES ============

// Get all media
app.get('/api/media', authenticateToken, async (req, res) => {
  try {
    const { format, search } = req.query;
    let query = 'SELECT * FROM media WHERE 1=1';
    const params = [];

    if (format && format !== 'all') {
      params.push(format);
      query += ` AND format = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (title ILIKE $${params.length} OR director ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// Search TMDB
app.post('/api/media/search-tmdb', authenticateToken, async (req, res) => {
  try {
    const { title, year } = req.body;
    const config = await loadAdminIntegrationConfig();
    const results = await searchTmdbMovie(title, year, config);
    res.json(results);
  } catch (error) {
    logError('TMDB search', error);
    res.status(500).json({ error: 'TMDB search failed' });
  }
});

app.get('/api/media/tmdb/:id/details', authenticateToken, async (req, res) => {
  try {
    const movieId = Number(req.params.id);
    if (!Number.isFinite(movieId) || movieId <= 0) {
      return res.status(400).json({ error: 'Valid TMDB id is required' });
    }
    const config = await loadAdminIntegrationConfig();
    const details = await fetchTmdbMovieDetails(movieId, config);
    res.json(details);
  } catch (error) {
    logError('TMDB details', error);
    res.status(500).json({ error: 'TMDB details lookup failed' });
  }
});

app.post('/api/media/lookup-upc', authenticateToken, async (req, res) => {
  try {
    const { upc } = req.body;
    if (!upc || !String(upc).trim()) {
      return res.status(400).json({ error: 'UPC is required' });
    }

    const config = await loadAdminIntegrationConfig();
    const provider = config.barcodeProvider || 'upcitemdb';
    const barcodeApiUrl = config.barcodeApiUrl;
    const barcodeQueryParam = config.barcodeQueryParam || 'upc';
    const barcodeApiKey = config.barcodeApiKey;
    const barcodeApiKeyHeader = config.barcodeApiKeyHeader || 'x-api-key';

    if (!barcodeApiUrl) {
      return res.status(400).json({
        error: 'UPC lookup failed',
        provider,
        detail: 'Barcode API URL is not configured'
      });
    }

    const headers = {};
    if (barcodeApiKey) headers[barcodeApiKeyHeader] = barcodeApiKey;

    const barcodeResponse = await axios.get(barcodeApiUrl, {
      params: { [barcodeQueryParam]: String(upc).trim() },
      headers,
      timeout: 15000
    });

    const barcodeMatches = normalizeBarcodeMatches(barcodeResponse.data);
    const enrichedMatches = [];

    for (const match of barcodeMatches.slice(0, 6)) {
      let tmdb = null;
      if (match.title) {
        const tmdbResults = await searchTmdbMovie(match.title, undefined, config);
        tmdb = tmdbResults[0] || null;
      }

      enrichedMatches.push({
        ...match,
        tmdb
      });
    }

    res.json({
      provider,
      upc: String(upc).trim(),
      matches: enrichedMatches
    });
  } catch (error) {
    logError('UPC lookup', error);
    const status = error.response?.status && error.response.status < 500 ? error.response.status : 502;
    const providerDetail = typeof error.response?.data === 'string'
      ? error.response.data
      : error.response?.data?.error || error.response?.data?.message || null;
    res.status(status).json({
      error: 'UPC lookup failed',
      provider: process.env.BARCODE_PRESET || process.env.BARCODE_PROVIDER || 'upcitemdb',
      detail: providerDetail || error.message
    });
  }
});

app.post('/api/media/recognize-cover', authenticateToken, upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Cover image file is required' });
    }

    const config = await loadAdminIntegrationConfig();
    const provider = config.visionProvider || 'ocrspace';
    const visionApiUrl = config.visionApiUrl;
    const visionApiKey = config.visionApiKey;
    const visionApiKeyHeader = config.visionApiKeyHeader || 'apikey';

    if (!visionApiUrl) {
      return res.status(400).json({
        error: 'Cover recognition failed',
        provider,
        detail: 'Vision API URL is not configured'
      });
    }

    if (provider === 'ocrspace' && !visionApiKey) {
      return res.status(400).json({
        error: 'Cover recognition failed',
        provider,
        detail: 'VISION_API_KEY is required when using ocrspace provider'
      });
    }

    const body = new FormData();
    body.append('file', fs.createReadStream(req.file.path));
    body.append('language', 'eng');
    body.append('isOverlayRequired', 'false');

    const headers = { ...body.getHeaders() };
    if (visionApiKey) headers[visionApiKeyHeader] = visionApiKey;

    const visionResponse = await axios.post(visionApiUrl, body, {
      headers,
      timeout: 25000
    });

    const extractedText = extractVisionText(visionResponse.data);
    const titleCandidates = extractTitleCandidates(extractedText);
    const tmdbMatches = [];
    const seenTmdbIds = new Set();

    for (const candidate of titleCandidates.slice(0, 6)) {
      const results = await searchTmdbMovie(candidate, undefined, config);
      if (results[0] && !seenTmdbIds.has(results[0].id)) {
        seenTmdbIds.add(results[0].id);
        tmdbMatches.push(results[0]);
      }
    }

    res.json({
      provider,
      extractedText: extractedText.slice(0, 2000),
      titleCandidates,
      tmdbMatches
    });
  } catch (error) {
    logError('Cover recognition', error);
    const status = error.response?.status && error.response.status < 500 ? error.response.status : 502;
    const providerDetail = typeof error.response?.data === 'string'
      ? error.response.data
      : error.response?.data?.error || error.response?.data?.message || null;
    res.status(status).json({
      error: 'Cover recognition failed',
      provider: process.env.VISION_PRESET || process.env.VISION_PROVIDER || 'ocrspace',
      detail: providerDetail || error.message
    });
  } finally {
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  }
});

// Add media
app.post('/api/media', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      original_title,
      release_date,
      year,
      format,
      genre,
      director,
      rating,
      user_rating,
      tmdb_id,
      tmdb_url,
      poster_path,
      backdrop_path,
      overview,
      trailer_url,
      runtime,
      upc,
      location,
      notes
    } = req.body;

    const result = await pool.query(
      `INSERT INTO media (
        title, original_title, release_date, year, format, genre, director, rating, user_rating, tmdb_id, tmdb_url, poster_path,
        backdrop_path, overview, trailer_url, runtime, upc, location, notes, added_by
      ) 
       VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20
      ) RETURNING *`,
      [
        title,
        original_title || null,
        release_date || null,
        year,
        format,
        genre,
        director,
        rating,
        user_rating,
        tmdb_id,
        tmdb_url || null,
        poster_path,
        backdrop_path,
        overview,
        trailer_url || null,
        runtime,
        upc,
        location,
        notes,
        req.user.id
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add media' });
  }
});

// Update media
app.patch('/api/media/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const allowedFields = [
      'title',
      'original_title',
      'release_date',
      'year',
      'format',
      'genre',
      'director',
      'rating',
      'user_rating',
      'tmdb_id',
      'tmdb_url',
      'poster_path',
      'backdrop_path',
      'overview',
      'trailer_url',
      'runtime',
      'upc',
      'location',
      'notes'
    ];
    const fields = Object.fromEntries(
      Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
    );
    const keys = Object.keys(fields);
    const values = Object.values(fields);

    if (keys.length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');
    const result = await pool.query(
      `UPDATE media SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update media' });
  }
});

// Delete media
app.delete('/api/media/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM media WHERE id = $1', [id]);
    res.json({ message: 'Media deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

// Upload cover image
app.post('/api/media/upload-cover', authenticateToken, upload.single('cover'), async (req, res) => {
  try {
    res.json({ path: `/uploads/${req.file.filename}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, gitSha: GIT_SHA, buildDate: BUILD_DATE, build: BUILD_LABEL });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, gitSha: GIT_SHA, buildDate: BUILD_DATE, build: BUILD_LABEL });
});

const startServer = async () => {
  await ensureSchema();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} and bound to 0.0.0.0`);
  });
};

startServer().catch((error) => {
  console.error('Failed to initialize server:', error.message);
  process.exit(1);
});

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} Origin:${req.headers.origin}`);
  next();
});
