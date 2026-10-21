ALTER TABLE users
	ADD COLUMN pride_flag text NOT NULL DEFAULT ''
		CHECK (pride_flag IN ('', 'rainbow', 'lesbian', 'gay', 'bisexual', 'pansexual', 'asexual', 'aromantic', 'demisexual', 'transgender', 'nonbinary', 'genderfluid', 'genderqueer', 'intersex')),
	ADD COLUMN user_badges text[] NOT NULL DEFAULT '{}'
		CHECK (user_badges <@ ARRAY['contributor', 'early_member', 'supporter']::text[] AND array_position(user_badges, NULL) IS NULL);
