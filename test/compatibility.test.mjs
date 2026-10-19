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
	runInNewContext(await readFile(join(Root, 'src/client/bridge.js'), 'utf8'), { window: Window, document: Document, location: { origin: Origin }, Request, Headers, URL, XMLHttpRequest: class { open() {} }, MutationObserver: class { observe() {} } });
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

test('social mutations enforce authentication and CSRF, and repeated likes stay unique', async () => {
	const Path = `/api/v1/videos/${VideoId}/like`;
	assert.equal((await Call(Path, 'PUT')).status, 401);
	assert.equal((await Call(Path, 'PUT', undefined, { cookie: Cookie })).status, 403);
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

test('search finds local accounts and paginated feeds do not repeat the final video', async () => {
	const Users = await (await Call('/api/search/user/full/?keyword=owner')).json(); assert.equal(Users.user_list[0].user_info.unique_id, 'owner');
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

test('users, sessions, videos, and social data survive a server restart', async () => {
	await Stop(); await Start();
	const Current = await (await Call('/api/v1/session', 'GET', undefined, { cookie: Cookie })).json(); assert.equal(Current.user.uniqueId, 'owner');
	assert.equal((await Pool.query('SELECT * FROM likes WHERE video_id=$1', [VideoId])).rowCount, 1);
	const Feed = await (await Call('/api/recommend/item_list/')).json(); assert.equal(Feed.itemList.length, 2);
	const Item = (await (await Call('/api/recommend/item_list/', 'GET', undefined, Auth())).json()).itemList.find(Item => Item.id === VideoId);
	assert.equal(Item.collected, true); assert.equal(Item.stats.collectCount, 1);
	assert.deepEqual((await (await Call(`/api/user/collect/item_list/?secUid=${Owner.id}`, 'GET', undefined, Auth())).json()).itemList.map(Item => Item.id), [VideoId]);
	assert.equal((await (await Call('/api/user/detail/?uniqueId=friend', 'GET', undefined, Auth())).json()).userInfo.user.relation, 2);
	assert.ok((await (await Call(`/api/comment/list/?aweme_id=${VideoId}`)).json()).comments.some(Comment => Comment.text === 'Published natively'));
	const Thread = (await (await Call(`/api/comment/list/?aweme_id=${VideoId}&count=50`, 'GET', undefined, Auth())).json()).comments.find(Comment => Comment.text === 'Thread root');
	assert.equal(Thread.reply_comment_total, 5);
	assert.equal((await (await Call(`/api/comment/list/reply/?comment_id=${Thread.cid}&count=3`, 'GET', undefined, Auth())).json()).comments[1].user_digged, 1);
	assert.equal((await Call('/api/v1/session', 'DELETE', undefined, Auth())).status, 200);
	assert.equal((await (await Call('/api/v1/session', 'GET', undefined, { cookie: Cookie })).json()).user, null);
});
