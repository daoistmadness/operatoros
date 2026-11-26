CREATE TABLE staff_ptk_administration (
  staff_member_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_members(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  context_id TEXT NOT NULL,
  preparation TEXT NOT NULL CHECK (json_valid(preparation)),
  prior_contexts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prior_contexts))
);

CREATE TABLE staff_ptk_documents (
  id TEXT PRIMARY KEY NOT NULL,
  staff_member_id TEXT NOT NULL REFERENCES staff_ptk_administration(staff_member_id) ON DELETE RESTRICT,
  slot TEXT NOT NULL,
  context_id TEXT NOT NULL,
  label TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 5000000),
  uploaded_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  UNIQUE (staff_member_id, context_id, slot, version)
);
