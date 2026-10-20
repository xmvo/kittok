import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetUrl, ClientDir, LocalAsset, ReadJsonScript, Root, LoginManifestUrl, RewriteAssets } from '../src/client/archive.mjs';
import { Shell } from '../src/client/shell.mjs';
import { LoadConfig } from '../src/config.mjs';
import { Database, Migrate } from '../src/db.mjs';
import { CreateUser, Hash, Token, PasswordMatches, Login } from '../src/auth.mjs';
import { ImportVideo } from '../src/media.mjs';
import { runInNewContext } from 'node:vm';
import { DecodePassportValue } from '../src/routes/passport.mjs';
import { Proto } from '../src/routes/im.mjs';
import { request as HttpRequest } from 'node:http';

const Origin = 'http://127.0.0.1:13210';
const Password = 'test-only-password-123456';
let Pool, Config, Directory, Server, Owner, Friend, VideoId, Session, Cookie;
if (!process.env.KITTOK_TEST_DATABASE?.startsWith('kittok_test_') || !new URL(process.env.DATABASE_URL).pathname.endsWith(process.env.KITTOK_TEST_DATABASE)) throw new Error('Run npm test: isolated database required');
async function Start() {
	Server = spawn(process.execPath, ['src/server.mjs'], { cwd: Root, env: { ...process.env, MEDIA_DIR: Directory }, stdio: ['ignore', 'pipe', 'pipe'] });
	await new Promise((Resolve, Reject) => {
		let Output = '';
		const Timer = setTimeout(() => Reject(new Error('ServerStartTimeout:' + Output)), 10000);
		Server.once('error', Error => { clearTimeout(Timer); Reject(Error); });
		Server.once('exit', Code => { clearTimeout(Timer); Reject(new Error(`ServerExit${Code}:${Output}`)); });
		Server.stderr.on('data', Chunk => { Output += Chunk; });
		Server.stdout.on('data', Chunk => { Output += Chunk; if (Output.includes('Kittok ready:')) { clearTimeout(Timer); Resolve(); } });
	});
}
async function Stop() {
	if (Server?.exitCode === null) { const Exited = once(Server, 'exit'); Server.kill(); await Exited; }
}
function Auth(Extra = {}) { return { cookie: Cookie, 'x-csrf-token': Session.csrfToken, ...Extra }; }
async function Call(Path, Method = 'GET', Body, Headers = {}) {
	return fetch(Origin + Path, { method: Method, headers: { ...Headers, ...(Body ? { 'content-type': 'application/json' } : {}) }, body: Body ? JSON.stringify(Body) : undefined });
}
before(async () => {
	Directory = await mkdtemp(join(tmpdir(), 'kittok-media-test-'));
	Config = { ...LoadConfig(), MediaDir: Directory };
	Pool = Database(Config.DatabaseUrl); await Migrate(Pool); await Migrate(Pool);
	Owner = await CreateUser(Pool, { username: 'owner', displayName: 'Test Owner', password: Password, role: 'admin' }, 'closed', true);
	Friend = await CreateUser(Pool, { username: 'friend', displayName: 'Test Friend', password: Password }, 'closed', true);
	const Input = join(Directory, 'input.mp4');
	const Generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x160:rate=12:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', Input]);
	assert.equal(Generated.status, 0);
	VideoId = await ImportVideo(Pool, Config, Owner.id, Input, 'First #kittok video');
	await Start();
	const Login = await Call('/api/v1/session', 'POST', { username: 'owner', password: Password });
	assert.equal(Login.status, 200);
	Cookie = Login.headers.get('set-cookie').split(';')[0]; Session = await Login.json();
});
after(async () => { await Stop(); await Pool?.end(); if (Directory) await rm(Directory, { recursive: true, force: true }); });

test('only approved CDN asset origins can use the cache', () => {
	for (const Url of ['http://127.0.0.1/private', 'https://example.com/obj/file.js', 'https://lf16-tiktok-web.tiktokcdn-us.com:444/obj/file.js', 'https://lf16-tiktok-web.tiktokcdn-us.com/not-an-asset', 'https://user:password@lf16-tiktok-web.tiktokcdn-us.com/obj/file.js']) assert.throws(() => AssetUrl(Url));
	assert.equal(LocalAsset('//lf16-tiktok-web.tiktokcdn-us.com/obj/example.js'), '/_client/lf16-tiktok-web.tiktokcdn-us.com/obj/example.js');
	assert.equal(AssetUrl(LoginManifestUrl).pathname, '/module_meta/common-login/vmok-manifest.json');
	assert.throws(() => AssetUrl('https://www.tiktok.com/passport/web/user/login/'));
});

test('original login page preserves its own build and startup state while keeping redirects local', async () => {
	const Page = await Call('/login'); assert.equal(Page.status, 200);
	const Html = await Page.text();
	assert.ok(Html.includes('webapp-login-page/static/js/'));
	const Legacy = ReadJsonScript(Html, 'SIGI_STATE');
	assert.equal(Legacy.AppContext.appContext.host, '127.0.0.1:13210');
	assert.equal(Legacy.AppContext.appContext.encryptedWebid, '');
	assert.deepEqual(Legacy.LoginContextModule.ttpConfig.syncSeverList, []);
	assert.equal(Legacy.LoginContextModule.redirectUrl, Origin);
	assert.equal((await Call('/login/phone-or-email/email')).status, 200);
	assert.equal((await fetch(Origin + '/account', { redirect: 'manual' })).headers.get('location'), '/login');
	assert.equal((await fetch(Origin + '/foryou?lang=en', { redirect: 'manual' })).headers.get('location'), '/?lang=en');
	assert.equal(RewriteAssets('https://www.tiktok.com/foryou?lang=en', Origin), Origin + '/foryou?lang=en');
});

test('native Passport sign-in decodes the original SDK request and creates a revocable local session', async () => {
	const Encode = Value => Buffer.from(Value, 'utf8').map(Byte => Byte ^ 5).toString('hex');
	assert.equal(DecodePassportValue(Encode('Kittén'), true), 'Kittén');
	assert.throws(() => DecodePassportValue('not-hex', true));
	const Body = new URLSearchParams({ account: Encode('owner'), password: Encode(Password), mix_mode: '1', fixed_mix_mode: '1' });
	const Login = await fetch(Origin + '/passport/web/user/login/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: Body });
	assert.equal(Login.status, 200);
	const Result = await Login.json(); assert.equal(Result.message, 'success'); assert.equal(Result.data.user_id, Owner.id);
	assert.equal(Result.data.redirect_url, Origin); assert.ok(!('session_key' in Result.data));
	const NativeCookie = Login.headers.get('set-cookie').split(';')[0];
	const Current = await (await Call('/api/v1/session', 'GET', undefined, { cookie: NativeCookie })).json();
	assert.equal(Current.user.uniqueId, 'owner');
	for (const Path of ['/', '/@owner']) {
		const Page = await Call(Path, 'GET', undefined, { cookie: NativeCookie });
		assert.equal(Page.headers.get('cache-control'), 'no-store');
		const App = ReadJsonScript(await Page.text(), '__UNIVERSAL_DATA_FOR_REHYDRATION__').__DEFAULT_SCOPE__['webapp.app-context'];
		assert.equal(App.user.uid, Owner.id); assert.equal(App.user.uniqueId, 'owner');
		assert.equal(App.user.nickName, 'Test Owner'); assert.equal(App.csrfToken, Current.csrfToken);
		assert.deepEqual(App.user.avatarUri, [Origin + '/public/avatar.svg']);
	}
	const Info = await (await Call('/passport/account/info/v2/', 'GET', undefined, { cookie: NativeCookie })).json(); assert.equal(Info.data.user_id, Owner.id);
	const Failed = await fetch(Origin + '/passport/web/user/login/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ account: Encode('owner'), password: Encode('incorrect'), mix_mode: '1' }) });
	assert.equal((await Failed.json()).message, 'error'); assert.equal(Failed.headers.get('set-cookie'), null);
	assert.equal((await Call('/passport/web/logout/', 'POST', undefined, { cookie: NativeCookie })).status, 403);
	assert.equal((await Call('/passport/web/logout/', 'POST', undefined, { cookie: NativeCookie, 'x-csrf-token': Current.csrfToken })).status, 200);
	assert.equal((await (await Call('/api/v1/session', 'GET', undefined, { cookie: NativeCookie })).json()).user, null);
	const Guest = ReadJsonScript(await (await Call('/', 'GET', undefined, { cookie: NativeCookie })).text(), '__UNIVERSAL_DATA_FOR_REHYDRATION__').__DEFAULT_SCOPE__['webapp.app-context'];
	assert.equal(Guest.user, undefined);
	assert.equal((await Call('/_kittok/bridge.js')).headers.get('cache-control'), 'no-store');
});

test('browser bridge redirects API fetches locally and preserves request bodies and CSRF headers', async () => {
	const Calls = [];
	const Window = { fetch: async (...Args) => { Calls.push(Args); return new Response('{}'); }, addEventListener() {} };
	const Document = { getElementById: () => ({ textContent: JSON.stringify({ name: 'Kittok', csrfToken: 'test-csrf' }) }), documentElement: { style: { setProperty() {} } }, addEventListener() {} };
	runInNewContext(await readFile(join(Root, 'src/client/bridge.js'), 'utf8'), { window: Window, document: Document, location: { origin: Origin }, Request, Headers, URL, XMLHttpRequest: class { open() {} }, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} } });
	await Window.fetch('https://www.tiktok.com/api/recommend/item_list/', { method: 'POST', body: 'count=20' });
	assert.equal(Calls[0][0], Origin + '/api/recommend/item_list/');
	assert.equal(Calls[0][1].headers.get('x-csrf-token'), 'test-csrf');
	assert.equal(Calls[0][1].body, 'count=20');
	await Window.fetch(new Request('https://www.tiktok.com/api/comment/publish/', { method: 'POST', body: 'hello' }));
	assert.equal(Calls[1][0].url, Origin + '/api/comment/publish/');
	assert.equal(await Calls[1][0].text(), 'hello');
	await Window.fetch('https://unrelated.example/collect');
	assert.ok(Calls[2][0].startsWith(Origin + '/_blocked'));
});

test('public domain config requires HTTPS, validates registration, and keeps distinct storage paths', () => {
	assert.throws(() => LoadConfig({ DATABASE_URL: Config.DatabaseUrl, PUBLIC_ORIGIN: 'http://example.com' }), /HTTPS/);
	assert.throws(() => LoadConfig({ DATABASE_URL: Config.DatabaseUrl, REGISTRATION_MODE: 'anything' }), /Registration/);
	const Public = LoadConfig({ DATABASE_URL: Config.DatabaseUrl, PUBLIC_ORIGIN: 'https://videos.example.com', INSTANCE_NAME: 'Kitten Club', MEDIA_DIR: '/tmp/another-instance' });
	assert.equal(Public.SecureCookies, true); assert.equal(Public.Name, 'Kitten Club'); assert.equal(Public.MediaDir, '/tmp/another-instance');
});

