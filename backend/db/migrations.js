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
  },
  {
    version: 13,
    description: 'Hash invite tokens at rest and remove plaintext storage',
    up: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      ALTER TABLE invites
        ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

      UPDATE invites
      SET token_hash = encode(digest(token, 'sha256'), 'hex')
      WHERE token_hash IS NULL
        AND token IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token_hash
        ON invites(token_hash)
        WHERE token_hash IS NOT NULL;

      ALTER TABLE invites
        ALTER COLUMN token DROP NOT NULL;

      UPDATE invites
      SET token = NULL
      WHERE token_hash IS NOT NULL;
    `
  },
  {
    version: 14,
    description: 'Password reset tokens table for admin-initiated one-time resets',
    up: `
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        used BOOLEAN DEFAULT false,
        revoked BOOLEAN DEFAULT false,
        used_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
        ON password_reset_tokens(user_id);

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active
        ON password_reset_tokens(used, revoked, expires_at);
    `
  },
  {
    version: 15,
    description: 'Server-authoritative scope state and library memberships',
    up: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS active_space_id INTEGER;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS active_library_id INTEGER;

      CREATE TABLE IF NOT EXISTS library_memberships (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
        role VARCHAR(20) DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, library_id)
      );

      CREATE INDEX IF NOT EXISTS idx_library_memberships_user_id
        ON library_memberships(user_id);

      CREATE INDEX IF NOT EXISTS idx_library_memberships_library_id
        ON library_memberships(library_id);
    `
  },
  {
    version: 16,
    description: 'Library backfill and active library defaults for 2.0',
    up: `
      WITH users_without_membership AS (
        SELECT u.id
        FROM users u
        LEFT JOIN library_memberships lm ON lm.user_id = u.id
        GROUP BY u.id
        HAVING COUNT(lm.library_id) = 0
      ),
      created_libraries AS (
        INSERT INTO libraries (name, description, created_by)
        SELECT 'My Library', 'Default personal library', uwm.id
        FROM users_without_membership uwm
        RETURNING id, created_by
      )
      INSERT INTO library_memberships (user_id, library_id, role)
      SELECT created_by, id, 'owner'
      FROM created_libraries
      ON CONFLICT (user_id, library_id) DO NOTHING;

      INSERT INTO library_memberships (user_id, library_id, role)
      SELECT u.id, u.active_library_id, 'owner'
      FROM users u
      WHERE u.active_library_id IS NOT NULL
      ON CONFLICT (user_id, library_id) DO NOTHING;

      WITH first_membership AS (
        SELECT lm.user_id, MIN(lm.library_id) AS library_id
        FROM library_memberships lm
        JOIN libraries l ON l.id = lm.library_id
        WHERE l.archived_at IS NULL
        GROUP BY lm.user_id
      )
      UPDATE users u
      SET active_library_id = fm.library_id
      FROM first_membership fm
      WHERE u.id = fm.user_id
        AND (
          u.active_library_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM libraries l
            WHERE l.id = u.active_library_id
              AND l.archived_at IS NULL
          )
        );

      UPDATE media m
      SET library_id = u.active_library_id
      FROM users u
      WHERE m.library_id IS NULL
        AND m.added_by = u.id
        AND u.active_library_id IS NOT NULL;

      INSERT INTO libraries (name, description, created_by)
      SELECT 'Shared Library', 'Fallback library for legacy unowned media', NULL
      WHERE EXISTS (SELECT 1 FROM media WHERE library_id IS NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM libraries
          WHERE archived_at IS NULL
            AND created_by IS NULL
            AND lower(name) = 'shared library'
        );

      WITH fallback_library AS (
        SELECT id
        FROM libraries
        WHERE archived_at IS NULL
        ORDER BY
          CASE
            WHEN created_by IS NULL AND lower(name) = 'shared library' THEN 0
            ELSE 1
          END,
          id
        LIMIT 1
      )
      UPDATE media m
      SET library_id = fl.id
      FROM fallback_library fl
      WHERE m.library_id IS NULL;
    `
  },
  {
    version: 17,
    description: 'Expand media type constraint for mixed media baseline',
    up: `
      ALTER TABLE media
        DROP CONSTRAINT IF EXISTS media_media_type_check;

      ALTER TABLE media
        ADD CONSTRAINT media_media_type_check
        CHECK (media_type IN ('movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'other'));
    `
  },
  {
    version: 18,
    description: 'Mixed media field consistency constraints and browse indexes',
    up: `
      UPDATE media
      SET season_number = NULL,
          episode_number = NULL,
          episode_title = NULL,
          network = NULL
      WHERE media_type NOT IN ('tv_series', 'tv_episode');

      UPDATE media
      SET episode_number = NULL,
          episode_title = NULL
      WHERE media_type = 'tv_series';

      ALTER TABLE media
        DROP CONSTRAINT IF EXISTS media_tv_fields_consistency_check;

      ALTER TABLE media
        ADD CONSTRAINT media_tv_fields_consistency_check
        CHECK (
          CASE
            WHEN media_type IN ('tv_series', 'tv_episode') THEN TRUE
            ELSE season_number IS NULL AND episode_number IS NULL AND episode_title IS NULL AND network IS NULL
          END
        );

      ALTER TABLE media
        DROP CONSTRAINT IF EXISTS media_tv_series_episode_fields_check;

      ALTER TABLE media
        ADD CONSTRAINT media_tv_series_episode_fields_check
        CHECK (
          CASE
            WHEN media_type = 'tv_series' THEN episode_number IS NULL AND episode_title IS NULL
            ELSE TRUE
          END
        );

      CREATE INDEX IF NOT EXISTS idx_media_library_type_title ON media(library_id, media_type, title);
      CREATE INDEX IF NOT EXISTS idx_media_library_type_year ON media(library_id, media_type, year);
      CREATE INDEX IF NOT EXISTS idx_media_library_type_created_at ON media(library_id, media_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_media_title_normalized_sort
        ON media ((regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\\s+', '', 'i')));

      CREATE INDEX IF NOT EXISTS idx_media_search_fts
        ON media USING GIN (
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' ||
            coalesce(original_title, '') || ' ' ||
            coalesce(director, '') || ' ' ||
            coalesce(genre, '') || ' ' ||
            coalesce(notes, '')
          )
        );
    `
  },
  {
    version: 19,
    description: 'Add media type_details JSONB payload for type-specific metadata',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS type_details JSONB;

      CREATE INDEX IF NOT EXISTS idx_media_type_details_gin
        ON media USING GIN (type_details);
    `
  },
  {
    version: 20,
    description: 'Expand media format check for book formats',
    up: `
      DO $$
      DECLARE
        cname text;
      BEGIN
        SELECT conname INTO cname
        FROM pg_constraint
        WHERE conrelid = 'media'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%format%';

        IF cname IS NOT NULL THEN
          EXECUTE format('ALTER TABLE media DROP CONSTRAINT %I', cname);
        END IF;
      END;
      $$;

      ALTER TABLE media
        ADD CONSTRAINT media_format_check
        CHECK (
          format IS NULL OR format IN (
            'VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD',
            'Paperback', 'Hardcover', 'Trade'
          )
        );
    `
  },
  {
    version: 21,
    description: 'Add books/audio/games integration settings',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS books_preset VARCHAR(100) DEFAULT 'googlebooks';
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS books_provider VARCHAR(100);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS books_api_url TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS books_api_key_encrypted TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS books_api_key_header VARCHAR(100);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS books_api_key_query_param VARCHAR(100);

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS audio_preset VARCHAR(100) DEFAULT 'theaudiodb';
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS audio_provider VARCHAR(100);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS audio_api_url TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS audio_api_key_encrypted TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS audio_api_key_header VARCHAR(100);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS audio_api_key_query_param VARCHAR(100);

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_preset VARCHAR(100) DEFAULT 'igdb';
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_provider VARCHAR(100);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_api_url TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_api_key_encrypted TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_api_key_header VARCHAR(100);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_api_key_query_param VARCHAR(100);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_client_id VARCHAR(255);
    `
  },
  {
    version: 22,
    description: 'Add encrypted games client secret for IGDB auth',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS games_client_secret_encrypted TEXT;
    `
  },
  {
    version: 23,
    description: 'Identifier-first import lookup indexes',
    up: `
      CREATE INDEX IF NOT EXISTS idx_media_upc ON media(upc);
      CREATE INDEX IF NOT EXISTS idx_media_type_details_isbn
        ON media ((type_details->>'isbn'))
        WHERE type_details ? 'isbn';
      CREATE INDEX IF NOT EXISTS idx_media_metadata_key_value
        ON media_metadata("key", "value");
      CREATE INDEX IF NOT EXISTS idx_media_metadata_isbn_value
        ON media_metadata("value")
        WHERE "key" = 'isbn';
      CREATE INDEX IF NOT EXISTS idx_media_metadata_ean_value
        ON media_metadata("value")
        WHERE "key" IN ('ean', 'ean_upc', 'upc');
      CREATE INDEX IF NOT EXISTS idx_media_metadata_asin_value
        ON media_metadata("value")
        WHERE "key" = 'amazon_item_id';
    `
  },
  {
    version: 24,
    description: 'Rename media_type other to comic_book',
    up: `
      UPDATE media
      SET media_type = 'comic_book'
      WHERE media_type = 'other';

      ALTER TABLE media
        DROP CONSTRAINT IF EXISTS media_media_type_check;

      ALTER TABLE media
        ADD CONSTRAINT media_media_type_check
        CHECK (media_type IN ('movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'comic_book'));
    `
  },
  {
    version: 25,
    description: 'Add signed metadata fields for media entries',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS signed_by VARCHAR(255),
        ADD COLUMN IF NOT EXISTS signed_role VARCHAR(20),
        ADD COLUMN IF NOT EXISTS signed_on DATE,
        ADD COLUMN IF NOT EXISTS signed_at VARCHAR(255);

      ALTER TABLE media
        DROP CONSTRAINT IF EXISTS media_signed_role_check;

      ALTER TABLE media
        ADD CONSTRAINT media_signed_role_check
        CHECK (signed_role IS NULL OR signed_role IN ('author', 'producer', 'cast'));
    `
  },
  {
    version: 26,
    description: 'Add comics integration settings',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS comics_preset VARCHAR(100) DEFAULT 'metron',
        ADD COLUMN IF NOT EXISTS comics_provider VARCHAR(100),
        ADD COLUMN IF NOT EXISTS comics_api_url TEXT,
        ADD COLUMN IF NOT EXISTS comics_api_key_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS comics_api_key_header VARCHAR(100),
        ADD COLUMN IF NOT EXISTS comics_api_key_query_param VARCHAR(100),
        ADD COLUMN IF NOT EXISTS comics_username VARCHAR(255);
    `
  },
  {
    version: 27,
    description: 'Add signed proof image path for media entries',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS signed_proof_path TEXT;
    `
  },
  {
    version: 28,
    description: 'Normalize media genre/director metadata tables',
    up: `
      CREATE TABLE IF NOT EXISTS genres (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        normalized_name VARCHAR(120) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS directors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        normalized_name VARCHAR(280) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS media_genres (
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (media_id, genre_id)
      );

      CREATE TABLE IF NOT EXISTS media_directors (
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        director_id INTEGER NOT NULL REFERENCES directors(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (media_id, director_id)
      );

      CREATE INDEX IF NOT EXISTS idx_media_genres_genre_id ON media_genres(genre_id);
      CREATE INDEX IF NOT EXISTS idx_media_directors_director_id ON media_directors(director_id);
      CREATE INDEX IF NOT EXISTS idx_genres_name ON genres(name);
      CREATE INDEX IF NOT EXISTS idx_directors_name ON directors(name);

      INSERT INTO genres (name, normalized_name)
      SELECT token, lower(regexp_replace(token, '\\s+', ' ', 'g'))
      FROM (
        SELECT DISTINCT trim(regexp_split_to_table(coalesce(genre, ''), '\\s*,\\s*')) AS token
        FROM media
      ) src
      WHERE token <> ''
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO directors (name, normalized_name)
      SELECT token, lower(regexp_replace(token, '\\s+', ' ', 'g'))
      FROM (
        SELECT DISTINCT trim(regexp_split_to_table(coalesce(director, ''), '\\s*,\\s*')) AS token
        FROM media
      ) src
      WHERE token <> ''
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO media_genres (media_id, genre_id)
      SELECT m.id, g.id
      FROM media m
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(m.genre, ''), '\\s*,\\s*') AS raw(token)
      JOIN genres g ON g.normalized_name = lower(regexp_replace(trim(raw.token), '\\s+', ' ', 'g'))
      WHERE trim(raw.token) <> ''
      ON CONFLICT (media_id, genre_id) DO NOTHING;

      INSERT INTO media_directors (media_id, director_id)
      SELECT m.id, d.id
      FROM media m
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(m.director, ''), '\\s*,\\s*') AS raw(token)
      JOIN directors d ON d.normalized_name = lower(regexp_replace(trim(raw.token), '\\s+', ' ', 'g'))
      WHERE trim(raw.token) <> ''
      ON CONFLICT (media_id, director_id) DO NOTHING;
    `
  },
  {
    version: 29,
    description: 'Normalize media actor metadata tables',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS cast_members VARCHAR(1000);

      CREATE TABLE IF NOT EXISTS actors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        normalized_name VARCHAR(280) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS media_actors (
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        actor_id INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (media_id, actor_id)
      );

      CREATE INDEX IF NOT EXISTS idx_media_actors_actor_id ON media_actors(actor_id);
      CREATE INDEX IF NOT EXISTS idx_actors_name ON actors(name);
      CREATE INDEX IF NOT EXISTS idx_media_cast_trgm
        ON media USING GIN (lower(COALESCE(cast_members, '')) gin_trgm_ops);

      DROP INDEX IF EXISTS idx_media_search_fts;
      CREATE INDEX IF NOT EXISTS idx_media_search_fts
        ON media USING GIN (
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' ||
            coalesce(original_title, '') || ' ' ||
            coalesce(director, '') || ' ' ||
            coalesce(cast_members, '') || ' ' ||
            coalesce(genre, '') || ' ' ||
            coalesce(notes, '')
          )
        );

      INSERT INTO actors (name, normalized_name)
      SELECT token, lower(regexp_replace(token, '\\s+', ' ', 'g'))
      FROM (
        SELECT DISTINCT trim(regexp_split_to_table(coalesce(cast_members, ''), '\\s*,\\s*')) AS token
        FROM media
      ) src
      WHERE token <> ''
      ON CONFLICT (normalized_name) DO NOTHING;

      INSERT INTO media_actors (media_id, actor_id)
      SELECT m.id, a.id
      FROM media m
      CROSS JOIN LATERAL regexp_split_to_table(coalesce(m.cast_members, ''), '\\s*,\\s*') AS raw(token)
      JOIN actors a ON a.normalized_name = lower(regexp_replace(trim(raw.token), '\\s+', ' ', 'g'))
      WHERE trim(raw.token) <> ''
      ON CONFLICT (media_id, actor_id) DO NOTHING;
    `
  },
  {
    version: 30,
    description: 'Add metadata normalized read feature flag',
    up: `
      INSERT INTO feature_flags (key, enabled, description)
      VALUES (
        'metadata_normalized_read_enabled',
        false,
        'Use normalized metadata relations (genres/directors/actors) as primary read path for metadata search/filter'
      )
      ON CONFLICT (key) DO UPDATE
      SET description = EXCLUDED.description;
    `
  },
  {
    version: 31,
    description: 'Add import match review queue and collection scaffolding',
    up: `
      CREATE TABLE IF NOT EXISTS collections (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        media_type VARCHAR(30),
        source_title TEXT,
        import_source VARCHAR(100),
        expected_item_count INTEGER,
        metadata JSONB,
        library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS collection_items (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        contained_title TEXT,
        position INTEGER,
        confidence_score INTEGER,
        resolution_status VARCHAR(20) DEFAULT 'pending' CHECK (resolution_status IN ('pending', 'resolved', 'skipped')),
        source_payload JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_collections_library_created_at
        ON collections(library_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_collection_items_collection_position
        ON collection_items(collection_id, position);
      CREATE INDEX IF NOT EXISTS idx_collection_items_media_id
        ON collection_items(media_id);

      CREATE TABLE IF NOT EXISTS import_match_reviews (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES sync_jobs(id) ON DELETE SET NULL,
        import_source VARCHAR(100),
        provider VARCHAR(100),
        row_number INTEGER,
        source_title TEXT,
        media_type VARCHAR(30),
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'skipped')),
        confidence_score INTEGER,
        match_mode VARCHAR(80),
        matched_by VARCHAR(120),
        enrichment_status VARCHAR(40),
        proposed_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        resolved_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        resolution_action VARCHAR(40),
        resolution_note TEXT,
        source_payload JSONB,
        library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_import_match_reviews_pending_scope
        ON import_match_reviews(status, library_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_import_match_reviews_job
        ON import_match_reviews(job_id);
      CREATE INDEX IF NOT EXISTS idx_import_match_reviews_created_by
        ON import_match_reviews(created_by, created_at DESC);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collections_updated_at') THEN
          CREATE TRIGGER update_collections_updated_at BEFORE UPDATE ON collections
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collection_items_updated_at') THEN
          CREATE TRIGGER update_collection_items_updated_at BEFORE UPDATE ON collection_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_import_match_reviews_updated_at') THEN
          CREATE TRIGGER update_import_match_reviews_updated_at BEFORE UPDATE ON import_match_reviews
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 32,
    description: 'Link import reviews to collections context',
    up: `
      ALTER TABLE import_match_reviews
        ADD COLUMN IF NOT EXISTS collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_import_match_reviews_collection_id
        ON import_match_reviews(collection_id);
    `
  },
  {
    version: 33,
    description: 'Enable normalized metadata read flag by default',
    up: `
      INSERT INTO feature_flags (key, enabled, description)
      VALUES (
        'metadata_normalized_read_enabled',
        true,
        'Use normalized metadata relations (genres/directors/actors) as primary read path for metadata search/filter'
      )
      ON CONFLICT (key) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          description = EXCLUDED.description;
    `
  },
  {
    version: 34,
    description: 'Add media seasons table for TV watch-state foundation',
    up: `
      CREATE TABLE IF NOT EXISTS media_seasons (
        id SERIAL PRIMARY KEY,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        season_number INTEGER NOT NULL CHECK (season_number > 0 AND season_number <= 999),
        expected_episodes INTEGER CHECK (expected_episodes IS NULL OR expected_episodes >= 0),
        available_episodes INTEGER CHECK (available_episodes IS NULL OR available_episodes >= 0),
        is_complete BOOLEAN NOT NULL DEFAULT false,
        watch_state VARCHAR(20) NOT NULL DEFAULT 'unwatched'
          CHECK (watch_state IN ('unwatched', 'in_progress', 'completed')),
        watchlist BOOLEAN NOT NULL DEFAULT false,
        last_watched_at TIMESTAMP,
        source VARCHAR(50) NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (media_id, season_number)
      );

      CREATE INDEX IF NOT EXISTS idx_media_seasons_media_id_season ON media_seasons(media_id, season_number);
      CREATE INDEX IF NOT EXISTS idx_media_seasons_media_id_watch_state ON media_seasons(media_id, watch_state);
      CREATE INDEX IF NOT EXISTS idx_media_seasons_watchlist ON media_seasons(watchlist);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_seasons_updated_at') THEN
          CREATE TRIGGER update_media_seasons_updated_at BEFORE UPDATE ON media_seasons
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;

      WITH parsed AS (
        SELECT
          mv.media_id,
          CASE
            WHEN coalesce(mv.raw_json->>'season_number', '') ~ '^[0-9]+$'
              THEN (mv.raw_json->>'season_number')::INTEGER
            WHEN coalesce(mv.edition, '') ~* 'season\\s*[0-9]+'
              THEN nullif(regexp_replace(lower(mv.edition), '[^0-9]', '', 'g'), '')::INTEGER
            ELSE NULL
          END AS season_number,
          coalesce(mv.source, 'legacy_variant') AS source
        FROM media_variants mv
        JOIN media m ON m.id = mv.media_id
        WHERE m.media_type = 'tv_series'
      )
      INSERT INTO media_seasons (
        media_id, season_number, source, expected_episodes, available_episodes, is_complete
      )
      SELECT DISTINCT
        p.media_id,
        p.season_number,
        p.source,
        NULL::INTEGER,
        NULL::INTEGER,
        false
      FROM parsed p
      WHERE p.season_number IS NOT NULL AND p.season_number > 0
      ON CONFLICT (media_id, season_number) DO NOTHING;
    `
  },
  {
    version: 35,
    description: 'Add events and event artifacts tables',
    up: `
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        location VARCHAR(255) NOT NULL,
        date_start DATE NOT NULL,
        date_end DATE,
        host VARCHAR(255),
        time_label VARCHAR(100),
        room VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS event_artifacts (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        artifact_type VARCHAR(20) NOT NULL CHECK (artifact_type IN ('session', 'person', 'autograph', 'purchase', 'freebie', 'note')),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        image_path TEXT,
        price NUMERIC(10,2),
        vendor VARCHAR(255),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_library_date_start
        ON events(library_id, date_start DESC);
      CREATE INDEX IF NOT EXISTS idx_events_created_by_created_at
        ON events(created_by, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_artifacts_event_created_at
        ON event_artifacts(event_id, created_at DESC);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_events_updated_at') THEN
          CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_artifacts_updated_at') THEN
          CREATE TRIGGER update_event_artifacts_updated_at BEFORE UPDATE ON event_artifacts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'collectibles'
        ) THEN
          EXECUTE 'ALTER TABLE collectibles ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL';
          EXECUTE 'CREATE INDEX IF NOT EXISTS idx_collectibles_event_id ON collectibles(event_id)';
        END IF;
      END;
      $$;
    `
  },
  {
    version: 36,
    description: 'Add collectibles table and taxonomy fields',
    up: `
      CREATE TABLE IF NOT EXISTS collectibles (
        id SERIAL PRIMARY KEY,
        library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        item_type VARCHAR(20) NOT NULL DEFAULT 'collectible'
          CHECK (item_type IN ('collectible', 'art', 'card')),
        category VARCHAR(100)
          CHECK (
            category IS NULL OR category IN (
              'Lego',
              'Figures / Statues',
              'Props / Replicas / Originals',
              'Funko',
              'Comic Panels',
              'Anime',
              'Toys',
              'Clothing'
            )
          ),
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        booth_or_vendor VARCHAR(255),
        price NUMERIC(10,2),
        exclusive BOOLEAN NOT NULL DEFAULT false,
        image_path TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_collectibles_library_created_at
        ON collectibles(library_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_collectibles_event_id
        ON collectibles(event_id);
      CREATE INDEX IF NOT EXISTS idx_collectibles_category
        ON collectibles(category);
      CREATE INDEX IF NOT EXISTS idx_collectibles_vendor
        ON collectibles(booth_or_vendor);
      CREATE INDEX IF NOT EXISTS idx_collectibles_exclusive
        ON collectibles(exclusive);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collectibles_updated_at') THEN
          CREATE TRIGGER update_collectibles_updated_at BEFORE UPDATE ON collectibles
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 37,
    description: 'Add canonical collectibles taxonomy table and subtype/category_key columns',
    up: `
      CREATE TABLE IF NOT EXISTS collectible_categories (
        key VARCHAR(64) PRIMARY KEY,
        label VARCHAR(100) NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO collectible_categories (key, label, sort_order) VALUES
        ('lego', 'Lego', 10),
        ('figures_statues', 'Figures / Statues', 20),
        ('props_replicas_originals', 'Props / Replicas / Originals', 30),
        ('funko', 'Funko', 40),
        ('comic_panels', 'Comic Panels', 50),
        ('anime', 'Anime', 60),
        ('toys', 'Toys', 70),
        ('clothing', 'Clothing', 80)
      ON CONFLICT (key) DO UPDATE
      SET label = EXCLUDED.label,
          sort_order = EXCLUDED.sort_order;

      ALTER TABLE collectibles
        ADD COLUMN IF NOT EXISTS subtype VARCHAR(20),
        ADD COLUMN IF NOT EXISTS category_key VARCHAR(64);

      UPDATE collectibles
      SET subtype = COALESCE(subtype, item_type, 'collectible')
      WHERE subtype IS NULL;

      UPDATE collectibles
      SET category_key = CASE category
        WHEN 'Lego' THEN 'lego'
        WHEN 'Figures / Statues' THEN 'figures_statues'
        WHEN 'Props / Replicas / Originals' THEN 'props_replicas_originals'
        WHEN 'Funko' THEN 'funko'
        WHEN 'Comic Panels' THEN 'comic_panels'
        WHEN 'Anime' THEN 'anime'
        WHEN 'Toys' THEN 'toys'
        WHEN 'Clothing' THEN 'clothing'
        ELSE category_key
      END
      WHERE category_key IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'collectibles_subtype_check'
        ) THEN
          ALTER TABLE collectibles
            ADD CONSTRAINT collectibles_subtype_check
            CHECK (subtype IN ('collectible', 'art', 'card'));
        END IF;
      END;
      $$;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'collectibles_category_key_fkey'
        ) THEN
          ALTER TABLE collectibles
            ADD CONSTRAINT collectibles_category_key_fkey
            FOREIGN KEY (category_key)
            REFERENCES collectible_categories(key)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
        END IF;
      END;
      $$;

      CREATE INDEX IF NOT EXISTS idx_collectibles_library_subtype_category
        ON collectibles(library_id, subtype, category_key);
      CREATE INDEX IF NOT EXISTS idx_collectibles_event_id_v2
        ON collectibles(event_id);
      CREATE INDEX IF NOT EXISTS idx_collectibles_exclusive_created
        ON collectibles(exclusive, created_at DESC);
    `
  },
  {
    version: 38,
    description: 'Add feature flags for Events and Collectibles library surfaces',
    up: `
      DO $$
      DECLARE
        has_existing_data BOOLEAN;
      BEGIN
        SELECT EXISTS (SELECT 1 FROM users LIMIT 1) INTO has_existing_data;

        INSERT INTO feature_flags (key, enabled, description) VALUES
          (
            'events_enabled',
            CASE WHEN has_existing_data THEN true ELSE false END,
            'Enable Events library UI and API'
          ),
          (
            'collectibles_enabled',
            CASE WHEN has_existing_data THEN true ELSE false END,
            'Enable Collectibles library UI and API'
          )
        ON CONFLICT (key) DO UPDATE
        SET description = EXCLUDED.description;
      END;
      $$;
    `
  },
  {
    version: 39,
    description: 'Add Calibre Web Automated OPDS integration settings',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS cwa_opds_url TEXT,
        ADD COLUMN IF NOT EXISTS cwa_base_url TEXT,
        ADD COLUMN IF NOT EXISTS cwa_username VARCHAR(255),
        ADD COLUMN IF NOT EXISTS cwa_password_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS cwa_timeout_ms INTEGER DEFAULT 20000;
    `
  },
  {
    version: 40,
    description: 'Add personal access tokens for non-browser API authentication',
    up: `
      CREATE TABLE IF NOT EXISTS personal_access_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        token_last_four VARCHAR(4) NOT NULL,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        expires_at TIMESTAMP,
        last_used_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_user_id
        ON personal_access_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_active
        ON personal_access_tokens(user_id, revoked_at, expires_at);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_personal_access_tokens_updated_at') THEN
          CREATE TRIGGER update_personal_access_tokens_updated_at BEFORE UPDATE ON personal_access_tokens
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 41,
    description: 'Add service account keys for machine-to-machine API authentication',
    up: `
      CREATE TABLE IF NOT EXISTS service_account_keys (
        id SERIAL PRIMARY KEY,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(64) UNIQUE NOT NULL,
        key_last_four VARCHAR(4) NOT NULL,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        allowed_prefixes JSONB NOT NULL DEFAULT '[]'::jsonb,
        expires_at TIMESTAMP,
        last_used_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_service_account_keys_owner_user_id
        ON service_account_keys(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_service_account_keys_active
        ON service_account_keys(owner_user_id, revoked_at, expires_at);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_service_account_keys_updated_at') THEN
          CREATE TRIGGER update_service_account_keys_updated_at BEFORE UPDATE ON service_account_keys
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 42,
    description: 'Activate first-class spaces and backfill default space memberships',
    up: `
      CREATE TABLE IF NOT EXISTS spaces (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255),
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_personal BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS space_memberships (
        id SERIAL PRIMARY KEY,
        space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL DEFAULT 'member'
          CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (space_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_spaces_slug_active
        ON spaces (lower(slug))
        WHERE slug IS NOT NULL AND archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_spaces_created_by
        ON spaces(created_by);
      CREATE INDEX IF NOT EXISTS idx_space_memberships_space_id
        ON space_memberships(space_id);
      CREATE INDEX IF NOT EXISTS idx_space_memberships_user_id
        ON space_memberships(user_id);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_spaces_updated_at') THEN
          CREATE TRIGGER update_spaces_updated_at BEFORE UPDATE ON spaces
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_space_memberships_updated_at') THEN
          CREATE TRIGGER update_space_memberships_updated_at BEFORE UPDATE ON space_memberships
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;

      INSERT INTO spaces (name, slug, description, created_by, is_personal)
      SELECT
        'Default Space',
        'default',
        'Default space for migrated and single-space installs',
        MIN(id),
        false
      FROM users
      WHERE NOT EXISTS (
        SELECT 1
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
      );

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE libraries l
      SET space_id = ds.id
      FROM default_space ds
      WHERE l.space_id IS NULL;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE media m
      SET space_id = COALESCE((
        SELECT l.space_id
        FROM libraries l
        WHERE l.id = m.library_id
      ), ds.id)
      FROM default_space ds
      WHERE m.space_id IS NULL;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE invites i
      SET space_id = ds.id
      FROM default_space ds
      WHERE i.space_id IS NULL;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE app_integrations ai
      SET space_id = ds.id
      FROM default_space ds
      WHERE ai.space_id IS NULL;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE collections c
      SET space_id = COALESCE((
        SELECT l.space_id
        FROM libraries l
        WHERE l.id = c.library_id
      ), ds.id)
      FROM default_space ds
      WHERE c.space_id IS NULL;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE import_match_reviews imr
      SET space_id = COALESCE((
        SELECT l.space_id
        FROM libraries l
        WHERE l.id = imr.library_id
      ), ds.id)
      FROM default_space ds
      WHERE imr.space_id IS NULL;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE events e
      SET space_id = COALESCE((
        SELECT l.space_id
        FROM libraries l
        WHERE l.id = e.library_id
      ), ds.id)
      FROM default_space ds
      WHERE e.space_id IS NULL;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      UPDATE collectibles c
      SET space_id = COALESCE((
        SELECT l.space_id
        FROM libraries l
        WHERE l.id = c.library_id
      ), ds.id)
      FROM default_space ds
      WHERE c.space_id IS NULL;

      INSERT INTO space_memberships (space_id, user_id, role, created_by)
      SELECT DISTINCT
        l.space_id,
        lm.user_id,
        CASE
          WHEN lm.role = 'owner' THEN 'owner'
          ELSE 'member'
        END,
        l.created_by
      FROM library_memberships lm
      JOIN libraries l ON l.id = lm.library_id
      WHERE l.space_id IS NOT NULL
      ON CONFLICT (space_id, user_id) DO NOTHING;

      INSERT INTO space_memberships (space_id, user_id, role, created_by)
      SELECT DISTINCT
        l.space_id,
        u.id,
        'admin',
        u.id
      FROM users u
      JOIN libraries l ON l.space_id IS NOT NULL
      WHERE u.role = 'admin'
      ON CONFLICT (space_id, user_id) DO UPDATE
      SET role = CASE
        WHEN space_memberships.role = 'owner' THEN 'owner'
        ELSE 'admin'
      END;

      WITH default_space AS (
        SELECT id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      INSERT INTO space_memberships (space_id, user_id, role, created_by)
      SELECT
        ds.id,
        u.id,
        CASE
          WHEN u.role = 'admin' THEN 'admin'
          WHEN u.role = 'viewer' THEN 'viewer'
          ELSE 'member'
        END,
        NULL
      FROM default_space ds
      CROSS JOIN users u
      WHERE NOT EXISTS (
        SELECT 1
        FROM space_memberships sm
        WHERE sm.space_id = ds.id
          AND sm.user_id = u.id
      );

      WITH user_default_space AS (
        SELECT
          u.id AS user_id,
          COALESCE(l.space_id, sm.space_id) AS space_id
        FROM users u
        LEFT JOIN libraries l ON l.id = u.active_library_id
        LEFT JOIN LATERAL (
          SELECT sm.space_id
          FROM space_memberships sm
          WHERE sm.user_id = u.id
          ORDER BY
            CASE sm.role
              WHEN 'owner' THEN 0
              WHEN 'admin' THEN 1
              WHEN 'member' THEN 2
              ELSE 3
            END,
            sm.space_id ASC
          LIMIT 1
        ) sm ON true
      )
      UPDATE users u
      SET active_space_id = uds.space_id
      FROM user_default_space uds
      WHERE u.id = uds.user_id
        AND uds.space_id IS NOT NULL;

      ALTER TABLE libraries
        ALTER COLUMN space_id SET NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'libraries_space_id_fkey'
        ) THEN
          ALTER TABLE libraries
            ADD CONSTRAINT libraries_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE RESTRICT;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'users_active_space_id_fkey'
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT users_active_space_id_fkey
            FOREIGN KEY (active_space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'media_space_id_fkey'
        ) THEN
          ALTER TABLE media
            ADD CONSTRAINT media_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'invites_space_id_fkey'
        ) THEN
          ALTER TABLE invites
            ADD CONSTRAINT invites_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'app_integrations_space_id_fkey'
        ) THEN
          ALTER TABLE app_integrations
            ADD CONSTRAINT app_integrations_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'collections_space_id_fkey'
        ) THEN
          ALTER TABLE collections
            ADD CONSTRAINT collections_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'import_match_reviews_space_id_fkey'
        ) THEN
          ALTER TABLE import_match_reviews
            ADD CONSTRAINT import_match_reviews_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'events_space_id_fkey'
        ) THEN
          ALTER TABLE events
            ADD CONSTRAINT events_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'collectibles'
        ) AND NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'collectibles_space_id_fkey'
        ) THEN
          ALTER TABLE collectibles
            ADD CONSTRAINT collectibles_space_id_fkey
            FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;
        END IF;
      END;
      $$;
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
