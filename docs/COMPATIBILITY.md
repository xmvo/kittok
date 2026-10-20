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
| Blocking | PostgreSQL `blocks`; blocking removes follows both ways. A blocked pair cannot follow each other or comment on each other's videos, and is hidden from each other's feeds, item detail, comments, follow lists, suggestions, and notifications. Search hides people who blocked you | Native profile Block/Unblock with confirmation verified, including the blocked profile state after reload. The Settings blocked-accounts list is served but the settings page is not integrated |
| Settings page | `/setting` and its subpages are served; the privacy, compliance, region, and unified-config calls are answered | Native Privacy section verified: Blocked accounts list with Unblock, and Direct messages with Friends, Potential connections, and Others. Private accounts, download your data, and the remaining settings are not implemented |
| Likes | PostgreSQL `likes`, read back as `digged`/`stats.diggCount` | Native like/unlike verified, including after reload |
| Profile and item detail | Response adapters and authored data | Own profile opens from the native account dropdown and survives refresh; editing and remaining profile interactions need integration |
| User and video search | Usernames and display names; video captions, newest first | Native Top, Users, and Videos tabs verified. Photos and LIVE return empty results |
| Direct messages | PostgreSQL `conversations`, `conversation_members` (read index, cleared-history index), and `messages`, served over the client's own IM protocol: protobuf over HTTP and the frontier WebSocket | Native inbox verified: starting a chat from a profile, sending text, the conversation list with profiles and previews, empty conversations, live delivery with unread badges, read state, and reload. Videos shared from the share sheet's send-to-friends panel arrive as the client's own video cards (`/api/share/settings/` offers the option, `/api/im/item_detail/` fills the card); verified natively. One-to-one only; group chats, photo and video uploads, and reactions are not implemented. Recipients choose, separately for friends (mutual follows), potential connections (a one-way follow), and everyone else, whether messages reach their inbox, land in message requests, or are refused, from the native Settings > Privacy > Direct messages page or `/account`; admins can switch DMs off, which hides the inbox and refuses IM requests and sockets. Sockets close on the next request, or within 10 seconds, after logout, session revocation, or suspension. Message requests use the client's stranger inbox commands (1001–1008) and stay out of the inbox until the recipient accepts (`/api/im/stranger/unlimit`) or replies; covered by database tests, not yet checked in the browser with two accounts |
| LIVE, shop, coins | Not implemented | Visible original controls do not imply working features |
| Reports | Local report reasons, authenticated submissions (videos, comments, accounts, and selected direct messages), moderation queue, resolve/dismiss actions | Native reason selection, optional description, Submit, and success feedback verified. Admin report cards, review dialog, menus, and compact user-page cards verified in dark and light themes |
| Moderation | One enforcement model in `moderation_decisions` and `moderation_restrictions`, modeled on TikTok's published system (see below) | Verified in the original client: the comment-ban toast, the DM failed-message notice and its Feedback link, the follow failure toast, the profile-update-limited toast, Account Updates in System notifications, and the banned-login dialog with its appeal form |
| Admin panel | `/admin`: a Trust & Safety console with a ticket queue, a review workspace (content, reports, owner standing, and a decision form with a preview of the notice the account receives), appeals, an enforcement log, accounts with enforcement, content, reports, and security tabs, content browsing, policy thresholds, instance settings, invites, and an audit log | Verified in the browser in dark and light themes with the rail open and collapsed: queue, keyboard review with auto-advance to the next ticket, take-action drawer, appeals, log, accounts, content, policies, instance, invites, and audit pages. Layout checked at the pane's width only; wide-screen three-column review was not visually checked |

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

The admin panel at `/admin` is a standalone page rather than a client route. It links the client's own stylesheets, found by scanning the cached client scripts for their hashed names, for the TikTok fonts from the cached asset host, and draws its own dark and light themes in `public/admin.css` using TikTok's red and cyan accents. It is a small client-side router under `/admin/...`, so tickets, accounts, and filters have their own URLs. Moderation is keyboard driven: `j`/`k` and Enter in the queue, `V`/`N`, `1`–`0` for a policy, `R`, `B`, `S`, and ⌘/Ctrl+Enter in review, `/` to search, `?` for the list. Admins see an extra Admin item in the client sidebar, cloned from the Upload item by the bridge. Feature switches hide sidebar entries with CSS on the nav container's direct children, and the bridge removes the client's in-app TikTok Shop promotion, which links to the real TikTok Shop.

The client reports no usable play event of its own, and it fetches media with `fetch()` from the browser cache and preloads the next video, so media requests cannot measure views. Instead `src/client/bridge.js` listens for `playing` on videos inside `xgwrapper-<n>-<itemId>` and posts `{id}` to `POST /_kittok/view` once per page. Signed-in viewers are keyed by account; guests by an HMAC of their address with a per-process secret, so raw IPs are never stored and guest deduplication resets on restart. Reports are limited to 120 a minute per address.