test('captured client bootstrap uses local domains without leaked guest identifiers', async () => {
	const Html = Shell(await readFile(join(ClientDir, 'index.html'), 'utf8'), Origin, { Config, User: { ...Owner, csrf_token: Session.csrfToken } });
	const Scope = ReadJsonScript(Html, '__UNIVERSAL_DATA_FOR_REHYDRATION__').__DEFAULT_SCOPE__;
	assert.equal(Scope['webapp.app-context'].host, '127.0.0.1:13210');
	assert.equal(Scope['webapp.app-context'].encryptedWebid, '');
	assert.equal(Scope['webapp.biz-context'].hashedIP, '');
	assert.equal(ReadJsonScript(Html, 'api-domains').rootApi, Origin);
	assert.equal(ReadJsonScript(Html, 'kittok-instance').account.username, 'owner');
	assert.ok(!Html.includes('src="//lf16-tiktok-web.tiktokcdn-us.com'));
	assert.ok(Html.includes('/_kittok/bridge.js'));
});

test('migrations are idempotent and passwords and session tokens are hashed at rest', async () => {
	assert.equal((await Pool.query('SELECT * FROM schema_migrations')).rowCount, (await readdir(join(Root, 'migrations'))).filter(Name => /^\d+.*\.sql$/.test(Name)).length);
	const User = (await Pool.query('SELECT password_hash FROM users WHERE id=$1', [Owner.id])).rows[0];
	assert.notEqual(User.password_hash, Password); assert.ok(await PasswordMatches(Password, User.password_hash));
	const Sessions = await Pool.query('SELECT token_hash FROM sessions WHERE user_id=$1', [Owner.id]);
	assert.equal(Sessions.rows[0].token_hash, Hash(Cookie.split('=')[1]));
	assert.equal((await Call('/api/v1/session', 'POST', { username: 'owner', password: 'wrong' })).status, 401);
});

test('invites have one-use enforcement and clients cannot choose an admin role', async () => {
	const Code = Token(); await Pool.query("INSERT INTO invites(token_hash, created_by, expires_at) VALUES ($1,$2,now()+interval '1 day')", [Hash(Code), Owner.id]);
	const New = await Call('/api/v1/users', 'POST', { username: 'newkitten', displayName: 'New Kitten', password: Password, role: 'admin', invite: Code });
	assert.equal(New.status, 201);
	assert.equal((await Pool.query("SELECT role FROM users WHERE username='newkitten'")).rows[0].role, 'member');
	assert.equal((await Call('/api/v1/users', 'POST', { username: 'anotherkitten', password: Password, invite: Code })).status, 403);
});

test('all observed original feed methods return database video data', async () => {
	for (const [Method, Path] of [['GET', '/api/recommend/item_list/'], ['GET', '/api/preload/item_list/'], ['POST', '/api/recommend/item_list/']]) {
		const Response = await Call(Path, Method); assert.equal(Response.status, 200);
		const Feed = await Response.json(); assert.equal(Feed.itemList[0].id, VideoId); assert.equal(Feed.itemList[0].author.uniqueId, 'owner');
		assert.ok(Feed.itemList[0].video.playAddr.startsWith(Origin + '/media/')); assert.equal(Feed.hasMore, false);
	}
});

test('media byte ranges, suffix ranges, HEAD, and invalid ranges work over HTTP', async () => {
	const Video = (await (await Call('/api/v1/videos')).json()).items[0];
	const Full = Buffer.from(await (await fetch(Video.video.playAddr)).arrayBuffer());
	const Range = await fetch(Video.video.playAddr, { headers: { range: 'bytes=100-199' } }); assert.equal(Range.status, 206);
	assert.deepEqual(Buffer.from(await Range.arrayBuffer()), Full.subarray(100, 200));
	const Suffix = await fetch(Video.video.playAddr, { headers: { range: 'bytes=-10' } });
	assert.deepEqual(Buffer.from(await Suffix.arrayBuffer()), Full.subarray(-10));
	const Head = await fetch(Video.video.playAddr, { method: 'HEAD' }); assert.equal((await Head.arrayBuffer()).byteLength, 0); assert.equal(Number(Head.headers.get('content-length')), Full.length);
	assert.equal((await fetch(Video.video.playAddr, { headers: { range: `bytes=${Full.length}-` } })).status, 416);
});

test('bridge play reports count one view per viewer per window and media requests do not count', async () => {
	const Play = (await (await Call('/api/v1/videos')).json()).items.find(Item => Item.id === VideoId).video.playAddr;
	const Views = async () => Number((await Pool.query('SELECT view_count FROM videos WHERE id=$1', [VideoId])).rows[0].view_count);
	const View = (Headers = {}, Id = VideoId) => Call('/_kittok/view', 'POST', { id: Id }, Headers);
	const Start = await Views();
	await (await fetch(Play)).arrayBuffer();
	assert.equal(await Views(), Start);
	assert.equal((await View()).status, 204);
	assert.equal(await Views(), Start + 1);
	await View();
	assert.equal(await Views(), Start + 1);
	await View({ cookie: Cookie });
	assert.equal(await Views(), Start + 2);
	await View({ cookie: Cookie });
	assert.equal(await Views(), Start + 2);
	assert.equal((await View({}, 'nope')).status, 400);
	assert.equal((await View({}, '1')).status, 204);
	assert.equal((await Call('/_kittok/view')).status, 405);
	await Pool.query("UPDATE video_views SET viewed_at = now() - interval '7 hours' WHERE video_id=$1", [VideoId]);
	await View({ cookie: Cookie });
	assert.equal(await Views(), Start + 3);
	const Item = (await (await Call(`/api/item/detail/?itemId=${VideoId}`)).json()).itemInfo.itemStruct;
	assert.equal(Item.stats.playCount, Start + 3); assert.equal(Item.statsV2.playCount, String(Start + 3));
});

test('social mutations enforce authentication and CSRF, and repeated likes stay unique', async () => {
	const Path = `/api/v1/videos/${VideoId}/like`;
	assert.equal((await Call(Path, 'PUT')).status, 401);
	assert.equal((await Call(Path, 'PUT', undefined, { cookie: Cookie })).status, 403);
	assert.equal((await Call(Path, 'PUT', undefined, Auth({ 'x-csrf-token': `${Session.csrfToken}, ${'0'.repeat(64)}` }))).status, 403);
	assert.equal((await Call(Path, 'PUT', undefined, Auth({ 'x-csrf-token': `${Session.csrfToken}, ${Session.csrfToken}` }))).status, 200);
	assert.equal((await Call(Path, 'PUT', undefined, Auth())).status, 200);
	assert.equal((await Call(Path, 'PUT', undefined, Auth())).status, 200);
	assert.equal((await Pool.query('SELECT * FROM likes WHERE video_id=$1', [VideoId])).rowCount, 1);
	const Feed = await (await Call('/api/recommend/item_list/', 'GET', undefined, Auth())).json(); assert.equal(Feed.itemList[0].stats.diggCount, 1); assert.equal(Feed.itemList[0].digged, true);
	assert.equal((await Call(`/api/v1/videos/${VideoId}/comments`, 'POST', { text: 'Hello kitten!' }, Auth())).status, 201);
	assert.equal((await Call(`/api/comment/list/?aweme_id=${VideoId}`)).status, 200);
	assert.equal((await Call('/api/v1/users/friend/follow', 'PUT', undefined, Auth())).status, 200);
	assert.equal((await Pool.query('SELECT * FROM follows WHERE follower_id=$1 AND following_id=$2', [Owner.id, Friend.id])).rowCount, 1);
});

test('original client favorite requests toggle persistent favorites and are read back on feed, detail, and profile', async () => {
	const Collect = Action => Call(`/api/item/collect/?aid=1988&itemId=${VideoId}&action=${Action}&secUid=${Owner.id}`, 'POST', undefined, Auth());
	assert.equal((await Call(`/api/item/collect/?itemId=${VideoId}&action=1`, 'POST', undefined, { cookie: Cookie })).status, 403);
	assert.deepEqual(await (await Collect(1)).json(), { status_code: 0, statusCode: 0, collected: true, collectCount: 1 });
	assert.equal((await Collect(1)).status, 200);
	assert.equal((await Pool.query('SELECT * FROM favorites WHERE user_id=$1 AND video_id=$2', [Owner.id, VideoId])).rowCount, 1);
	const Item = (await (await Call('/api/recommend/item_list/', 'GET', undefined, Auth())).json()).itemList.find(Item => Item.id === VideoId);
	assert.equal(Item.collected, true); assert.equal(Item.stats.collectCount, 1); assert.equal(Item.statsV2.collectCount, '1');
	assert.equal((await (await Call(`/api/item/detail/?itemId=${VideoId}`, 'GET', undefined, Auth())).json()).itemInfo.itemStruct.collected, true);
	assert.equal((await (await Call(`/api/item/detail/?itemId=${VideoId}`)).json()).itemInfo.itemStruct.collected, false);
	const Saved = await (await Call(`/api/user/collect/item_list/?secUid=${Owner.id}&count=30&cursor=0`, 'GET', undefined, Auth())).json();
	assert.equal(Saved.statusCode, 0); assert.deepEqual(Saved.itemList.map(Item => Item.id), [VideoId]);
	assert.deepEqual((await (await Call(`/api/user/collect/item_list/?secUid=${Friend.id}`, 'GET', undefined, Auth())).json()).itemList, []);
	assert.deepEqual((await (await Call(`/api/user/collect/item_list/?secUid=${Owner.id}`)).json()).itemList, []);
	assert.deepEqual(await (await Collect(2)).json(), { status_code: 0, statusCode: 0, collected: false, collectCount: 0 });
	assert.deepEqual((await (await Call(`/api/user/collect/item_list/?secUid=${Owner.id}`, 'GET', undefined, Auth())).json()).itemList, []);
	assert.equal((await Call('/api/item/collect/?itemId=1&action=1', 'POST', undefined, Auth())).status, 404);
	assert.equal((await Collect(1)).status, 200);
});

test('original client like requests persist and never report is_digg equal to the requested type', async () => {
	const Digg = (Type, Headers = Auth()) => Call(`/api/commit/item/digg/?aweme_id=${VideoId}&channel_id=0&type=${Type}`, 'POST', undefined, Headers);
	const Item = async () => (await (await Call('/api/recommend/item_list/', 'GET', undefined, Auth())).json()).itemList.find(Item => Item.id === VideoId);
	assert.equal((await Digg(1, { cookie: Cookie })).status, 403);
	const Unliked = await (await Digg(0)).json();
	assert.equal(Unliked.status_code, 0); assert.notEqual(Unliked.is_digg, 0);
	assert.equal((await Pool.query('SELECT * FROM likes WHERE user_id=$1 AND video_id=$2', [Owner.id, VideoId])).rowCount, 0);
	assert.equal((await Item()).digged, false); assert.equal((await Item()).stats.diggCount, 0);
	const Liked = await (await Digg(1)).json();
	assert.equal(Liked.status_code, 0); assert.notEqual(Liked.is_digg, 1);
	assert.equal((await Pool.query('SELECT * FROM likes WHERE user_id=$1 AND video_id=$2', [Owner.id, VideoId])).rowCount, 1);
	assert.equal((await Item()).digged, true); assert.equal((await Item()).stats.diggCount, 1);
	assert.equal((await Call(`/api/commit/item/digg/?aweme_id=1&type=1`, 'POST', undefined, Auth())).status, 404);
});

