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
| Comments | PostgreSQL `comments`, read back by the comment list and `stats.commentCount` | Native comment list and Post button verified |
| Comment replies and likes | One-level threads in `comments.parent_id`; likes in `comment_likes` | Native "View N replies", reply paging, and comment heart verified |
| Comment delete | Comment author, video owner, or admin; deleting a top-level comment removes its replies | Native "..." menu and confirmation verified. The client does not lower the video's comment count until reload |
| Follower, following, friend, and suggested lists | `follows`, with per-user stats and `relation` | Native profile Following/Suggested popup and sidebar "Following accounts" verified |
| Profile editing | Name, bio, and avatar in `users`; avatars re-encoded by ffmpeg to 200×200 JPEG without metadata; username changes through the Passport adapter | Native Edit profile dialog verified: photo crop and upload, name, bio, username availability, and username change |
| Notifications | Derived from likes, comment likes, comments, replies, and follows; one read marker per user (`users.notices_read_at`) | Native inbox verified: unread badge, All activity list with wording and thumbnails, Follow back, and mark-read on open |
| View counts | `videos.view_count`, reported by the Kittok bridge when a video actually starts playing; one view per viewer per video every 6 hours | Verified: the playing video counts, preloaded videos do not, reloads do not double-count, and the profile grid shows the count |
| Share sheet following list | Your followings from `follows` | Verified: the client's retry loop (about 2 requests per second) stopped |
| Likes | PostgreSQL `likes`, read back as `digged`/`stats.diggCount` | Native like/unlike verified, including after reload |
| Profile and item detail | Response adapters and authored data | Own profile opens from the native account dropdown and survives refresh; editing and remaining profile interactions need integration |
| User and video search | Usernames and display names; video captions, newest first | Native Top, Users, and Videos tabs verified. Photos and LIVE return empty results |
| Video search, notifications, DMs, LIVE, shop, coins | Not implemented | Visible original controls do not imply working features |
| Admin panel | `/admin` inside the original client: overview, users (suspend, role, delete), videos, comments, invites, and an audit log in `admin_actions` | Verified in the browser: sidebar Admin entry, every action, hash navigation, Back, and leaving through the sidebar. There are no user reports yet |

The client can emit nonfatal errors for unsupported service calls. Unknown APIs return HTTP 501 and are counted in `/_debug/unknown` for logged-in administrators. API success alone does not establish a working screen. Browser verification and database tests must be reported separately.

The original login choices and layout are retained. Google, Apple, Facebook, QR, phone/SMS, email codes, and password reset are not configured. Unconfigured external/QR providers remain visible with disabled accessibility state and an availability tooltip. Kittok authenticates local usernames and passwords only.

The server supplies the original client's `webapp.app-context.user` from the current database session, including its native `uid`, `secUid`, `uniqueId`, `nickName`, and `avatarUri` fields. Signed-in controls come from the original client. The native logout confirmation submits a CSRF-protected local Passport request. Session HTML and the bridge are never cached.

## Social request contracts

These are taken from the cached client bundle. The client sends every parameter in the query string, along with the session cookie and `X-CSRF-Token`.

| Client call | Parameters read | Response read by the client |
| --- | --- | --- |
| POST `/api/commit/item/digg/` | `aweme_id`, `type` (1 like, 0 unlike) | `status_code` and `is_digg`. The client treats `is_digg` equal to `type` as a failure and reverts after 3 seconds, so success returns the opposite value. The client sends likes immediately but delays unlikes by about 10 seconds, and sends nothing if the user toggles back within that time |
| POST `/api/item/collect/` | `itemId`, `action` (1 save, 2 unsave) | `statusCode` (0 = ok; otherwise the client reverts its optimistic update). Kittok also returns `collected` and `collectCount` |
| GET `/api/user/collect/item_list/` and `/api/favorite/item_list/` | `secUid`, `cursor`, `count` | `itemList`, `cursor`, `hasMore`. The Favorites and Liked tabs are private: other users' tabs return an empty list |
| GET `/api/user/collection_list/` | `secUid`, `cursor`, `count` | `collectionList`, `cursor`, `hasMore`. Named collections are not implemented, so the list is always empty |
| GET `/api/user/list/` | `scene` (21 following, 67 followers, 150 friends, 151 suggested), optional `secUid`, `minCursor` (0 first), `count` | `userList[{user, stats, statsV2}]`, `minCursor` (next offset), `hasMore`, `total`. Without `secUid` the lists are the viewer's own |
| GET `/api/im/spotlight/relation` | `max_time` (0 first), `count` | `status_code`, `followings[]` (`uid`, `sec_uid`, `unique_id`, `nickname`, `avatar_thumb`, `follow_status`, `follower_status`), `min_time` (next offset), `has_more` (1/0). On any failure the client retries continuously |
| POST `/api/comment/delete/` | `cid` | `status_code`. Not found and not allowed both return 404 |
| POST `/api/upload/image/` | multipart `file`, `source` | `status_code`, `data.uri` (sent back as `avatar_uri`), `data.url_list[0]` for the preview. Images over 5 MB or 4096 px, and anything other than PNG, JPEG, or WebP, are rejected |
| POST `/api/update/profile/` | form `nickname`, `signature`, `avatar_uri`, `tt_csrf_token` (each only when changed) | `status_code` (2550 = invalid name, shown under the field) and `user`. The profile page reloads 3 seconds after a successful save. The client's 7-day name and 30-day username limits are its own warnings; Kittok does not enforce them |
| GET `/api/uniqueid/check/` | `unique_id` | `status_code`, `is_valid`. Kittok usernames are 3–24 lowercase letters, digits, or underscores, so names with periods show as unavailable |
| POST `/passport/web/login_name/update/` | form `login_name` | Passport envelope: `message: "success"`, or `message: "error"` with `data.error_code` 1024 (taken) or 1027 (invalid) |

