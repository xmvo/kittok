# Kittok API v1

All routes are on the instance's configured public origin. Responses are JSON. IDs are strings. Errors use HTTP status codes and a short `error` identifier. No TikTok login or remote API access is involved.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/v1/instance` | Instance name, origin, version, registration mode, source URL |
| POST | `/api/v1/users` | Register with `username`, `displayName`, `password`, optional `invite` |
| POST | `/api/v1/session` | Log in with `username` and `password`; sets a host-only HttpOnly session cookie, returns `user` and `csrfToken` |
| GET | `/api/v1/session` | Current `user` and `csrfToken`, or null values |
| DELETE | `/api/v1/session` | Revoke the current session and clear its cookie |
| GET | `/api/v1/videos?cursor=ID` | Paginated public feed: `items`, `hasMore`, `cursor` |
| POST | `/api/v1/videos?description=CAPTION` | Upload raw video bytes with a `video/*` content type; returns `{id}` after transcoding |
| PUT / DELETE | `/api/v1/videos/ID/like` | Like/unlike idempotently |
| PUT / DELETE | `/api/v1/videos/ID/favorite` | Save/unsave idempotently |
| GET | `/api/v1/videos/ID/comments` | Up to 50 newest comments |
| POST | `/api/v1/videos/ID/comments` | Add a comment with JSON `{text}` |
| PUT / DELETE | `/api/v1/users/USERNAME/follow` | Follow/unfollow idempotently |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | PostgreSQL readiness |
| GET | `/source` | Current packaged instance source, if generated |

Authenticated writes require both the session cookie and `X-CSRF-Token` from the session response. Login and registration are limited by the directly connected IP; authenticated uploads and comments have user limits. Cross-origin browser writes are rejected. Credentials are supplied to this instance only.

Uploads currently process synchronously. Allow enough request time for ffmpeg. They are public after successful processing. Supported containers are MP4/MOV and WebM; format, dimensions, duration, file size, and tool timeouts are checked. The native account page uses this API.

The client-compatibility API paths are experimental and documented by their handlers in `src/routes/compatibility.mjs`. Kittok API tests do not guarantee that the captured client's controls use the expected paths or session state.

The original username/password form posts to `/passport/web/user/login/`. This adapter accepts the native SDK’s form encoding and returns its success/error envelope while issuing a Kittok session cookie. `/passport/web/account/info/` and `/passport/account/info/v2/` expose the current local account; authenticated CSRF-protected POST `/passport/web/logout/` revokes it. These routes do not contact TikTok.
