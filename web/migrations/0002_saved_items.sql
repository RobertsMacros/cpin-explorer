CREATE TABLE saved_items (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('highlights','pins','reviews')),
  id TEXT NOT NULL, value TEXT, revision INTEGER NOT NULL CHECK(revision > 0),
  bytes INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,kind,id)
);
CREATE TABLE approval_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id),
  owner_id TEXT NOT NULL REFERENCES "user"(id), approved INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE password_requests (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL
);
CREATE TABLE account_limits (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL);
