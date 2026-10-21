ALTER TABLE users ADD COLUMN allow_downloads boolean NOT NULL DEFAULT true;
ALTER TABLE videos ADD COLUMN download_name text;
