-- Optional greeting name, separate from authentication and approval.
CREATE TABLE account_profiles (user_id TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE, first_name TEXT NOT NULL);
