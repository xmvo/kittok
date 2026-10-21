import { Escape, HttpError, Id, ReadBody, RequireMethod } from '../http.mjs';
import { Categories, Category, GuessCategory } from '../categories.mjs';
import { RequireCsrf } from '../auth.mjs';
import { Page } from './account.mjs';
import { AvatarUrl } from '../store.mjs';
import { PostSettings, SetPrivateAccount, DecideFollowRequest, FollowRequests } from '../privacy.mjs';
import { Public } from '../client/shell.mjs';

const Visibility = (Private, Current = 'public') => [['public', Private ? 'Followers (approved)' : 'Everyone'], ['followers', 'Followers'], ['friends', 'Friends (followers you follow back)'], ['only_me', 'Only you']].filter(([Value]) => !Private || Value !== (Current === 'followers' ? 'public' : 'followers'));
const Comments = [['default', 'Use account settings'], ['everyone', 'Everyone'], ['followers', 'Followers'], ['friends', 'Friends'], ['none', 'No one']];
const CategoryOptions = [['', 'Automatic from hashtags'], ...Categories.map(([Type, Label]) => [String(Type), Label]), ['0', 'None']];
const Select = (Name, Title, Options, Value) => `<label>${Title}<select name="${Name}">${Options.map(([Key, Text]) => `<option value="${Key}"${Key === Value ? ' selected' : ''}>${Text}</option>`).join('')}</select></label>`;
const Csrf = User => `<input type="hidden" name="csrf" value="${Escape(User.csrf_token)}">`;
const Redirect = (Response, To) => { Response.writeHead(303, { location: To }); Response.end(); return true; };

