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
    media_type VARCHAR(20) DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'comic_book')),
    original_title VARCHAR(500),
    release_date DATE,
    year INTEGER,
    format VARCHAR(50) CHECK (format IN ('VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD', 'Paperback', 'Hardcover', 'Trade')),
    genre VARCHAR(100),
    director VARCHAR(255),
    cast_members VARCHAR(1000),
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
    signed_by VARCHAR(255),
    signed_role VARCHAR(20) CHECK (signed_role IN ('author', 'producer', 'cast')),
    signed_on DATE,
    signed_at VARCHAR(255),
    signed_proof_path TEXT,
    location VARCHAR(255),
    notes TEXT,
    season_number INTEGER,
    episode_number INTEGER,
    episode_title VARCHAR(500),
    network VARCHAR(255),
    type_details JSONB,
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
    books_preset VARCHAR(100) DEFAULT 'googlebooks',
    books_provider VARCHAR(100),
    books_api_url TEXT,
    books_api_key_encrypted TEXT,
    books_api_key_header VARCHAR(100),
    books_api_key_query_param VARCHAR(100),
    audio_preset VARCHAR(100) DEFAULT 'theaudiodb',
    audio_provider VARCHAR(100),
    audio_api_url TEXT,
    audio_api_key_encrypted TEXT,
    audio_api_key_header VARCHAR(100),
    audio_api_key_query_param VARCHAR(100),
    games_preset VARCHAR(100) DEFAULT 'igdb',
    games_provider VARCHAR(100),
    games_api_url TEXT,
    games_api_key_encrypted TEXT,
    games_api_key_header VARCHAR(100),
    games_api_key_query_param VARCHAR(100),
    games_client_id VARCHAR(255),
    games_client_secret_encrypted TEXT,
    comics_preset VARCHAR(100) DEFAULT 'metron',
    comics_provider VARCHAR(100),
    comics_api_url TEXT,
    comics_api_key_encrypted TEXT,
    comics_api_key_header VARCHAR(100),
    comics_api_key_query_param VARCHAR(100),
    comics_username VARCHAR(255),
    cwa_opds_url TEXT,
    cwa_base_url TEXT,
    cwa_username VARCHAR(255),
    cwa_password_encrypted TEXT,
    cwa_timeout_ms INTEGER DEFAULT 20000,
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

