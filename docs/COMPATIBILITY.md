# Current compatibility

Version 0.1.0 establishes an independently hostable server and persistent data. The original web client remains a moving compatibility target.

| Feature | Backend | Original client |
| --- | --- | --- |
| Guest For You feed | PostgreSQL-backed, cursor pagination | Original feed/player verified with local data |
| Local video playback and seeking | MP4 stream, HTTP ranges | Verified in the original player |
| Accounts and sessions | Scrypt passwords, hashed sessions, CSRF | Original username/password form, errors, local redirect, signed-in navigation, avatar dropdown, refresh persistence, and native logout confirmation verified |
| Registration | Closed, invite-only, open | Kittok registration fallback at `/account?register=1`; native signup is not integrated |
| Uploads | Authenticated, size/duration bounds, ffmpeg transcoding | Kittok account screen; original Upload link redirects there |
| Favorites | PostgreSQL `favorites`, read back as `collected`/`stats.collectCount` and the own-profile Favorites tab | Native save/unsave button verified, including after reload |
| Follows | PostgreSQL `follows`, read back as user/author `relation` | Native feed follow button verified, including after reload |
| Comments | PostgreSQL `comments`, read back by the comment list and `stats.commentCount` | Native comment list verified; native post button not yet browser-verified |
| Likes | Persistent Kittok API | Compatibility handler exists; native gesture not yet verified |
| Profile and item detail | Response adapters and authored data | Own profile opens from the native account dropdown and survives refresh; editing and remaining profile interactions need integration |
| User search | Local SQL lookup and response adapter | Needs browser acceptance checks |
| Video search, notifications, DMs, LIVE, shop, coins | Not implemented | Visible original controls do not imply working features |
| Moderation and admin panel | Operator CLI and admin debug routes only | Full administration UI remains to be built |

The client can emit nonfatal errors for unsupported service calls. Unknown APIs return HTTP 501 and are counted in `/_debug/unknown` for logged-in administrators. API success alone does not establish a working screen. Browser verification and database tests must be reported separately.

The original login choices and layout are retained. Google, Apple, Facebook, QR, phone/SMS, email codes, and password reset are not configured. Unconfigured external/QR providers remain visible with disabled accessibility state and an availability tooltip. Kittok authenticates local usernames and passwords only.

The server supplies the original client's `webapp.app-context.user` from the current database session, including its native `uid`, `secUid`, `uniqueId`, `nickName`, and `avatarUri` fields. Signed-in controls come from the original client. The native logout confirmation submits a CSRF-protected local Passport request. Session HTML and the bridge are never cached.

## Social request contracts

These are taken from the cached client bundle. The client sends every parameter in the query string, along with the session cookie and `X-CSRF-Token`.

| Client call | Parameters read | Response read by the client |
| --- | --- | --- |
| POST `/api/item/collect/` | `itemId`, `action` (1 save, 2 unsave) | `statusCode` (0 = ok; otherwise the client reverts its optimistic update). Kittok also returns `collected` and `collectCount` |
| GET `/api/user/collect/item_list/` | `secUid`, `cursor`, `count` | `itemList`, `cursor`, `hasMore`. Favorites are private: other users' tabs return an empty list |
| POST `/api/commit/follow/user/` and `/api/follow/` | `user_id`, `type`/`action_type` (1 follow, 0 unfollow) | `status_code`, integer `follow_status`: 0 none, 1 following, 2 mutual (4, requested, is unused) |
| GET `/api/user/detail/`, feed `author` | — | integer `relation`: 0 none, 1 following, 2 mutual, 6 follows you |
| POST `/api/comment/publish/` | `aweme_id`, `text`, `reply_id` (`0` for top level), `reply_to_reply_id`, `text_extra` | `status_code` and `comment`, in the same shape as `/api/comment/list/` items |

Replies are stored with their parent, but `/api/comment/list/reply/` is not implemented yet, so replies appear in the top-level list.

Next work: verify the remaining native social interactions, integrate profile editing and remaining profile/search interactions, then add moderation and operational features before inviting an untrusted public community.