| GET `/api/inbox/notice_count/` | — | `status_code`, `notice_count[{group, count}]` unread counts. Groups: 500 all, 3 and 505 likes (the client uses one or the other depending on an A/B flag), 2 comments, 6 mentions, 7 followers, 661 system |
| GET `/api/notice/multi/` and `/api/inbox/notice_list/` | `group_list` JSON `[{group, count, max_time, min_time, is_mark_read}]` | `notice_lists[0]`: `notice_list`, `has_more`, `max_time`, `min_time`. `max_time` 0 and `min_time` 0 returns the newest page; `max_time` above 0 loads items older than `min_time`; `max_time` 0 with `min_time` set fetches newer items. `is_mark_read: 1`, sent whenever the inbox opens, marks everything read |

Notices use type 41 for likes (`digg.digg_type` 1 for a video, 3 for a comment), 31 for comments (`comment.comment_type` 1 for a comment, 2 for a reply to your comment, with `reply_comment.user`), and 33 for follows (`follow.follow_button_type` 0 when mutual). `create_time` must be whole seconds because the client sorts with `BigInt`. Mentions are not stored, so that tab is always empty. Each like is its own notice; likes on the same video are not merged.

| GET `/api/search/item/full/` | `keyword`, `cursor` (0 first), `count` (12) | `item_list` of item structs, `cursor` (last video id), `has_more` |
| GET `/api/search/general/full/` | `keyword`, `cursor`, `count` | `data[]`: `{type: 4, user_list}` once on the first page, then `{type: 1, item}` per video; `cursor`, `has_more` |
| GET `/api/search/user/full/` | `keyword` | `user_list[{user_info}]` with snake_case stats (`follower_count`, `following_count`, `aweme_count`, `total_favorited`) and the viewer's `follow_status` |

The client has no `/admin` route, so `/admin` serves the original client with an inline script that renames the URL to `/@.kittok-admin` before the client starts (a profile no account can have, which renders the normal layout). `public/admin.js` then restores `/admin`, hides the client's content in `main`, and mounts the panel there using the client's TUX button classes and `--tux-*` colour tokens. Section changes use `#hash` with `history.replaceState`, and the inline script stops `popstate`/`hashchange` on `/admin` from reaching the client router, which would otherwise redirect to its server-side 404. Admins see an extra Admin item in the sidebar, cloned from the Upload item by the bridge.

The client reports no usable play event of its own, and it fetches media with `fetch()` from the browser cache and preloads the next video, so media requests cannot measure views. Instead `src/client/bridge.js` listens for `playing` on videos inside `xgwrapper-<n>-<itemId>` and posts `{id}` to `POST /_kittok/view` once per page. Signed-in viewers are keyed by account; guests by an HMAC of their address with a per-process secret, so raw IPs are never stored and guest deduplication resets on restart. Reports are limited to 120 a minute per address.

Your own account still shows a Follow button in search results; following yourself is rejected.

The client's security SDK re-opens XHR requests and replays their headers, so `X-CSRF-Token` can arrive as `token, token`. Kittok accepts that only when every copy matches the session token.
| POST `/api/commit/follow/user/` and `/api/follow/` | `user_id`, `type`/`action_type` (1 follow, 0 unfollow) | `status_code`, integer `follow_status`: 0 none, 1 following, 2 mutual (4, requested, is unused) |
| GET `/api/user/detail/`, feed `author` | — | integer `relation`: 0 none, 1 following, 2 mutual, 6 follows you |
| POST `/api/comment/publish/` | `aweme_id`, `text`, `reply_id` (`0` for top level), `reply_to_reply_id`, `text_extra` | `status_code` and `comment`, in the same shape as `/api/comment/list/` items |
| GET `/api/comment/list/` | `aweme_id`, `cursor` (`0` first), `count` | top-level `comments` newest first, `cursor` (last `cid`), `has_more` (1/0), `total` (all comments, used as the video's comment count) |
| GET `/api/comment/list/reply/` | `comment_id`, `cursor`, `count` (3) | replies oldest first, `cursor`, `has_more` (must be the number 1 to show "View more") |
| POST `/api/comment/digg/` | `cid`, `digg_type` (1 like, 2 unlike) | `status_code`. Each comment carries `digg_count`, `user_digged` (1/0), and `reply_comment_total` |

Threads are one level deep. A reply to a reply is attached to the root comment, and its `reply_to_reply_id` target is not stored.

Next work: verify the remaining native social interactions, integrate profile editing and remaining profile/search interactions, then add moderation and operational features before inviting an untrusted public community.
