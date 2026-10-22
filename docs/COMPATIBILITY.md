# What works

Kittok runs TikTok's own web client, so most of the job is answering its API calls the way TikTok would. This page covers what's done, what isn't, and the odd details of the client's API for anyone digging into it. Most of it was clicked through in the real client, and the integration tests in `test/` cover the rest.

## Done

**Watching and posting**

- For You feed, video pages, playback and seeking (MP4 with range requests).
- View counts that only go up when a video actually starts playing, not when it's preloaded, once per viewer every 6 hours.
- Uploads through Kittok's own upload page (not TikTok Studio): preview, caption, privacy, comment settings, category, and a Share to story switch.
- Explore with categories (picked at upload or guessed from hashtags), hashtag pages, related videos, music pages for original sounds, and search for people and videos. The Photos and LIVE search tabs stay empty.
- Up to 3 pinned videos, and Latest, Popular and Oldest sorting on profiles.
- Stories that last 24 hours, in the client's own tray, rings and player, starting at the first one you haven't watched. Only the author sees who watched.
- Downloads from the client's right-click menu and from a share panel entry Kittok adds. Copies get a Kittok watermark like TikTok's (logo and @username, then an end card), capped at 720p and made ahead of time so they download right away. The Downloads switch in privacy settings turns it off for your videos.

**People**

- Log in with a username or email. Sign-up with emailed codes (invite-only instances get an invite field) and password reset by email.
- Profiles and Edit profile: photo, name, bio and username.
- Follows, followers, friends and suggestions, private accounts with follow requests, and blocking.
- Likes, favorites and named collections, and reposts.
- Comments with replies, likes, deleting, @mentions, and Creator, Following and Friend labels. Replies go one level deep, like on TikTok.
- Notifications for likes (grouped per video), comments, follows, mentions and moderation decisions.
- Settings: privacy (private account, comments, DMs, downloads, blocked accounts), download your data, and deactivating or deleting your account.

**Messages**

- DMs over the client's own protocol, live, with message requests, unsend (within 3 minutes), emoji reactions, replies, shared videos, and photos and short videos that stay blurred until tapped. Read receipts only show when both people turn them on.
- Group chats with up to 32 friends. The web client can be in groups but can't make or manage them, so Kittok adds a New group button and a group settings button.

**Kittok extras** (each one can be turned off under Admin → Misc)

- Verified checks and pride flags.
- Discord avatar decorations, display name styles (fonts and effects) and nameplates. Decorations and nameplates come from Discord's catalog, which an admin imports.
- IP privacy: IPs are stored as keyed hashes, and only people who say they don't mind get theirs saved in a form the owner's security key can open.

**Running an instance**

- The admin panel at `/admin`, inside the client: report queue, appeals, enforcement log, accounts, content, policies, instance settings, invites and an audit log. Reviewing is keyboard driven (`?` lists the keys).
- Moderation modeled on TikTok's: warnings, strikes, feature restrictions and bans, shown with the client's own toasts and ban dialog, plus appeals.
- Reports for videos, comments, accounts and DMs.

## Not done

