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
  }
];

async function runMigrations() {
  const client = await pool.connect();
  try {
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

    const pending = MIGRATIONS.filter(m => !appliedVersions.has(m.version));

    if (pending.length === 0) {
      console.log(`Database schema up to date (${MIGRATIONS.length} migration(s) applied).`);
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
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