test('original client follow requests persist and return follow_status and relation from the database', async () => {
	const Friendly = await Login(Pool, 'friend', Password);
	const AsFriend = { cookie: `kittok_session=${Friendly.Token}`, 'x-csrf-token': Friendly.Csrf };
	const Follow = (Path, Type, Target, Headers) => Call(`${Path}?type=${Type}&action_type=${Type}&user_id=${Target.id}&sec_user_id=${Target.id}&from=18&channel_id=0&from_pre=0&fromWeb=1`, 'POST', undefined, Headers);
	const RelationTo = async (Target, Headers) => (await (await Call(`/api/user/detail/?uniqueId=${Target.username}`, 'GET', undefined, Headers)).json()).userInfo.user.relation;
	assert.equal((await Follow('/api/commit/follow/user/', 1, Friend, { cookie: Cookie })).status, 403);
	assert.deepEqual(await (await Follow('/api/commit/follow/user/', 0, Friend, Auth())).json(), { status_code: 0, statusCode: 0, follow_status: 0 });
	assert.equal((await Pool.query('SELECT * FROM follows WHERE follower_id=$1 AND following_id=$2', [Owner.id, Friend.id])).rowCount, 0);
	assert.equal(await RelationTo(Friend, Auth()), 0);
	assert.equal((await (await Follow('/api/commit/follow/user/', 1, Friend, Auth())).json()).follow_status, 1);
	assert.equal(await RelationTo(Friend, Auth()), 1);
	assert.equal(await RelationTo(Owner, AsFriend), 6);
	assert.equal((await (await Call('/api/recommend/item_list/', 'GET', undefined, AsFriend)).json()).itemList.find(Item => Item.id === VideoId).author.relation, 6);
	assert.equal((await (await Follow('/api/follow/', 1, Owner, AsFriend)).json()).follow_status, 2);
	assert.equal(await RelationTo(Friend, Auth()), 2);
	assert.equal((await (await Call('/api/recommend/item_list/', 'GET', undefined, AsFriend)).json()).itemList.find(Item => Item.id === VideoId).author.relation, 2);
	assert.equal(await RelationTo(Friend), 0);
	assert.equal(await RelationTo(Owner, Auth()), 0);
	assert.equal((await Follow('/api/commit/follow/user/', 1, Owner, Auth())).status, 400);
	assert.equal((await Follow('/api/commit/follow/user/', 1, { id: '1' }, Auth())).status, 404);
});

test('original client comment publish persists comments that the list and item counts read back', async () => {
	const Publish = (Query, Headers = Auth()) => Call(`/api/comment/publish/?${new URLSearchParams({ aweme_id: VideoId, reply_id: '0', reply_to_reply_id: '0', text_extra: '[]', ...Query })}`, 'POST', undefined, Headers);
	const Before = (await Pool.query('SELECT count(*)::int AS count FROM comments WHERE video_id=$1', [VideoId])).rows[0].count;
	assert.equal((await Publish({ text: 'Nope' }, { cookie: Cookie })).status, 403);
	assert.equal((await Publish({ text: '   ' })).status, 400);
	const First = await (await Publish({ text: ' Published natively ' })).json();
	assert.equal(First.status_code, 0); assert.equal(First.comment.text, 'Published natively'); assert.equal(First.comment.aweme_id, VideoId);
	assert.equal(First.comment.reply_id, '0'); assert.equal(First.comment.user.unique_id, 'owner'); assert.match(First.comment.cid, /^\d+$/);
	const Reply = await (await Publish({ text: 'A reply', reply_id: First.comment.cid })).json();
	assert.equal(Reply.comment.reply_id, First.comment.cid);
	assert.equal((await Pool.query('SELECT parent_id FROM comments WHERE id=$1', [Reply.comment.cid])).rows[0].parent_id, First.comment.cid);
	assert.equal((await Publish({ text: 'Orphan', reply_id: '1' })).status, 404);
	assert.equal((await Publish({ text: 'Missing', aweme_id: '1' })).status, 404);
	const List = await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=20&cursor=0`)).json();
	assert.equal(List.comments[0].cid, First.comment.cid); assert.equal(List.comments[0].reply_comment_total, 1);
	assert.ok(!List.comments.some(Comment => Comment.text === 'A reply')); assert.equal(List.total, Before + 2);
	assert.equal((await (await Call(`/api/item/detail/?itemId=${VideoId}`)).json()).itemInfo.itemStruct.stats.commentCount, Before + 2);
});

test('original client reply threads page oldest first and comment likes persist per viewer', async () => {
	const Publish = Query => Call(`/api/comment/publish/?${new URLSearchParams({ aweme_id: VideoId, reply_to_reply_id: '0', text_extra: '[]', ...Query })}`, 'POST', undefined, Auth());
	const Root = (await (await Publish({ text: 'Thread root', reply_id: '0' })).json()).comment.cid;
	const Replies = [];
	for (const Text of ['R1', 'R2', 'R3', 'R4']) Replies.push((await (await Publish({ text: Text, reply_id: Root })).json()).comment);
	const Nested = (await (await Publish({ text: 'R5 to R1', reply_id: Replies[0].cid, reply_to_reply_id: Replies[0].cid })).json()).comment;
	assert.equal(Nested.reply_id, Root);
	const ReplyPage = Cursor => Call(`/api/comment/list/reply/?comment_id=${Root}&item_id=${VideoId}&cursor=${Cursor}&count=3`).then(Response => Response.json());
	const PageOne = await ReplyPage('0');
	assert.equal(PageOne.status_code, 0); assert.deepEqual(PageOne.comments.map(Comment => Comment.text), ['R1', 'R2', 'R3']);
	assert.equal(PageOne.has_more, 1); assert.equal(PageOne.comments[0].reply_id, Root);
	const PageTwo = await ReplyPage(PageOne.cursor);
	assert.deepEqual(PageTwo.comments.map(Comment => Comment.text), ['R4', 'R5 to R1']); assert.equal(PageTwo.has_more, 0);
	const Top = await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=1&cursor=0`)).json();
	assert.equal(Top.comments[0].cid, Root); assert.equal(Top.comments[0].reply_comment_total, 5); assert.equal(Top.has_more, 1);
	const Older = await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=50&cursor=${Top.cursor}`)).json();
	assert.ok(Older.comments.length > 0 && !Older.comments.some(Comment => Comment.cid === Root)); assert.equal(Older.has_more, 0);
	const Digg = (Cid, Type, Headers = Auth()) => Call(`/api/comment/digg/?aweme_id=${VideoId}&cid=${Cid}&digg_type=${Type}&channel_id=0`, 'POST', undefined, Headers);
	assert.equal((await Digg(Root, 1, { cookie: Cookie })).status, 403);
	assert.deepEqual(await (await Digg(Root, 1)).json(), { status_code: 0, statusCode: 0 });
	assert.equal((await Digg(Root, 1)).status, 200);
	assert.equal((await Digg(Replies[1].cid, 1)).status, 200);
	assert.equal((await Pool.query('SELECT * FROM comment_likes WHERE comment_id=$1', [Root])).rowCount, 1);
	const Mine = (await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=1&cursor=0`, 'GET', undefined, Auth())).json()).comments[0];
	assert.equal(Mine.digg_count, 1); assert.equal(Mine.user_digged, 1);
	const Guest = (await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=1&cursor=0`)).json()).comments[0];
	assert.equal(Guest.digg_count, 1); assert.equal(Guest.user_digged, 0);
	const Reply = (await (await Call(`/api/comment/list/reply/?comment_id=${Root}&cursor=0&count=3`, 'GET', undefined, Auth())).json()).comments[1];
	assert.equal(Reply.digg_count, 1); assert.equal(Reply.user_digged, 1);
	assert.equal((await Digg(Root, 2)).status, 200);
	assert.equal((await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=1&cursor=0`, 'GET', undefined, Auth())).json()).comments[0].digg_count, 0);
	assert.equal((await Digg('1', 1)).status, 404);
	assert.equal((await Digg(Replies[1].cid, 1)).status, 200);
});

test('original client follower, following, friend, and suggested lists page from the database', async () => {
	const Kitten = (await Pool.query("SELECT id FROM users WHERE username='newkitten'")).rows[0].id;
	await Pool.query('INSERT INTO follows(follower_id, following_id) VALUES ($1, $2)', [Kitten, Owner.id]);
	const List = (Query, Headers = Auth()) => Call(`/api/user/list/?${new URLSearchParams({ maxCursor: 0, minCursor: 0, count: 30, ...Query })}`, 'GET', undefined, Headers).then(Response => Response.json());
	const Names = Result => Result.userList.map(Entry => Entry.user.uniqueId);
	const Following = await List({ scene: 21 });
	assert.equal(Following.statusCode, 0); assert.deepEqual(Names(Following), ['friend']);
	assert.equal(Following.userList[0].user.relation, 2); assert.equal(Following.userList[0].stats.followerCount, 1); assert.equal(Following.userList[0].statsV2.followerCount, '1');
	assert.deepEqual(Names(await List({ scene: 67 })), ['newkitten', 'friend']);
	assert.deepEqual(Names(await List({ scene: 150 })), ['friend']);
	assert.deepEqual(Names(await List({ scene: 151 })), ['newkitten']);
	const First = await List({ scene: 67, count: 1 });
	assert.deepEqual(Names(First), ['newkitten']); assert.equal(First.userList[0].user.relation, 6); assert.equal(First.hasMore, true); assert.equal(First.total, 2);
	const Second = await List({ scene: 67, count: 1, minCursor: First.minCursor });
	assert.deepEqual(Names(Second), ['friend']); assert.equal(Second.hasMore, false);
	assert.deepEqual(Names(await List({ scene: 21, secUid: Friend.id })), ['owner']);
	assert.deepEqual(Names(await List({ scene: 67, secUid: Friend.id }, {})), ['owner']);
	assert.deepEqual(Names(await List({ scene: 21 }, {})), []);
	assert.deepEqual(Names(await List({ scene: 999 })), []);
	const Spotlight = await (await Call('/api/im/spotlight/relation?source=web&with_fstatus=1&count=30&max_time=0&min_time=0', 'GET', undefined, Auth())).json();
	assert.equal(Spotlight.status_code, 0); assert.equal(Spotlight.has_more, 0);
	assert.deepEqual(Spotlight.followings.map(User => [User.unique_id, User.follow_status, User.follower_status]), [['friend', 2, 1]]);
	assert.deepEqual(await (await Call('/api/im/spotlight/relation?count=30&max_time=0')).json(), { status_code: 0, max_time: 0, min_time: 0, has_more: 0, followings: [] });
});

test('liked and favorites tabs stay private and collection lists return an empty native shape', async () => {
	assert.deepEqual((await (await Call(`/api/favorite/item_list/?secUid=${Owner.id}&count=30&cursor=0`, 'GET', undefined, Auth())).json()).itemList.map(Item => Item.id), [VideoId]);
	assert.deepEqual((await (await Call(`/api/favorite/item_list/?secUid=${Owner.id}`)).json()).itemList, []);
	assert.deepEqual((await (await Call(`/api/favorite/item_list/?secUid=${Friend.id}`, 'GET', undefined, Auth())).json()).itemList, []);
	assert.deepEqual(await (await Call(`/api/user/collection_list/?secUid=${Owner.id}&count=30&cursor=0`, 'GET', undefined, Auth())).json(), { statusCode: 0, status_code: 0, collectionList: [], cursor: '0', hasMore: false });
});

