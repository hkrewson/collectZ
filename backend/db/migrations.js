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
        user_rating DECIMAL(3,1),
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
  },
  {
    version: 43,
    description: 'Add space-scoped invite roles for tenancy activation',
    up: `
      ALTER TABLE invites
        ADD COLUMN IF NOT EXISTS space_role VARCHAR(20)
        DEFAULT 'member'
        CHECK (space_role IN ('owner', 'admin', 'member', 'viewer'));

      UPDATE invites
      SET space_role = 'member'
      WHERE space_role IS NULL;
    `
  },
  {
    version: 44,
    description: 'Reconcile legacy default-space installs into isolated personal spaces',
    up: `
      DO $$
      DECLARE
        default_space_id INTEGER;
        primary_admin_id INTEGER;
        active_space_count INTEGER;
        user_count INTEGER;
        default_membership_count INTEGER;
        default_owner_count INTEGER;
        user_row RECORD;
        personal_space_id INTEGER;
        fallback_library_id INTEGER;
      BEGIN
        SELECT COUNT(*)::int
        INTO active_space_count
        FROM spaces
        WHERE archived_at IS NULL;

        IF active_space_count <> 1 THEN
          RETURN;
        END IF;

        SELECT id
        INTO default_space_id
        FROM spaces
        WHERE lower(COALESCE(slug, '')) = 'default'
          AND archived_at IS NULL
        ORDER BY id ASC
        LIMIT 1;

        IF default_space_id IS NULL THEN
          RETURN;
        END IF;

        SELECT COUNT(*)::int
        INTO user_count
        FROM users;

        SELECT COUNT(*)::int
        INTO default_membership_count
        FROM space_memberships
        WHERE space_id = default_space_id;

        SELECT COUNT(*)::int
        INTO default_owner_count
        FROM space_memberships
        WHERE space_id = default_space_id
          AND role = 'owner';

        IF default_membership_count <> user_count OR default_owner_count <> user_count THEN
          RETURN;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM libraries
          WHERE archived_at IS NULL
            AND space_id <> default_space_id
        ) THEN
          RETURN;
        END IF;

        SELECT id
        INTO primary_admin_id
        FROM users
        WHERE role = 'admin'
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 1;

        IF primary_admin_id IS NULL THEN
          SELECT id
          INTO primary_admin_id
          FROM users
          ORDER BY created_at ASC NULLS LAST, id ASC
          LIMIT 1;
        END IF;

        IF primary_admin_id IS NULL THEN
          RETURN;
        END IF;

        UPDATE spaces
        SET created_by = primary_admin_id
        WHERE id = default_space_id;

        DELETE FROM space_memberships;

        INSERT INTO space_memberships (space_id, user_id, role, created_by)
        VALUES (default_space_id, primary_admin_id, 'owner', primary_admin_id)
        ON CONFLICT (space_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            created_by = EXCLUDED.created_by,
            updated_at = CURRENT_TIMESTAMP;

        FOR user_row IN
          SELECT id, email, name, active_library_id
          FROM users
          WHERE id <> primary_admin_id
          ORDER BY created_at ASC NULLS LAST, id ASC
        LOOP
          INSERT INTO spaces (name, slug, description, created_by, is_personal)
          VALUES (
            COALESCE(NULLIF(BTRIM(user_row.name), ''), split_part(lower(user_row.email), '@', 1), 'User ' || user_row.id) || '''s Space',
            'legacy-user-' || user_row.id,
            'Personal space created during legacy tenancy reconciliation',
            primary_admin_id,
            true
          )
          RETURNING id INTO personal_space_id;

          INSERT INTO space_memberships (space_id, user_id, role, created_by)
          VALUES (personal_space_id, user_row.id, 'owner', primary_admin_id)
          ON CONFLICT (space_id, user_id) DO UPDATE
          SET role = EXCLUDED.role,
              created_by = EXCLUDED.created_by,
              updated_at = CURRENT_TIMESTAMP;

          UPDATE libraries
          SET space_id = personal_space_id
          WHERE created_by = user_row.id
            AND archived_at IS NULL;

          UPDATE media
          SET space_id = personal_space_id
          WHERE library_id IN (
            SELECT id
            FROM libraries
            WHERE created_by = user_row.id
              AND archived_at IS NULL
              AND space_id = personal_space_id
          );

          UPDATE events
          SET space_id = personal_space_id
          WHERE library_id IN (
            SELECT id
            FROM libraries
            WHERE created_by = user_row.id
              AND archived_at IS NULL
              AND space_id = personal_space_id
          );

          UPDATE collectibles
          SET space_id = personal_space_id
          WHERE library_id IN (
            SELECT id
            FROM libraries
            WHERE created_by = user_row.id
              AND archived_at IS NULL
              AND space_id = personal_space_id
          );

          UPDATE collections
          SET space_id = personal_space_id
          WHERE library_id IN (
            SELECT id
            FROM libraries
            WHERE created_by = user_row.id
              AND archived_at IS NULL
              AND space_id = personal_space_id
          );

          UPDATE import_match_reviews
          SET space_id = personal_space_id
          WHERE library_id IN (
            SELECT id
            FROM libraries
            WHERE created_by = user_row.id
              AND archived_at IS NULL
              AND space_id = personal_space_id
          );

          DELETE FROM library_memberships
          WHERE user_id = user_row.id
            AND library_id NOT IN (
              SELECT id
              FROM libraries
              WHERE archived_at IS NULL
                AND space_id = personal_space_id
            );

          INSERT INTO library_memberships (user_id, library_id, role)
          SELECT user_row.id, l.id, 'owner'
          FROM libraries l
          WHERE l.created_by = user_row.id
            AND l.archived_at IS NULL
            AND l.space_id = personal_space_id
          ON CONFLICT (user_id, library_id) DO UPDATE
          SET role = 'owner';

          SELECT l.id
          INTO fallback_library_id
          FROM libraries l
          JOIN library_memberships lm
            ON lm.library_id = l.id
           AND lm.user_id = user_row.id
          WHERE l.archived_at IS NULL
            AND l.space_id = personal_space_id
            AND l.id = user_row.active_library_id
          LIMIT 1;

          IF fallback_library_id IS NULL THEN
            SELECT l.id
            INTO fallback_library_id
            FROM libraries l
            JOIN library_memberships lm
              ON lm.library_id = l.id
             AND lm.user_id = user_row.id
            WHERE l.archived_at IS NULL
              AND l.space_id = personal_space_id
            ORDER BY
              CASE lm.role
                WHEN 'owner' THEN 0
                ELSE 1
              END,
              l.id ASC
            LIMIT 1;
          END IF;

          IF fallback_library_id IS NULL THEN
            INSERT INTO libraries (name, created_by, space_id)
            VALUES ('My Library', user_row.id, personal_space_id)
            RETURNING id INTO fallback_library_id;

            INSERT INTO library_memberships (user_id, library_id, role)
            VALUES (user_row.id, fallback_library_id, 'owner')
            ON CONFLICT (user_id, library_id) DO UPDATE
            SET role = 'owner';
          END IF;

          UPDATE users
          SET active_space_id = personal_space_id,
              active_library_id = fallback_library_id
          WHERE id = user_row.id;
        END LOOP;

        SELECT l.id
        INTO fallback_library_id
        FROM libraries l
        JOIN library_memberships lm
          ON lm.library_id = l.id
         AND lm.user_id = primary_admin_id
        WHERE l.archived_at IS NULL
          AND l.space_id = default_space_id
        ORDER BY
          CASE lm.role
            WHEN 'owner' THEN 0
            ELSE 1
          END,
          l.id ASC
        LIMIT 1;

        IF fallback_library_id IS NULL THEN
          INSERT INTO libraries (name, created_by, space_id)
          VALUES ('My Library', primary_admin_id, default_space_id)
          RETURNING id INTO fallback_library_id;

          INSERT INTO library_memberships (user_id, library_id, role)
          VALUES (primary_admin_id, fallback_library_id, 'owner')
          ON CONFLICT (user_id, library_id) DO UPDATE
          SET role = 'owner';
        END IF;

        UPDATE users
        SET active_space_id = default_space_id,
            active_library_id = fallback_library_id
        WHERE id = primary_admin_id;
      END;
      $$;
    `
  },
  {
    version: 45,
    description: 'Retire import review queue after moving diagnostics to audit and debug logging',
    up: `
      DROP TRIGGER IF EXISTS update_import_match_reviews_updated_at ON import_match_reviews;
      DROP TABLE IF EXISTS import_match_reviews;
    `
  },
  {
    version: 46,
    description: 'Session-scoped support access metadata for explicit admin troubleshooting',
    up: `
      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS support_space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL;

      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS support_library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL;

      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS support_started_at TIMESTAMP;

      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS support_reason TEXT;

      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS support_previous_space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL;

      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS support_previous_library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_user_sessions_support_space_id
        ON user_sessions(support_space_id)
        WHERE support_space_id IS NOT NULL;
    `
  },
  {
    version: 47,
    description: 'Add event image and collectible artist fields for first-class object presentation',
    up: `
      ALTER TABLE events
        ADD COLUMN IF NOT EXISTS image_path TEXT;

      ALTER TABLE collectibles
        ADD COLUMN IF NOT EXISTS artist VARCHAR(255);
    `
  },
  {
    version: 48,
    description: 'Add support admin role and support request foundation tables',
    up: `
      ALTER TABLE users
        DROP CONSTRAINT IF EXISTS users_role_check;

      ALTER TABLE users
        ADD CONSTRAINT users_role_check
        CHECK (role IN ('admin', 'support_admin', 'user', 'viewer'));

      CREATE TABLE IF NOT EXISTS support_requests (
        id SERIAL PRIMARY KEY,
        requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'answered', 'closed')),
        target_space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL,
        target_library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_by_role VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS support_request_messages (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        author_role VARCHAR(50) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_support_requests_requester_user_id
        ON support_requests(requester_user_id);

      CREATE INDEX IF NOT EXISTS idx_support_requests_status_last_message_at
        ON support_requests(status, last_message_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS idx_support_request_messages_request_id_created_at
        ON support_request_messages(request_id, created_at ASC, id ASC);
    `
  },
  {
    version: 49,
    description: 'Add support request triage and tracking fields',
    up: `
      ALTER TABLE support_requests
        ADD COLUMN IF NOT EXISTS classification VARCHAR(30) NOT NULL DEFAULT 'support';

      ALTER TABLE support_requests
        DROP CONSTRAINT IF EXISTS support_requests_classification_check;

      ALTER TABLE support_requests
        ADD CONSTRAINT support_requests_classification_check
        CHECK (classification IN ('support', 'bug', 'feature_request'));

      ALTER TABLE support_requests
        ADD COLUMN IF NOT EXISTS tracking_status VARCHAR(30) NOT NULL DEFAULT 'untracked',
        ADD COLUMN IF NOT EXISTS internal_notes TEXT,
        ADD COLUMN IF NOT EXISTS repo_issue_number INTEGER,
        ADD COLUMN IF NOT EXISTS repo_issue_url TEXT,
        ADD COLUMN IF NOT EXISTS resolved_in_version VARCHAR(32);

      ALTER TABLE support_requests
        DROP CONSTRAINT IF EXISTS support_requests_tracking_status_check;

      ALTER TABLE support_requests
        ADD CONSTRAINT support_requests_tracking_status_check
        CHECK (tracking_status IN ('untracked', 'investigating', 'planned', 'in_progress', 'shipped', 'declined'));

      CREATE INDEX IF NOT EXISTS idx_support_requests_classification_tracking
        ON support_requests(classification, tracking_status, last_message_at DESC, id DESC);
    `
  },
  {
    version: 50,
    description: 'Add staff-only support thread note visibility',
    up: `
      ALTER TABLE support_request_messages
        ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

      CREATE INDEX IF NOT EXISTS idx_support_request_messages_visibility_created_at
        ON support_request_messages(request_id, is_internal, created_at ASC, id ASC);
    `
  },
  {
    version: 51,
    description: 'Add explicit support request access approval state',
    up: `
      ALTER TABLE support_requests
        ADD COLUMN IF NOT EXISTS support_access_status VARCHAR(20) NOT NULL DEFAULT 'not_requested',
        ADD COLUMN IF NOT EXISTS support_access_approved_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS support_access_approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

      ALTER TABLE support_requests
        DROP CONSTRAINT IF EXISTS support_requests_support_access_status_check;

      ALTER TABLE support_requests
        ADD CONSTRAINT support_requests_support_access_status_check
        CHECK (support_access_status IN ('not_requested', 'approved', 'revoked'));

      CREATE INDEX IF NOT EXISTS idx_support_requests_access_status
        ON support_requests(support_access_status, last_message_at DESC, id DESC);
    `
  },
  {
    version: 52,
    description: 'Link support sessions to approved support requests',
    up: `
      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS support_request_id INTEGER REFERENCES support_requests(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_user_sessions_support_request_id
        ON user_sessions(support_request_id)
        WHERE support_request_id IS NOT NULL;
    `
  },
  {
    version: 53,
    description: 'Add support request updated_at trigger parity',
    up: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_support_requests_updated_at') THEN
          CREATE TRIGGER update_support_requests_updated_at BEFORE UPDATE ON support_requests
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 54,
    description: 'Add observability endpoint control-plane fields',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_backend VARCHAR(50);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_host TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_port INTEGER;
    `
  },
  {
    version: 55,
    description: 'Add observability endpoint validation fields',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_last_validation_status VARCHAR(20);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_last_validation_message TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_last_validation_backend VARCHAR(50);
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_last_validation_host TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_last_validation_port INTEGER;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_last_validated_at TIMESTAMP;
    `
  },
  {
    version: 56,
    description: 'Add observability endpoint label fields',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_host_label TEXT;
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_service TEXT;
    `
  },
  {
    version: 57,
    description: 'Add observability endpoint debug field',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS log_export_debug BOOLEAN;
    `
  },
  {
    version: 58,
    description: 'Add multi-format ownership fields for media entries',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS owned_formats TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

      UPDATE media
      SET owned_formats = CASE
        WHEN format IS NULL THEN ARRAY[]::text[]
        WHEN COALESCE(media_type, 'movie') = 'book' THEN array_remove(ARRAY[
          CASE
            WHEN format = 'Digital' THEN 'digital'
            WHEN format = 'Paperback' THEN 'paperback'
            WHEN format = 'Trade' THEN 'trade_paperback'
            WHEN format = 'Trade Paperback' THEN 'trade_paperback'
            WHEN format = 'Hardcover' THEN 'hardcover'
            ELSE NULL
          END
        ]::text[], NULL)
        WHEN COALESCE(media_type, 'movie') = 'comic_book' THEN array_remove(ARRAY[
          CASE
            WHEN format = 'Digital' THEN 'digital'
            WHEN format = 'Paper' THEN 'paper'
            ELSE NULL
          END
        ]::text[], NULL)
        WHEN COALESCE(media_type, 'movie') = 'game' THEN array_remove(ARRAY[
          CASE
            WHEN format = 'Digital' THEN 'digital'
            WHEN format IN ('DVD', 'Blu-ray', 'Disc') THEN 'disc'
            WHEN format = 'Card' THEN 'card'
            WHEN format = 'Cartridge' THEN 'cartridge'
            ELSE NULL
          END
        ]::text[], NULL)
        WHEN COALESCE(media_type, 'movie') = 'audio' THEN array_remove(ARRAY[
          CASE
            WHEN format = 'Digital' THEN 'digital'
            WHEN format = '4 Track' THEN 'four_track'
            WHEN format = '8 Track' THEN 'eight_track'
            WHEN format = 'Cassette' THEN 'cassette'
            WHEN format = 'VHS' THEN 'vhs'
            WHEN format = 'Vinyl' THEN 'vinyl'
            WHEN format = 'CD' THEN 'cd'
            ELSE NULL
          END
        ]::text[], NULL)
        WHEN COALESCE(media_type, 'movie') IN ('tv_series', 'tv_episode') THEN array_remove(ARRAY[
          CASE
            WHEN format = 'VHS' THEN 'vhs'
            WHEN format = 'DVD' THEN 'dvd'
            WHEN format = 'Blu-ray' THEN 'bluray'
            WHEN format = '4K UHD' THEN 'uhd'
            ELSE NULL
          END
        ]::text[], NULL)
        ELSE array_remove(ARRAY[
          CASE
            WHEN format = 'VHS' THEN 'vhs'
            WHEN format = 'Beta' THEN 'beta'
            WHEN format = 'Laserdisc' THEN 'laserdisc'
            WHEN format = 'DVD' THEN 'dvd'
            WHEN format = 'Blu-ray' THEN 'bluray'
            WHEN format = '4K UHD' THEN 'uhd'
            WHEN format = 'Digital' THEN 'digital'
            ELSE NULL
          END
        ]::text[], NULL)
      END
      WHERE owned_formats = ARRAY[]::text[];

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
            'VHS', 'Beta', 'Laserdisc', 'DVD', 'Blu-ray', '4K UHD', 'Digital',
            'Paperback', 'Trade Paperback', 'Hardcover', 'Paper', 'Disc', 'Card',
            'Cartridge', '4 Track', '8 Track', 'Cassette', 'Vinyl', 'CD'
          )
        );

      ALTER TABLE media
        ADD CONSTRAINT media_owned_formats_check
        CHECK (
          owned_formats IS NOT NULL
          AND (
            (COALESCE(media_type, 'movie') = 'book'
              AND owned_formats <@ ARRAY['digital', 'paperback', 'trade_paperback', 'hardcover']::text[])
            OR (COALESCE(media_type, 'movie') = 'comic_book'
              AND owned_formats <@ ARRAY['digital', 'paper']::text[])
            OR (COALESCE(media_type, 'movie') = 'game'
              AND owned_formats <@ ARRAY['digital', 'disc', 'card', 'cartridge']::text[])
            OR (COALESCE(media_type, 'movie') = 'audio'
              AND owned_formats <@ ARRAY['four_track', 'eight_track', 'cassette', 'vhs', 'vinyl', 'cd', 'digital']::text[])
            OR (COALESCE(media_type, 'movie') = 'movie'
              AND owned_formats <@ ARRAY['vhs', 'beta', 'laserdisc', 'dvd', 'bluray', 'uhd', 'digital']::text[])
            OR (COALESCE(media_type, 'movie') IN ('tv_series', 'tv_episode')
              AND owned_formats <@ ARRAY['vhs', 'dvd', 'bluray', 'uhd', 'digital']::text[])
          )
        );
    `
  },
  {
    version: 59,
    description: 'Allow one integration config row per space',
    up: `
      CREATE SEQUENCE IF NOT EXISTS app_integrations_id_seq;

      SELECT setval(
        'app_integrations_id_seq',
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM app_integrations), 1),
        true
      );

      ALTER TABLE app_integrations
        ALTER COLUMN id SET DEFAULT nextval('app_integrations_id_seq');

      ALTER SEQUENCE app_integrations_id_seq
        OWNED BY app_integrations.id;

      ALTER TABLE app_integrations
        DROP CONSTRAINT IF EXISTS app_integrations_id_check;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'app_integrations_space_id_key'
        ) THEN
          ALTER TABLE app_integrations
            ADD CONSTRAINT app_integrations_space_id_key UNIQUE (space_id);
        END IF;
      END;
      $$;
    `
  },
  {
    version: 60,
    description: 'Add space-scoped settings and library visibility controls',
    up: `
      ALTER TABLE spaces
        ADD COLUMN IF NOT EXISTS theme VARCHAR(20);

      ALTER TABLE spaces
        ADD COLUMN IF NOT EXISTS density VARCHAR(20);

      ALTER TABLE spaces
        ADD COLUMN IF NOT EXISTS events_enabled BOOLEAN;

      ALTER TABLE spaces
        ADD COLUMN IF NOT EXISTS collectibles_enabled BOOLEAN;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'spaces_theme_check'
        ) THEN
          ALTER TABLE spaces
            ADD CONSTRAINT spaces_theme_check
            CHECK (theme IS NULL OR theme IN ('system', 'light', 'dark'));
        END IF;
      END;
      $$;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'spaces_density_check'
        ) THEN
          ALTER TABLE spaces
            ADD CONSTRAINT spaces_density_check
            CHECK (density IS NULL OR density IN ('comfortable', 'compact'));
        END IF;
      END;
      $$;
    `
  },
  {
    version: 61,
    description: 'Add platform SMTP settings overrides',
    up: `
      ALTER TABLE app_settings
        ADD COLUMN IF NOT EXISTS smtp_override_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS smtp_host TEXT,
        ADD COLUMN IF NOT EXISTS smtp_port INTEGER,
        ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN,
        ADD COLUMN IF NOT EXISTS smtp_user TEXT,
        ADD COLUMN IF NOT EXISTS smtp_password_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS smtp_from TEXT;
    `
  },
  {
    version: 62,
    description: 'Add SaaS email verification state and tokens',
    up: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

      UPDATE users
      SET email_verified = true,
          email_verified_at = COALESCE(email_verified_at, created_at)
      WHERE email_verified = false
        AND (
          role IN ('admin', 'support_admin')
          OR EXISTS (
            SELECT 1
            FROM space_memberships sm
            WHERE sm.user_id = users.id
              AND sm.role = 'owner'
          )
        );

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        used BOOLEAN DEFAULT false,
        revoked BOOLEAN DEFAULT false,
        used_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id
        ON email_verification_tokens(user_id);

      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_active
        ON email_verification_tokens(used, revoked, expires_at);
    `
  },
  {
    version: 63,
    description: 'Add workspace membership suspension lifecycle fields',
    up: `
      ALTER TABLE space_memberships
        ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS suspended_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_space_memberships_user_active
        ON space_memberships(user_id, space_id)
        WHERE suspended_at IS NULL;
    `
  },
  {
    version: 64,
    description: 'Add optional valuation fields and platform valuation provider settings',
    up: `
      ALTER TABLE media
        ADD COLUMN IF NOT EXISTS estimated_value_low NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS estimated_value_mid NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS estimated_value_high NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS valuation_currency VARCHAR(8),
        ADD COLUMN IF NOT EXISTS valuation_source VARCHAR(100),
        ADD COLUMN IF NOT EXISTS valuation_last_updated TIMESTAMP;

      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS pricecharting_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS pricecharting_api_url TEXT,
        ADD COLUMN IF NOT EXISTS pricecharting_api_key_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS pricecharting_rate_limit_ms INTEGER,
        ADD COLUMN IF NOT EXISTS ebay_browse_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS ebay_browse_api_url TEXT,
        ADD COLUMN IF NOT EXISTS ebay_browse_client_id TEXT,
        ADD COLUMN IF NOT EXISTS ebay_browse_client_secret_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS ebay_browse_marketplace_id VARCHAR(50);

      UPDATE app_integrations
         SET pricecharting_rate_limit_ms = 1100
       WHERE pricecharting_rate_limit_ms IS NULL
          OR pricecharting_rate_limit_ms < 1100;

      UPDATE app_integrations
         SET pricecharting_api_url = 'https://www.pricecharting.com/api'
       WHERE COALESCE(TRIM(pricecharting_api_url), '') = '';

      UPDATE app_integrations
         SET ebay_browse_api_url = 'https://api.ebay.com/buy/browse/v1/item_summary/search'
       WHERE COALESCE(TRIM(ebay_browse_api_url), '') = '';

      UPDATE app_integrations
         SET ebay_browse_marketplace_id = 'EBAY_US'
       WHERE COALESCE(TRIM(ebay_browse_marketplace_id), '') = '';
    `
  },
  {
    version: 65,
    description: 'Add optional user profile image field',
    up: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS image_path TEXT;
    `
  },
  {
    version: 66,
    description: 'Add media repair history table for duplicate attach snapshots',
    up: `
      CREATE TABLE IF NOT EXISTS media_repair_history (
        id SERIAL PRIMARY KEY,
        canonical_media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        duplicate_media_id INTEGER NOT NULL,
        repair_type VARCHAR(50) NOT NULL CHECK (repair_type IN ('duplicate_attach')),
        snapshot JSONB NOT NULL,
        context JSONB NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reverted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT media_repair_history_unique_duplicate_attach
          UNIQUE (canonical_media_id, duplicate_media_id, repair_type)
      );

      CREATE INDEX IF NOT EXISTS idx_media_repair_history_canonical_type
        ON media_repair_history(canonical_media_id, repair_type);
      CREATE INDEX IF NOT EXISTS idx_media_repair_history_duplicate_type
        ON media_repair_history(duplicate_media_id, repair_type);
      CREATE INDEX IF NOT EXISTS idx_media_repair_history_reverted_at
        ON media_repair_history(reverted_at);
    `
  },
  {
    version: 67,
    description: 'Add recommendation feedback table for manual merge rejection outcomes',
    up: `
      CREATE TABLE IF NOT EXISTS media_merge_recommendation_feedback (
        id SERIAL PRIMARY KEY,
        pair_low_media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        pair_high_media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        canonical_media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        duplicate_media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        media_type VARCHAR(50) NOT NULL,
        outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('rejected')),
        reason TEXT,
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        space_id INTEGER,
        library_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_media_merge_recommendation_feedback_pair_scope
        ON media_merge_recommendation_feedback(pair_low_media_id, pair_high_media_id, space_id, library_id, outcome);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_media_merge_recommendation_feedback_unique_rejected_pair_scope
        ON media_merge_recommendation_feedback(
          COALESCE(space_id, 0),
          COALESCE(library_id, 0),
          pair_low_media_id,
          pair_high_media_id,
          outcome
        );
    `
  },
  {
    version: 68,
    description: 'Add collection merge history table for duplicate collection snapshots',
    up: `
      CREATE TABLE IF NOT EXISTS collection_merge_history (
        id SERIAL PRIMARY KEY,
        canonical_collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        duplicate_collection_id INTEGER NOT NULL,
        repair_type VARCHAR(50) NOT NULL CHECK (repair_type IN ('duplicate_attach')),
        snapshot JSONB NOT NULL,
        context JSONB NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reverted_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT collection_merge_history_unique_duplicate_attach
          UNIQUE (canonical_collection_id, duplicate_collection_id, repair_type)
      );

      CREATE INDEX IF NOT EXISTS idx_collection_merge_history_canonical_type
        ON collection_merge_history(canonical_collection_id, repair_type);
      CREATE INDEX IF NOT EXISTS idx_collection_merge_history_duplicate_type
        ON collection_merge_history(duplicate_collection_id, repair_type);
      CREATE INDEX IF NOT EXISTS idx_collection_merge_history_reverted_at
        ON collection_merge_history(reverted_at);
    `
  },
  {
    version: 69,
    description: 'Allow deferred recommendation feedback outcomes for operator merge workflow',
    up: `
      ALTER TABLE media_merge_recommendation_feedback
        DROP CONSTRAINT IF EXISTS media_merge_recommendation_feedback_outcome_check;

      ALTER TABLE media_merge_recommendation_feedback
        ADD CONSTRAINT media_merge_recommendation_feedback_outcome_check
        CHECK (outcome IN ('rejected', 'deferred'));
    `
  },
  {
    version: 70,
    description: 'Add media loans workflow table and active-loan indexes',
    up: `
      CREATE TABLE IF NOT EXISTS media_loans (
        id SERIAL PRIMARY KEY,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        library_id INTEGER,
        space_id INTEGER,
        borrower_name VARCHAR(255) NOT NULL,
        borrower_email VARCHAR(255),
        loaned_at DATE NOT NULL,
        due_at DATE NOT NULL,
        returned_at DATE,
        loan_format VARCHAR(50),
        notes TEXT,
        reminder_last_sent_at TIMESTAMP,
        reminder_status VARCHAR(20) DEFAULT 'pending' CHECK (reminder_status IN ('pending', 'sent', 'skipped')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_media_loans_library_due_at
        ON media_loans(library_id, due_at ASC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_media_loans_space_due_at
        ON media_loans(space_id, due_at ASC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_media_loans_media_active
        ON media_loans(media_id) WHERE returned_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_media_loans_returned_at
        ON media_loans(returned_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_media_loans_unique_active_per_media
        ON media_loans(media_id) WHERE returned_at IS NULL;
    `
  },
  {
    version: 71,
    description: 'Add phase-specific reminder tracking to media loans',
    up: `
      ALTER TABLE media_loans
        ADD COLUMN IF NOT EXISTS due_soon_reminder_last_sent_at TIMESTAMP;

      ALTER TABLE media_loans
        ADD COLUMN IF NOT EXISTS overdue_reminder_last_sent_at TIMESTAMP;
    `
  },
  {
    version: 72,
    description: 'Add event-level reminder history for media loans',
    up: `
      CREATE TABLE IF NOT EXISTS media_loan_reminders (
        id SERIAL PRIMARY KEY,
        loan_id INTEGER NOT NULL REFERENCES media_loans(id) ON DELETE CASCADE,
        media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
        library_id INTEGER,
        space_id INTEGER,
        phase VARCHAR(20) NOT NULL CHECK (phase IN ('due_soon', 'overdue')),
        trigger_source VARCHAR(20) NOT NULL CHECK (trigger_source IN ('manual', 'automatic')),
        status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
        sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        triggered_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        failure_summary TEXT,
        delivery_window_key VARCHAR(100) NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_media_loan_reminders_loan_sent_at
        ON media_loan_reminders(loan_id, sent_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_media_loan_reminders_library_sent_at
        ON media_loan_reminders(library_id, sent_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_media_loan_reminders_space_sent_at
        ON media_loan_reminders(space_id, sent_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_media_loan_reminders_window
        ON media_loan_reminders(loan_id, phase, delivery_window_key);
    `
  },
  {
    version: 73,
    description: 'Add collectible series plus split vendor and booth fields',
    up: `
      ALTER TABLE collectibles
        ADD COLUMN IF NOT EXISTS series VARCHAR(255),
        ADD COLUMN IF NOT EXISTS vendor VARCHAR(255),
        ADD COLUMN IF NOT EXISTS booth VARCHAR(255);

      UPDATE collectibles
      SET vendor = COALESCE(vendor, booth_or_vendor)
      WHERE COALESCE(vendor, '') = ''
        AND COALESCE(booth_or_vendor, '') <> '';

      CREATE INDEX IF NOT EXISTS idx_collectibles_vendor_v2
        ON collectibles(vendor);
      CREATE INDEX IF NOT EXISTS idx_collectibles_series
        ON collectibles(series);
    `
  },
  {
    version: 74,
    description: 'Add native art storage and shared event purchased item links',
    up: `
      CREATE TABLE IF NOT EXISTS art_items (
        id SERIAL PRIMARY KEY,
        source_collectible_id INTEGER UNIQUE REFERENCES collectibles(id) ON DELETE SET NULL,
        library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255),
        series VARCHAR(255),
        vendor VARCHAR(255),
        booth VARCHAR(255),
        price NUMERIC(10,2),
        exclusive BOOLEAN NOT NULL DEFAULT false,
        image_path TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_art_items_library_created_at
        ON art_items(library_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_art_items_space_created_at
        ON art_items(space_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_art_items_artist
        ON art_items(artist);
      CREATE INDEX IF NOT EXISTS idx_art_items_series
        ON art_items(series);
      CREATE INDEX IF NOT EXISTS idx_art_items_vendor
        ON art_items(vendor);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_art_items_updated_at') THEN
          CREATE TRIGGER update_art_items_updated_at BEFORE UPDATE ON art_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;

      CREATE TABLE IF NOT EXISTS event_purchased_items (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('art', 'collectible')),
        item_id INTEGER NOT NULL,
        title_snapshot VARCHAR(255),
        vendor_snapshot VARCHAR(255),
        booth_snapshot VARCHAR(255),
        price_snapshot NUMERIC(10,2),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_purchased_items_event_created
        ON event_purchased_items(event_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_event_purchased_items_item_lookup
        ON event_purchased_items(item_type, item_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_purchased_items_active_unique
        ON event_purchased_items(event_id, item_type, item_id)
        WHERE archived_at IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_purchased_items_updated_at') THEN
          CREATE TRIGGER update_event_purchased_items_updated_at BEFORE UPDATE ON event_purchased_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 75,
    description: 'Backfill native art rows and shared event purchased item links',
    up: `
      INSERT INTO art_items (
        source_collectible_id,
        library_id,
        space_id,
        created_by,
        title,
        artist,
        series,
        vendor,
        booth,
        price,
        exclusive,
        image_path,
        notes,
        created_at,
        updated_at,
        archived_at
      )
      SELECT
        c.id,
        c.library_id,
        c.space_id,
        c.created_by,
        c.title,
        c.artist,
        c.series,
        COALESCE(NULLIF(c.vendor, ''), NULLIF(c.booth_or_vendor, '')),
        c.booth,
        c.price,
        COALESCE(c.exclusive, false),
        c.image_path,
        c.notes,
        COALESCE(c.created_at, CURRENT_TIMESTAMP),
        COALESCE(c.updated_at, c.created_at, CURRENT_TIMESTAMP),
        c.archived_at
      FROM collectibles c
      WHERE c.subtype = 'art'
      ON CONFLICT (source_collectible_id) DO UPDATE
        SET library_id = EXCLUDED.library_id,
            space_id = EXCLUDED.space_id,
            created_by = COALESCE(art_items.created_by, EXCLUDED.created_by),
            title = EXCLUDED.title,
            artist = EXCLUDED.artist,
            series = EXCLUDED.series,
            vendor = EXCLUDED.vendor,
            booth = EXCLUDED.booth,
            price = EXCLUDED.price,
            exclusive = EXCLUDED.exclusive,
            image_path = EXCLUDED.image_path,
            notes = EXCLUDED.notes,
            archived_at = EXCLUDED.archived_at,
            updated_at = CURRENT_TIMESTAMP;

      INSERT INTO event_purchased_items (
        event_id,
        item_type,
        item_id,
        title_snapshot,
        vendor_snapshot,
        booth_snapshot,
        price_snapshot,
        created_by,
        created_at,
        updated_at,
        archived_at
      )
      SELECT
        c.event_id,
        'art',
        a.id,
        c.title,
        COALESCE(NULLIF(c.vendor, ''), NULLIF(c.booth_or_vendor, '')),
        c.booth,
        c.price,
        c.created_by,
        COALESCE(c.created_at, CURRENT_TIMESTAMP),
        COALESCE(c.updated_at, c.created_at, CURRENT_TIMESTAMP),
        c.archived_at
      FROM collectibles c
      INNER JOIN art_items a
        ON a.source_collectible_id = c.id
      INNER JOIN events e
        ON e.id = c.event_id
      WHERE c.subtype = 'art'
        AND c.event_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM event_purchased_items epi
          WHERE epi.event_id = c.event_id
            AND epi.item_type = 'art'
            AND epi.item_id = a.id
      );
    `
  },
  {
    version: 76,
    description: 'Add art medium and signed fields with comic panel migration boundary',
    up: `
      ALTER TABLE art_items
        ADD COLUMN IF NOT EXISTS medium VARCHAR(50),
        ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT false;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'art_items_medium_check'
        ) THEN
          ALTER TABLE art_items
            ADD CONSTRAINT art_items_medium_check
            CHECK (medium IS NULL OR medium IN ('original', 'print', 'comic_panel', 'sketch', 'commission', 'other'));
        END IF;
      END;
      $$;

      INSERT INTO art_items (
        source_collectible_id,
        library_id,
        space_id,
        created_by,
        title,
        artist,
        series,
        medium,
        vendor,
        booth,
        price,
        exclusive,
        signed,
        image_path,
        notes,
        created_at,
        updated_at,
        archived_at
      )
      SELECT
        c.id,
        c.library_id,
        c.space_id,
        c.created_by,
        c.title,
        c.artist,
        c.series,
        'comic_panel',
        COALESCE(NULLIF(c.vendor, ''), NULLIF(c.booth_or_vendor, '')),
        c.booth,
        c.price,
        COALESCE(c.exclusive, false),
        false,
        c.image_path,
        c.notes,
        COALESCE(c.created_at, CURRENT_TIMESTAMP),
        COALESCE(c.updated_at, c.created_at, CURRENT_TIMESTAMP),
        c.archived_at
      FROM collectibles c
      WHERE c.archived_at IS NULL
        AND COALESCE(c.subtype, c.item_type, 'collectible') <> 'art'
        AND c.category_key = 'comic_panels'
      ON CONFLICT (source_collectible_id) DO UPDATE
        SET library_id = EXCLUDED.library_id,
            space_id = EXCLUDED.space_id,
            title = EXCLUDED.title,
            artist = EXCLUDED.artist,
            series = EXCLUDED.series,
            medium = 'comic_panel',
            vendor = EXCLUDED.vendor,
            booth = EXCLUDED.booth,
            price = EXCLUDED.price,
            exclusive = EXCLUDED.exclusive,
            image_path = EXCLUDED.image_path,
            notes = EXCLUDED.notes,
            archived_at = EXCLUDED.archived_at,
            updated_at = CURRENT_TIMESTAMP;

      INSERT INTO event_purchased_items (
        event_id,
        item_type,
        item_id,
        title_snapshot,
        vendor_snapshot,
        booth_snapshot,
        price_snapshot,
        created_by,
        created_at,
        updated_at,
        archived_at
      )
      SELECT
        c.event_id,
        'art',
        a.id,
        c.title,
        COALESCE(NULLIF(c.vendor, ''), NULLIF(c.booth_or_vendor, '')),
        c.booth,
        c.price,
        c.created_by,
        COALESCE(c.created_at, CURRENT_TIMESTAMP),
        COALESCE(c.updated_at, c.created_at, CURRENT_TIMESTAMP),
        c.archived_at
      FROM collectibles c
      INNER JOIN art_items a
        ON a.source_collectible_id = c.id
      WHERE c.archived_at IS NULL
        AND c.category_key = 'comic_panels'
        AND c.event_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM event_purchased_items epi
          WHERE epi.event_id = c.event_id
            AND epi.item_type = 'art'
            AND epi.item_id = a.id
            AND epi.archived_at IS NULL
        );

      UPDATE collectibles
      SET subtype = 'art',
          item_type = 'art',
          category_key = NULL,
          category = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE archived_at IS NULL
        AND COALESCE(subtype, item_type, 'collectible') <> 'art'
        AND category_key = 'comic_panels';
    `
  },
  {
    version: 77,
    description: 'Add shared fandom franchise metadata to Art and Collectibles',
    up: `
      ALTER TABLE collectibles
        ADD COLUMN IF NOT EXISTS franchise VARCHAR(255);

      ALTER TABLE art_items
        ADD COLUMN IF NOT EXISTS franchise VARCHAR(255);

      CREATE INDEX IF NOT EXISTS idx_collectibles_franchise
        ON collectibles(franchise);

      CREATE INDEX IF NOT EXISTS idx_art_items_franchise
        ON art_items(franchise);
    `
  },
  {
    version: 78,
    description: 'Add shared signature provenance records for Art and media',
    up: `
      CREATE TABLE IF NOT EXISTS signature_records (
        id SERIAL PRIMARY KEY,
        owner_type VARCHAR(20) NOT NULL CHECK (owner_type IN ('media', 'art')),
        owner_id INTEGER NOT NULL,
        library_id INTEGER,
        space_id INTEGER,
        signer_name VARCHAR(255),
        signer_role VARCHAR(100),
        signed_on DATE,
        signed_at VARCHAR(255),
        signed_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        proof_path TEXT,
        notes TEXT,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_signature_records_primary_active
        ON signature_records(owner_type, owner_id)
        WHERE is_primary = TRUE AND archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_signature_records_owner_active
        ON signature_records(owner_type, owner_id, archived_at);

      CREATE INDEX IF NOT EXISTS idx_signature_records_signed_event
        ON signature_records(signed_event_id)
        WHERE signed_event_id IS NOT NULL AND archived_at IS NULL;

      INSERT INTO signature_records (
        owner_type,
        owner_id,
        library_id,
        space_id,
        signer_name,
        signer_role,
        signed_on,
        signed_at,
        proof_path,
        is_primary,
        created_by,
        created_at,
        updated_at
      )
      SELECT
        'media',
        m.id,
        m.library_id,
        m.space_id,
        NULLIF(m.signed_by, ''),
        NULLIF(m.signed_role, ''),
        m.signed_on,
        NULLIF(m.signed_at, ''),
        NULLIF(m.signed_proof_path, ''),
        TRUE,
        m.added_by,
        COALESCE(m.created_at, CURRENT_TIMESTAMP),
        COALESCE(m.updated_at, m.created_at, CURRENT_TIMESTAMP)
      FROM media m
      WHERE (NULLIF(m.signed_by, '') IS NOT NULL
          OR NULLIF(m.signed_role, '') IS NOT NULL
          OR m.signed_on IS NOT NULL
          OR NULLIF(m.signed_at, '') IS NOT NULL
          OR NULLIF(m.signed_proof_path, '') IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM signature_records sr
          WHERE sr.owner_type = 'media'
            AND sr.owner_id = m.id
            AND sr.is_primary = TRUE
            AND sr.archived_at IS NULL
        );

      INSERT INTO signature_records (
        owner_type,
        owner_id,
        library_id,
        space_id,
        is_primary,
        created_by,
        created_at,
        updated_at
      )
      SELECT
        'art',
        a.id,
        a.library_id,
        a.space_id,
        TRUE,
        a.created_by,
        COALESCE(a.created_at, CURRENT_TIMESTAMP),
        COALESCE(a.updated_at, a.created_at, CURRENT_TIMESTAMP)
      FROM art_items a
      WHERE a.signed = TRUE
        AND a.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM signature_records sr
          WHERE sr.owner_type = 'art'
            AND sr.owner_id = a.id
            AND sr.is_primary = TRUE
            AND sr.archived_at IS NULL
        );
    `
  },
  {
    version: 79,
    description: 'Link event autograph artifacts to shared signature provenance',
    up: `
      ALTER TABLE event_artifacts
        ADD COLUMN IF NOT EXISTS signature_record_id INTEGER REFERENCES signature_records(id) ON DELETE SET NULL;

      DO $$
      DECLARE
        constraint_name text;
      BEGIN
        SELECT conname
          INTO constraint_name
          FROM pg_constraint
         WHERE conrelid = 'signature_records'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%owner_type%'
         LIMIT 1;

        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE signature_records DROP CONSTRAINT %I', constraint_name);
        END IF;
      END;
      $$;

      ALTER TABLE signature_records
        ADD CONSTRAINT signature_records_owner_type_check
        CHECK (owner_type IN ('media', 'art', 'event_artifact'));

      CREATE INDEX IF NOT EXISTS idx_event_artifacts_signature_record
        ON event_artifacts(signature_record_id)
        WHERE signature_record_id IS NOT NULL;
    `
  },
  {
    version: 80,
    description: 'Add Art physical dimensions and framed metadata',
    up: `
      ALTER TABLE art_items
        ADD COLUMN IF NOT EXISTS height NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS width NUMERIC(10,2),
        ADD COLUMN IF NOT EXISTS framed BOOLEAN NOT NULL DEFAULT false;
    `
  },
  {
    version: 81,
    description: 'Add Art dimension unit metadata',
    up: `
      ALTER TABLE art_items
        ADD COLUMN IF NOT EXISTS dimension_unit VARCHAR(10);

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'art_items_dimension_unit_check'
            AND conrelid = 'art_items'::regclass
        ) THEN
          ALTER TABLE art_items
            ADD CONSTRAINT art_items_dimension_unit_check
            CHECK (dimension_unit IS NULL OR dimension_unit IN ('in', 'cm'));
        END IF;
      END;
      $$;
    `
  },
  {
    version: 82,
    description: 'Add multi-proof signature evidence table',
    up: `
      CREATE TABLE IF NOT EXISTS signature_proofs (
        id SERIAL PRIMARY KEY,
        signature_record_id INTEGER NOT NULL REFERENCES signature_records(id) ON DELETE CASCADE,
        proof_path TEXT NOT NULL,
        provider VARCHAR(50),
        original_filename VARCHAR(255),
        mime_type VARCHAR(100),
        is_primary BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_signature_proofs_primary_active
        ON signature_proofs(signature_record_id)
        WHERE is_primary = TRUE AND archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_signature_proofs_signature_active
        ON signature_proofs(signature_record_id, archived_at, created_at DESC);

      INSERT INTO signature_proofs (
        signature_record_id,
        proof_path,
        is_primary,
        created_at
      )
      SELECT sr.id,
             sr.proof_path,
             TRUE,
             COALESCE(sr.updated_at, sr.created_at, CURRENT_TIMESTAMP)
        FROM signature_records sr
       WHERE NULLIF(sr.proof_path, '') IS NOT NULL
         AND sr.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM signature_proofs sp
            WHERE sp.signature_record_id = sr.id
              AND sp.archived_at IS NULL
              AND sp.proof_path = sr.proof_path
         );
    `
  },
  {
    version: 83,
    description: 'Add signature proof evidence metadata',
    up: `
      ALTER TABLE signature_proofs
        ADD COLUMN IF NOT EXISTS proof_type VARCHAR(50),
        ADD COLUMN IF NOT EXISTS label VARCHAR(255),
        ADD COLUMN IF NOT EXISTS notes TEXT;
    `
  },
  {
    version: 84,
    description: 'Add event social planning foundation tables',
    up: `
      CREATE TABLE IF NOT EXISTS event_attendees (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        display_name VARCHAR(255) NOT NULL,
        contact_label VARCHAR(255),
        relationship VARCHAR(100),
        status VARCHAR(30) NOT NULL DEFAULT 'attending'
          CHECK (status IN ('attending', 'maybe', 'not_attending', 'unknown')),
        visibility VARCHAR(30) NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'selected_people', 'group', 'event_workspace')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS event_groups (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        visibility VARCHAR(30) NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'selected_people', 'group', 'event_workspace')),
        status VARCHAR(30) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'archived')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS event_group_members (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES event_groups(id) ON DELETE CASCADE,
        attendee_id INTEGER NOT NULL REFERENCES event_attendees(id) ON DELETE CASCADE,
        role VARCHAR(100),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (group_id, attendee_id)
      );

      CREATE TABLE IF NOT EXISTS event_meetups (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES event_groups(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        location VARCHAR(255),
        status VARCHAR(30) NOT NULL DEFAULT 'planned'
          CHECK (status IN ('planned', 'tentative', 'cancelled', 'done')),
        visibility VARCHAR(30) NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'selected_people', 'group', 'event_workspace')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS event_schedule_plans (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        location VARCHAR(255),
        source_type VARCHAR(50),
        source_ref VARCHAR(255),
        status VARCHAR(30) NOT NULL DEFAULT 'planned'
          CHECK (status IN ('planned', 'maybe', 'backup', 'skipped', 'attended')),
        visibility VARCHAR(30) NOT NULL DEFAULT 'private'
          CHECK (visibility IN ('private', 'selected_people', 'group', 'event_workspace')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_attendees_event_active
        ON event_attendees(event_id, archived_at, display_name);
      CREATE INDEX IF NOT EXISTS idx_event_groups_event_active
        ON event_groups(event_id, archived_at, name);
      CREATE INDEX IF NOT EXISTS idx_event_group_members_group
        ON event_group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_event_group_members_attendee
        ON event_group_members(attendee_id);
      CREATE INDEX IF NOT EXISTS idx_event_meetups_event_time
        ON event_meetups(event_id, archived_at, start_at);
      CREATE INDEX IF NOT EXISTS idx_event_schedule_plans_event_time
        ON event_schedule_plans(event_id, archived_at, start_at);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_attendees_updated_at') THEN
          CREATE TRIGGER update_event_attendees_updated_at BEFORE UPDATE ON event_attendees
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_groups_updated_at') THEN
          CREATE TRIGGER update_event_groups_updated_at BEFORE UPDATE ON event_groups
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_meetups_updated_at') THEN
          CREATE TRIGGER update_event_meetups_updated_at BEFORE UPDATE ON event_meetups
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_schedule_plans_updated_at') THEN
          CREATE TRIGGER update_event_schedule_plans_updated_at BEFORE UPDATE ON event_schedule_plans
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 85,
    description: 'Add personal Sched ICS sources for event schedule plans',
    up: `
      CREATE TABLE IF NOT EXISTS event_personal_ics_sources (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL DEFAULT 'sched_ics',
        feed_url_encrypted TEXT NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'paused', 'error', 'archived')),
        sync_status VARCHAR(30) NOT NULL DEFAULT 'idle'
          CHECK (sync_status IN ('idle', 'running', 'succeeded', 'failed')),
        last_synced_at TIMESTAMP,
        last_success_at TIMESTAMP,
        last_error TEXT,
        last_item_count INTEGER NOT NULL DEFAULT 0,
        last_change_summary JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_personal_ics_sources_active_unique
        ON event_personal_ics_sources(event_id, user_id)
        WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_event_personal_ics_sources_event_user
        ON event_personal_ics_sources(event_id, user_id, archived_at);
      CREATE INDEX IF NOT EXISTS idx_event_schedule_plans_sched_ics_source
        ON event_schedule_plans(event_id, created_by, source_type, source_ref)
        WHERE source_type = 'sched_ics';

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_personal_ics_sources_updated_at') THEN
          CREATE TRIGGER update_event_personal_ics_sources_updated_at BEFORE UPDATE ON event_personal_ics_sources
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 86,
    description: 'Add richer personal ICS schedule detail fields',
    up: `
      ALTER TABLE event_schedule_plans
        ADD COLUMN IF NOT EXISTS source_url TEXT,
        ADD COLUMN IF NOT EXISTS source_categories TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS source_sequence INTEGER;

      CREATE INDEX IF NOT EXISTS idx_event_schedule_plans_source_categories
        ON event_schedule_plans USING GIN (source_categories);
    `
  },
  {
    version: 87,
    description: 'Add event social vendor booth and location notes',
    up: `
      ALTER TABLE event_meetups
        ADD COLUMN IF NOT EXISTS vendor VARCHAR(255),
        ADD COLUMN IF NOT EXISTS booth VARCHAR(100),
        ADD COLUMN IF NOT EXISTS location_notes TEXT;

      ALTER TABLE event_schedule_plans
        ADD COLUMN IF NOT EXISTS vendor VARCHAR(255),
        ADD COLUMN IF NOT EXISTS booth VARCHAR(100),
        ADD COLUMN IF NOT EXISTS location_notes TEXT;
    `
  },
  {
    version: 88,
    description: 'Add event schedule catalog sessions',
    up: `
      CREATE TABLE IF NOT EXISTS event_schedule_sessions (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        start_at TIMESTAMP,
        end_at TIMESTAMP,
        location VARCHAR(255),
        room VARCHAR(255),
        description TEXT,
        track VARCHAR(100),
        categories TEXT[] NOT NULL DEFAULT '{}',
        source_type VARCHAR(50),
        source_ref VARCHAR(255),
        source_url TEXT,
        source_updated_at TIMESTAMP,
        status VARCHAR(30) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'cancelled', 'hidden')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_schedule_sessions_event_time
        ON event_schedule_sessions(event_id, archived_at, start_at);
      CREATE INDEX IF NOT EXISTS idx_event_schedule_sessions_categories
        ON event_schedule_sessions USING GIN (categories);
      CREATE INDEX IF NOT EXISTS idx_event_schedule_sessions_source
        ON event_schedule_sessions(event_id, source_type, source_ref)
        WHERE source_type IS NOT NULL AND source_ref IS NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_schedule_sessions_updated_at') THEN
          CREATE TRIGGER update_event_schedule_sessions_updated_at BEFORE UPDATE ON event_schedule_sessions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 89,
    description: 'Link personal Sched plans to catalog sessions',
    up: `
      ALTER TABLE event_schedule_plans
        ADD COLUMN IF NOT EXISTS source_catalog_session_id INTEGER REFERENCES event_schedule_sessions(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_event_schedule_plans_catalog_session
        ON event_schedule_plans(event_id, source_catalog_session_id)
        WHERE source_catalog_session_id IS NOT NULL;

      UPDATE event_schedule_plans esp
         SET source_catalog_session_id = ess.id,
             updated_at = CURRENT_TIMESTAMP
        FROM event_schedule_sessions ess
       WHERE esp.event_id = ess.event_id
         AND esp.source_type = 'sched_ics'
         AND ess.source_type = 'sched_catalog_ics'
         AND esp.source_ref IS NOT NULL
         AND ess.source_ref IS NOT NULL
         AND esp.source_ref = ess.source_ref
         AND esp.archived_at IS NULL
         AND ess.archived_at IS NULL
         AND esp.source_catalog_session_id IS DISTINCT FROM ess.id;
    `
  },
  {
    version: 90,
    description: 'Add event schedule notification draft and send records',
    up: `
      CREATE TABLE IF NOT EXISTS event_schedule_notifications (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        schedule_plan_id INTEGER REFERENCES event_schedule_plans(id) ON DELETE SET NULL,
        catalog_session_id INTEGER REFERENCES event_schedule_sessions(id) ON DELETE SET NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'sent', 'archived')),
        requested_status VARCHAR(30) NOT NULL
          CHECK (requested_status IN ('planned', 'maybe', 'backup', 'skipped', 'attended')),
        requested_visibility VARCHAR(30) NOT NULL
          CHECK (requested_visibility IN ('private', 'selected_people', 'group', 'event_workspace')),
        message_title VARCHAR(255) NOT NULL,
        message_body TEXT NOT NULL,
        subject_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        recipients_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        conflicts_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
        contract_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        delivery_channel VARCHAR(50) NOT NULL DEFAULT 'event_local'
          CHECK (delivery_channel IN ('event_local')),
        delivery_supported BOOLEAN NOT NULL DEFAULT FALSE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_schedule_notifications_event_created
        ON event_schedule_notifications(event_id, archived_at, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_event_schedule_notifications_plan
        ON event_schedule_notifications(event_id, schedule_plan_id)
        WHERE schedule_plan_id IS NOT NULL AND archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_event_schedule_notifications_catalog
        ON event_schedule_notifications(event_id, catalog_session_id)
        WHERE catalog_session_id IS NOT NULL AND archived_at IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_schedule_notifications_updated_at') THEN
          CREATE TRIGGER update_event_schedule_notifications_updated_at BEFORE UPDATE ON event_schedule_notifications
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 91,
    description: 'Add event schedule notification recipient readback',
    up: `
      CREATE TABLE IF NOT EXISTS event_schedule_notification_recipients (
        id SERIAL PRIMARY KEY,
        notification_id INTEGER NOT NULL REFERENCES event_schedule_notifications(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        recipient_type VARCHAR(30) NOT NULL CHECK (recipient_type IN ('attendee', 'group')),
        attendee_id INTEGER REFERENCES event_attendees(id) ON DELETE SET NULL,
        group_id INTEGER REFERENCES event_groups(id) ON DELETE SET NULL,
        recipient_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        read_status VARCHAR(30) NOT NULL DEFAULT 'unread'
          CHECK (read_status IN ('unread', 'read', 'acknowledged')),
        read_at TIMESTAMP,
        acknowledged_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP,
        CHECK (
          (recipient_type = 'attendee' AND attendee_id IS NOT NULL AND group_id IS NULL)
          OR (recipient_type = 'group' AND group_id IS NOT NULL AND attendee_id IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_schedule_notification_recipients_attendee_unique
        ON event_schedule_notification_recipients(notification_id, attendee_id)
        WHERE recipient_type = 'attendee' AND attendee_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_schedule_notification_recipients_group_unique
        ON event_schedule_notification_recipients(notification_id, group_id)
        WHERE recipient_type = 'group' AND group_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_event_schedule_notification_recipients_event_status
        ON event_schedule_notification_recipients(event_id, read_status, created_at DESC, id DESC)
        WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_event_schedule_notification_recipients_notification
        ON event_schedule_notification_recipients(notification_id)
        WHERE archived_at IS NULL;

      INSERT INTO event_schedule_notification_recipients (
        notification_id,
        event_id,
        recipient_type,
        attendee_id,
        recipient_snapshot,
        created_at,
        updated_at
      )
      SELECT
        n.id,
        n.event_id,
        'attendee',
        (attendee.value->>'id')::integer,
        attendee.value,
        COALESCE(n.sent_at, n.created_at, CURRENT_TIMESTAMP),
        COALESCE(n.updated_at, n.created_at, CURRENT_TIMESTAMP)
      FROM event_schedule_notifications n
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n.recipients_snapshot->'attendees', '[]'::jsonb)) attendee(value)
      WHERE n.archived_at IS NULL
        AND (attendee.value->>'id') ~ '^[0-9]+$'
      ON CONFLICT DO NOTHING;

      INSERT INTO event_schedule_notification_recipients (
        notification_id,
        event_id,
        recipient_type,
        group_id,
        recipient_snapshot,
        created_at,
        updated_at
      )
      SELECT
        n.id,
        n.event_id,
        'group',
        (recipient_group.value->>'id')::integer,
        recipient_group.value,
        COALESCE(n.sent_at, n.created_at, CURRENT_TIMESTAMP),
        COALESCE(n.updated_at, n.created_at, CURRENT_TIMESTAMP)
      FROM event_schedule_notifications n
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n.recipients_snapshot->'groups', '[]'::jsonb)) recipient_group(value)
      WHERE n.archived_at IS NULL
        AND (recipient_group.value->>'id') ~ '^[0-9]+$'
      ON CONFLICT DO NOTHING;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_schedule_notification_recipients_updated_at') THEN
          CREATE TRIGGER update_event_schedule_notification_recipients_updated_at BEFORE UPDATE ON event_schedule_notification_recipients
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 92,
    description: 'Add user-linked event attendee identity',
    up: `
      ALTER TABLE event_attendees
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendees_event_user_active
        ON event_attendees(event_id, user_id)
        WHERE user_id IS NOT NULL AND archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_event_attendees_user_active
        ON event_attendees(user_id, archived_at)
        WHERE user_id IS NOT NULL;
    `
  },
  {
    version: 93,
    description: 'Add event schedule notification delivery attempts',
    up: `
      CREATE TABLE IF NOT EXISTS event_schedule_notification_delivery_attempts (
        id SERIAL PRIMARY KEY,
        notification_id INTEGER NOT NULL REFERENCES event_schedule_notifications(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        recipient_id INTEGER NOT NULL REFERENCES event_schedule_notification_recipients(id) ON DELETE CASCADE,
        provider VARCHAR(50) NOT NULL DEFAULT 'event_local'
          CHECK (provider IN ('event_local', 'push', 'email', 'platform_device')),
        channel VARCHAR(50) NOT NULL DEFAULT 'event_local'
          CHECK (channel IN ('event_local', 'push', 'email', 'device')),
        status VARCHAR(30) NOT NULL DEFAULT 'succeeded'
          CHECK (status IN ('queued', 'sending', 'succeeded', 'failed', 'skipped', 'cancelled')),
        attempted_at TIMESTAMP,
        completed_at TIMESTAMP,
        retry_after TIMESTAMP,
        provider_message_id TEXT,
        error_code VARCHAR(120),
        error_message TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_schedule_notification_delivery_attempts_unique
        ON event_schedule_notification_delivery_attempts(notification_id, recipient_id, provider)
        WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_event_schedule_notification_delivery_attempts_event
        ON event_schedule_notification_delivery_attempts(event_id, status, created_at DESC, id DESC)
        WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_event_schedule_notification_delivery_attempts_notification
        ON event_schedule_notification_delivery_attempts(notification_id, created_at DESC, id DESC)
        WHERE archived_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_event_schedule_notification_delivery_attempts_recipient
        ON event_schedule_notification_delivery_attempts(recipient_id)
        WHERE archived_at IS NULL;

      INSERT INTO event_schedule_notification_delivery_attempts (
        notification_id,
        event_id,
        recipient_id,
        provider,
        channel,
        status,
        attempted_at,
        completed_at,
        metadata,
        created_at,
        updated_at
      )
      SELECT
        r.notification_id,
        r.event_id,
        r.id,
        'event_local',
        'event_local',
        'succeeded',
        COALESCE(n.sent_at, r.created_at, CURRENT_TIMESTAMP),
        COALESCE(n.sent_at, r.created_at, CURRENT_TIMESTAMP),
        jsonb_build_object('source', 'migration_93_event_local_backfill'),
        COALESCE(n.sent_at, r.created_at, CURRENT_TIMESTAMP),
        COALESCE(n.updated_at, r.updated_at, r.created_at, CURRENT_TIMESTAMP)
      FROM event_schedule_notification_recipients r
      JOIN event_schedule_notifications n
        ON n.id = r.notification_id
       AND n.archived_at IS NULL
       AND n.status = 'sent'
      WHERE r.archived_at IS NULL
      ON CONFLICT DO NOTHING;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_schedule_notification_delivery_attempts_updated_at') THEN
          CREATE TRIGGER update_event_schedule_notification_delivery_attempts_updated_at BEFORE UPDATE ON event_schedule_notification_delivery_attempts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 94,
    description: 'Add Kavita digital library integration settings',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS kavita_base_url TEXT,
        ADD COLUMN IF NOT EXISTS kavita_api_key_encrypted TEXT,
        ADD COLUMN IF NOT EXISTS kavita_timeout_ms INTEGER DEFAULT 20000;
    `
  },
  {
    version: 95,
    description: 'Add Art numbered print metadata',
    up: `
      ALTER TABLE art_items
        ADD COLUMN IF NOT EXISTS print_number INTEGER,
        ADD COLUMN IF NOT EXISTS print_run INTEGER;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'art_items_print_number_check'
            AND conrelid = 'art_items'::regclass
        ) THEN
          ALTER TABLE art_items
            ADD CONSTRAINT art_items_print_number_check
            CHECK (print_number IS NULL OR print_number > 0);
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'art_items_print_run_check'
            AND conrelid = 'art_items'::regclass
        ) THEN
          ALTER TABLE art_items
            ADD CONSTRAINT art_items_print_run_check
            CHECK (print_run IS NULL OR print_run > 0);
        END IF;
      END;
      $$;
    `
  },
  {
    version: 96,
    description: 'Add Plex now playing display token metadata',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_now_playing_display_token_hash TEXT,
        ADD COLUMN IF NOT EXISTS plex_now_playing_display_token_created_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS plex_now_playing_display_token_last_used_at TIMESTAMP;
    `
  },
  {
    version: 97,
    description: 'Add Plex now playing display preferences',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_now_playing_display_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
    `
  },
  {
    version: 98,
    description: 'Add Plex webhook receiver token metadata',
    up: `
      ALTER TABLE app_integrations
        ADD COLUMN IF NOT EXISTS plex_webhook_receiver_token_hash TEXT,
        ADD COLUMN IF NOT EXISTS plex_webhook_receiver_token_created_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS plex_webhook_receiver_token_last_rotated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS plex_webhook_receiver_last_received_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS plex_webhook_receiver_last_event TEXT;
    `
  },
  {
    version: 99,
    description: 'Normalize user ratings to 0-10 provider scale',
    up: `
      ALTER TABLE media
        ALTER COLUMN user_rating TYPE DECIMAL(3,1);

      UPDATE media
         SET user_rating = ROUND((user_rating * 2)::numeric, 1)
       WHERE user_rating IS NOT NULL
         AND user_rating >= 0
         AND user_rating <= 5;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'media_user_rating_scale_check'
            AND conrelid = 'media'::regclass
        ) THEN
          ALTER TABLE media
            ADD CONSTRAINT media_user_rating_scale_check
            CHECK (user_rating IS NULL OR (user_rating >= 0 AND user_rating <= 10));
        END IF;
      END;
      $$;
    `
  },
  {
    version: 100,
    description: 'Add Plex reconciliation conflict reviews',
    up: `
      CREATE TABLE IF NOT EXISTS plex_reconciliation_reviews (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(50) NOT NULL DEFAULT 'plex',
        source_key TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        resolution VARCHAR(50),
        reason TEXT,
        matched_by VARCHAR(100),
        item_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        existing_snapshot JSONB,
        source_item_snapshot JSONB,
        job_id INTEGER REFERENCES sync_jobs(id) ON DELETE SET NULL,
        existing_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        resolved_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        library_id INTEGER REFERENCES libraries(id) ON DELETE CASCADE,
        space_id INTEGER,
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_plex_reconciliation_reviews_source
        ON plex_reconciliation_reviews(provider, library_id, source_key);

      CREATE INDEX IF NOT EXISTS idx_plex_reconciliation_reviews_status_library
        ON plex_reconciliation_reviews(status, library_id, updated_at DESC);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_plex_reconciliation_reviews_updated_at') THEN
          CREATE TRIGGER update_plex_reconciliation_reviews_updated_at BEFORE UPDATE ON plex_reconciliation_reviews
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 101,
    description: 'Add reusable artist records for Art',
    up: `
      CREATE TABLE IF NOT EXISTS art_artist_records (
        id SERIAL PRIMARY KEY,
        library_id INTEGER REFERENCES libraries(id) ON DELETE CASCADE,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        normalized_name VARCHAR(255) NOT NULL,
        sort_name VARCHAR(255),
        aliases TEXT[] NOT NULL DEFAULT '{}',
        website_url TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      ALTER TABLE art_items
        ADD COLUMN IF NOT EXISTS artist_id INTEGER REFERENCES art_artist_records(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS artist_role VARCHAR(100);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_art_artist_records_library_name_active
        ON art_artist_records(library_id, normalized_name)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_art_artist_records_space_name
        ON art_artist_records(space_id, normalized_name)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_art_items_artist_id
        ON art_items(artist_id);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_art_artist_records_updated_at') THEN
          CREATE TRIGGER update_art_artist_records_updated_at BEFORE UPDATE ON art_artist_records
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 102,
    description: 'Repair Kavita chapter issue cover proxy paths',
    up: `
      WITH kavita_chapter_covers AS (
        SELECT
          id,
          '/api/media/kavita-chapter-cover/' || (type_details->>'kavita_chapter_id') AS chapter_cover_proxy
        FROM media
        WHERE type_details->>'provider_name' = 'kavita'
          AND type_details->>'provider_item_id' LIKE 'kavita:chapter:%'
          AND COALESCE(type_details->>'kavita_chapter_id', '') <> ''
          AND poster_path LIKE '/api/media/kavita-cover/%'
      )
      UPDATE media AS m
         SET poster_path = k.chapter_cover_proxy,
             type_details = jsonb_set(
               jsonb_set(
                 jsonb_set(
                   COALESCE(m.type_details, '{}'::jsonb),
                   '{kavita_cover_proxy_url}',
                   to_jsonb(k.chapter_cover_proxy),
                   true
                 ),
                 '{kavita_cover_source}',
                 to_jsonb('collectz_chapter_proxy'::text),
                 true
               ),
               '{kavita_cover_status}',
               to_jsonb('proxied_chapter_page_0'::text),
               true
             )
        FROM kavita_chapter_covers AS k
       WHERE m.id = k.id;
    `
  },
  {
    version: 103,
    description: 'Add scoped wishlist and acquisition tracking',
    up: `
      CREATE TABLE IF NOT EXISTS wanted_items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        object_type VARCHAR(30) NOT NULL DEFAULT 'movie' CHECK (object_type IN ('movie', 'tv_series', 'book', 'comic_book', 'audio', 'game', 'art', 'collectible', 'event_item', 'other')),
        status VARCHAR(20) NOT NULL DEFAULT 'wanted' CHECK (status IN ('wanted', 'watching', 'preordered', 'ordered', 'acquired', 'dismissed')),
        priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'grail')),
        year INTEGER,
        desired_format VARCHAR(100),
        desired_edition VARCHAR(255),
        notes TEXT,
        identifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        provider VARCHAR(80),
        provider_key TEXT,
        event_id INTEGER,
        vendor VARCHAR(255),
        target_price NUMERIC(12,2),
        linked_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        library_id INTEGER,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        acquired_at TIMESTAMP,
        dismissed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_wanted_items_library_status
        ON wanted_items(library_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_wanted_items_space_status
        ON wanted_items(space_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_wanted_items_provider_key
        ON wanted_items(provider, provider_key)
        WHERE provider IS NOT NULL AND provider_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_wanted_items_linked_media
        ON wanted_items(linked_media_id)
        WHERE linked_media_id IS NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_wanted_items_updated_at') THEN
          CREATE TRIGGER update_wanted_items_updated_at BEFORE UPDATE ON wanted_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 104,
    description: 'Add mobile capture inbox foundation',
    up: `
      CREATE TABLE IF NOT EXISTS capture_items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500),
        capture_type VARCHAR(30) NOT NULL DEFAULT 'manual_note' CHECK (capture_type IN ('barcode', 'photo', 'ocr_text', 'manual_note')),
        status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'converted', 'discarded')),
        object_type VARCHAR(30) NOT NULL DEFAULT 'other' CHECK (object_type IN ('movie', 'tv_series', 'book', 'comic_book', 'audio', 'game', 'art', 'collectible', 'event_item', 'other')),
        barcode TEXT,
        symbology VARCHAR(80),
        ocr_text TEXT,
        notes TEXT,
        image_path TEXT,
        source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        review_decision JSONB NOT NULL DEFAULT '{}'::jsonb,
        linked_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
        wanted_item_id INTEGER REFERENCES wanted_items(id) ON DELETE SET NULL,
        library_id INTEGER,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        converted_at TIMESTAMP,
        discarded_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_capture_items_library_status
        ON capture_items(library_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_capture_items_space_status
        ON capture_items(space_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_capture_items_barcode
        ON capture_items(barcode)
        WHERE barcode IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_capture_items_wanted_item
        ON capture_items(wanted_item_id)
        WHERE wanted_item_id IS NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_capture_items_updated_at') THEN
          CREATE TRIGGER update_capture_items_updated_at BEFORE UPDATE ON capture_items
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 105,
    description: 'Add wishlist price history snapshots',
    up: `
      CREATE TABLE IF NOT EXISTS wanted_item_price_history (
        id SERIAL PRIMARY KEY,
        wanted_item_id INTEGER NOT NULL REFERENCES wanted_items(id) ON DELETE CASCADE,
        provider VARCHAR(100) NOT NULL,
        provider_key TEXT,
        price NUMERIC(12,2),
        currency VARCHAR(10),
        target_price NUMERIC(12,2),
        target_met BOOLEAN NOT NULL DEFAULT false,
        source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        library_id INTEGER,
        space_id INTEGER,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_wanted_item_price_history_item_checked
        ON wanted_item_price_history(wanted_item_id, checked_at DESC);

      CREATE INDEX IF NOT EXISTS idx_wanted_item_price_history_provider_key
        ON wanted_item_price_history(provider, provider_key, checked_at DESC)
        WHERE provider_key IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_wanted_item_price_history_scope_checked
        ON wanted_item_price_history(space_id, library_id, checked_at DESC);
    `
  },
  {
    version: 106,
    description: 'Add Dashboard Review decision tracking',
    up: `
      CREATE TABLE IF NOT EXISTS media_review_decisions (
        id SERIAL PRIMARY KEY,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        finding_type VARCHAR(40) NOT NULL CHECK (finding_type IN ('missing_covers', 'missing_identifiers', 'sparse_metadata')),
        action VARCHAR(20) NOT NULL CHECK (action IN ('deferred', 'dismissed')),
        media_updated_at TIMESTAMP,
        deferred_until TIMESTAMP,
        note TEXT,
        library_id INTEGER,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_media_review_decisions_media_finding_created
        ON media_review_decisions(media_id, finding_type, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_media_review_decisions_scope_finding_created
        ON media_review_decisions(space_id, library_id, finding_type, created_at DESC);
    `
  },
  {
    version: 107,
    description: 'Add reusable collectible trait persistence',
    up: `
      CREATE TABLE IF NOT EXISTS collectible_trait_records (
        id SERIAL PRIMARY KEY,
        owner_type VARCHAR(30) NOT NULL CHECK (owner_type IN ('media', 'art', 'collectible')),
        owner_id INTEGER NOT NULL,
        trait_key VARCHAR(80) NOT NULL,
        family VARCHAR(40) NOT NULL CHECK (family IN ('signed', 'numbered', 'certificate', 'event_acquired', 'edition_variant', 'graded', 'bundle', 'provenance')),
        label VARCHAR(120) NOT NULL,
        summary TEXT,
        tone VARCHAR(20) NOT NULL DEFAULT 'default' CHECK (tone IN ('default', 'brand', 'warning', 'danger', 'success')),
        details JSONB NOT NULL DEFAULT '[]'::jsonb,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        source VARCHAR(80) NOT NULL DEFAULT 'manual',
        source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
        library_id INTEGER,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_collectible_trait_records_owner_key_active
        ON collectible_trait_records(owner_type, owner_id, trait_key)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_collectible_trait_records_owner_active
        ON collectible_trait_records(owner_type, owner_id, updated_at DESC)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_collectible_trait_records_scope_family_active
        ON collectible_trait_records(space_id, library_id, family, updated_at DESC)
        WHERE archived_at IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collectible_trait_records_updated_at') THEN
          CREATE TRIGGER update_collectible_trait_records_updated_at BEFORE UPDATE ON collectible_trait_records
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 108,
    description: 'Add object relationship workflows',
    up: `
      CREATE TABLE IF NOT EXISTS object_relationships (
        id SERIAL PRIMARY KEY,
        source_type VARCHAR(30) NOT NULL CHECK (source_type IN ('media', 'art', 'collectible', 'event')),
        source_id INTEGER NOT NULL,
        target_type VARCHAR(30) NOT NULL CHECK (target_type IN ('media', 'art', 'collectible', 'event')),
        target_id INTEGER NOT NULL,
        relationship_type VARCHAR(40) NOT NULL CHECK (relationship_type IN ('part_of', 'includes', 'included_with', 'companion_to', 'purchased_with', 'event_acquired_with')),
        label VARCHAR(160),
        notes TEXT,
        library_id INTEGER,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_object_relationships_unique_active
        ON object_relationships(source_type, source_id, target_type, target_id, relationship_type)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_object_relationships_source_active
        ON object_relationships(source_type, source_id, updated_at DESC)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_object_relationships_target_active
        ON object_relationships(target_type, target_id, updated_at DESC)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_object_relationships_scope_active
        ON object_relationships(space_id, library_id, relationship_type, updated_at DESC)
        WHERE archived_at IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_object_relationships_updated_at') THEN
          CREATE TRIGGER update_object_relationships_updated_at BEFORE UPDATE ON object_relationships
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 109,
    description: 'Add event exclusive source cache',
    up: `
      CREATE TABLE IF NOT EXISTS event_exclusive_sources (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        provider VARCHAR(80) NOT NULL,
        provider_key TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_title VARCHAR(500) NOT NULL,
        source_updated_label VARCHAR(120),
        vendor VARCHAR(255),
        booth VARCHAR(120),
        status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'ignored', 'promoted')),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        promoted_wanted_item_id INTEGER REFERENCES wanted_items(id) ON DELETE SET NULL,
        promoted_collectible_id INTEGER REFERENCES collectibles(id) ON DELETE SET NULL,
        library_id INTEGER,
        space_id INTEGER,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        promoted_at TIMESTAMP,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_exclusive_sources_event_provider_active
        ON event_exclusive_sources(event_id, provider, provider_key)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_event_exclusive_sources_event_status_active
        ON event_exclusive_sources(event_id, status, updated_at DESC)
        WHERE archived_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_event_exclusive_sources_scope_active
        ON event_exclusive_sources(space_id, library_id, updated_at DESC)
        WHERE archived_at IS NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_exclusive_sources_updated_at') THEN
          CREATE TRIGGER update_event_exclusive_sources_updated_at BEFORE UPDATE ON event_exclusive_sources
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
      END;
      $$;
    `
  },
  {
    version: 110,
    description: 'Add saved library views',
    up: `
      CREATE TABLE IF NOT EXISTS saved_library_views (
        id SERIAL PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        object_type VARCHAR(40) NOT NULL DEFAULT 'library' CHECK (object_type IN ('library')),
        media_type VARCHAR(50) NOT NULL,
        snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        visibility VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (visibility IN ('private')),
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        space_id INTEGER,
        library_id INTEGER REFERENCES libraries(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_saved_library_views_owner_scope
        ON saved_library_views(owner_user_id, space_id, library_id, media_type, updated_at DESC);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_saved_library_views_updated_at') THEN
          CREATE TRIGGER update_saved_library_views_updated_at BEFORE UPDATE ON saved_library_views
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
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
