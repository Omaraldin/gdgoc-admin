-- schema.sql
-- Complete, idempotent database schema.
-- Safe to re-apply on an existing database: all DDL uses IF NOT EXISTS guards.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Core tables: users, sessions, whitelist, chapters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chapters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    leader_id   UUID,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kayan_id    TEXT NOT NULL UNIQUE,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'chapter_leader' CHECK (role IN ('super_admin','chapter_leader','editor')),
    chapter_id  UUID REFERENCES chapters(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_chapter_leader'
    ) THEN
        ALTER TABLE chapters ADD CONSTRAINT fk_chapter_leader
            FOREIGN KEY (leader_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whitelist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_chapter_id    ON users(chapter_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_whitelist_email     ON whitelist(email)  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Chapter extended columns
-- ---------------------------------------------------------------------------

ALTER TABLE chapters ADD COLUMN IF NOT EXISTS smtp_password       TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS smtp_provider       TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS smtp_host           TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS smtp_port           INTEGER;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS smtp_username       TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS code                TEXT NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS since_year          INTEGER;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS leader_codename     TEXT NOT NULL DEFAULT '';

-- Backfill: set standard Gmail host/port for chapters that used App Password.
UPDATE chapters
SET smtp_host     = 'smtp.gmail.com',
    smtp_port     = 587,
    smtp_username = email
WHERE smtp_password IS NOT NULL
  AND smtp_provider = 'manual'
  AND smtp_host IS NULL;

-- ---------------------------------------------------------------------------
-- Certificate templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    owner_user_id       UUID NOT NULL REFERENCES users(id)     ON DELETE RESTRICT,
    owner_chapter_id    UUID NOT NULL REFERENCES chapters(id)  ON DELETE RESTRICT,
    visibility          TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
    status              TEXT NOT NULL DEFAULT 'draft'   CHECK (status IN ('draft','published','archived')),
    source_template_id  UUID REFERENCES templates(id) ON DELETE SET NULL,
    current_version_id  UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS template_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID    NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    scene       JSONB   NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (template_id, version)
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_current_version'
    ) THEN
        ALTER TABLE templates ADD CONSTRAINT fk_current_version
            FOREIGN KEY (current_version_id) REFERENCES template_versions(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS template_assets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    object_key   TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_owner_chapter       ON templates(owner_chapter_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_templates_public              ON templates(visibility, status)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_template_versions_tmpl        ON template_versions(template_id);
CREATE INDEX IF NOT EXISTS idx_template_assets_content_hash  ON template_assets(content_hash);

-- ---------------------------------------------------------------------------
-- Certificate issuance: batches, recipients
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS issuance_batches (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id           UUID NOT NULL REFERENCES chapters(id)          ON DELETE RESTRICT,
    template_id          UUID NOT NULL REFERENCES templates(id)         ON DELETE RESTRICT,
    template_version_id  UUID NOT NULL REFERENCES template_versions(id) ON DELETE RESTRICT,
    name                 TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processing','completed','cancelled','failed')),
    total_count          INTEGER NOT NULL DEFAULT 0,
    success_count        INTEGER NOT NULL DEFAULT 0,
    failed_count         INTEGER NOT NULL DEFAULT 0,
    send_mail            BOOLEAN NOT NULL DEFAULT false,
    is_printable         BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issuance_recipients (
    id                TEXT PRIMARY KEY,
    batch_id          UUID NOT NULL REFERENCES issuance_batches(id) ON DELETE CASCADE,
    email             TEXT NOT NULL,
    variables         JSONB NOT NULL DEFAULT '{}',
    scripts           JSONB NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','rendering','rendered','emailed','failed','revoked')),
    pdf_object_key    TEXT,
    png_object_key    TEXT,
    failure_reason    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_issuance_batches_chapter  ON issuance_batches(chapter_id);
CREATE INDEX IF NOT EXISTS idx_issuance_batches_status   ON issuance_batches(status);
CREATE INDEX IF NOT EXISTS idx_issuance_recipients_batch ON issuance_recipients(batch_id);
CREATE INDEX IF NOT EXISTS idx_issuance_recipients_email ON issuance_recipients(email);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID REFERENCES users(id)    ON DELETE SET NULL,
    chapter_id  UUID REFERENCES chapters(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor   ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_chapter ON audit_logs(chapter_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- Kayan OIDC identity & credentials
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kayan_identities (
    id         TEXT        PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    traits     JSONB       NOT NULL DEFAULT '{}',
    state      TEXT        NOT NULL DEFAULT 'active',
    verified   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS kayan_identities_user_id_idx    ON kayan_identities(user_id);
CREATE INDEX IF NOT EXISTS kayan_identities_deleted_at_idx ON kayan_identities(deleted_at)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS kayan_credentials (
    id          TEXT        PRIMARY KEY,
    identity_id TEXT        NOT NULL REFERENCES kayan_identities(id) ON DELETE CASCADE,
    type        TEXT        NOT NULL,
    identifier  TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT kayan_credentials_identifier_type_uq UNIQUE (identifier, type)
);

CREATE INDEX IF NOT EXISTS kayan_credentials_identity_id_idx ON kayan_credentials(identity_id);

-- ---------------------------------------------------------------------------
-- Mail templates & images
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mail_templates (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID        NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    subject    TEXT        NOT NULL,
    body       TEXT        NOT NULL,
    variables  JSONB       NOT NULL DEFAULT '[]',
    created_by UUID        NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_templates_chapter ON mail_templates(chapter_id);

CREATE TABLE IF NOT EXISTS mail_template_images (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id   UUID NOT NULL,
    object_key   TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_template_images_content_hash ON mail_template_images(content_hash);

-- ---------------------------------------------------------------------------
-- Dynamic images
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dynamic_images (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    owner_user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    owner_chapter_id UUID REFERENCES chapters(id)        ON DELETE SET NULL,
    scene            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dynamic_images_chapter ON dynamic_images(owner_chapter_id)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Font library
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fonts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_name  TEXT NOT NULL,
    object_key   TEXT NOT NULL UNIQUE,
    file_name    TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fonts_content_hash ON fonts(content_hash);
CREATE INDEX IF NOT EXISTS idx_fonts_family_name  ON fonts(family_name);