test('original client comment delete lets authors, video owners, and nobody else remove comments', async () => {
	const Friendly = await Login(Pool, 'friend', Password);
	const AsFriend = { cookie: `kittok_session=${Friendly.Token}`, 'x-csrf-token': Friendly.Csrf };
	const Publish = (Text, Headers, Reply = '0') => Call(`/api/comment/publish/?aweme_id=${VideoId}&text=${encodeURIComponent(Text)}&reply_id=${Reply}`, 'POST', undefined, Headers).then(Response => Response.json()).then(Result => Result.comment.cid);
	const Delete = (Cid, Headers = Auth()) => Call(`/api/comment/delete/?cid=${Cid}`, 'POST', undefined, Headers);
	const Mine = await Publish('Owner will delete this', Auth());
	const Child = await Publish('Reply goes with it', AsFriend, Mine);
	const Theirs = await Publish('Friend wrote this', AsFriend);
	const Kept = await Publish('Owner keeps this', Auth());
	assert.equal((await Delete(Mine, { cookie: Cookie })).status, 403);
	assert.equal((await Delete(Mine, {})).status, 401);
	assert.equal((await Delete(Kept, AsFriend)).status, 404);
	assert.deepEqual(await (await Delete(Mine)).json(), { status_code: 0, statusCode: 0 });
	assert.equal((await Pool.query('SELECT * FROM comments WHERE id = ANY($1)', [[Mine, Child]])).rowCount, 0);
	assert.equal((await Delete(Theirs)).status, 200);
	assert.equal((await Delete(Mine)).status, 404);
	assert.ok((await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=50`)).json()).comments.some(Comment => Comment.cid === Kept));
	assert.equal((await Delete(Kept)).status, 200);
});

test('original client profile editing saves name, bio, and a re-encoded avatar that every user shape reads back', async () => {
	const Image = join(Directory, 'avatar.png');
	assert.equal(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x300', '-frames:v', '1', Image]).status, 0);
	const Upload = async (Bytes, Headers = Auth()) => { const Form = new FormData(); Form.append('file', new Blob([Bytes], { type: 'image/png' }), 'blob'); Form.append('source', '0'); return fetch(Origin + '/api/upload/image/', { method: 'POST', headers: Headers, body: Form }); };
	const Save = (Fields, Headers = Auth()) => fetch(Origin + '/api/update/profile/', { method: 'POST', headers: { ...Headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...Fields, tt_csrf_token: Session.csrfToken }) });
	assert.equal((await Upload(await readFile(Image), { cookie: Cookie })).status, 403);
	assert.equal((await Upload(Buffer.from('not an image'))).status, 422);
	const First = await (await Upload(await readFile(Image))).json();
	assert.equal(First.status_code, 0); assert.match(First.data.uri, new RegExp(`^avatar-${Owner.id}-[0-9a-f-]{36}\\.jpg$`));
	const Served = await fetch(First.data.url_list[0]); assert.equal(Served.headers.get('content-type'), 'image/jpeg');
	const Probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', join(Directory, First.data.uri)]).stdout);
	assert.equal(Probe.streams[0].width, 200); assert.equal(Probe.streams[0].height, 200);
	assert.deepEqual(await (await Save({ nickname: '   ' })).json(), { status_code: 2550, status_msg: 'InvalidNickname' });
	assert.equal((await Save({ signature: 'x'.repeat(161) })).status, 400);
	assert.equal((await Save({ avatar_uri: First.data.uri.replace(Owner.id, Friend.id) })).status, 400);
	assert.equal((await Save({ avatar_uri: `avatar-${Owner.id}-00000000-0000-0000-0000-000000000000.jpg` })).status, 400);
	const Saved = await (await Save({ nickname: ' Kitten Owner ', signature: 'Making local videos', avatar_uri: First.data.uri })).json();
	assert.equal(Saved.status_code, 0); assert.equal(Saved.user.nickname, 'Kitten Owner'); assert.equal(Saved.user.signature, 'Making local videos');
	const AvatarUrl = `${Origin}/media/${First.data.uri}`;
	const Detail = (await (await Call('/api/user/detail/?uniqueId=owner')).json()).userInfo.user;
	assert.equal(Detail.nickname, 'Kitten Owner'); assert.equal(Detail.signature, 'Making local videos'); assert.equal(Detail.avatarThumb, AvatarUrl);
	assert.equal((await (await Call('/api/recommend/item_list/')).json()).itemList.find(Item => Item.id === VideoId).author.avatarLarger, AvatarUrl);
	const Page = ReadJsonScript(await (await Call('/', 'GET', undefined, { cookie: Cookie })).text(), '__UNIVERSAL_DATA_FOR_REHYDRATION__').__DEFAULT_SCOPE__['webapp.app-context'];
	assert.deepEqual(Page.user.avatarUri, [AvatarUrl]); assert.equal(Page.user.nickName, 'Kitten Owner');
	const Bio = await (await Save({ signature: '' })).json(); assert.equal(Bio.user.signature, ''); assert.equal(Bio.user.nickname, 'Kitten Owner');
	const Second = await (await Upload(await readFile(Image))).json();
	await Save({ avatar_uri: Second.data.uri });
	assert.equal((await fetch(AvatarUrl)).status, 404);
	assert.equal((await fetch(Second.data.url_list[0])).status, 200);
});

test('original client username checks and changes enforce local username rules', async () => {
	const Kitten = await Login(Pool, 'newkitten', Password);
	const AsKitten = { cookie: `kittok_session=${Kitten.Token}`, 'x-csrf-token': Kitten.Csrf };
	const Check = async (Name, Headers = AsKitten) => (await (await Call(`/api/uniqueid/check/?unique_id=${encodeURIComponent(Name)}`, 'GET', undefined, Headers)).json()).is_valid;
	assert.equal(await Check('newkitten'), true); assert.equal(await Check('owner'), false); assert.equal(await Check('Fresh_Name'), true);
	assert.equal(await Check('ab'), false); assert.equal(await Check('has.dot'), false);
	const Rename = (Name, Headers = AsKitten) => fetch(Origin + '/passport/web/login_name/update/', { method: 'POST', headers: { ...Headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ login_name: Name }) });
	assert.equal((await Rename('fresh_name', { cookie: AsKitten.cookie })).status, 403);
	assert.equal((await (await Rename('owner')).json()).data.error_code, 1024);
	assert.equal((await (await Rename('bad name!')).json()).data.error_code, 1027);
	const Renamed = await (await Rename('Fresh_Name')).json();
	assert.equal(Renamed.message, 'success'); assert.equal(Renamed.data.username, 'fresh_name');
	assert.equal((await (await Call('/api/user/detail/?uniqueId=fresh_name')).json()).userInfo.user.uniqueId, 'fresh_name');
	assert.equal((await Call('/api/user/detail/?uniqueId=newkitten')).status, 404);
	assert.equal((await (await Call('/api/v1/session', 'GET', undefined, { cookie: AsKitten.cookie })).json()).user.uniqueId, 'fresh_name');
});

test('original client notifications derive likes, comments, replies, and follows from the database with read state', async () => {
	const Friendly = await Login(Pool, 'friend', Password);
	const AsFriend = { cookie: `kittok_session=${Friendly.Token}`, 'x-csrf-token': Friendly.Csrf };
	const Publish = (Text, Headers, Reply = '0') => Call(`/api/comment/publish/?aweme_id=${VideoId}&text=${encodeURIComponent(Text)}&reply_id=${Reply}`, 'POST', undefined, Headers).then(Response => Response.json()).then(Result => Result.comment.cid);
	const Mine = await Publish('Owner comment for notices', Auth());
	await Call(`/api/commit/item/digg/?aweme_id=${VideoId}&type=1`, 'POST', undefined, AsFriend);
	const FriendComment = await Publish('Nice video from friend', AsFriend);
	const FriendReply = await Publish('Replying to the owner', AsFriend, Mine);
	await Call(`/api/comment/digg/?aweme_id=${VideoId}&cid=${Mine}&digg_type=1`, 'POST', undefined, AsFriend);
	await Publish('Owner replies to self', Auth(), Mine);
	const Counts = async (Headers = Auth()) => Object.fromEntries((await (await Call('/api/inbox/notice_count/', 'GET', undefined, Headers)).json()).notice_count.map(Entry => [Entry.group, Entry.count]));
	const Unread = await Counts();
	assert.equal(Unread[3], 2); assert.equal(Unread[505], 2); assert.equal(Unread[2], 2); assert.equal(Unread[7], 2); assert.equal(Unread[6], 0); assert.equal(Unread[500], 6);
	const List = async (Group, Extra = {}, Headers = Auth()) => (await (await Call(`/api/notice/multi/?aid=1988&group_list=${encodeURIComponent(JSON.stringify([{ count: 20, is_mark_read: 0, group: Group, max_time: 0, min_time: 0, ...Extra }]))}`, 'GET', undefined, Headers)).json()).notice_lists[0];
	const All = await List(500);
	assert.equal(All.notice_list.length, 6); assert.equal(All.has_more, 0);
	assert.ok(All.notice_list.every((Notice, Index, Notices) => Index === 0 || Number(Notices[Index - 1].create_time) >= Number(Notice.create_time)));
	assert.ok(All.notice_list.every(Notice => Notice.has_read === false && Notice.nid_str === Notice.nid));
	assert.equal(new Set(All.notice_list.map(Notice => Notice.nid)).size, 6);
	const Like = All.notice_list.find(Notice => Notice.type === 41 && Notice.digg.digg_type === 1);
	assert.equal(Like.digg.from_user[0].unique_id, 'friend'); assert.equal(Like.digg.aweme.aweme_id, VideoId); assert.equal(Like.digg.aweme.author.uid, Owner.id); assert.ok(Like.digg.aweme.video.cover.url_list[0].startsWith(Origin + '/media/'));
	const CommentLike = All.notice_list.find(Notice => Notice.type === 41 && Notice.digg.digg_type === 3);
	assert.equal(CommentLike.digg.comment.cid, Mine); assert.equal(CommentLike.digg.comment.text, 'Owner comment for notices');
	const Comment = All.notice_list.find(Notice => Notice.type === 31 && Notice.comment.comment.cid === FriendComment);
	assert.equal(Comment.comment.comment_type, 1); assert.equal(Comment.comment.comment.text, 'Nice video from friend'); assert.equal(Comment.comment.comment.user.unique_id, 'friend'); assert.equal(Comment.comment.aweme.aweme_id, VideoId);
	const Reply = All.notice_list.find(Notice => Notice.type === 31 && Notice.comment.comment.cid === FriendReply);
	assert.equal(Reply.comment.comment_type, 2); assert.equal(Reply.comment.reply_comment.user.uid, Owner.id); assert.equal(Reply.comment.comment.reply_id, Mine);
	const Follows = All.notice_list.filter(Notice => Notice.type === 33);
	assert.deepEqual(Follows.map(Notice => [Notice.follow.from_user.unique_id, Notice.follow.follow_button_type]).sort(), [['fresh_name', 1], ['friend', 0]]);
	assert.deepEqual((await List(2)).notice_list.map(Notice => Notice.type), [31, 31]);
	assert.deepEqual((await List(7)).notice_list.map(Notice => Notice.type), [33, 33]);
	assert.deepEqual((await List(3)).notice_list.map(Notice => Notice.type), [41, 41]);
	assert.deepEqual((await List(6)).notice_list, []);
	const First = await List(500, { count: 4 });
	assert.equal(First.notice_list.length, 4); assert.equal(First.has_more, 1);
	const Second = await List(500, { count: 4, max_time: First.max_time, min_time: First.min_time });
	assert.equal(Second.notice_list.length, 2); assert.equal(Second.has_more, 0);
	assert.deepEqual([...First.notice_list, ...Second.notice_list].map(Notice => Notice.nid), All.notice_list.map(Notice => Notice.nid));
	assert.deepEqual((await List(500, { max_time: 0, min_time: All.max_time })).notice_list, []);
	assert.deepEqual((await List(500, { max_time: 0, min_time: Second.min_time })).notice_list.length, 5);
	assert.deepEqual(Object.values(await Counts({})).filter(Boolean), []);
	assert.deepEqual((await List(500, {}, {})).notice_list, []);
	await List(500, { is_mark_read: 1 });
	assert.deepEqual(Object.values(await Counts()).filter(Boolean), []);
	assert.ok((await List(500)).notice_list.every(Notice => Notice.has_read === true));
	assert.equal((await Call('/api/notice/multi/?group_list=not-json', 'GET', undefined, Auth())).status, 400);
});

test('search finds local accounts and paginated feeds do not repeat the final video', async () => {
	const Users = await (await Call('/api/search/user/full/?keyword=owner')).json(); assert.equal(Users.user_list[0].user_info.unique_id, 'owner');
	const Friendly = (await (await Call('/api/search/user/full/?keyword=friend', 'GET', undefined, Auth())).json()).user_list[0].user_info;
	assert.equal(Friendly.follower_count, 1); assert.equal(Friendly.follow_status, 2);
	const Videos = await (await Call('/api/search/item/full/?keyword=KITTOK&cursor=0&count=12')).json();
	assert.equal(Videos.status_code, 0); assert.deepEqual(Videos.item_list.map(Item => Item.id), [VideoId]); assert.equal(Videos.has_more, 0);
	assert.deepEqual((await (await Call('/api/search/item/full/?keyword=nothing-matches-this')).json()).item_list, []);
	assert.deepEqual((await (await Call('/api/search/item/full/?keyword=%25')).json()).item_list, []);
	const Top = await (await Call('/api/search/general/full/?keyword=owner&cursor=0&count=12')).json();
	assert.deepEqual(Top.data.map(Entry => Entry.type), [4]); assert.equal(Top.data[0].user_list[0].user_info.unique_id, 'owner');
	const TopVideo = await (await Call('/api/search/general/full/?keyword=first&cursor=0')).json();
	assert.equal(TopVideo.data[0].type, 1); assert.equal(TopVideo.data[0].item.id, VideoId);
	assert.deepEqual((await (await Call('/api/search/photo/full/?keyword=owner')).json()).item_list, []);
	const Next = await (await Call(`/api/recommend/item_list/?cursor=${VideoId}`)).json(); assert.deepEqual(Next.itemList, []);
});

test('cross-origin writes, debug data, traversal, and unsupported APIs fail explicitly', async () => {
	assert.equal((await Call('/api/v1/session', 'POST', { username: 'owner', password: Password }, { origin: 'https://example.com' })).status, 403);
	assert.equal((await Call('/_debug/unknown')).status, 403);
	assert.equal((await Call('/api/unsupported/')).status, 501);
	assert.equal((await Call('/unimplemented')).status, 404);
	assert.equal((await Call('/media/.incoming')).status, 404);
	const Page = await Call('/'); assert.match(Page.headers.get('content-security-policy'), /connect-src 'self'/);
	assert.equal((await Call('/health/ready')).status, 200);
});

test('raw video uploads are transcoded, persist, and appear in the original feed', async () => {
	const Body = await readFile(join(Directory, 'input.mp4'));
	const Uploaded = await fetch(Origin + '/api/v1/videos?description=Uploaded%20through%20HTTP', { method: 'POST', headers: Auth({ 'content-type': 'video/mp4' }), body: Body });
	assert.equal(Uploaded.status, 201); const Result = await Uploaded.json();
	const Feed = await (await Call('/api/recommend/item_list/')).json(); assert.equal(Feed.itemList[0].id, Result.id);
	assert.equal(Feed.itemList[0].desc, 'Uploaded through HTTP');
	const Bad = await fetch(Origin + '/api/v1/videos', { method: 'POST', headers: Auth({ 'content-type': 'video/mp4' }), body: 'not a video' }); assert.equal(Bad.status, 422);
});

test('admin panel is admin-only and its actions suspend, change roles, manage invites, and remove content with files', async () => {
	const Admin = (Route, Body, Headers = Auth()) => Call('/_kittok/admin/' + Route, Body ? 'POST' : 'GET', Body, Headers);
	let Friendly = await Login(Pool, 'friend', Password);
	const AsFriend = () => ({ cookie: `kittok_session=${Friendly.Token}`, 'x-csrf-token': Friendly.Csrf });
	assert.equal((await fetch(Origin + '/admin', { redirect: 'manual' })).headers.get('location'), '/login');
	assert.equal((await Call('/admin', 'GET', undefined, AsFriend())).status, 404);
	assert.equal((await Admin('overview', undefined, AsFriend())).status, 404);
	assert.equal((await Admin('overview', undefined, {})).status, 404);
	const AdminPage = await (await Call('/admin/users/1', 'GET', undefined, { cookie: Cookie })).text();
	assert.ok(AdminPage.includes('/public/admin.js') && AdminPage.includes(`"csrf":"${Session.csrfToken}"`) && /\/_client\/[^"]+\.css/.test(AdminPage));
	assert.ok((await (await Call('/', 'GET', undefined, { cookie: Cookie })).text()).includes('"role":"admin"'));
	const Overview = await (await Admin('overview')).json();
	assert.equal(Overview.stats.users, (await Pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count); assert.equal(Overview.registration, 'invite');
	const Users = (await (await Admin('users?q=friend')).json()).users;
	assert.deepEqual(Users.map(User => [User.username, User.self]), [['friend', false]]);
	assert.equal((await (await Admin('users')).json()).users.find(User => User.username === 'owner').self, true);
	assert.equal((await Admin(`users/${Friend.id}/suspend`, {}, { cookie: Cookie })).status, 403);
	assert.equal((await Admin(`users/${Owner.id}/suspend`, {})).status, 400);
	assert.equal((await Admin(`users/${Friend.id}/suspend`, {})).status, 200);
	assert.equal((await (await Call('/api/v1/session', 'GET', undefined, AsFriend())).json()).user, null);
	assert.equal((await Call('/api/v1/session', 'POST', { username: 'friend', password: Password })).status, 403);
	assert.equal((await Call('/api/v1/session', 'POST', { username: 'friend', password: 'wrong-password-123' })).status, 401);
	assert.equal((await Admin(`users/${Friend.id}/unsuspend`, {})).status, 200);
	Friendly = await Login(Pool, 'friend', Password);
	assert.equal((await (await Call('/api/v1/session', 'GET', undefined, AsFriend())).json()).user.uniqueId, 'friend');
	assert.equal((await Admin(`users/${Friend.id}/role`, { role: 'admin' })).status, 200);
	assert.equal((await Admin('overview', undefined, AsFriend())).status, 200);
	assert.equal((await Admin(`users/${Friend.id}/role`, { role: 'root' })).status, 400);
	assert.equal((await Admin(`users/${Friend.id}/role`, { role: 'member' })).status, 200);
	assert.equal((await Admin('overview', undefined, AsFriend())).status, 404);
	assert.equal((await Admin('invites', { uses: 0, days: 7 })).status, 400);
	const Invite = await (await Admin('invites', { uses: 1, days: 7 })).json();
	assert.match(Invite.code, /^[a-f0-9]{64}$/);
	assert.equal((await (await Admin('invites')).json()).invites.length, 1);
	assert.equal((await Call('/api/v1/users', 'POST', { username: 'invited_kitten', displayName: 'Invited', password: Password, invite: Invite.code })).status, 201);
	const Spare = await (await Admin('invites', { uses: 2, days: 1 })).json();
	assert.equal((await Admin(`invites/${Hash(Spare.code)}/delete`, {})).status, 200);
	assert.equal((await Call('/api/v1/users', 'POST', { username: 'late_kitten', displayName: 'Late', password: Password, invite: Spare.code })).status, 403);
	const Doomed = (await Pool.query("SELECT id FROM users WHERE username='invited_kitten'")).rows[0].id;
	const DoomedVideo = await ImportVideo(Pool, Config, Doomed, join(Directory, 'input.mp4'), 'Doomed video');
	const Files = (await Pool.query('SELECT file_name, cover_name FROM videos WHERE id=$1', [DoomedVideo])).rows[0];
	const Comment = (await Pool.query("INSERT INTO comments(video_id, author_id, body) VALUES ($1, $2, 'Admin removes me') RETURNING id", [VideoId, Doomed])).rows[0].id;
	assert.ok((await (await Admin('comments')).json()).comments.some(Row => Row.id === Comment));
	assert.equal((await Admin(`comments/${Comment}/delete`, {})).status, 200);
	assert.equal((await Admin(`comments/${Comment}/delete`, {})).status, 404);
	assert.ok((await (await Admin('videos')).json()).videos.some(Row => Row.id === DoomedVideo));
	assert.equal((await Admin(`users/${Doomed}/delete`, { confirm: 'nope' })).status, 400);
	assert.equal((await Admin(`users/${Doomed}/delete`, { confirm: 'invited_kitten' })).status, 200);
	assert.equal((await Pool.query('SELECT * FROM videos WHERE id=$1', [DoomedVideo])).rowCount, 0);
	assert.equal((await fetch(`${Origin}/media/${Files.file_name}`)).status, 404); assert.equal((await fetch(`${Origin}/media/${Files.cover_name}`)).status, 404);
	const Actions = (await (await Admin('audit')).json()).actions.map(Row => Row.action);
	assert.deepEqual(Actions.slice(0, 9), ['user.delete', 'comment.delete', 'invite.revoke', 'invite.create', 'invite.create', 'user.role', 'user.role', 'user.unsuspend', 'user.suspend']);
});

test('admin user pages show tracked security details, violations, comment lookups, and instance settings take effect', async () => {
	const Admin = (Route, Body, Headers = Auth()) => Call('/_kittok/admin/' + Route, Body ? 'POST' : 'GET', Body, Headers);
	const Client = { 'accept-language': 'fr-FR,fr;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/140.0' };
	const Code = Token(); await Pool.query("INSERT INTO invites(token_hash, created_by, expires_at) VALUES ($1,$2,now()+interval '1 day')", [Hash(Code), Owner.id]);
	assert.equal((await Call('/api/v1/users', 'POST', { username: 'tracked_kitten', displayName: 'Tracked', password: Password, invite: Code }, Client)).status, 201);
	assert.equal((await Call('/api/v1/session', 'POST', { username: 'tracked_kitten', password: 'wrong-password-123' }, Client)).status, 401);
	const Signed = await Call('/api/v1/session', 'POST', { username: 'tracked_kitten', password: Password }, { ...Client, 'user-agent': 'curl/8.0' });
	const TrackedCookie = Signed.headers.get('set-cookie').split(';')[0];
	const Tracked = (await Pool.query("SELECT id FROM users WHERE username='tracked_kitten'")).rows[0].id;
	const Detail = await (await Admin(`users/${Tracked}`)).json();
	assert.equal(Detail.user.username, 'tracked_kitten'); assert.equal(Detail.user.self, false);
	assert.deepEqual(Detail.events.map(Event => Event.kind), ['login', 'login_failed', 'signup']);
	assert.equal(Detail.signup.language, 'fr-FR'); assert.equal(Detail.signup.ip, '127.0.0.1'); assert.match(Detail.signup.user_agent, /Firefox/);
	assert.equal(Detail.signup.country, null); assert.deepEqual(Detail.seen.languages, ['fr-FR']);
	assert.equal(Detail.sessions.length, 1); assert.equal(Detail.sessions[0].user_agent, 'curl/8.0'); assert.ok(!('token_hash' in Detail.sessions[0]));
	assert.ok(Detail.related.some(Row => Row.username === 'owner'));
	assert.ok((await (await Admin('users?q=127.0.0.1')).json()).users.some(Row => Row.username === 'tracked_kitten'));
	assert.equal((await Admin(`users/${Tracked}/sessions/revoke`, { session: Detail.sessions[0].id })).status, 200);
	assert.equal((await (await Call('/api/v1/session', 'GET', undefined, { cookie: TrackedCookie })).json()).user, null);
	const Comment = (await Pool.query("INSERT INTO comments(video_id, author_id, body) VALUES ($1, $2, 'Look me up') RETURNING id", [VideoId, Tracked])).rows[0].id;
	assert.equal((await Admin(`users/${Tracked}/violations`, { category: 'bogus', reason: 'x' })).status, 400);
	assert.equal((await Admin(`users/${Tracked}/violations`, { category: 'spam', reason: 'Promo links', comment_id: VideoId })).status, 400);
	assert.equal((await Admin(`users/${Tracked}/violations`, { category: 'spam', reason: 'Promo links', video_id: VideoId })).status, 400);
	assert.equal((await Admin(`users/${Tracked}/violations`, { category: 'spam', reason: 'Promo links', comment_id: Comment })).status, 200);
	const Found = await (await Admin(`comments/${Comment}`)).json();
	assert.equal(Found.comment.body, 'Look me up'); assert.equal(Found.comment.username, 'tracked_kitten'); assert.equal(Found.violations[0].category, 'spam');
	assert.equal((await Admin('comments/1')).status, 404);
	const Violation = (await (await Admin(`users/${Tracked}`)).json()).violations[0];
	assert.equal(Violation.admin, 'owner'); assert.equal(Violation.revoked_at, null);
	assert.equal((await Admin(`violations/${Violation.id}/revoke`, {})).status, 200);
	assert.equal((await Admin(`violations/${Violation.id}/revoke`, {})).status, 404);
	assert.equal((await Admin('settings/name', { value: '' })).status, 400);
	assert.equal((await Admin('settings/limits', { value: { videoMB: 0, videoSeconds: 10 } })).status, 400);
	assert.equal((await Admin('settings/announcement', { value: { text: 'Hi', link: 'javascript:alert(1)' } })).status, 400);
	await Admin('settings/name', { value: 'Kitten Club' });
	await Admin('settings/features', { value: { comments: false, live: false } });
	await Admin('settings/announcement', { value: { text: 'Be kind', link: '/rules' } });
	await Admin('settings/rules', { value: 'Be kind.\n\nNo spam.' });
	const Settings = await (await Admin('settings')).json();
	assert.equal(Settings.name, 'Kitten Club'); assert.equal(Settings.features.comments, false); assert.equal(Settings.features.shop, true); assert.ok(Settings.announcement.version > 0);
	const Feed = await (await Call('/', 'GET', undefined, { cookie: Cookie })).text();
	assert.equal(ReadJsonScript(Feed, 'kittok-instance').announcement.text, 'Be kind'); assert.ok(Feed.includes('<title>Kitten Club</title>'));
	assert.ok(Feed.includes(':has([data-e2e="nav-live"])') && Feed.includes('[data-e2e="comment-input"]') && !Feed.includes('nav-shop"])'));
	assert.equal((await Call(`/api/comment/publish/?aweme_id=${VideoId}&text=hi`, 'POST', undefined, Auth())).status, 403);
	assert.ok((await (await Call('/rules')).text()).includes('<p>No spam.</p>'));
	await Admin('settings/features', { value: {} });
	assert.equal((await Call(`/api/comment/publish/?aweme_id=${VideoId}&text=hi`, 'POST', undefined, Auth())).status, 200);
	const Form = new FormData(); Form.append('file', new Blob([await readFile(join(Directory, 'avatar.png'))], { type: 'image/png' }), 'logo.png');
	const Uploaded = await fetch(Origin + '/_kittok/admin/brand/wordmarkDark', { method: 'POST', headers: Auth(), body: Form });
	assert.equal(Uploaded.status, 200); assert.equal((await Uploaded.json()).wordmarkDark.custom, true);
	assert.equal((await fetch(Origin + '/brand/wordmarkDark')).headers.get('content-type'), 'image/png');
	assert.equal((await fetch(Origin + '/_kittok/admin/brand/wordmarkDark', { method: 'POST', headers: Auth(), body: (() => { const Bad = new FormData(); Bad.append('file', new Blob(['nope']), 'x.png'); return Bad; })() })).status, 422);
	assert.equal((await Admin('brand/wordmarkDark/reset', {})).status, 200);
	assert.equal((await fetch(Origin + '/brand/wordmarkDark')).headers.get('content-type'), 'image/svg+xml');
	assert.equal((await fetch(Origin + '/brand/nothing')).status, 404);
	await Admin('settings/name', { value: 'Kittok' }); await Admin('settings/announcement', { value: { text: '' } }); await Admin('settings/rules', { value: '' });
	assert.equal((await Admin(`comments/${Comment}/delete`, {})).status, 200);
	const Audit = (await (await Admin('audit')).json()).actions.map(Row => Row.action);
	assert.ok(Audit.includes('user.violations') && Audit.includes('violation.revoke') && Audit.includes('user.sessions.revoke') && Audit.includes('brand.upload'));
});

test('original client reports reach the admin queue, deduplicate, and close together', async () => {
	const Admin = (Route, Body, Headers = Auth()) => Call('/_kittok/admin/' + Route, Body ? 'POST' : 'GET', Body, Headers);
	const Friendly = await Login(Pool, 'friend', Password);
	const AsFriend = { cookie: `kittok_session=${Friendly.Token}`, 'x-csrf-token': Friendly.Csrf };
	const Reasons = await (await Call(`/node/report/reasons?report_type=video&object_id=${VideoId}&lang=en`)).json();
	assert.equal(Reasons.statusCode, 0); assert.ok(Reasons.body.length >= 5);
	assert.deepEqual(Object.keys(Reasons.body[0]).sort(), ['audit_type', 'next_reason', 'option', 'reason_code', 'reason_type', 'special_type', 'text']);
	assert.equal(Reasons.body[0].reason_type, Reasons.body[0].reason_code); assert.deepEqual(Reasons.body[0].next_reason, []);
	for (const Reason of Reasons.body) {
		const Option = JSON.parse(Reason.option);
		assert.equal(Option.action.action_type, 'route');
		assert.equal(Option.action.action_params.route_path, 'Detail_WithDesc');
		assert.equal(Option.action.action_params.title_text, Reason.text);
	}
	const Report = (Query, Headers = AsFriend) => Call(`/aweme/v2/aweme/feedback/?${new URLSearchParams({ app_name: 'tiktok_web', aid: 1988, reporter_id: Friend.id, ...Query })}`, 'GET', undefined, Headers);
	assert.equal((await Report({ object_id: VideoId, target: VideoId, owner_id: Owner.id, report_type: 'video', reason: 101 }, { cookie: AsFriend.cookie })).status, 403);
	assert.equal((await Report({ object_id: VideoId, report_type: 'video', reason: 999 })).status, 400);
	assert.equal((await Report({ object_id: VideoId, report_type: 'music', reason: 101 })).status, 400);
	assert.equal((await Report({ object_id: '1', report_type: 'video', reason: 101 })).status, 404);
	assert.equal((await Report({ object_id: Friend.id, report_type: 'user', reason: 101 })).status, 400);
	const Sent = await Report({ object_id: VideoId, target: VideoId, owner_id: Friend.id, report_type: 'video', reason: 101, report_desc: 'Same promo everywhere' });
	assert.deepEqual(await Sent.json(), { status_code: 0, statusCode: 0, status_msg: '', data: {} });
	assert.equal((await Report({ object_id: VideoId, report_type: 'video', reason: 103 })).status, 200);
	const KittenLogin = await Login(Pool, 'fresh_name', Password);
	assert.equal((await Report({ object_id: VideoId, report_type: 'video', reason: 104 }, { cookie: `kittok_session=${KittenLogin.Token}`, 'x-csrf-token': KittenLogin.Csrf })).status, 200);
	assert.equal((await Report({ object_id: Owner.id, report_type: 'user', reason: 108, report_desc: 'Pretending to be me' })).status, 200);
	assert.equal((await Pool.query("SELECT * FROM reports WHERE target_type='video' AND target_id=$1", [VideoId])).rowCount, 2);
	const Queue = (await (await Admin('reports')).json()).reports;
	const VideoReport = Queue.find(Row => Row.target_type === 'video' && Row.reporter === 'friend');
	assert.equal(VideoReport.category, 'spam'); assert.equal(VideoReport.description, 'Same promo everywhere'); assert.equal(VideoReport.owner, 'owner'); assert.equal(VideoReport.open_on_target, 2); assert.equal(VideoReport.exists, true);
	assert.ok(VideoReport.cover.startsWith(Origin + '/media/'));
	assert.ok(Queue.some(Row => Row.target_type === 'user' && Row.category === 'impersonation'));
	assert.equal((await (await Admin('overview')).json()).stats.reports, 3);
	const Detail = await (await Admin(`users/${Owner.id}`)).json();
	assert.equal(Detail.reportsAgainst.length, 3);
	assert.equal((await (await Admin(`users/${Friend.id}`)).json()).reportsFiled.length, 2);
	assert.equal((await Admin(`reports/${VideoReport.id}/resolve`, { resolution: 'Warned the owner' })).status, 200);
	assert.equal((await (await Admin('reports')).json()).reports.length, 1);
	const Resolved = (await (await Admin('reports?status=resolved')).json()).reports;
	assert.equal(Resolved.length, 2); assert.ok(Resolved.every(Row => Row.resolver === 'owner' && Row.resolution === 'Warned the owner'));
	assert.equal((await Report({ object_id: VideoId, report_type: 'video', reason: 101 })).status, 200);
	const UserReport = (await (await Admin('reports')).json()).reports.find(Row => Row.target_type === 'user');
	assert.equal((await Admin(`reports/${UserReport.id}/dismiss`, {})).status, 200);
	assert.equal((await Admin('reports/999999999/dismiss', {})).status, 404);
	assert.equal((await (await Admin('reports?status=dismissed')).json()).reports.length, 1);
	assert.equal((await (await Admin('audit')).json()).actions[0].action, 'report.dismiss');
	await Pool.query('DELETE FROM reports');
});

test('original client block requests persist, sever follows, and hide each side from the other', async () => {
	const Grumpy = await CreateUser(Pool, { username: 'grumpy', displayName: 'Grumpy Cat', password: Password }, 'closed', true);
	const Grumped = await Login(Pool, 'grumpy', Password);
	const AsGrumpy = { cookie: `kittok_session=${Grumped.Token}`, 'x-csrf-token': Grumped.Csrf };
	const Block = (Target, Type, Headers) => Call(`/api/user/block/?sec_user_id=${Target.id}&block_type=${Type}&source=3`, 'POST', undefined, Headers);
	const Follow = (Target, Headers) => Call(`/api/commit/follow/user/?type=1&action_type=1&user_id=${Target.id}&fromWeb=1`, 'POST', undefined, Headers);
	const RelationTo = async (Target, Headers) => (await (await Call(`/api/user/detail/?uniqueId=${Target.username}`, 'GET', undefined, Headers)).json()).userInfo.user.relation;
	const SeesVideo = async Headers => (await (await Call('/api/recommend/item_list/?count=50', 'GET', undefined, Headers)).json()).itemList.some(Item => Item.id === VideoId);
	assert.equal((await Follow(Owner, AsGrumpy)).status, 200);
	await Pool.query('INSERT INTO follows(follower_id, following_id) VALUES ($1, $2)', [Owner.id, Grumpy.id]);
	assert.equal(await RelationTo(Grumpy, Auth()), 2);
	assert.equal((await Block(Grumpy, 1, { cookie: Cookie })).status, 403);
	assert.deepEqual(await (await Block(Grumpy, 1, Auth())).json(), { status_code: 0, statusCode: 0, block_status: 1 });
	assert.equal((await Block(Grumpy, 1, Auth())).status, 200);
	assert.equal((await Pool.query('SELECT * FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [Owner.id, Grumpy.id])).rowCount, 1);
	assert.equal((await Pool.query('SELECT * FROM follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)', [Owner.id, Grumpy.id])).rowCount, 0);
	assert.equal(await RelationTo(Grumpy, Auth()), 4);
	assert.equal(await RelationTo(Owner, AsGrumpy), 5);
	assert.equal(await SeesVideo(AsGrumpy), false);
	assert.equal(await SeesVideo(), true);
	assert.equal((await Call(`/api/item/detail/?itemId=${VideoId}`, 'GET', undefined, AsGrumpy)).status, 404);
	assert.equal((await Call(`/api/comment/publish/?aweme_id=${VideoId}&text=hiss&reply_id=0`, 'POST', undefined, AsGrumpy)).status, 403);
	assert.equal((await Follow(Owner, AsGrumpy)).status, 403);
	assert.equal((await Follow(Grumpy, Auth())).status, 403);
	assert.equal((await Call('/api/v1/users/owner/follow', 'PUT', undefined, AsGrumpy)).status, 403);
	assert.deepEqual((await (await Call('/api/search/user/full/?keyword=owner', 'GET', undefined, AsGrumpy)).json()).user_list, []);
	assert.equal((await (await Call('/api/search/user/full/?keyword=grumpy', 'GET', undefined, Auth())).json()).user_list[0].user_info.is_block, true);
	const Blocked = await (await Call('/api/block/user_list/?offset=0&count=20', 'GET', undefined, Auth())).json();
	assert.equal(Blocked.status_code, 0); assert.equal(Blocked.offset, '1'); assert.equal(Blocked.hasMore, false);
	assert.deepEqual(Blocked.userList.map(Entry => [Entry.user.uniqueId, Entry.user.relation, typeof Entry.stats.followerCount]), [['grumpy', 4, 'number']]);
	assert.deepEqual((await (await Call('/api/block/user_list/?offset=0', 'GET', undefined, AsGrumpy)).json()).userList, []);
	assert.equal((await Call('/api/block/user_list/?offset=0')).status, 401);
	assert.equal((await Block(Owner, 1, Auth())).status, 400);
	assert.equal((await Block({ id: '1' }, 1, Auth())).status, 404);
	assert.deepEqual(await (await Block(Grumpy, 0, Auth())).json(), { status_code: 0, statusCode: 0, block_status: 0 });
	assert.equal(await RelationTo(Grumpy, Auth()), 0);
	assert.equal(await SeesVideo(AsGrumpy), true);
	assert.equal((await Call('/api/v1/users/grumpy/block', 'PUT', undefined, Auth())).status, 200);
	assert.equal(await RelationTo(Owner, AsGrumpy), 5);
});

test('the IM protobuf codec reads and writes the same bytes as the original client encoder', () => {
	const Init = '08cb0110071800324eda0c4b0a1f0a017818feffffffffffffffff0138014a060a016b1201765080d095ffbc3112240a01781005180132100a0c08818090bbbad6adf00d18001000380240019a03042803300018632800';
	const Decoded = Proto.Decode('Response', Buffer.from(Init, 'hex'));
	assert.equal(Proto.Encode('Response', Decoded).toString('hex'), Init);
	const Body = Decoded.body.messages_per_user_init_v2_body;
	assert.equal(Body.messages[0].server_message_id, '-2'); assert.deepEqual(Body.messages[0].ext, { k: 'v' });
	assert.equal(Body.conversations[0].first_page_participants.participants[0].user_id, '1000000000000000001');
	const Request = Proto.Decode('Request', Buffer.from('086410f2dfb89ea7e7021a05312e322e3328033000428001a2067d0a2b303a313a313030303030303030303030303030303030313a31303030303030303030303030303030303033100118fb8090cfb09985d96622117b2274657874223a2268c3a96c6c6f227d2a1a0a13733a636c69656e745f6d6573736167655f696412036162633007420361626348838090bbbad6adf00d480550015a037765627a060a0161120162900102', 'hex'));
	assert.equal(Request.sequence_id, '12345678901234');
	assert.deepEqual(Request.body.send_message_body.mentioned_users, ['1000000000000000003', '5']);
	assert.equal(Request.body.send_message_body.content, '{"text":"héllo"}');
	assert.deepEqual(Proto.Decode('Frame', Buffer.from('08091080d095ffbc31180520012a060a016b1201763a0270624203010203', 'hex')).headers, [{ key: 'k', value: 'v' }]);
});

test('original client direct messages persist through the IM protocol over HTTP and arrive live over the frontier socket', async () => {
	const Friendly = await Login(Pool, 'friend', Password);
	const AsFriend = { cookie: `kittok_session=${Friendly.Token}` };
	const Im = async (Cmd, Field, Body, Headers = Auth(), Inbox = 0) => {
		const Sent = await fetch(`${Origin}/v1/kittok`, { method: 'POST', headers: { ...Headers, 'content-type': 'application/x-protobuf' }, body: Proto.Encode('Request', { cmd: Cmd, sequence_id: '9', inbox_type: Inbox, auth_type: 1, body: { [Field]: Body } }) });
		assert.equal(Sent.status, 200);
		const Response = Proto.Decode('Response', Buffer.from(await Sent.arrayBuffer()));
		assert.equal(Response.sequence_id, '9');
		return Response;
	};
	assert.equal((await fetch(`${Origin}/v1/kittok`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: Proto.Encode('Request', { cmd: 203 }) })).status, 401);
	assert.equal((await Im(203, 'messages_per_user_init_v2_body', {})).body.messages_per_user_init_v2_body.conversations, undefined);
	const Created = (await Im(609, 'create_conversation_v2_body', { conversation_type: 1, participants: [Friend.id, Owner.id] })).body.create_conversation_v2_body.conversation;
	assert.equal(Created.conversation_id, `0:1:${Owner.id}:${Friend.id}`);
	assert.deepEqual(Created.first_page_participants.participants.map(Participant => Participant.user_id).sort(), [Owner.id, Friend.id].sort());
	assert.equal((await Im(609, 'create_conversation_v2_body', { conversation_type: 1, participants: [Friend.id] })).body.create_conversation_v2_body.conversation.conversation_short_id, Created.conversation_short_id);
	const Socket = new WebSocket(Origin.replace('http', 'ws') + '/ws/v2', { protocols: ['binary', 'base64', 'pbbp2'], headers: { ...AsFriend, origin: Origin } });
	Socket.binaryType = 'arraybuffer';
	const Received = [];
	Socket.onmessage = Event => Received.push(Event.data);
	await new Promise((Resolve, Reject) => { Socket.onopen = Resolve; Socket.onerror = Reject; });
	assert.equal(Socket.protocol, 'pbbp2');
	Socket.send('hi');
	const Send = (Text, ClientId) => Im(100, 'send_message_body', { conversation_id: Created.conversation_id, conversation_short_id: Created.conversation_short_id, conversation_type: 1, message_type: 7, content: JSON.stringify({ aweType: 0, text: Text }), client_message_id: ClientId, ext: { 's:client_message_id': ClientId } });
	const Sent = (await Send('Hello friend', 'client-1')).body.send_message_body;
	assert.equal(Sent.status, 0); assert.equal(Sent.client_message_id, 'client-1');
	assert.equal((await Send('Hello friend', 'client-1')).body.send_message_body.server_message_id, Sent.server_message_id);
	await new Promise(Resolve => setTimeout(Resolve, 200));
	assert.ok(Received.includes('hi'));
	const Pushes = Received.filter(Data => typeof Data !== 'string').map(Data => Proto.Decode('Response', Proto.Decode('Frame', new Uint8Array(Data)).payload));
	assert.equal(Pushes.length, 1); assert.equal(Pushes[0].cmd, 500);
	const Notify = Pushes[0].body.has_new_message_notify;
	assert.equal(Notify.message.content, '{"aweType":0,"text":"Hello friend"}'); assert.equal(Notify.message.sender, Owner.id);
	assert.equal(Notify.next_cursor, Sent.server_message_id); assert.equal(Notify.previous_cursor, '0'); assert.equal(Notify.badge_count, 1);
	const Framed = new Promise(Resolve => { Socket.onmessage = Event => typeof Event.data !== 'string' && Resolve(Proto.Decode('Frame', new Uint8Array(Event.data))); });
	Socket.send(Proto.Encode('Frame', { seqid: '42', service: 5, method: 1, payload_type: 'pb', payload: Proto.Encode('Request', { cmd: 203, sequence_id: '42', inbox_type: 0 }) }));
	const Reply = await Framed;
	assert.equal(Reply.seqid, '42');
	const FriendInit = Proto.Decode('Response', Reply.payload).body.messages_per_user_init_v2_body;
	assert.equal(FriendInit.per_user_cursor, Sent.server_message_id);
	assert.equal(FriendInit.conversations[0].badge_count, 1);
	assert.deepEqual(FriendInit.messages.map(Message => [Message.content, Message.ext['s:client_message_id'], Message.index_in_conversation]), [['{"aweType":0,"text":"Hello friend"}', 'client-1', '1']]);
	Socket.close();
	assert.equal((await Im(203, 'messages_per_user_init_v2_body', {}, AsFriend, 3)).body.messages_per_user_init_v2_body.conversations, undefined);
	await Send('Second note', 'client-2');
	const Combo = (await Im(204, 'messages_per_user_combo_body', { inboxes: [{ inbox_type: 0, cursor: Sent.server_message_id, limit: 50 }, { inbox_type: 3, cursor: '0', limit: 50 }] }, AsFriend)).body.messages_per_user_combo_body.inboxes;
	assert.deepEqual(Combo[0].messages.map(Message => JSON.parse(Message.content).text), ['Second note']); assert.equal(Combo[1].messages, undefined);
	const History = (await Im(301, 'messages_in_conversation_body', { conversation_short_id: Created.conversation_short_id, direction: 1, limit: 1 }, AsFriend)).body.messages_in_conversation_body;
	assert.deepEqual(History.messages.map(Message => JSON.parse(Message.content).text), ['Second note']); assert.equal(History.has_more, true);
	const Range = (await Im(304, 'messages_in_conversation_with_range', { conversation_short_id: Created.conversation_short_id, message_range: { min_conv_index: '1', max_conv_index: '2' }, limit: 10 }, AsFriend)).body.messages_in_conversation_with_range;
	assert.deepEqual(Range.messages_pb.map(Bytes => Proto.Decode('MessageBody', Bytes).index_in_conversation), ['1', '2']);
	assert.equal((await Im(2002, 'mark_conversation_read_body', { conversation_short_id: Created.conversation_short_id, conversation_type: 1, read_message_index: '99' }, AsFriend)).status_code, 0);
	assert.equal((await Pool.query('SELECT read_index FROM conversation_members WHERE conversation_id = $1 AND user_id = $2', [Created.conversation_short_id, Friend.id])).rows[0].read_index, '2');
	const Indexes = (await Im(2000, 'participants_read_index_body', { conversation_short_id: Created.conversation_short_id })).body.participants_read_index_body.indexes;
	assert.equal(Indexes.find(Entry => Entry.user_id === Friend.id).index, '2');
	const Stranger = await CreateUser(Pool, { username: 'stranger', displayName: 'Stranger', password: Password }, 'closed', true);
	const Outsider = (await Pool.query("INSERT INTO conversations(conversation_key, conversation_type) VALUES ($1, 1) RETURNING id", [`0:1:${Friend.id}:${Stranger.id}`])).rows[0].id;
	assert.equal((await Im(301, 'messages_in_conversation_body', { conversation_short_id: Outsider })).status_code, 1001);
	const Grumpy = (await Pool.query("SELECT id FROM users WHERE username = 'grumpy'")).rows[0].id;
	assert.equal((await Im(609, 'create_conversation_v2_body', { conversation_type: 1, participants: [Grumpy] })).status_code, 11);
	assert.equal((await Im(609, 'create_conversation_v2_body', { conversation_type: 2, participants: [Friend.id, Grumpy] })).status_code, 4);
	assert.equal((await Im(9999, 'vcd_clean_body', {})).status_code, 5);
	const Upgrade = Origin => new Promise(Resolve => {
		const Sent = HttpRequest('http://127.0.0.1:13210/ws/v2', { headers: { ...AsFriend, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', origin: Origin } });
		Sent.on('upgrade', (Response, Socket) => { Socket.destroy(); Resolve(Response.statusCode); });
		Sent.on('error', () => Resolve('Rejected'));
		Sent.on('response', Response => Resolve(Response.statusCode));
		Sent.end();
	});
	assert.equal(await Upgrade('http://127.0.0.1:13210'), 101);
	assert.equal(await Upgrade('http://evil.example'), 403);
	const Profiles = await (await Call(`/tiktok/v1/im/user/profile/?aid=1988&user_ids=${encodeURIComponent(JSON.stringify([Friend.id]))}`, 'GET', undefined, Auth())).json();
	assert.deepEqual([Profiles.status_code, Profiles.users[0].im_user_profile.unique_id, Profiles.users[0].im_user_profile.follow_status], [0, 'friend', 2]);
});

test('direct messages honor recipient privacy, end with the session, and follow the admin switch', async () => {
	const Friendly = await Login(Pool, 'friend', Password);
	const AsFriend = { cookie: `kittok_session=${Friendly.Token}` };
	const Im = async (Cmd, Field, Body, Headers = Auth()) => {
		const Sent = await fetch(`${Origin}/v1/kittok`, { method: 'POST', headers: { ...Headers, 'content-type': 'application/x-protobuf' }, body: Proto.Encode('Request', { cmd: Cmd, sequence_id: '3', inbox_type: 0, body: { [Field]: Body } }) });
		return Sent.status === 200 ? Proto.Decode('Response', Buffer.from(await Sent.arrayBuffer())) : Sent.status;
	};
	const Policy = Value => fetch(`${Origin}/account/messages`, { method: 'POST', redirect: 'manual', headers: { ...AsFriend, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: Friendly.Csrf, policy: Value }) });
	const Short = (await Pool.query('SELECT id FROM conversations WHERE conversation_key = $1', [`0:1:${Owner.id}:${Friend.id}`])).rows[0].id;
	const Send = ClientId => Im(100, 'send_message_body', { conversation_short_id: Short, conversation_type: 1, message_type: 7, content: '{"aweType":0,"text":"Knock knock"}', client_message_id: ClientId });
	assert.equal((await Policy('nobody')).status, 303);
	assert.equal((await Pool.query('SELECT dm_policy FROM users WHERE id = $1', [Friend.id])).rows[0].dm_policy, 'nobody');
	assert.equal((await Send('private-1')).body.send_message_body.status, 2);
	assert.equal((await Im(609, 'create_conversation_v2_body', { conversation_type: 1, participants: [Friend.id] })).status_code, 11);
	assert.equal((await Policy('following')).status, 303);
	assert.equal((await Send('private-2')).body.send_message_body.status, 0);
	const Followed = (await Pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING created_at', [Friend.id, Owner.id])).rows[0].created_at;
	assert.equal((await Send('private-3')).body.send_message_body.status, 2);
	await Pool.query('INSERT INTO follows(follower_id, following_id, created_at) VALUES ($1, $2, $3)', [Friend.id, Owner.id, Followed]);
	assert.equal((await Policy('everyone')).status, 303);
	assert.equal((await fetch(`${Origin}/account/messages`, { method: 'POST', redirect: 'manual', headers: { ...AsFriend, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: Friendly.Csrf, policy: 'anyone' }) })).status, 303);
	assert.equal((await Pool.query('SELECT dm_policy FROM users WHERE id = $1', [Friend.id])).rows[0].dm_policy, 'everyone');
	const Socket = new WebSocket(Origin.replace('http', 'ws') + '/ws/v2', { protocols: ['pbbp2'], headers: { ...AsFriend, origin: Origin } });
	await new Promise((Resolve, Reject) => { Socket.onopen = Resolve; Socket.onerror = Reject; });
	const Closed = new Promise(Resolve => { Socket.onclose = Resolve; });
	await Pool.query('DELETE FROM sessions WHERE token_hash = $1', [Hash(Friendly.Token)]);
	Socket.send(Proto.Encode('Frame', { seqid: '1', service: 5, method: 1, payload_type: 'pb', payload: Proto.Encode('Request', { cmd: 203, sequence_id: '1' }) }));
	await Closed;
	const Settings = await (await Call('/_kittok/admin/settings', 'GET', undefined, Auth())).json();
	const Switch = Value => Call('/_kittok/admin/settings/features', 'POST', { value: { ...Settings.features, messages: Value } }, Auth());
	assert.equal((await Switch(false)).status, 200);
	assert.equal(await Im(203, 'messages_per_user_init_v2_body', {}), 403);
	const Page = await (await Call('/', 'GET', undefined, { cookie: Cookie })).text();
	assert.ok(Page.includes('"hasIMPermission":false')); assert.ok(Page.includes('[data-e2e="nav-messages"]'));
	const Refused = new WebSocket(Origin.replace('http', 'ws') + '/ws/v2', { headers: { cookie: Cookie, origin: Origin } });
	assert.equal(await new Promise(Resolve => { Refused.onopen = () => Resolve('Open'); Refused.onerror = () => Resolve('Refused'); }), 'Refused');
	assert.equal((await Switch(true)).status, 200);
	assert.equal((await Im(203, 'messages_per_user_init_v2_body', {})).status_code, 0);
});

test('users, sessions, videos, and social data survive a server restart', async () => {
	await Stop(); await Start();
	const Current = await (await Call('/api/v1/session', 'GET', undefined, { cookie: Cookie })).json(); assert.equal(Current.user.uniqueId, 'owner');
	assert.equal((await Pool.query('SELECT * FROM likes WHERE video_id=$1 AND user_id=$2', [VideoId, Owner.id])).rowCount, 1);
	assert.deepEqual((await (await Call('/api/inbox/notice_count/', 'GET', undefined, Auth())).json()).notice_count.filter(Entry => Entry.count), []);
	const Feed = await (await Call('/api/recommend/item_list/')).json(); assert.equal(Feed.itemList.length, 2);
	const Item = (await (await Call('/api/recommend/item_list/', 'GET', undefined, Auth())).json()).itemList.find(Item => Item.id === VideoId);
	assert.equal(Item.collected, true); assert.equal(Item.stats.collectCount, 1);
	assert.deepEqual((await (await Call(`/api/user/collect/item_list/?secUid=${Owner.id}`, 'GET', undefined, Auth())).json()).itemList.map(Item => Item.id), [VideoId]);
	assert.equal((await (await Call('/api/user/detail/?uniqueId=friend', 'GET', undefined, Auth())).json()).userInfo.user.relation, 2);
	assert.equal((await (await Call('/api/user/detail/?uniqueId=grumpy', 'GET', undefined, Auth())).json()).userInfo.user.relation, 4);
	const Inbox = await fetch(`${Origin}/v2/message/get_by_user_init`, { method: 'POST', headers: { ...Auth(), 'content-type': 'application/x-protobuf' }, body: Proto.Encode('Request', { cmd: 203, sequence_id: '1', inbox_type: 0 }) });
	assert.deepEqual(Proto.Decode('Response', Buffer.from(await Inbox.arrayBuffer())).body.messages_per_user_init_v2_body.messages.map(Message => JSON.parse(Message.content).text), ['Hello friend', 'Second note', 'Knock knock']);
	assert.ok((await (await Call(`/api/comment/list/?aweme_id=${VideoId}`)).json()).comments.some(Comment => Comment.text === 'Published natively'));
	const Thread = (await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=50`, 'GET', undefined, Auth())).json()).comments.find(Comment => Comment.text === 'Thread root');
	assert.equal(Thread.reply_comment_total, 5);
	assert.equal((await (await Call(`/api/comment/list/reply/?comment_id=${Thread.cid}&count=3`, 'GET', undefined, Auth())).json()).comments[1].user_digged, 1);
	assert.equal((await Call('/api/v1/session', 'DELETE', undefined, Auth())).status, 200);
	assert.equal((await (await Call('/api/v1/session', 'GET', undefined, { cookie: Cookie })).json()).user, null);
});
