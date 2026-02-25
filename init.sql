-- collectZ database initialization
--
-- This file runs ONCE when the Postgres volume is first created.
-- It seeds the database schema tracked by db/migrations.js.
--
-- DO NOT add ad-hoc ALTER TABLE statements here — use a new migration instead.
-- DO NOT add seed users here. The first user to register becomes admin automatically
-- when the user table is empty. See docs/wiki/01-Configuration-and-Use.md.

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    active_space_id INTEGER,
    active_library_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invites table
CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) UNIQUE,
    token_hash VARCHAR(64),
    used BOOLEAN DEFAULT false,
    revoked BOOLEAN DEFAULT false,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at TIMESTAMP,
    space_id INTEGER,
    expires_at TIMESTAMP NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Media table
CREATE TABLE IF NOT EXISTS media (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    media_type VARCHAR(20) DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv_series', 'tv_episode', 'other')),
    original_title VARCHAR(500),
    release_date DATE,
    year INTEGER,
    format VARCHAR(50) CHECK (format IN ('VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD')),
    genre VARCHAR(100),
    director VARCHAR(255),
    rating DECIMAL(3,1),
    user_rating DECIMAL(2,1),
    tmdb_id INTEGER,
    tmdb_media_type VARCHAR(20),
    tmdb_url TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    overview TEXT,
    trailer_url TEXT,
    runtime INTEGER,
    upc VARCHAR(50),
    location VARCHAR(255),
    notes TEXT,
    season_number INTEGER,
    episode_number INTEGER,
    episode_title VARCHAR(500),
    network VARCHAR(255),
    series_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    space_id INTEGER,
    library_id INTEGER,
    import_source VARCHAR(50) DEFAULT 'manual',
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Media metadata table
CREATE TABLE IF NOT EXISTS media_metadata (
    id SERIAL PRIMARY KEY,
    media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Media variants (edition / file-level details, primarily from Plex)
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

-- Activity log
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

-- Opaque cookie sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

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

-- Per-user integration settings (reserved for future per-user overrides)
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

-- App-level integration settings (admin-managed)
CREATE TABLE IF NOT EXISTS app_integrations (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    space_id INTEGER,
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

-- App-level display settings
CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    theme VARCHAR(20) DEFAULT 'system',
    density VARCHAR(20) DEFAULT 'comfortable',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Future library scaffolding (1.9 prep, activated in 2.0)
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

CREATE TABLE IF NOT EXISTS library_memberships (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, library_id)
);

CREATE TABLE IF NOT EXISTS feature_flags (
    key VARCHAR(100) PRIMARY KEY,
    enabled BOOLEAN DEFAULT false,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Async sync jobs (long-running imports)
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

-- Migration tracking (used by db/migrations.js)
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_media_title ON media(title);
CREATE INDEX IF NOT EXISTS idx_media_format ON media(format);
CREATE INDEX IF NOT EXISTS idx_media_year ON media(year);
CREATE INDEX IF NOT EXISTS idx_media_tmdb_id ON media(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_media_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_media_library_id ON media(library_id);
CREATE INDEX IF NOT EXISTS idx_media_space_id ON media(space_id);
CREATE INDEX IF NOT EXISTS idx_media_format_year ON media(format, year);
CREATE INDEX IF NOT EXISTS idx_media_genre_year ON media(genre, year);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_metadata_media_id_key ON media_metadata(media_id, "key");
CREATE INDEX IF NOT EXISTS idx_media_variants_media_id ON media_variants(media_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_variants_plex_part ON media_variants (source, source_part_id) WHERE source = 'plex' AND source_part_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_variants_plex_item ON media_variants (source, source_item_key) WHERE source = 'plex' AND source_item_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token_hash ON invites(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invites_active ON invites(used, revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_app_integrations_space_id ON app_integrations(space_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active ON password_reset_tokens(used, revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_libraries_name ON libraries(name);
CREATE INDEX IF NOT EXISTS idx_library_memberships_user_id ON library_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_library_memberships_library_id ON library_memberships(library_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_created_at ON sync_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_by_created_at ON sync_jobs(created_by, created_at DESC);

-- Text search performance indexes for director/genre filters
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_media_director_trgm ON media USING GIN (lower(COALESCE(director, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_media_genre_trgm ON media USING GIN (lower(COALESCE(genre, '')) gin_trgm_ops);

-- Updated-at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers
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
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_sync_jobs_updated_at') THEN
        CREATE TRIGGER update_sync_jobs_updated_at BEFORE UPDATE ON sync_jobs
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_feature_flags_updated_at') THEN
        CREATE TRIGGER update_feature_flags_updated_at BEFORE UPDATE ON feature_flags
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END;
$$;

-- Seed singleton rows
INSERT INTO app_integrations (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO feature_flags (key, enabled, description) VALUES
    ('import_plex_enabled', true, 'Allow Plex imports from the Import page and API'),
    ('import_csv_enabled', true, 'Allow CSV imports (generic and Delicious)'),
    ('tmdb_search_enabled', true, 'Allow TMDB search and details lookups'),
    ('lookup_upc_enabled', true, 'Allow barcode/UPC lookup API usage'),
    ('recognize_cover_enabled', true, 'Allow vision/OCR cover recognition API usage')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description;

-- Mark bootstrap migrations as applied since init.sql creates everything directly.
-- This prevents the migration runner from re-applying them on first startup.
INSERT INTO schema_migrations (version, description) VALUES
    (1, 'Initial schema from init.sql'),
    (2, 'Activity log extended filter index'),
    (3, 'Opaque cookie sessions table'),
    (4, 'Invite lifecycle fields for revocation and claim metadata'),
    (5, 'Plex integration settings fields'),
    (6, 'Media variants table for edition and file-level metadata'),
    (7, 'Media import_source traceability field'),
    (8, 'Media type and multi-library scaffolding'),
    (9, 'Scope scaffolding on app integrations'),
    (10, 'Async sync job tracking for long-running imports'),
    (11, 'Metadata uniqueness and filter performance indexes'),
    (12, 'Feature flag metadata and defaults'),
    (13, 'Hash invite tokens at rest and remove plaintext storage'),
    (14, 'Password reset tokens table for admin-initiated one-time resets'),
    (15, 'Server-authoritative scope state and library memberships'),
    (16, 'Library backfill and active library defaults for 2.0')
ON CONFLICT (version) DO NOTHING;
