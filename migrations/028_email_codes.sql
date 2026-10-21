CREATE TABLE email_codes (
	email text NOT NULL,
	purpose text NOT NULL,
	code_hash text NOT NULL,
	attempts integer NOT NULL DEFAULT 0,
	sent_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	PRIMARY KEY (email, purpose)
);
