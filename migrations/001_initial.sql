CREATE TABLE users (
	id bigint GENERATED ALWAYS AS IDENTITY (START WITH 1000000000000000001) PRIMARY KEY,
	username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,24}$'),
	display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
	bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 160),
	password_hash text NOT NULL,
	role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
	token_hash text PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	csrf_token text NOT NULL,
	expires_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE invites (
	token_hash text PRIMARY KEY,
	created_by bigint NOT NULL REFERENCES users(id),
	max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
	uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
	expires_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE videos (
	id bigint GENERATED ALWAYS AS IDENTITY (START WITH 2000000000000000001) PRIMARY KEY,
	author_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2200),
	file_name text NOT NULL UNIQUE,
	cover_name text NOT NULL,
	width integer NOT NULL CHECK (width > 0),
	height integer NOT NULL CHECK (height > 0),
	duration double precision NOT NULL CHECK (duration > 0),
	bytes bigint NOT NULL CHECK (bytes > 0),
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX videos_feed ON videos(created_at DESC, id DESC);
CREATE INDEX videos_author ON videos(author_id, id DESC);

CREATE TABLE likes (
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	video_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY(user_id, video_id)
);
CREATE INDEX likes_video ON likes(video_id);

CREATE TABLE favorites (
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	video_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY(user_id, video_id)
);

CREATE TABLE follows (
	follower_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	following_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY(follower_id, following_id),
	CHECK (follower_id <> following_id)
);
CREATE INDEX follows_following ON follows(following_id);

CREATE TABLE comments (
	id bigint GENERATED ALWAYS AS IDENTITY (START WITH 3000000000000000001) PRIMARY KEY,
	video_id bigint NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
	author_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1500),
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_video ON comments(video_id, id DESC);
