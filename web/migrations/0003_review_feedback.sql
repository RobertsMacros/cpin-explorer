-- Shared feedback is explicitly submitted; private saved reviews stay separate.
CREATE TABLE review_feedback (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  record_sha TEXT NOT NULL,
  vote TEXT CHECK(vote IN ('approve','disagree') OR vote IS NULL),
  reason TEXT NOT NULL DEFAULT 'other',
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
  mutation TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,record_id,record_sha)
);
CREATE INDEX review_feedback_record ON review_feedback(record_id,record_sha,vote);
CREATE TABLE review_feedback_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  record_sha TEXT NOT NULL,
  vote TEXT,
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE review_rechecks (
  record_id TEXT NOT NULL,
  record_sha TEXT NOT NULL,
  generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','completed')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(record_id,record_sha)
);
CREATE TABLE review_recheck_results (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  record_sha TEXT NOT NULL,
  generation INTEGER NOT NULL,
  plan_sha TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(record_id,record_sha,generation)
);
CREATE TABLE review_feedback_epoch (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO review_feedback_epoch(id,revision) VALUES(1,0);
