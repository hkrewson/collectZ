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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invites table
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

-- Media table
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

-- App-level display settings
CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    theme VARCHAR(20) DEFAULT 'system',
    density VARCHAR(20) DEFAULT 'comfortable',
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
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_active ON invites(used, revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

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

-- Seed singleton rows
INSERT INTO app_integrations (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Mark bootstrap migrations as applied since init.sql creates everything directly.
-- This prevents the migration runner from re-applying them on first startup.
INSERT INTO schema_migrations (version, description) VALUES
    (1, 'Initial schema from init.sql'),
    (2, 'Activity log extended filter index'),
    (3, 'Opaque cookie sessions table'),
    (4, 'Invite lifecycle fields for revocation and claim metadata')
ON CONFLICT (version) DO NOTHING;