export async function Studio({ Request, Response, Url, Pool, Config, User }) {
	const Path = Url.pathname, Post = /^\/account\/posts\/(\d+)$/.exec(Path);
	if (!['/upload', '/tiktokstudio/upload', '/account/posts', '/account/requests', '/account/privacy'].includes(Path) && !Post) return false;
	if (!User) return Redirect(Response, '/login');
	let Title, Content;
	if (['/upload', '/tiktokstudio/upload'].includes(Path)) {
		RequireMethod(Request, ['GET']);
		if (Config.Features?.upload === false) throw new HttpError(403, 'UploadsDisabled');
		Title = 'Upload video';
		Content = `<div class="studio-heading"><div><h1>Upload video</h1><p>Post a video to your account</p></div><a href="/account/posts">Manage posts</a></div>
		<form id="upload" class="upload-layout"><section class="upload-file"><label id="drop-zone" tabindex="0"><span class="upload-symbol" aria-hidden="true">↑</span><strong>Select video to upload</strong><span>Or drag and drop a file</span><span class="file-help">MP4 or WebM · Up to ${Math.round(Config.MaxVideoBytes / 1024 / 1024)} MB · ${Config.MaxVideoSeconds} seconds</span><input required name="video" type="file" accept="video/mp4,video/webm,video/quicktime"><span class="choose-file">Select video</span></label><video id="video-preview" controls playsinline hidden></video><button id="change-video" class="secondary" type="button" hidden>Change video</button><p id="file-name"></p></section>
		<section class="upload-details"><label>Caption<textarea name="description" maxlength="2200" rows="5" placeholder="Describe your video"></textarea><span id="caption-count">0 / 2200</span></label>${Select('visibility', 'Who can view this video', Visibility(User.private_account), 'public')}${Select('comments', 'Who can comment', Comments, 'default')}${Select('category', 'Explore category', CategoryOptions, '')}<label class="toggle-row"><input type="checkbox" name="story"><span><strong>Share to story</strong><small>Shows in the stories tray for 24 hours instead of on your profile.</small></span></label><p class="field-help">Your account’s privacy and comment settings also apply.</p><div class="upload-actions"><button type="reset" class="secondary">Discard</button><button type="submit">Post</button></div><progress id="upload-progress" max="100" value="0" hidden></progress><p id="status" role="status" aria-live="polite"></p><a id="posted-link" hidden>View video</a></section></form><script id="upload-config" type="application/json">${JSON.stringify({ csrf: User.csrf_token, maxBytes: Config.MaxVideoBytes, username: User.username }).replaceAll('<', '\\u003c')}</script><script src="${Public('upload.js')}"></script>`;
	} else if (Path === '/account/privacy') {
		if (Request.method === 'POST') {
			const Body = await ReadBody(Request); RequireCsrf(Request, User, Body.csrf);
			if (!['0', '1'].includes(Body.private_account) || !['everyone', 'followers', 'friends', 'none'].includes(Body.comments)) throw new HttpError(400, 'InvalidAccountPrivacy');
			await SetPrivateAccount(Pool, User.id, Body.private_account);
			await Pool.query('UPDATE users SET comment_permission = $2 WHERE id = $1', [User.id, Body.comments]);
			return Redirect(Response, '/account/privacy?saved=1');
		}
		RequireMethod(Request, ['GET']); Title = 'Privacy';
		Content = `<h1>Privacy</h1>${Url.searchParams.has('saved') ? '<p role="status">Settings saved.</p>' : ''}<form method="post">${Csrf(User)}${Select('private_account', 'Account visibility', [['0', 'Public account'], ['1', 'Private account']], User.private_account ? '1' : '0')}<p class="field-help">With a private account, only approved followers can view your posts. Your name, photo and bio stay public. Existing followers remain approved. Switching to public accepts pending follow requests.</p>${Select('comments', 'Who can comment on your posts', Comments.filter(([Value]) => Value !== 'default'), User.comment_permission)}<button>Save</button></form><p><a href="/account/requests">Follow requests</a> · <a href="/setting/privacy/direct-messages">Direct messages</a> · <a href="/account/posts">Post privacy</a></p>`;
	} else if (Path === '/account/requests') {
		if (Request.method === 'POST') {
			const Body = await ReadBody(Request); RequireCsrf(Request, User, Body.csrf);
			if (!['accept', 'delete'].includes(Body.action)) throw new HttpError(400, 'InvalidFollowAction');
			await DecideFollowRequest(Pool, User.id, Id(Body.user), Body.action === 'accept');
			return Redirect(Response, '/account/requests');
		}
		RequireMethod(Request, ['GET']); Title = 'Follow requests';
		const Rows = await FollowRequests(Pool, User.id);
		Content = `<h1>Follow requests</h1><p>People asking to follow your private account</p><div class="request-list">${Rows.map(Row => `<article class="follow-request"><img src="${AvatarUrl(Row, Config.Origin)}" alt=""><a href="/@${Row.username}"><strong>${Escape(Row.display_name)}</strong><span>@${Row.username}</span></a><form method="post">${Csrf(User)}<input type="hidden" name="user" value="${Row.id}"><button name="action" value="accept">Confirm</button><button name="action" value="delete" class="secondary">Delete</button></form></article>`).join('') || '<div class="empty-state"><h2>No follow requests</h2><p>New requests will appear here.</p></div>'}</div>`;
	} else if (Post) {
		const Row = (await Pool.query('SELECT * FROM videos WHERE id = $1 AND author_id = $2', [Id(Post[1]), User.id])).rows[0];
		if (!Row) throw new HttpError(404, 'VideoNotFound');
		if (Request.method === 'POST') {
			const Body = await ReadBody(Request); RequireCsrf(Request, User, Body.csrf);
			const Settings = PostSettings(Body.visibility, Body.comments);
			const Chosen = Category(Body.category) ?? GuessCategory(Row.description);
			const Pin = Body.pinned === '1';
			if (Pin && !Row.pinned_at && (await Pool.query('SELECT count(*)::int AS pinned FROM videos WHERE author_id = $1 AND pinned_at IS NOT NULL', [User.id])).rows[0].pinned >= 3) return Redirect(Response, Path + '?error=pins');
			await Pool.query('UPDATE videos SET visibility = $3, comment_permission = $4, category = $5, pinned_at = CASE WHEN $6 THEN coalesce(pinned_at, now()) END WHERE id = $1 AND author_id = $2', [Row.id, User.id, Settings.visibility, Settings.comment_permission, Chosen, Pin]);
			return Redirect(Response, Path + '?saved=1');
		}
		RequireMethod(Request, ['GET']); Title = 'Post settings';
		Content = `<h1>Post settings</h1>${Url.searchParams.has('saved') ? '<p role="status">Settings saved.</p>' : ''}${Url.searchParams.get('error') === 'pins' ? '<p role="alert">You can pin up to 3 videos. Unpin one first.</p>' : ''}<div class="post-editor"><a href="/@${User.username}/video/${Row.id}"><img class="post-cover" src="/media/${Row.cover_name}" alt="Video cover"></a><div><p>${Escape(Row.description || 'Untitled video')}</p><form method="post">${Csrf(User)}${Select('visibility', 'Who can view this video', Visibility(User.private_account, Row.visibility), Row.visibility)}${Select('comments', 'Who can comment', Comments, Row.comment_permission)}${Select('category', 'Explore category', CategoryOptions, Row.category >= 0 ? String(Row.category) : '')}<label class="check"><input type="checkbox" name="pinned" value="1"${Row.pinned_at ? ' checked' : ''}> Pin to the top of your profile</label><p class="field-help">Your account’s privacy and comment settings also apply.</p><button>Save</button></form></div></div><p><a href="/account/posts">Back to posts</a></p>`;
	} else {
		RequireMethod(Request, ['GET']); Title = 'Your posts';
		const Before = Url.searchParams.has('before') ? Id(Url.searchParams.get('before')) : null;
		const Rows = (await Pool.query('SELECT id, description, cover_name, visibility FROM videos WHERE author_id = $1 AND story_expires_at IS NULL AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT 25', [User.id, Before])).rows;
		Content = `<div class="studio-heading"><h1>Your posts</h1><a class="button" href="/upload">Upload video</a></div><div class="post-grid">${Rows.map(Row => `<a class="post-card" href="/account/posts/${Row.id}"><img src="/media/${Row.cover_name}" alt=""><strong>${Escape(Row.description || 'Untitled video')}</strong><span>${Escape(Visibility(User.private_account, Row.visibility).find(([Value]) => Value === Row.visibility)[1])}</span></a>`).join('') || '<div class="empty-state"><h2>No posts yet</h2><p>Your videos will appear here.</p></div>'}</div>${Rows.length === 25 ? `<a href="?before=${Rows.at(-1).id}">More posts</a>` : ''}`;
	}
	Response.setHeader('content-type', 'text/html; charset=utf-8');
	Response.setHeader('cache-control', 'no-store');
	Response.end(Page(Config, Title, `<link rel="stylesheet" href="${Public('studio.css')}"><nav class="account-nav"><a href="/@${User.username}">Your profile</a><a href="/account/privacy">Privacy</a><a href="/account/requests">Follow requests</a></nav>${Content}`).replace('<main>', '<main class="studio">'));
	return true;
}
