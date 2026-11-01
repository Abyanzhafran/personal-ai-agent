-- Skema baseline (versi 1). Empat tabel final: projects, repos, checks, findings.
-- Tabel baru dilarang (aturan kerja #7); state tambahan jadi file di runs/ atau cache/.
-- PRAGMA journal_mode=WAL dan foreign_keys=ON diatur di db/database.ts per koneksi,
-- karena PRAGMA foreign_keys tidak berlaku di dalam transaksi migrasi.
-- Waktu disimpan sebagai ISO-8601 UTC (TEXT).
-- Nilai di CHECK harus sama dengan konstanta di packages/shared/src/domain.ts (dijaga test).

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  -- huruf kecil, spasi menjadi '-'; nama folder contexts/projects/<slug>/. Dua nama dengan slug sama = bentrok.
  slug        TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS repos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('service', 'microfrontend', 'e2e')),
  name           TEXT NOT NULL,
  local_path     TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  spec_path      TEXT,
  spec_cmd       TEXT,
  -- Hanya tiga nilai tersimpan. "Sedang dipindai" adalah status in-memory, "tidak dipindai"
  -- diturunkan dari role e2e; keduanya tidak pernah ditulis ke kolom ini.
  profile_status TEXT NOT NULL DEFAULT 'not_scanned'
    CHECK (profile_status IN ('not_scanned', 'pending_review', 'approved')),
  -- Alasan pemindaian profil terakhir gagal; NULL bila tidak ada.
  profile_error  TEXT,
  last_fetch_at  TEXT,
  -- Repo yang sama boleh ada di project lain, tidak di project yang sama.
  UNIQUE (project_id, local_path),
  -- Profil ditulis ke contexts/projects/<slug>/<name>.md, jadi nama harus unik per project.
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS checks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  base_ref         TEXT NOT NULL,
  head_ref         TEXT NOT NULL,
  base_sha         TEXT,
  head_sha         TEXT,
  status           TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'clean', 'findings', 'failed', 'cancelled')),
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  summary_json     TEXT CHECK (summary_json IS NULL OR json_valid(summary_json)),
  -- Alasan status 'failed', mis. "origin/feature/old tidak ada".
  error            TEXT
);

CREATE TABLE IF NOT EXISTS findings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id         INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  endpoint         TEXT NOT NULL,
  -- NULL, file, dan line untuk finding tingkat provider (spec_stale).
  consumer_repo_id INTEGER REFERENCES repos(id) ON DELETE CASCADE,
  file             TEXT,
  line             INTEGER,
  kind             TEXT NOT NULL
    CHECK (kind IN ('removed', 'required_added', 'param_mismatch', 'type_changed', 'spec_stale')),
  severity         TEXT NOT NULL CHECK (severity IN ('break', 'warn', 'info')),
  detail           TEXT NOT NULL,
  confidence       TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  via_symbol       TEXT,
  snippet_json     TEXT CHECK (snippet_json IS NULL OR json_valid(snippet_json))
);

CREATE INDEX IF NOT EXISTS idx_checks_project_started ON checks(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_checks_provider ON checks(provider_repo_id);
CREATE INDEX IF NOT EXISTS idx_findings_check ON findings(check_id);
CREATE INDEX IF NOT EXISTS idx_findings_consumer ON findings(consumer_repo_id);