Your own account still shows a Follow button in search results; following yourself is rejected.

The client's security SDK re-opens XHR requests and replays their headers, so `X-CSRF-Token` can arrive as `token, token`. Kittok accepts that only when every copy matches the session token.
| POST `/api/commit/follow/user/` and `/api/follow/` | `user_id`, `type`/`action_type` (1 follow, 0 unfollow) | `status_code`, integer `follow_status`: 0 none, 1 following, 2 mutual (4, requested, is unused) |
| GET `/api/user/detail/`, feed `author` | — | integer `relation`: 0 none, 1 following, 2 mutual, 4 you blocked them, 5 they blocked you, 6 follows you |
| POST `/api/user/block/` | `sec_user_id`, `block_type` (1 block, 0 unblock), `source` | `status_code` only; on 0 the client sets `relation` to 4 or 0 itself. Kittok also returns `block_status`. Following a blocked pair either way returns 403 |
| GET `/api/block/user_list/` | `offset` (`"0"` first), `count` (20) | `userList[{user, stats}]`, `offset` (next offset, string), `hasMore`. The Settings > Privacy blocked-accounts list; the client marks every entry `relation` 4 |
| POST `/api/comment/publish/` | `aweme_id`, `text`, `reply_id` (`0` for top level), `reply_to_reply_id`, `text_extra` | `status_code` and `comment`, in the same shape as `/api/comment/list/` items |
| GET `/api/comment/list/` | `aweme_id`, `cursor` (`0` first), `count` | top-level `comments` newest first, `cursor` (last `cid`), `has_more` (1/0), `total` (all comments, used as the video's comment count) |
| GET `/api/comment/list/reply/` | `comment_id`, `cursor`, `count` (3) | replies oldest first, `cursor`, `has_more` (must be the number 1 to show "View more") |
| POST `/api/comment/digg/` | `cid`, `digg_type` (1 like, 2 unlike) | `status_code`. Each comment carries `digg_count`, `user_digged` (1/0), and `reply_comment_total` |

Threads are one level deep. A reply to a reply is attached to the root comment, and its `reply_to_reply_id` target is not stored.

Next work: verify the remaining native social interactions, integrate profile editing and remaining profile/search interactions, then add moderation and operational features before inviting an untrusted public community.

## Direct message protocol

The DM inbox loads only when the signed-in user has `hasIMPermission`. Its SDK sends protobuf `Request` messages and reads `Response` messages (`application/x-protobuf`), either as an HTTP POST to the `imApi` origin (`/v1/message/send`, `/v2/message/get_by_user_init`, …) or inside a protobuf `Frame` (`service` 5, `payload_type: "pb"`) on the `imFrontier` WebSocket at `/ws/v2`. Kittok handles both on the same origin; the path does not matter, only `cmd`. Field numbers in `src/im/schema.mjs` are generated from the cached client's encoders and only cover the commands Kittok handles. The codec in `src/im/protobuf.mjs` was checked byte-for-byte against the client encoder. 64-bit values are decimal strings.

The socket must accept one of the offered subprotocols (`binary`, `base64`, `pbbp2`); Kittok picks `pbbp2`. The client sends the text `hi` every 15 seconds and reconnects after 30 seconds without any data, so Kittok echoes it. Responses reuse the request's `seqid` and `sequence_id`; pushes use 0. Authentication is the session cookie (`auth_type` 1, session auth), and the upgrade requires this instance's Origin.

| Command | Request body | Kittok behavior |
| --- | --- | --- |
| 203 init | `messages_per_user_init_v2_body` | All the user's conversations and up to 20 recent messages each; `per_user_cursor` is the newest visible message ID. Other inbox types (the client also asks for 3) are empty |
| 200, 204 pull | `messages_per_user_body`, `messages_per_user_combo_body` (per inbox `cursor`) | Messages with an ID above the cursor, oldest first, with `next_cursor` and `has_more` |
| 609 create | `create_conversation_v2_body` (`participants`) | Finds or creates the one-to-one conversation `0:1:<lower id>:<higher id>`; the SDK reads the inbox from the first segment. 11 if either user blocked the other; 4 for group chats |
| 100 send | `send_message_body` (`conversation_short_id`, `message_type`, JSON `content`, `client_message_id`) | Stores the message with the next `index_in_conversation` and pushes 500 `has_new_message_notify` (with `previous_cursor`, `next_cursor`, and the recipient's `badge_count`) to every member's sockets. Repeating a `client_message_id` returns the original. `status` 5 when blocked. Text is type 7 with `{"aweType":0,"text":…}` |
| 301, 304 history | `messages_in_conversation_body` (direction, anchor), `messages_in_conversation_with_range` | Older or newer pages by index; the range command returns `messages_pb`, each an encoded `MessageBody` |
| 604, 2002 read | `mark_conversation_read_body` (`read_message_index`) | Raises the reader's read index (capped at the last message) and pushes 501 to members; 2000 returns every member's read index |
| 603 delete | `delete_conversation_body` | Hides the conversation's history for that user only |
| 411 typing | `send_input_status_body` | Pushes 510 to the other members |

Unknown commands return status 5 and are counted in `/_debug/unknown`. Messages carry `s:client_message_id` in `ext` because the client's store keys messages by it. `create_time` is in milliseconds. Participant profiles come from GET `/tiktok/v1/im/user/profile/?user_ids=["id",…]`, which returns `users[{im_user_profile: {user_id, unique_id, nick_name, avatars, follow_status, follower_status, block_info}}]`.

The client's conversation list drops conversations without a last message and leaves their preview blank. Kittok rewrites those two expressions when serving the bundle so empty conversations appear with "No messages yet".

## Settings page contract

The client's fetch wrapper rejects any non-2xx response, and one rejection ends every request stream in that Settings module, so every call the page makes must answer 200; unsupported actions return `status_code` 1 with a `status_msg`. GET `/api/privacy/setting/restriction/v1/` returns `privacy_restriction.account[key] = {show_type, values[{value, show_type}]}` (show types 0 show, 1 disabled, 2 hide; a missing key is hidden, except `comment`, which the list reads unguarded) and `privacy_settings[key]` with the user's values. GET `/api/privacy/unified_config/v1` returns `configs`, a JSON string of server-defined pages keyed by page tag (`main`, `direct_message_permission`, `dm_friends`, `dm_potential_connection`, `dm_others`), each with sections of items (`item_type` 0 disclosure, 2 radio; `item_info.restriction_key`, `setting_key`, `label_config`, `options`). The client attaches its handlers by tag: `direct_message_entrance`, `dm_*_permission_entrance`, and `options_inbox` / `options_request` / `options_dont_receive`. POST `/api/privacy/user/settings/update/v1` takes `field` and `value` (1 inbox, 3 don't receive; 2, message requests, is hidden because Kittok has no request inbox).

## Moderation

The model follows TikTok's account enforcement documentation. Content can be removed (hidden everywhere, including comment counts and notifications) or made ineligible for the For You feed (removed from the recommended feeds only). A first violation is a warning, which never counts; later violations are strikes that expire after 90 days and count against the feature where they happened (videos, comments, direct messages, profile, LIVE), the policy area, and the account total. Reaching any threshold records an automatic permanent ban; severe violations can ban immediately. Thresholds are instance settings because TikTok does not publish its numbers; stricter policies (hate, violence, impersonation) default lower. Feature restrictions are separate, timed rows: posting videos, commenting, sending messages, going LIVE, following, and editing the profile, each 1 hour to 30 days or until lifted. Bans set `users.suspended_at`, end every session, and hide the account's videos and comments. Appeals reverse a decision and everything it applied.

Each restriction answers in the client's own shape:

| Restricted action | Response | Client shows |
| --- | --- | --- |
| Comment (`/api/comment/publish/`) | `status_code` 22 | "Due to multiple Community Guideline violations, you're temporarily blocked from commenting." |
| Send a DM | `send_message_body.status` 3, `check_code` 7195, `check_message` JSON `{status_code: 7195, status_msg: {msg_content: {tips, template}}}` | The failed message with Kittok's notice under it and a Feedback link; Feedback (POST `/aweme/v1/im/msg/feedback/`) files an appeal |
| Follow | `status_code` 2096 | "Couldn't follow account" (the client has no follow-ban text); following a banned account returns 24, "This account was banned…" |
| Update profile, avatar, or username | `status_code` 23 (username: Passport `error_code` 23) | "…you're temporarily prevented from updating your profile." |
| Upload | HTTP 403 `UploadRestricted` | Kittok's upload page |
| Sign in while banned | Passport `error_code` 1091 with `user_id_str` and a 30-minute `verify_ticket` | Its ban dialog from GET `/aweme/v2/appeal/status/` (or `/tns-api/appeal/status/`): `pop_title`, `pop_content`, `appeal_type` 2018, and `button_list` (`btn_type` 4 opens its appeal form, 0 closes). The form stores the email with POST `/aweme/v1/material/upload/` (`ns: review_account_appeal`) and submits POST `/tns-api/appeal/post-commit/` with `extra.mail_address_v2` |

Decisions and appeal outcomes appear in Inbox > System notifications > Account updates: group 661 and type 47, `template_notice.notice` `{title: {title}, content}`, with their own read marker (`users.moderation_seen_at`). `/account` shows the account status: standing, active strikes against each limit, restrictions, history, and an appeal form. The client's success text promises an email, but Kittok does not send mail; outcomes are visible on the next sign-in. LIVE restrictions are recorded but Kittok has no LIVE yet.

## Report dialog contract

`GET /node/report/reasons` returns reasons with a JSON `option` containing `action.action_type: "route"` and `action.action_params.route_path: "Detail_WithDesc"`. An empty option cannot navigate the current client, and `Desc` opens a confirmation page without the description field. The original description step submits `report_desc` to the local feedback adapter and displays its own success screen.
