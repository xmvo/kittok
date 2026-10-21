# Kittok API v1

All routes are on the instance's configured public origin. Responses are JSON. IDs are strings. Errors use HTTP status codes and a short `error` identifier. No TikTok login or remote API access is involved.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/v1/instance` | Instance name, origin, version, registration mode, source URL |
| POST | `/api/v3/register/verification/age/` | Form `birthday` (`YYYY-MM-DD`): `{is_eligible}`; under 13 is not eligible |
| POST | `/passport/web/email/send_code/` | Native sign-up: form `email` (hex, XOR 5 when `mix_mode=1`). Emails a 6-digit code; 1023 if the address is registered |
| POST | `/passport/web/email/register_verify_login/` | Native sign-up: `email`, `password`, `code` (mixed), `birthday`. Checks the invite (cookie `kittok_invite`, set by the form's Invite code field) and code, creates `user#########`, signs in, and sets `passport_csrf_token` for the next step |
| POST | `/passport/web/email/password/reset_and_login/` | Forgot password: mixed `email`, `code` (sent by `email/send_code/` with `type=31`), and new `password`. Signs out every session, then signs in. Codes only go to existing accounts, but the reply is the same either way |
| GET | `/api/music/detail/`, `/api/music/item_list/` | Every video is its own Original sound, so `musicId` is a video id: the sound (playing the video's audio), its author, and that one video. 10219 when missing |
| GET | `/api/discover/user/` | Accounts with a preview video each (`needItemList=true`): who you follow, or suggested accounts for guests and anyone who follows no one, which fills the Friends page's empty state |
| GET | `/api/search/general/preview/`, `/api/search/user/preview/` | Suggestions while typing: public hashtags by use, then usernames, starting with the keyword |
| POST | `/api/v1/account/deactivate` | JSON `{password, delete}` from the Settings deactivate and delete pages: hides the account and ends every session; `delete: true` also schedules permanent deletion 30 days out (`deleteAfter`). Logging in again cancels both. 403 `InvalidPassword`, 409 `LastAdmin` |
| POST | `/api/v1/account/data` | JSON `{format, sections}` (`format` is `txt` or `json`) from the Settings Download your data page; `sections` picks from `profile`, `video`, `activity`, `comment`, `messages`, `settings` and empty means all. Adds a request that can be downloaded for 4 days; only the three newest are kept. 400 `InvalidFormat` or `InvalidSection`, 429 `TryLater` after 5 an hour |
| POST | `/api/v1/account/data/download` | Form post `{id, csrf, password}` from the same page. Streams a ZIP (`user_data.json`, or one TXT file per list, plus your own videos and profile photo); a wrong password or expired request redirects back to `/ppp` with `error=InvalidPassword` or `ExportExpired` |
| POST | `/api/v1/im/media?type=image` or `?type=video` | Raw photo (JPEG, PNG, WebP, up to 20 MB) or video (up to 50 MB and 16 seconds) for a direct message, with the CSRF header. Returns `{uri, width, height, duration, cover}`; the uri goes in the message's `send_media_list`. 403 `MessageMediaDisabled` or `MessageRestricted`, 413, 422 `InvalidImage` or `UnsupportedVideo` |
| GET | `/api/v1/im/media/{uri}`, `/api/v1/im/media/{uri}/cover` | The file (byte ranges supported) or a video's cover, for its sender and for chat members who can still see the message; 404 for everyone else |
| GET | `/api/v1/im/groups/friends` | Friends who can be added to a group: `{friends: [{id, username, name, avatar}]}` |
| GET | `/api/v1/im/groups` | Your group chats: `{groups: [{id, title, members}]}` |
| POST | `/api/v1/im/groups` | JSON `{members, name}`: starts a group with 2 to 31 friends. Returns `{id}`. 403 `OnlyFriendsCanBeAdded`, 400 `GroupNeeds2To31People` |
| GET, PATCH | `/api/v1/im/groups/{id}` | The group's `{id, name, title, owner, you, limit, members}`; PATCH `{name}` renames it (50 characters, empty for the default name) |
| POST | `/api/v1/im/groups/{id}/members` | JSON `{members}`: adds your friends; returns `{added, failed}` |
| DELETE | `/api/v1/im/groups/{id}/members/{user}` | Removes someone (owner only, 403 `OnlyTheOwnerCanRemove`), or leaves when `{user}` is you |
| POST | `/api/v1/videos/ID/pin` | JSON `{pinned}` on your own video; 409 `PinLimit` past three. Used by the Pin to profile item Kittok adds to the native video menu |
| GET | `/api/v1/videos/ID/download` | The watermarked copy (MP4 with an end card, byte ranges supported) that "Download video" saves; made on the first request. 403 `DownloadsOff` when the author turned downloads off or is private, unless you are the author |
| POST | `/passport/web/account/set/` | Create username step: mixed `username`, with `x-tt-passport-csrf-token`. A placeholder nickname follows the new name |
| POST | `/api/v1/users` | Register with `username`, `displayName`, `password`, optional `invite` and `prideFlag` (default `""`, no flag). Cannot choose verification, community badges, or roles |
| POST | `/api/v1/session` | Log in with `username` and `password`; sets a host-only HttpOnly session cookie, returns `user` and `csrfToken` |
| GET | `/api/v1/session` | Current `user` and `csrfToken`, or null values |
| PATCH | `/api/v1/profile/decoration` | Authenticated JSON `{decoration}`: a decoration `id` from the catalog, or `""` to remove it. Profile restrictions apply; refused while the Avatar decorations switch is off |
| PATCH | `/api/v1/profile/badges` | Authenticated JSON `{prideFlag}`: set your optional public flag, or `""` to remove it. Profile restrictions apply; community badges and verification cannot be changed here |
| DELETE | `/api/v1/session` | Revoke the current session and clear its cookie |
| GET | `/api/v1/videos?cursor=ID` | Paginated public feed: `items`, `hasMore`, `cursor` |
| POST | `/api/v1/videos?description=CAPTION&visibility=public&comments=default` | Upload raw video bytes. Privacy is stored atomically with the new video; returns `{id}` after transcoding. `story=1` posts it as a 24-hour story instead |
| PATCH | `/api/v1/videos/ID` | Owner-only JSON `{visibility, comments}`; audiences: `public`, `followers`, `friends`, `only_me`; comments: `default`, `everyone`, `followers`, `friends`, `none` |
| PATCH | `/api/v1/profile/privacy` | JSON `{privateAccount: boolean, comments}`; account comments use the same audiences except `default` |
| GET | `/api/v1/follow-requests` | Your pending incoming requests, newest first (up to 100); review them at `/account/requests` |
| GET | `/api/v1/messages/ID/actions` | Conversation members only: `{canUnsend}` |
| DELETE | `/api/v1/messages/ID` | Sender-only unsend, within three minutes; broadcasts the native recall event |
| PUT / DELETE | `/api/v1/videos/ID/like` | Like/unlike idempotently |
| PUT / DELETE | `/api/v1/videos/ID/favorite` | Save/unsave idempotently |
| GET | `/api/v1/videos/ID/comments` | Up to 50 newest comments |
| POST | `/api/v1/videos/ID/comments` | Add a comment with JSON `{text}` |
| PUT / DELETE | `/api/v1/users/USERNAME/follow` | Follow/unfollow idempotently; private accounts receive a pending request. Unfollow also cancels a pending request; 403 when blocked |
| PUT / DELETE | `/api/v1/users/USERNAME/block` | Block/unblock idempotently; blocking removes follows and pending requests in both directions |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | PostgreSQL readiness |
| GET | `/source` | Current packaged instance source, if generated |

Authenticated writes require both the session cookie and `X-CSRF-Token` from the session response. Login and registration are limited by the directly connected IP; authenticated uploads and comments have user limits. Cross-origin browser writes are rejected. Credentials are supplied to this instance only.

Uploads currently process synchronously. Allow enough request time for ffmpeg. They use the requested visibility immediately; the default `public` audience is still limited to approved followers when the author has a private account. Supported containers are MP4/MOV and WebM; format, dimensions, duration, file size, and tool timeouts are checked. The dedicated `/upload` page uses this API; `/account` links to it. `/account/posts` lists your posts and links to each post’s privacy editor.

The client-compatibility API paths are experimental and documented by their handlers in `src/routes/compatibility.mjs`. Kittok API tests do not guarantee that the captured client's controls use the expected paths or session state.

The original username/password form posts to `/passport/web/user/login/`. This adapter accepts the native SDK’s form encoding and returns its success/error envelope while issuing a Kittok session cookie. `/passport/web/account/info/` and `/passport/account/info/v2/` expose the current local account; authenticated CSRF-protected POST `/passport/web/logout/` revokes it. These routes do not contact TikTok.

## Admin

Admins open `/admin` (also linked from the sidebar and `/account`). It runs inside the original client: the server serves the client shell, `src/client/bridge.js` boots the client on a placeholder tag page (its router has no `/admin` route), and `public/admin.js` restores the address and takes over the main column. The client's own sidebar lists the admin sections, and the console is built from the client's TUX web components (buttons, switches, tags, segmented controls) and color tokens, so it follows the client's theme. The panel calls these JSON routes; non-admins get 404. Writes need the session's `X-CSRF-Token` and are recorded in `admin_actions`. Admins cannot suspend, demote, delete, or sign out their own account here.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/_kittok/admin/overview` | Instance counts, newest accounts, and the most frequent unimplemented client calls |
| GET | `/_kittok/admin/console` | Queue counts (open tickets, oldest waiting, pending appeals, 30-day overturn rate, decisions today, active restrictions, bans), instance counts, and 14 days of daily reports and decisions |
| GET | `/_kittok/admin/tickets?type=video\|comment\|message\|user` | One ticket per reported item with its open report count, reasons tallied, top reason, owner with active strikes, and a priority from the most severe reason and report volume, highest first |
| GET | `/_kittok/admin/tickets/TYPE/ID` | The item (video file and cover, comment with its video and parent, direct message with the conversation around it, or profile), every report on it, the open report IDs, decisions taken on it, and the owner's `standing` |
| GET | `/_kittok/admin/decisions?action=&category=&before=ID` | Enforcement log, newest first, 50 per page, with each decision's restricted features |
| GET | `/_kittok/admin/users?q=&before=ID` | Users, newest first, 50 per page. `q` matches username, display name, user ID, or an IP address seen in the activity log |
| GET | `/_kittok/admin/users/ID` | Profile, stats, sign-up details, countries and languages seen, activity log, active sessions, accounts sharing an IP, videos, comments, violations (moderation decisions), and `standing` (state, active strikes per feature and policy, thresholds, restrictions) |
| POST | `/_kittok/admin/users/ID/suspend` / `unsuspend` | Suspend records a permanent ban decision (JSON `{category?, reason?}`), signs the user out everywhere, and blocks login; unsuspend reverses every active ban |
| POST | `/_kittok/admin/users/ID/role` | JSON `{role}`: `admin` or `member` |
| POST | `/_kittok/admin/users/ID/verification` | JSON `{verified: true\|false}`: grant/remove the instance's verified badge, including on the admin's own account. Does not change roles or permissions. Each change is recorded as `user.verification`; repeated requests for the current value do not add audit entries |
| POST | `/_kittok/admin/users/ID/badges` | JSON `{prideFlag?, userBadges?}`: update the optional flag and/or community badge IDs. Omitted fields remain unchanged; `""` clears the flag, `[]` removes community badges. Records `user.badges` atomically without copying the selected identity into audit details |
| POST | `/_kittok/admin/users/ID/sessions/revoke` | JSON `{session}`: a session ID from the user page, or `all` |
| POST | `/_kittok/admin/users/ID/violations` | JSON `{category, reason, video_id?, comment_id?}`: a strike against the user, their video, or their comment |
| POST | `/_kittok/admin/enforce` | JSON `{target_type: video\|comment\|user, target_id, category, reason, content_action?: none\|remove\|fyf_ineligible, account_action?: none\|strike\|ban, severe?, restrictions?: [{feature, hours}]}`. Features: `upload`, `comment`, `message`, `live`, `follow`, `profile`; hours 1, 24, 48, 72, 168, 720, or `null` until lifted. Returns `{decision, autoBan}` |
| POST | `/_kittok/admin/reports/ID/decide` | JSON `{verdict: violation\|no_violation, ...enforce fields}`; closes every open report on the target and links the decision |
| POST | `/_kittok/admin/decisions/ID/reverse` (`violations/ID/revoke`) | JSON `{reason}`; reverses the decision, lifts its restrictions, and lifts a ban if no other ban is active. History is kept |
| POST | `/_kittok/admin/restrictions/ID/lift` | Ends one feature restriction early |
| GET | `/_kittok/admin/appeals?status=pending\|restored\|upheld&before=ID` | Appeals with the decision they contest, 50 per page |
| POST | `/_kittok/admin/appeals/ID/review` | JSON `{outcome: restored\|upheld, reason}`; restored reverses the decision |
| POST | `/_kittok/admin/users/ID/delete` | JSON `{confirm}` must equal the username; deletes the account, its videos and their files, and its avatar |
| GET | `/_kittok/admin/videos?before=ID` | Videos with views, likes, and comment counts, 30 per page |
| POST | `/_kittok/admin/videos/ID/delete` | Deletes the video and its files |
| GET | `/_kittok/admin/comments?before=ID` | Comments, newest first, 50 per page |
| GET | `/_kittok/admin/comments/ID` | One comment with its author, video, parent, replies, and the decisions taken on it |
| POST | `/_kittok/admin/comments/ID/delete` | Deletes the comment and its replies |
| GET / POST | `/_kittok/admin/invites` | List open invites, or create one with JSON `{uses, days}` (1–100 uses, 1–90 days); the code is returned once |
| POST | `/_kittok/admin/invites/HASH/delete` | Revokes an invite |
| GET | `/_kittok/admin/settings` | Sign-up mode, instance name, features, upload limits, announcement, rules, and brand images |
| POST | `/_kittok/admin/settings/KEY` | JSON `{value}` for `registration`, `name`, `features`, `misc`, `limits`, `announcement`, `rules`, or `moderation` (`{strikeDays, feature, total, policy: {category: n}}`); applied immediately without a restart. `misc` takes booleans for Kittok's own additions: `verifiedBadges`, `profileBadges`, `reposts`, `collections`, `hashtags`, `groupedLikes`, `commentLabels`, `messageRequests`, `readReceipts`, and `unsend`; omitted keys stay on |
| POST | `/_kittok/admin/brand/SLOT` | Multipart `file` (PNG, JPEG, or WebP, up to 2 MB) for `wordmarkDark`, `wordmarkLight`, `icon`, or `favicon`; re-encoded to PNG |
| POST | `/_kittok/admin/brand/SLOT/reset` | Restores the shipped image |
| GET | `/_kittok/admin/audit?before=ID` | Admin actions, newest first, 50 per page |

Settings stored in the database override the environment values for `REGISTRATION_MODE`, `INSTANCE_NAME`, `MAX_VIDEO_MB`, and `MAX_VIDEO_SECONDS`. Public routes `/brand/SLOT` serve the current brand images and `/rules` shows the rules.

To manage verification, open **Admin → Accounts**, select an account, and choose **Verify account** or **Remove verification**. The `users.verified` flag defaults to false and persists in PostgreSQL. Registration and profile-edit requests cannot set it. Public user shapes expose `verified`; the original client's snake-case user shapes receive `custom_verify: "Verified account"` (the exact string its comment list checks) and `verification_type: 1` for verified accounts. This badge is granted by the local instance and does not represent verification by TikTok.

The account page's **three-dot menu** groups secondary account actions, including **Edit profile badges** and verification. Community badges (`contributor`, `early_member`, `supporter`) are hidden for now: they stay stored and assignable through the admin API but appear in no catalog or user shape, and the admin console no longer edits them. People choose a pride flag at signup or from the **Pride flag** row in the native Edit profile dialog, which saves on change (also `/account#badges`). This selection is optional, public, editable, and removable; existing accounts receive no flag automatically. `/signup` links to the local registration form and respects the instance's registration mode.

Public GET `/_kittok/badges/catalog` lists available flags and community badges; GET `/_kittok/badges?users=name1,name2` returns only badge descriptors for up to 50 distinct valid usernames. GET `/_kittok/badges/icon/ID.svg` serves the local vector artwork. User shapes include `prideFlag` and `kittokBadges`. The captured client ignores extra badge fields, so `/public/user-badges.js` decorates its profile and author name wrappers with the server's descriptors, after the native verified badge. Lookups are batched and briefly cached; a local edit updates the current page immediately, while other open tabs refresh on focus or their next 30-second check. Changes to the captured client's markup may require updating these selectors.

Avatar decorations are Discord's 644 avatar decoration presets, listed in `src/decorations.json` (regenerate with `node scripts/import-decorations.mjs collectibles.json` from Discord's collectibles catalog). Public GET `/_kittok/decorations/catalog` groups them by collection as `{id, name, label, image, still}`. GET `/_kittok/decorations/ASSET.png` serves the animated image and `?static=1` the still one; each is fetched from Discord's CDN once and then served from `MEDIA_DIR/decorations`; `node scripts/preload-decorations.mjs` fetches all of them ahead of time (about 650 MB). The badge lookup also returns `decorations`, a map of username to the chosen decoration. In the native Edit profile dialog, the profile photo opens an **Edit avatar** panel with a searchable decoration picker and **Change photo**, which leads to the client's own crop screen. `/public/user-badges.js` draws the chosen decoration at 1.2× around profile, post, comment and list avatars.

## Privacy and direct messages

Private accounts keep existing followers; new follows require approval. Switching back to public accepts pending requests. POST `/api/commit/follow/request/approve/` or `/reject/` with `user_id` (or `sec_user_id`) acts on the signed-in recipient’s request only. Native follow responses use `follow_status: 4` for requested; profile `relation` uses 3. Names, photos and bios remain public. A private account limits every post to approved followers even when its post audience is `public`; `friends` additionally requires mutual follows, and `only_me` is author-only. Account and post comment permissions intersect.

Feeds, search, details, comments, activity and shared-video cards apply the same visibility check. Video and cover requests, including HEAD and ranges, authenticate before serving bytes and use `private, no-store`. An explicit `?review=1` is honored only for a signed-in admin; admin review URLs use it to inspect removed/private evidence.

Native Settings exposes Private account, Comments, message audiences and Read status. Message audience values are 1 (inbox), 2 (requests), 3 (don’t receive). `message_read_status` is 0/1. Native updates require CSRF and return the refreshed settings so controls update immediately. Read indexes and live receipts are disclosed only when both users opt in, the request is accepted, and the pair is unblocked. Typing is also suppressed for pending or blocked chats. This follows TikTok’s documented [read-status and message-request behavior](https://support.tiktok.com/en/account-and-privacy/account-privacy-settings/direct-message).

Pending senders may send three messages total, matching the captured client’s request notice; retries with the same client message ID do not consume another slot. Deleting a request hides its history and stops further pending sends. Acceptance moves it from native inbox 3 into inbox 0. Personal deletion (IM 701, legacy 1003) persists only for the deleting member. Unsend (IM 702 or the local DELETE route) requires the sender and a three-minute window, matching TikTok’s documented limit. Recalled content is blank in ordinary IM responses; the database retains the original for moderation evidence. The captured desktop menu’s Delete action is personal; Kittok adds Delete for everyone while the sender is eligible.
