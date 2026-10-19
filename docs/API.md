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

## Admin

Admins open `/admin` (also linked from the sidebar and `/account`). It is a standalone page that loads the original client's TUX stylesheets and fonts. The panel calls these JSON routes; non-admins get 404. Writes need the session's `X-CSRF-Token` and are recorded in `admin_actions`. Admins cannot suspend, demote, delete, or sign out their own account here.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/_kittok/admin/overview` | Instance counts, newest accounts, and the most frequent unimplemented client calls |
| GET | `/_kittok/admin/users?q=&before=ID` | Users, newest first, 50 per page. `q` matches username, display name, user ID, or an IP address seen in the activity log |
| GET | `/_kittok/admin/users/ID` | Profile, stats, sign-up details, countries and languages seen, activity log, active sessions, accounts sharing an IP, videos, comments, and violations |
| POST | `/_kittok/admin/users/ID/suspend` / `unsuspend` | Suspending signs the user out everywhere and blocks login |
| POST | `/_kittok/admin/users/ID/role` | JSON `{role}`: `admin` or `member` |
| POST | `/_kittok/admin/users/ID/sessions/revoke` | JSON `{session}`: a session ID from the user page, or `all` |
| POST | `/_kittok/admin/users/ID/violations` | JSON `{category, reason, video_id?, comment_id?}`; the video or comment must be the user's |
| POST | `/_kittok/admin/violations/ID/revoke` | Marks a violation revoked; it stays in the history |
| POST | `/_kittok/admin/users/ID/delete` | JSON `{confirm}` must equal the username; deletes the account, its videos and their files, and its avatar |
| GET | `/_kittok/admin/videos?before=ID` | Videos with views, likes, and comment counts, 30 per page |
| POST | `/_kittok/admin/videos/ID/delete` | Deletes the video and its files |
| GET | `/_kittok/admin/comments?before=ID` | Comments, newest first, 50 per page |
| GET | `/_kittok/admin/comments/ID` | One comment with its author, video, parent, replies, and violations |
| POST | `/_kittok/admin/comments/ID/delete` | Deletes the comment and its replies |
| GET / POST | `/_kittok/admin/invites` | List open invites, or create one with JSON `{uses, days}` (1–100 uses, 1–90 days); the code is returned once |
| POST | `/_kittok/admin/invites/HASH/delete` | Revokes an invite |
| GET | `/_kittok/admin/settings` | Sign-up mode, instance name, features, upload limits, announcement, rules, and brand images |
| POST | `/_kittok/admin/settings/KEY` | JSON `{value}` for `registration`, `name`, `features`, `limits`, `announcement`, or `rules`; applied immediately without a restart |
| POST | `/_kittok/admin/brand/SLOT` | Multipart `file` (PNG, JPEG, or WebP, up to 2 MB) for `wordmarkDark`, `wordmarkLight`, `icon`, or `favicon`; re-encoded to PNG |
| POST | `/_kittok/admin/brand/SLOT/reset` | Restores the shipped image |
| GET | `/_kittok/admin/audit?before=ID` | Admin actions, newest first, 50 per page |

Settings stored in the database override the environment values for `REGISTRATION_MODE`, `INSTANCE_NAME`, `MAX_VIDEO_MB`, and `MAX_VIDEO_SECONDS`. Public routes `/brand/SLOT` serve the current brand images and `/rules` shows the rules.