-- Future library scaffolding (1.9 prep, activated in 2.0)
CREATE TABLE IF NOT EXISTS libraries (
    id SERIAL PRIMARY KEY,
    space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

-- Import review queue and collection scaffolding
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
    collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
    space_id INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Events and event artifacts
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

-- Collectibles taxonomy
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

-- Collectibles
CREATE TABLE IF NOT EXISTS collectibles (
    id SERIAL PRIMARY KEY,
    library_id INTEGER REFERENCES libraries(id) ON DELETE SET NULL,
    space_id INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    item_type VARCHAR(20) NOT NULL DEFAULT 'collectible'
      CHECK (item_type IN ('collectible', 'art', 'card')),
    subtype VARCHAR(20)
      CHECK (subtype IN ('collectible', 'art', 'card')),
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
    category_key VARCHAR(64) REFERENCES collectible_categories(key) ON UPDATE CASCADE ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS idx_media_upc ON media(upc);
CREATE INDEX IF NOT EXISTS idx_media_type_details_isbn ON media ((type_details->>'isbn')) WHERE type_details ? 'isbn';
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_metadata_media_id_key ON media_metadata(media_id, "key");
CREATE INDEX IF NOT EXISTS idx_media_metadata_key_value ON media_metadata("key", "value");
CREATE INDEX IF NOT EXISTS idx_media_metadata_isbn_value ON media_metadata("value") WHERE "key" = 'isbn';
CREATE INDEX IF NOT EXISTS idx_media_metadata_ean_value ON media_metadata("value") WHERE "key" IN ('ean', 'ean_upc', 'upc');
CREATE INDEX IF NOT EXISTS idx_media_metadata_asin_value ON media_metadata("value") WHERE "key" = 'amazon_item_id';
CREATE INDEX IF NOT EXISTS idx_media_genres_genre_id ON media_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_media_directors_director_id ON media_directors(director_id);
CREATE INDEX IF NOT EXISTS idx_genres_name ON genres(name);
CREATE INDEX IF NOT EXISTS idx_directors_name ON directors(name);
CREATE INDEX IF NOT EXISTS idx_media_actors_actor_id ON media_actors(actor_id);
CREATE INDEX IF NOT EXISTS idx_actors_name ON actors(name);
CREATE INDEX IF NOT EXISTS idx_media_variants_media_id ON media_variants(media_id);
CREATE INDEX IF NOT EXISTS idx_media_seasons_media_id_season ON media_seasons(media_id, season_number);
CREATE INDEX IF NOT EXISTS idx_media_seasons_media_id_watch_state ON media_seasons(media_id, watch_state);
CREATE INDEX IF NOT EXISTS idx_media_seasons_watchlist ON media_seasons(watchlist);
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
CREATE INDEX IF NOT EXISTS idx_spaces_slug_active ON spaces (lower(slug)) WHERE slug IS NOT NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_spaces_created_by ON spaces(created_by);
CREATE INDEX IF NOT EXISTS idx_space_memberships_space_id ON space_memberships(space_id);
CREATE INDEX IF NOT EXISTS idx_space_memberships_user_id ON space_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_library_memberships_user_id ON library_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_library_memberships_library_id ON library_memberships(library_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_created_at ON sync_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_by_created_at ON sync_jobs(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_library_created_at ON collections(library_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection_position ON collection_items(collection_id, position);
CREATE INDEX IF NOT EXISTS idx_collection_items_media_id ON collection_items(media_id);
CREATE INDEX IF NOT EXISTS idx_import_match_reviews_pending_scope ON import_match_reviews(status, library_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_match_reviews_job ON import_match_reviews(job_id);
CREATE INDEX IF NOT EXISTS idx_import_match_reviews_created_by ON import_match_reviews(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_match_reviews_collection_id ON import_match_reviews(collection_id);
CREATE INDEX IF NOT EXISTS idx_events_library_date_start ON events(library_id, date_start DESC);
CREATE INDEX IF NOT EXISTS idx_events_created_by_created_at ON events(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_artifacts_event_created_at ON event_artifacts(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collectibles_library_created_at ON collectibles(library_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collectibles_event_id ON collectibles(event_id);
CREATE INDEX IF NOT EXISTS idx_collectibles_category ON collectibles(category);
CREATE INDEX IF NOT EXISTS idx_collectibles_vendor ON collectibles(booth_or_vendor);
CREATE INDEX IF NOT EXISTS idx_collectibles_exclusive ON collectibles(exclusive);
CREATE INDEX IF NOT EXISTS idx_collectibles_library_subtype_category ON collectibles(library_id, subtype, category_key);
CREATE INDEX IF NOT EXISTS idx_collectibles_event_id_v2 ON collectibles(event_id);
CREATE INDEX IF NOT EXISTS idx_collectibles_exclusive_created ON collectibles(exclusive, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_user_id ON personal_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_active ON personal_access_tokens(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_service_account_keys_owner_user_id ON service_account_keys(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_service_account_keys_active ON service_account_keys(owner_user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_media_library_type_title ON media(library_id, media_type, title);
CREATE INDEX IF NOT EXISTS idx_media_library_type_year ON media(library_id, media_type, year);
CREATE INDEX IF NOT EXISTS idx_media_library_type_created_at ON media(library_id, media_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_title_normalized_sort
  ON media ((regexp_replace(lower(coalesce(title, '')), '^(the|an|a)\s+', '', 'i')));
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
CREATE INDEX IF NOT EXISTS idx_media_type_details_gin ON media USING GIN (type_details);

-- Text search performance indexes for director/genre filters
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_media_director_trgm ON media USING GIN (lower(COALESCE(director, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_media_genre_trgm ON media USING GIN (lower(COALESCE(genre, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_media_cast_trgm ON media USING GIN (lower(COALESCE(cast_members, '')) gin_trgm_ops);

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
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_seasons_updated_at') THEN
        CREATE TRIGGER update_media_seasons_updated_at BEFORE UPDATE ON media_seasons
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
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_events_updated_at') THEN
        CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_event_artifacts_updated_at') THEN
        CREATE TRIGGER update_event_artifacts_updated_at BEFORE UPDATE ON event_artifacts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collectibles_updated_at') THEN
        CREATE TRIGGER update_collectibles_updated_at BEFORE UPDATE ON collectibles
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_spaces_updated_at') THEN
        CREATE TRIGGER update_spaces_updated_at BEFORE UPDATE ON spaces
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_space_memberships_updated_at') THEN
        CREATE TRIGGER update_space_memberships_updated_at BEFORE UPDATE ON space_memberships
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_personal_access_tokens_updated_at') THEN
        CREATE TRIGGER update_personal_access_tokens_updated_at BEFORE UPDATE ON personal_access_tokens
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_service_account_keys_updated_at') THEN
        CREATE TRIGGER update_service_account_keys_updated_at BEFORE UPDATE ON service_account_keys
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
    ('recognize_cover_enabled', true, 'Allow vision/OCR cover recognition API usage'),
    ('metadata_normalized_read_enabled', true, 'Use normalized metadata relations (genres/directors/actors) as primary read path for metadata search/filter'),
    ('events_enabled', false, 'Enable Events library UI and API'),
    ('collectibles_enabled', false, 'Enable Collectibles library UI and API')
ON CONFLICT (key) DO UPDATE
SET enabled = EXCLUDED.enabled,
    description = EXCLUDED.description;

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
    (16, 'Library backfill and active library defaults for 2.0'),
    (17, 'Expand media type constraint for mixed media baseline'),
    (18, 'Mixed media field consistency constraints and browse indexes'),
    (19, 'Add media type_details JSONB payload for type-specific metadata'),
    (20, 'Expand media format check for book formats'),
    (21, 'Add books/audio/games integration settings'),
    (22, 'Add encrypted games client secret for IGDB auth'),
    (23, 'Identifier-first import lookup indexes'),
    (24, 'Rename media_type other to comic_book'),
    (25, 'Add signed metadata fields for media entries'),
    (26, 'Add comics integration settings'),
    (27, 'Add signed proof image path for media entries'),
    (28, 'Normalize media genre/director metadata tables'),
    (29, 'Normalize media actor metadata tables'),
    (30, 'Add metadata normalized read feature flag'),
    (31, 'Add import match review queue and collection scaffolding'),
    (32, 'Link import reviews to collections context'),
    (33, 'Enable normalized metadata read flag by default'),
    (34, 'Add media seasons table for TV watch-state foundation'),
    (35, 'Add events and event artifacts tables'),
    (36, 'Add collectibles table and taxonomy fields'),
    (37, 'Add canonical collectibles taxonomy table and subtype/category_key columns'),
    (38, 'Add feature flags for Events and Collectibles library surfaces'),
    (39, 'Add Calibre Web Automated OPDS integration settings'),
    (40, 'Add personal access tokens for non-browser API authentication'),
    (41, 'Add service account keys for machine-to-machine API authentication'),
    (42, 'Activate first-class spaces and backfill default space memberships')
ON CONFLICT (version) DO NOTHING;