- LIVE, the shop and coins. The buttons are still there but don't do anything.
- Phone numbers and SMS, and signing in with Google, Apple, Facebook or a QR code.
- Most of Settings beyond privacy, downloading your data and deleting your account.
- Pinned comments (the web client doesn't have them), and photos or videos in group chats.
- Recent people in the @mention picker.

Unknown API calls get a 501 and are listed for admins at `/_debug/unknown`, which is the quickest way to find what's missing.

## API notes

These come from reading the cached client bundle. The client sends every parameter in the query string, along with the session cookie and `X-CSRF-Token`. The page's `webapp.app-context.user` (its `uid`, `secUid`, `uniqueId`, `nickName` and `avatarUri`) comes from the current session, and pages for signed-in people are never cached.

### Likes, saves, collections and profiles

| Client call | Parameters read | Response read by the client |
| --- | --- | --- |
| POST `/api/commit/item/digg/` | `aweme_id`, `type` (1 like, 0 unlike) | `status_code` and `is_digg`. The client treats `is_digg` equal to `type` as a failure and reverts after 3 seconds, so success returns the opposite value. The client sends likes immediately but delays unlikes by about 10 seconds, and sends nothing if the user toggles back within that time |
| POST `/api/item/collect/` | `itemId`, `action` (1 save, 2 unsave) | `statusCode` (0 = ok; otherwise the client reverts its optimistic update). Kittok also returns `collected` and `collectCount` |
| GET `/api/user/collect/item_list/` and `/api/favorite/item_list/` | `secUid`, `cursor`, `count` | `itemList`, `cursor`, `hasMore`. The Favorites and Liked tabs are private: other users' tabs return an empty list |
| GET `/api/user/collection_list/` | `secUid`, `cursor`, `count` | `collectionList[{collectionId, name, status (1 private, 3 public), total (string), cover, userId, userName}]`, `cursor`, `hasMore`, `total`. Other people see only public collections |
| GET `/api/playlist/name_check` | `name` | `statusCode`, `isValid`. Names are 1–30 characters. The New collection dialog waits on this before showing its video picker |
| POST `/api/collection/create/` | `collectionName`, `collectionStatus` | `statusCode`, `collectionId`, `collectionIdString` |
| POST `/api/collection/modify_items/` | `collectionId`, `commitIds` (add), `deleteIds` (remove), comma-separated | `statusCode`. Only your own favorites can be added |
| POST `/api/collection/move_items/` | `itemIDs`, `fromCollectionID`, `targetCollectionID` | `statusCode` |
| POST `/api/collection/modify_info/` and `/api/collection/delete/` | `collectionId`, and for edits `collectionName`, `collectionStatus` | `statusCode`. Deleting a collection keeps its videos in Favorites |
| GET `/api/collection/detail/` | `collectionId` | `collectionInfo` with the list fields plus `cover.urlList`; the header reads the owner from `userName`. 10201 when missing or private |
| GET `/api/collection/item_list/` and `/api/collection/candidate/item_list/` | `collectionId` (item list), `cursor`, `count` | `itemList`, `cursor`, `hasMore`. Candidates are your favorites |
| POST `/tiktok/v1/upvote/publish` and `/tiktok/v1/upvote/delete` | `item_id` | `status_code` |
| GET `/api/repost/item_list/` | `secUid` or `uniqueId`, `cursor`, `count` | `itemList`, `cursor`, `hasMore` |
| GET `/api/user/following/request/list/` | `count`, `max_time` (0 first) | `request_users` (snake-case users), `has_more`, `min_time`, `total`. A total above 0 shows Follow requests at the top of the native inbox |
| POST `/api/commit/follow/request/approve/` and `/reject/` | `from_user_id` | `status_code` |
| POST `/v1/list` | Analytics event batches | `{e: 0}`. Batches are discarded; without a success reply the SDK retries about once a second |
| GET `/api/related/item_list/` | `itemID`, `count`, `cursor` | `itemList` without the anchor video. The client never clears its card placeholders for an empty list, so the bridge marks the page and `brand.css` shows "No suggestions yet" instead |
| GET `/api/explore/item_list/` | `categoryType` (120 All), `count` | `itemList`; other categories are empty |
| GET `/api/challenge/detail/` | `challengeName` or `challengeId` | `challengeInfo.challenge{id, title}`, `stats{videoCount, viewCount}`, `statsV2`. 10205 for names that are not hashtags |
| GET `/api/challenge/item_list/` | `challengeID`, `cursor`, `count` | `itemList` of videos whose caption contains the hashtag |
| GET `/api/user/list/` | `scene` (21 following, 67 followers, 150 friends, 151 suggested), optional `secUid`, `minCursor` (0 first), `count` | `userList[{user, stats, statsV2}]`, `minCursor` (next offset), `hasMore`, `total`. Without `secUid` the lists are the viewer's own |
| GET `/api/im/spotlight/relation` | `max_time` (0 first), `count` | `status_code`, `followings[]` (`uid`, `sec_uid`, `unique_id`, `nickname`, `avatar_thumb`, `follow_status`, `follower_status`), `min_time` (next offset), `has_more` (1/0). On any failure the client retries continuously |
| POST `/api/comment/delete/` | `cid` | `status_code`. Not found and not allowed both return 404 |
| POST `/api/upload/image/` | multipart `file`, `source` | `status_code`, `data.uri` (sent back as `avatar_uri`), `data.url_list[0]` for the preview. Images over 5 MB or 4096 px, and anything other than PNG, JPEG, or WebP, are rejected |
| POST `/api/update/profile/` | form `nickname`, `signature`, `avatar_uri`, `tt_csrf_token` (each only when changed) | `status_code` (2550 = invalid name, shown under the field) and `user`. The profile page reloads 3 seconds after a successful save. The client's 7-day name and 30-day username limits are its own warnings; Kittok does not enforce them |
| GET `/api/uniqueid/check/` | `unique_id` | `status_code`, `is_valid`. Kittok usernames are 3–24 lowercase letters, digits, or underscores, so names with periods show as unavailable |
| POST `/passport/web/login_name/update/` | form `login_name` | Passport envelope: `message: "success"`, or `message: "error"` with `data.error_code` 1024 (taken) or 1027 (invalid) |

### Notifications

| Client call | Parameters read | Response read by the client |
| --- | --- | --- |
| GET `/api/inbox/notice_count/` | — | `status_code`, `notice_count[{group, count}]` unread counts. Groups: 500 all, 3 and 505 likes (the client uses one or the other depending on an A/B flag), 2 comments, 6 mentions, 7 followers, 661 system |
| GET `/api/notice/multi/` and `/api/inbox/notice_list/` | `group_list` JSON `[{group, count, max_time, min_time, is_mark_read}]` | `notice_lists[0]`: `notice_list`, `has_more`, `max_time`, `min_time`. `max_time` 0 and `min_time` 0 returns the newest page; `max_time` above 0 loads items older than `min_time`; `max_time` 0 with `min_time` set fetches newer items. `is_mark_read: 1`, sent whenever the inbox opens, marks everything read |

Notices use type 41 for likes (`digg.digg_type` 1 for a video, 3 for a comment), 31 for comments (`comment.comment_type` 1 for a comment, 2 for a reply to your comment, with `reply_comment.user`), and 33 for follows (`follow.follow_button_type` 0 when mutual). `create_time` must be whole seconds because the client sorts with `BigInt`. Mentions use type 45 with `at.sub_type` 1 for a caption and 2 for a comment, `at.user_info`, `at.aweme`, and `at.comment`. Likes on the same video or comment share one notice id: `digg.from_user` holds the newest two likers and `digg.merge_count` the total, which the client shows as "A, B and N others". Unread counts count merged notices, not individual likes.

### Search

| Client call | Parameters read | Response read by the client |
| --- | --- | --- |
| GET `/api/search/item/full/` | `keyword`, `cursor` (0 first), `count` (12) | `item_list` of item structs, `cursor` (last video id), `has_more` |
| GET `/api/search/general/full/` | `keyword`, `cursor`, `count` | `data[]`: `{type: 4, user_list}` once on the first page, then `{type: 1, item}` per video; `cursor`, `has_more` |
| GET `/api/search/user/full/` | `keyword` | `user_list[{user_info}]` with snake_case stats (`follower_count`, `following_count`, `aweme_count`, `total_favorited`) and the viewer's `follow_status` |

Your own account still shows a Follow button in search results; following yourself is rejected.

### Follows, blocks and comments

| Client call | Parameters read | Response read by the client |
| --- | --- | --- |
| POST `/api/commit/follow/user/` and `/api/follow/` | `user_id`, `type`/`action_type` (1 follow, 0 unfollow) | `status_code`, integer `follow_status`: 0 none, 1 following, 2 mutual (4, requested, is unused) |
| GET `/api/user/detail/`, feed `author` | — | integer `relation`: 0 none, 1 following, 2 mutual, 4 you blocked them, 5 they blocked you, 6 follows you |
| POST `/api/user/block/` | `sec_user_id`, `block_type` (1 block, 0 unblock), `source` | `status_code` only; on 0 the client sets `relation` to 4 or 0 itself. Kittok also returns `block_status`. Following a blocked pair either way returns 403 |
| GET `/api/block/user_list/` | `offset` (`"0"` first), `count` (20) | `userList[{user, stats}]`, `offset` (next offset, string), `hasMore`. The Settings > Privacy blocked-accounts list; the client marks every entry `relation` 4 |
| POST `/api/comment/publish/` | `aweme_id`, `text`, `reply_id` (`0` for top level), `reply_to_reply_id`, `text_extra` | `status_code` and `comment`, in the same shape as `/api/comment/list/` items |
| GET `/api/at/default/list/` | `cursor`, `count` | `status_code`, `user_list` of app-shaped users you follow (friends first), empty `block_results`; empty when logged out. Fills the @mention picker before you type |
| GET `/api/mention/recent/contact/list/v1/` | `mentionType`, `secUid` | `statusCode` and an empty `userList`: recent mentions aren't tracked |
| GET `/api/comment/search/sug/user/` | `keyword`, `count`, `uid_filter_list` (ids already shown) | `statusCode`, `userList` of web user shapes matching username or name, prefix matches first, and `hasMore` |
| GET `/api/comment/list/` | `aweme_id`, `cursor` (`0` first), `count` | top-level `comments` newest first, `cursor` (last `cid`), `has_more` (1/0), `total` (all comments, used as the video's comment count) |
| GET `/api/comment/list/reply/` | `comment_id`, `cursor`, `count` (3) | replies oldest first, `cursor`, `has_more` (must be the number 1 to show "View more") |
| POST `/api/comment/digg/` | `cid`, `digg_type` (1 like, 2 unlike) | `status_code`. Each comment carries `digg_count`, `user_digged` (1/0), and `reply_comment_total` |

Threads are one level deep. A reply to a reply is attached to the root comment, and its `reply_to_reply_id` target is not stored.

### Other notes

The client reports no usable play event of its own, and it fetches media with `fetch()` from the browser cache and preloads the next video, so media requests cannot measure views. Instead `src/client/bridge.js` listens for `playing` on videos inside `xgwrapper-<n>-<itemId>` and posts `{id}` to `POST /_kittok/view` once per page. Signed-in viewers are keyed by account; guests by an HMAC of their address with a per-process secret, so raw IPs are never stored and guest deduplication resets on restart. Reports are limited to 120 a minute per address.

The client's security SDK re-opens XHR requests and replays their headers, so `X-CSRF-Token` can arrive as `token, token`. Kittok accepts that only when every copy matches the session token.

The admin panel runs inside the client at `/admin`. The client's router has no admin route, so the bridge boots it on an empty page and `public/admin.js` draws the console with the client's own components and stylesheets. Each admin page has its own URL. Reviewing is keyboard driven: `j`/`k` and Enter in the queue, `V`/`N`, `1` to `0` for a policy, `R`, `B`, `S`, and Cmd/Ctrl+Enter in review, `/` to search, and `?` for the list. Admins get an extra Admin item in the client's sidebar, feature switches hide sidebar entries with CSS, and the bridge removes the client's in-app TikTok Shop promotion, which links to the real shop.

## Direct message protocol

The DM inbox loads only when the signed-in user has `hasIMPermission`. Its SDK sends protobuf `Request` messages and reads `Response` messages (`application/x-protobuf`), either as an HTTP POST to the `imApi` origin (`/v1/message/send`, `/v2/message/get_by_user_init`, …) or inside a protobuf `Frame` (`service` 5, `payload_type: "pb"`) on the `imFrontier` WebSocket at `/ws/v2`. Kittok handles both on the same origin; the path does not matter, only `cmd`. Field numbers in `src/im/schema.mjs` are generated from the cached client's encoders and only cover the commands Kittok handles. The codec in `src/im/protobuf.mjs` was checked byte-for-byte against the client encoder. 64-bit values are decimal strings.

The socket must accept one of the offered subprotocols (`binary`, `base64`, `pbbp2`); Kittok picks `pbbp2`. The client sends the text `hi` every 15 seconds and reconnects after 30 seconds without any data, so Kittok echoes it. Responses reuse the request's `seqid` and `sequence_id`; pushes use 0. Authentication is the session cookie (`auth_type` 1, session auth), and the upgrade requires this instance's Origin.

| Command | Request body | Kittok behavior |
| --- | --- | --- |
| 203 init | `messages_per_user_init_v2_body` | All the user's conversations and up to 20 recent messages each; `per_user_cursor` is the newest visible message ID. Inbox 0 contains accepted chats; inbox 3 contains eligible message requests with `ext.stranger` metadata |
| 200, 204 pull | `messages_per_user_body`, `messages_per_user_combo_body` (per inbox `cursor`) | Messages with an ID above the cursor, oldest first, with `next_cursor` and `has_more` |
| 609 create | `create_conversation_v2_body` (`participants`) | Finds or creates the one-to-one conversation `0:1:<lower id>:<higher id>`; the SDK reads the inbox from the first segment. 11 if either user blocked the other; 4 for group chats |
| 100 send | `send_message_body` (`conversation_short_id`, `message_type`, JSON `content`, `client_message_id`) | Stores the message with the next `index_in_conversation` and pushes 500 `has_new_message_notify` (with `previous_cursor`, `next_cursor`, and the recipient's `badge_count`) to every member's sockets. Repeating a `client_message_id` returns the original. `status` 5 when blocked. Text is type 7 with `{"aweType":0,"text":…}` |
| 301, 304 history | `messages_in_conversation_body` (direction, anchor), `messages_in_conversation_with_range` | Older or newer pages by index; the range command returns `messages_pb`, each an encoded `MessageBody` |
| 604, 2002 read | `mark_conversation_read_body` (`read_message_index`) | Raises the reader’s index; pushes 501 and exposes peer indexes only with mutual read-status consent in accepted, unblocked chats |
| 603 delete | `delete_conversation_body` | Hides the conversation's history for that user only |
| 411 typing | `send_input_status_body` | Pushes 510 only to accepted, unblocked peers |
| 701 / 702 message actions | `delete_message_body` / `recall_message_body` | Personal hide / sender-only unsend within three minutes; recall pushes native type 50021 without inserting a fake chat message |

Unknown commands return status 5 and are counted in `/_debug/unknown`. Messages carry `s:client_message_id` in `ext` because the client's store keys messages by it. `create_time` is in milliseconds. Participant profiles come from GET `/tiktok/v1/im/user/profile/?user_ids=["id",…]`, which returns `users[{im_user_profile: {user_id, unique_id, nick_name, avatars, follow_status, follower_status, block_info}}]`.

The client's conversation list drops conversations without a last message and leaves their preview blank. Kittok rewrites those two expressions when serving the bundle so empty conversations appear with "No messages yet".

## Settings page contract

The client's fetch wrapper rejects any non-2xx response, and one rejection ends every request stream in that Settings module, so every call the page makes must answer 200; unsupported actions return `status_code` 1 with a `status_msg`. GET `/api/privacy/setting/restriction/v1/` returns `privacy_restriction.account[key] = {show_type, values[{value, show_type}]}` (show types 0 show, 1 disabled, 2 hide; a missing key is hidden, except `comment`, which the list reads unguarded) and `privacy_settings[key]` with the user's values. GET `/api/privacy/unified_config/v1` returns `configs`, a JSON string of server-defined pages keyed by page tag (`main`, `direct_message_permission`, `dm_friends`, `dm_potential_connection`, `dm_others`), each with sections of items (`item_type` 0 disclosure, 1 switch, 2 radio; `item_info.restriction_key`, `setting_key`, `label_config`, `options`). The client attaches its handlers by tag: `direct_message_entrance`, `dm_*_permission_entrance`, and `options_inbox` / `options_request` / `options_dont_receive`. POST `/api/privacy/user/settings/update/v1` takes `field` and `value` (1 inbox, 2 message requests, 3 don’t receive; `message_read_status` and `private_account` use 0/1; `comment` uses 0 everyone, 1 friends, 2 no one, 3 followers).

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

## Narrow layouts

`public/responsive.css` adapts the captured desktop settings and inbox at widths below 760 px. Settings use a single scrollable column with a back link. The inbox preserves the compact navigation rail; opening a conversation shows a full-width chat with a back button. The upload, follow-request and post-edit screens also reflow. These changes were visually checked at 390×844 and desktop width. They depend on captured DOM selectors and should be rechecked when updating the client.
