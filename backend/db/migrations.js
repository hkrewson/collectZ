/**
 * Schema migration runner.
 *
 * Migrations are applied in order, each inside a transaction.
 * If any migration fails, the transaction rolls back and the server
 * refuses to start rather than leaving the schema partially applied.
 *
 * To add a new migration: append an entry to the MIGRATIONS array.
 * Never edit or reorder existing entries.
 */

const pool = require('./pool');

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema from init.sql',
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invites (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        used BOOLEAN DEFAULT false,
        revoked BOOLEAN DEFAULT false,
        used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        used_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        original_title VARCHAR(500),
        release_date DATE,
        year INTEGER,
        format VARCHAR(50) CHECK (format IN ('VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD')),
        genre VARCHAR(100),
        director VARCHAR(255),
        rating DECIMAL(3,1),
        user_rating DECIMAL(2,1),
        tmdb_id INTEGER,
        tmdb_url TEXT,
        poster_path TEXT,
        backdrop_path TEXT,
        overview TEXT,
        trailer_url TEXT,
        runtime INTEGER,
        upc VARCHAR(50),
        location VARCHAR(255),
        notes TEXT,
        import_source VARCHAR(50) DEFAULT 'manual',
        added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS media_metadata (
        id SERIAL PRIMARY KEY,
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        key VARCHAR(100) NOT NULL,
        value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS media_variants (
        id SERIAL PRIMARY KEY,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        source VARCHAR(50) NOT NULL DEFAULT 'plex',
        source_item_key VARCHAR(255),
        source_media_id VARCHAR(255),
        source_part_id VARCHAR(255),
        edition VARCHAR(255),
        file_path TEXT,
        container VARCHAR(50),
        video_codec VARCHAR(50),
        audio_codec VARCHAR(50),
        resolution VARCHAR(50),
        video_width INTEGER,
        video_height INTEGER,
        audio_channels INTEGER,
        duration_ms INTEGER,
        runtime_minutes INTEGER,
        raw_json JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INTEGER,
        details JSONB,
        ip_address INET,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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
      );

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
        plex_preset VARCHAR(100) DEFAULT 'plex',
        plex_provider VARCHAR(100),
        plex_api_url TEXT,
        plex_server_name VARCHAR(255),
        plex_api_key_encrypted TEXT,
        plex_api_key_query_param VARCHAR(100),
        plex_library_sections JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        theme VARCHAR(20) DEFAULT 'system',
        density VARCHAR(20) DEFAULT 'comfortable',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_media_title ON media(title);
      CREATE INDEX IF NOT EXISTS idx_media_format ON media(format);
      CREATE INDEX IF NOT EXISTS idx_media_year ON media(year);
      CREATE INDEX IF NOT EXISTS idx_media_tmdb_id ON media(tmdb_id);
      CREATE INDEX IF NOT EXISTS idx_media_variants_media_id ON media_variants(media_id);
      CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
      CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);

      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
          CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_updated_at') THEN
          CREATE TRIGGER update_media_updated_at BEFORE UPDATE ON media
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_variants_updated_at') THEN
          CREATE TRIGGER update_media_variants_updated_at BEFORE UPDATE ON media_variants
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_app_integrations_updated_at') THEN
          CREATE TRIGGER update_app_integrations_updated_at BEFORE UPDATE ON app_integrations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_app_settings_updated_at') THEN
          CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_integrations_updated_at') THEN
          CREATE TRIGGER update_user_integrations_updated_at BEFORE UPDATE ON user_integrations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;

      INSERT INTO app_integrations (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    `
  },
  {
    version: 2,
    description: 'Activity log extended filter index',
    up: `
      CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
    `
  },
  {
    version: 3,
    description: 'Opaque cookie sessions table',
    up: `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
    `
  },
  {
    version: 4,
    description: 'Invite lifecycle fields for revocation and claim metadata',
    up: `
      ALTER TABLE invites
        ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT false;

      ALTER TABLE invites
        ADD COLUMN IF NOT EXISTS used_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

      ALTER TABLE invites
        ADD COLUMN IF NOT EXISTS used_at TIMESTAMP;

      UPDATE invites
      SET revoked = false
      WHERE revoked IS NULL;

      CREATE INDEX IF NOT EXISTS idx_invites_active ON invites(used, revoked, expires_at);
    `
  },
  {
    version: 5,
    description: 'Plex integration settings fields',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_preset VARCHAR(100) DEFAULT 'plex';

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_provider VARCHAR(100);

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_api_url TEXT;

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_server_name VARCHAR(255);

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_api_key_encrypted TEXT;

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_api_key_query_param VARCHAR(100);

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_library_sections JSONB DEFAULT '[]'::jsonb;

      UPDATE app_integrations
      SET plex_library_sections = '[]'::jsonb
      WHERE plex_library_sections IS NULL;
    `
  },
  {
    version: 6,
    description: 'Media variants table for edition and file-level metadata',
    up: `
      CREATE TABLE IF NOT EXISTS media_variants (
        id SERIAL PRIMARY KEY,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        source VARCHAR(50) NOT NULL DEFAULT 'plex',
        source_item_key VARCHAR(255),
        source_media_id VARCHAR(255),
        source_part_id VARCHAR(255),
        edition VARCHAR(255),
        file_path TEXT,
        container VARCHAR(50),
        video_codec VARCHAR(50),
        audio_codec VARCHAR(50),
        resolution VARCHAR(50),
        video_width INTEGER,
        video_height INTEGER,
        audio_channels INTEGER,
        duration_ms INTEGER,
        runtime_minutes INTEGER,
        raw_json JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_media_variants_media_id ON media_variants(media_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_media_variants_plex_part
        ON media_variants (source, source_part_id)
        WHERE source = 'plex' AND source_part_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_media_variants_plex_item
        ON media_variants (source, source_item_key)
        WHERE source = 'plex' AND source_item_key IS NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_variants_updated_at') THEN
          CREATE TRIGGER update_media_variants_updated_at BEFORE UPDATE ON media_variants
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 7,
    description: 'Media import_source traceability field',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS import_source VARCHAR(50) DEFAULT 'manual';

      UPDATE media m
      SET import_source = 'plex'
      WHERE import_source IS NULL
        AND EXISTS (
          SELECT 1
          FROM media_metadata mm
          WHERE mm.media_id = m.id
            AND mm."key" IN ('plex_guid', 'plex_item_key')
        );

      UPDATE media
      SET import_source = 'manual'
      WHERE import_source IS NULL;
    `
  },
  {
    version: 8,
    description: 'Media type and multi-library scaffolding',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'movie';

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS tmdb_media_type VARCHAR(20);

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS season_number INTEGER;

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS episode_number INTEGER;

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS episode_title VARCHAR(500);

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS network VARCHAR(255);

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES media(id) ON DELETE SET NULL;

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS space_id INTEGER;

      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS library_id INTEGER;

      ALTER TABLE invites
        ADD COLUMN IF NOT EXISTS space_id INTEGER;

      CREATE TABLE IF NOT EXISTS libraries (
        id SERIAL PRIMARY KEY,
        space_id INTEGER,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS feature_flags (
        key VARCHAR(100) PRIMARY KEY,
        enabled BOOLEAN DEFAULT false,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      UPDATE media
      SET media_type = 'movie'
      WHERE media_type IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'media_media_type_check'
        ) THEN
          ALTER TABLE media
            ADD CONSTRAINT media_media_type_check
            CHECK (media_type IN ('movie', 'tv_series', 'tv_episode', 'other'));
        END IF;
      END;
      $$;

      CREATE INDEX IF NOT EXISTS idx_media_media_type ON media(media_type);
      CREATE INDEX IF NOT EXISTS idx_media_library_id ON media(library_id);
      CREATE INDEX IF NOT EXISTS idx_media_space_id ON media(space_id);
      CREATE INDEX IF NOT EXISTS idx_media_format_year ON media(format, year);
      CREATE INDEX IF NOT EXISTS idx_media_genre_year ON media(genre, year);
      CREATE INDEX IF NOT EXISTS idx_libraries_name ON libraries(name);
    `
  },
  {
    version: 9,
    description: 'Scope scaffolding on app integrations',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS space_id INTEGER;

      CREATE INDEX IF NOT EXISTS idx_app_integrations_space_id ON app_integrations(space_id);
    `
  },
  {
    version: 10,
    description: 'Async sync job tracking for long-running imports',
    up: `
      CREATE TABLE IF NOT EXISTS sync_jobs (
        id SERIAL PRIMARY KEY,
        job_type VARCHAR(50) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'succeeded')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        scope JSONB,
        progress JSONB,
        summary JSONB,
        error TEXT,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_created_at
        ON sync_jobs(status, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_by_created_at
        ON sync_jobs(created_by, created_at DESC);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_sync_jobs_updated_at') THEN
          CREATE TRIGGER update_sync_jobs_updated_at BEFORE UPDATE ON sync_jobs
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 11,
    description: 'Metadata uniqueness and filter performance indexes',
    up: `
      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY media_id, "key"
            ORDER BY created_at DESC, id DESC
          ) AS rn
        FROM media_metadata
      )
      DELETE FROM media_metadata mm
      USING ranked r
      WHERE mm.id = r.id
        AND r.rn > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_media_metadata_media_id_key
        ON media_metadata(media_id, "key");

      CREATE INDEX IF NOT EXISTS idx_media_director_trgm
        ON media USING GIN (lower(COALESCE(director, '')) gin_trgm_ops);

      CREATE INDEX IF NOT EXISTS idx_media_genre_trgm
        ON media USING GIN (lower(COALESCE(genre, '')) gin_trgm_ops);
    `
  },
  {
    version: 12,
    description: 'Feature flag metadata and defaults',
    up: `
      ALTER TABLE feature_flags
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE feature_flags
        ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_feature_flags_updated_at') THEN
          CREATE TRIGGER update_feature_flags_updated_at BEFORE UPDATE ON feature_flags
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;

      INSERT INTO feature_flags (key, enabled, description)
      VALUES
        ('import_plex_enabled', true, 'Allow Plex imports from the Import page and API'),
        ('import_csv_enabled', true, 'Allow CSV imports (generic and Delicious)'),
        ('tmdb_search_enabled', true, 'Allow TMDB search and details lookups'),
        ('lookup_upc_enabled', true, 'Allow barcode/UPC lookup API usage'),
        ('recognize_cover_enabled', true, 'Allow vision/OCR cover recognition API usage')
      ON CONFLICT (key) DO UPDATE
      SET description = EXCLUDED.description;
    `
  }
];

async function runMigrationsForClient(client, options = {}) {
  const maxVersion = Number.isFinite(Number(options.maxVersion)) ? Number(options.maxVersion) : null;
  // Create the migrations tracking table outside a transaction (DDL in PG is transactional)
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.rows.map(r => r.version));

  const pending = MIGRATIONS
    .filter(m => !appliedVersions.has(m.version))
    .filter(m => maxVersion === null || m.version <= maxVersion);

  if (pending.length === 0) {
    const expectedCount = maxVersion === null
      ? MIGRATIONS.length
      : MIGRATIONS.filter(m => m.version <= maxVersion).length;
    console.log(`Database schema up to date (${expectedCount} migration(s) applied).`);
    return;
  }

  for (const migration of pending) {
    console.log(`Applying migration v${migration.version}: ${migration.description}`);
    await client.query('BEGIN');
    try {
      await client.query(migration.up);
      await client.query(
        'INSERT INTO schema_migrations (version, description) VALUES ($1, $2)',
        [migration.version, migration.description]
      );
      await client.query('COMMIT');
      console.log(`  ✓ Migration v${migration.version} applied.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration v${migration.version} failed and was rolled back: ${err.message}`
      );
    }
  }
  console.log(`Applied ${pending.length} migration(s) successfully.`);
}

async function runMigrations(options = {}) {
  const client = await pool.connect();
  try {
    await runMigrationsForClient(client, options);
  } finally {
    client.release();
  }
}

module.exports = { runMigrations, runMigrationsForClient, MIGRATIONS };
