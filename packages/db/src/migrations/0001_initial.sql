-- Migration: 0001_initial
-- Creates the full schema for ai-code-reviewer-bot.
-- Requires: PostgreSQL 16, pgcrypto extension for gen_random_uuid().

-- Enable pgcrypto for gen_random_uuid() (no-op if already enabled).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── installations ────────────────────────────────────────────────────────────
-- Root tenant table. Each row represents one GitHub App installation.
CREATE TABLE IF NOT EXISTS installations (
  id                  BIGINT      PRIMARY KEY,
  account_login       TEXT        NOT NULL,
  account_type        TEXT        NOT NULL,
  settings            JSONB       NOT NULL DEFAULT '{}',
  monthly_token_limit INTEGER     NOT NULL DEFAULT 500000,
  suspended_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── repositories ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repositories (
  id              BIGINT    PRIMARY KEY,
  installation_id BIGINT    NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  full_name       TEXT      NOT NULL,
  enabled         BOOLEAN   NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS repositories_installation_id_idx
  ON repositories (installation_id);

-- ─── review_runs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id   BIGINT      NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_number       INTEGER     NOT NULL,
  base_sha        TEXT        NOT NULL,
  head_sha        TEXT        NOT NULL,
  check_run_id    BIGINT,
  status          TEXT        NOT NULL DEFAULT 'queued',
  tokens_in       INTEGER     NOT NULL DEFAULT 0,
  tokens_out      INTEGER     NOT NULL DEFAULT 0,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_runs_repository_pr_idx
  ON review_runs (repository_id, pr_number);

-- ─── findings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS findings (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID    NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
  fingerprint       TEXT    NOT NULL,
  source            TEXT    NOT NULL,
  rule_or_category  TEXT    NOT NULL,
  severity          TEXT    NOT NULL,
  file              TEXT    NOT NULL,
  line              INTEGER,
  rationale         TEXT    NOT NULL,
  github_comment_id BIGINT
);

CREATE INDEX IF NOT EXISTS findings_run_id_idx
  ON findings (run_id);

CREATE INDEX IF NOT EXISTS findings_fingerprint_idx
  ON findings (fingerprint);

-- ─── feedback ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id   UUID  NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  kind         TEXT  NOT NULL,
  actor_login  TEXT  NOT NULL
);

-- ─── usage_periods ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_periods (
  installation_id BIGINT  NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  period          DATE    NOT NULL,
  tokens_total    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (installation_id, period)
);

CREATE INDEX IF NOT EXISTS usage_periods_installation_period_idx
  ON usage_periods (installation_id, period);

-- ─── Row-Level Security setup ─────────────────────────────────────────────────
-- RLS policies enforce tenant isolation. The application sets
-- app.current_installation_id via SET LOCAL inside each transaction before
-- querying tenant-scoped tables.
--
-- Enable RLS on all tenant-scoped tables.
ALTER TABLE repositories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback          ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_periods     ENABLE ROW LEVEL SECURITY;

-- Policies: allow access only to rows belonging to the current installation.
-- The app role must have SELECT/INSERT/UPDATE/DELETE but NOT BYPASSRLS.
CREATE POLICY repositories_tenant_isolation ON repositories
  USING (installation_id = current_setting('app.current_installation_id', true)::BIGINT);

CREATE POLICY review_runs_tenant_isolation ON review_runs
  USING (
    repository_id IN (
      SELECT id FROM repositories
      WHERE installation_id = current_setting('app.current_installation_id', true)::BIGINT
    )
  );

CREATE POLICY findings_tenant_isolation ON findings
  USING (
    run_id IN (
      SELECT rr.id FROM review_runs rr
      JOIN repositories r ON r.id = rr.repository_id
      WHERE r.installation_id = current_setting('app.current_installation_id', true)::BIGINT
    )
  );

CREATE POLICY feedback_tenant_isolation ON feedback
  USING (
    finding_id IN (
      SELECT f.id FROM findings f
      JOIN review_runs rr ON rr.id = f.run_id
      JOIN repositories r ON r.id = rr.repository_id
      WHERE r.installation_id = current_setting('app.current_installation_id', true)::BIGINT
    )
  );

CREATE POLICY usage_periods_tenant_isolation ON usage_periods
  USING (installation_id = current_setting('app.current_installation_id', true)::BIGINT);
