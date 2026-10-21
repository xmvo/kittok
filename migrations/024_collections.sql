CREATE TABLE collections (
	id bigint GENERATED ALWAYS AS IDENTITY (START WITH 7000000000000000001) PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
	public boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collections_user ON collections(user_id, id DESC);
CREATE TABLE collection_items (
	collection_id bigint NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
	user_id bigint NOT NULL,
	video_id bigint NOT NULL,
	added_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY(collection_id, video_id),
	FOREIGN KEY (user_id, video_id) REFERENCES favorites(user_id, video_id) ON DELETE CASCADE
);
CREATE INDEX collection_items_favorite ON collection_items(user_id, video_id);
