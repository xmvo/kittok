ALTER TABLE users ADD COLUMN email text;
CREATE UNIQUE INDEX users_email ON users (lower(email)) WHERE email IS NOT NULL;
