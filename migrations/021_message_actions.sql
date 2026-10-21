ALTER TABLE messages ADD COLUMN hidden_for bigint[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN recalled_at timestamptz;
