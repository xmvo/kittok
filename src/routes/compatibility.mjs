import { createHmac, randomBytes } from 'node:crypto';
import { Transaction } from '../db.mjs';
import { HttpError, Id, Json, ReadBody, ReadRaw, RequireMethod } from '../http.mjs';
import { RequireCsrf, RecordEvent, ClientInfo } from '../auth.mjs';
import { SaveAvatar, AvatarExists, RemoveMedia } from '../media.mjs';
import { ActiveRestriction, RestrictionText, RemovedSql, ModerationNotices, UnreadModerationNotices, MarkModerationNoticesRead, ReadBanTicket, ActiveBan, BanText, Appeal } from '../moderation.mjs';
import { AcceptRequest } from './im.mjs';
import { AssertVideoVisible, VideoVisibleSql, SetPrivateAccount, DecideFollowRequest, FollowRequests } from '../privacy.mjs';
import { PublicBadges } from '../badges.mjs';
import { Categories } from '../categories.mjs';
import { Misc } from '../settings.mjs';
import { FindUser, UserShape, UserStats, Videos, SetRelation, TagId, TagName, TagSql, MentionedUsers, CommentExtra, Relation, AddComment, FollowList, AvatarUrl, Activity, UnreadActivity, MarkActivityRead, RelationSql, RecordView, SetBlock, BlockList, BlockedBetween, DmAudiences, DmSettings, SetDmSetting } from '../store.mjs';

const ViewSecret = randomBytes(32);

const FollowStatus = Value => ({ 1: 1, 2: 2, 3: 4 })[Value] ?? 0;
const Offset = Value => Math.min(Math.max(Math.floor(Number(Value)) || 0, 0), 100000);
const PageSize = (Value, Default) => Math.min(Math.max(Number(Value) || Default, 1), 50);

function CollectionShape(Row, Owner, Origin) {
	return { collectionId: Row.id, name: Row.name, status: Row.public ? 3 : 1, total: String(Row.total ?? 0), cover: Row.cover_name ? `${Origin}/media/${Row.cover_name}` : '', userId: Owner.id, userSecUid: Owner.id, userName: Owner.username };
}

const CommentLabel = Row => Row.author_id === Row.video_author ? 1 : Row.relation === 2 ? 8 : Row.relation === 1 ? 2 : 0;

function CommentShape(Row, Origin, Mentioned) {
	return {
		cid: Row.id, aweme_id: Row.video_id, text: Row.body, text_extra: CommentExtra(Row.body, Mentioned), label_type: Misc.commentLabels ? CommentLabel(Row) : 0, is_author_digged: Misc.commentLabels && Boolean(Row.author_digged), create_time: Math.floor(new Date(Row.created_at).getTime() / 1000),
		digg_count: Row.likes ?? 0, reply_comment_total: Row.replies ?? 0, user_digged: Row.liked ? 1 : 0, reply_id: Row.parent_id ?? '0', reply_to_reply_id: '0',
		user: ApiUser({ ...Row, id: Row.author_id }, Origin),
	};
}

function ApiUser(Row, Origin) {
	const Avatar = { url_list: [AvatarUrl(Row, Origin)] };
	return { uid: Row.id, sec_uid: Row.id, unique_id: Row.username, nickname: Row.display_name, signature: Row.bio ?? '', avatar_thumb: Avatar, avatar_medium: Avatar, follow_status: FollowStatus(Row.relation), follower_status: [2, 6].includes(Row.relation) ? 1 : 0, is_block: Row.relation === 4, kittokBadges: PublicBadges(Row), ...(Row.verified && Misc.verifiedBadges ? { custom_verify: 'Verified account', enterprise_verify_reason: '', verification_type: 1 } : {}) };
}

const MentionsOn = Kinds => Kinds.filter(Kind => Kind !== 'mention' || Misc.hashtags);
const NoticeKinds = { 500: ['like', 'comment_like', 'comment', 'follow', 'mention', 'approved'], 3: ['like', 'comment_like'], 505: ['like', 'comment_like'], 2: ['comment'], 6: ['mention'], 7: ['follow', 'approved'] };

function NoticeShape(Row, Viewer, Origin) {
	const Code = { like: 1, comment_like: 2, comment: 3, follow: 4, mention: 5, approved: 6 }[Row.kind];
	const Merged = Misc.groupedLikes && ['like', 'comment_like'].includes(Row.kind);
	const Nid = `${Code}${Row.video_id ?? 0}${Row.comment_id ?? 0}${Merged ? '' : Row.id}`;
	const Notice = { nid: Nid, nid_str: Nid, create_time: Math.floor(Row.epoch), has_read: Row.read, user_id: Viewer };
	const From = ApiUser(Row, Origin);
	const Aweme = Row.video_id && { aweme_id: Row.video_id, aweme_type: 0, desc: Row.description, author: { uid: Row.video_author }, status: { private_status: 0 }, video: { cover: { url_list: [`${Origin}/media/${Row.cover_name}`] } } };
	if (Row.kind === 'mention') return { ...Notice, type: 45, at: { sub_type: Row.comment_id ? 2 : 1, content: Row.comment_id ? Row.body : Row.description, aweme: Aweme, user_info: From,
		...(Row.comment_id ? { comment: { cid: Row.comment_id, text: Row.body, text_extra: CommentExtra(Row.body), reply_id: Row.parent_id ?? '0', user: From } } : {}) } };
	if (Row.kind === 'approved') return { ...Notice, type: 23, follow_request_approve: { from_user: From } };
	if (Row.kind === 'follow') return { ...Notice, type: 33, follow: { from_user: From, follow_button_type: Row.relation === 2 ? 0 : 1 } };
	if (Row.kind === 'comment') {
		const Reply = Row.parent_author === Viewer;
		return { ...Notice, type: 31, comment: { comment_type: Reply ? 2 : 1, aweme: Aweme, comment: { cid: Row.comment_id, text: Row.body, text_extra: [], reply_id: Row.parent_id ?? '0', user: From }, ...(Reply ? { reply_comment: { user: { uid: Viewer } } } : {}) } };
	}
	return { ...Notice, type: 41, digg: { digg_type: Row.kind === 'like' ? 1 : 3, merge_count: Row.merge_count ?? 1, from_user: Row.second ? [From, ApiUser(Row.second, Origin)] : [From], aweme: Aweme, ...(Row.kind === 'comment_like' ? { comment: { cid: Row.comment_id, text: Row.body, text_extra: [] } } : {}) } };
}

const ReportReasons = [[101, 'spam', 'Spam or scams'], [102, 'harassment', 'Harassment or bullying'], [103, 'hate', 'Hate speech'], [104, 'nudity', 'Nudity or sexual content'], [105, 'violence', 'Violent or graphic content'],
	[106, 'self_harm', 'Suicide or self-harm'], [107, 'misinformation', 'False information'], [108, 'impersonation', 'Impersonation'], [109, 'copyright', 'Copyright or intellectual property'], [110, 'other', 'Something else']];
const ReportTargets = { video: 'video', photo_mode: 'video', comment: 'comment', user: 'user', im: 'message' };

async function CommentPage(Pool, Origin, Viewer, { video, parent, cursor, count }) {
	if (parent) video = (await Pool.query('SELECT video_id FROM comments WHERE id = $1', [parent])).rows[0]?.video_id;
	if (!video) throw new HttpError(404, 'VideoNotFound');
	await AssertVideoVisible(Pool, video, Viewer);
	const Limit = PageSize(count, 20);
	const After = cursor && cursor !== '0' ? Id(cursor) : null;
	const Result = await Pool.query(`SELECT c.*, u.username, u.display_name, u.avatar_name, u.verified, u.pride_flag, u.user_badges, v.author_id AS video_author,
		${RelationSql('$1::bigint', 'c.author_id')} AS relation,
		EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = v.author_id) AS author_digged,
		(SELECT count(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS likes,
		EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = $1::bigint) AS liked,
		(SELECT count(*)::int FROM comments r WHERE r.parent_id = c.id) AS replies
		FROM comments c JOIN users u ON u.id = c.author_id JOIN videos v ON v.id = c.video_id
		WHERE ${parent ? 'c.parent_id = $2' : 'c.video_id = $2 AND c.parent_id IS NULL'} AND ($3::bigint IS NULL OR c.id ${parent ? '>' : '<'} $3) AND NOT ${BlockedBetween('$1::bigint', 'c.author_id')} AND NOT ${RemovedSql('comment', 'c.id')} AND u.suspended_at IS NULL
		ORDER BY c.id ${parent ? 'ASC' : 'DESC'} LIMIT $4`, [Viewer ?? null, parent ?? video, After, Limit + 1]);
	const Rows = Result.rows.slice(0, Limit);
	const Mentioned = await MentionedUsers(Pool, Rows.map(Row => Row.body));
	return { status_code: 0, comments: Rows.map(Row => CommentShape(Row, Origin, Mentioned)), cursor: Rows.at(-1)?.id ?? cursor ?? '0', has_more: Result.rows.length > Limit ? 1 : 0 };
}

export async function Compatibility(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	const Path = Url.pathname;
	const Params = Url.searchParams;
	if (Path === '/node-webapp/api/login-config') {
		RequireMethod(Request, ['GET']);
		Json(Response, { statusCode: 0, config: {
			emailSuffixConfig: [], platformConfig: { show_num: 2, order: 'FACEBOOK,GOOGLE,APPLE,INSTAGRAM' },
			platformConfigV2: { show_num: 2, order: 'FACEBOOK,GOOGLE,APPLE,INSTAGRAM' },
			signupConfig: { enable: Config.Registration !== 'closed', text: { title: '', description: 'Registration is closed on this instance.' } },
			forceLogin: false, emailConsent: false, ttpConfig: { open: false, syncSeverList: [] },
			preventSignupText: { title: '', description: 'Registration is closed on this instance.' },
			disableStandaloneAidLoginList: [], disableStandaloneAppFlags: {},
		} }); return true;
	}
	if (['/api/preload/item_list/', '/api/recommend/item_list/', '/api/following/item_list/', '/api/post/item_list/', '/api/favorite/item_list/', '/api/collection/item_list/', '/api/user/collect/item_list/', '/api/related/item_list/', '/api/explore/item_list/', '/api/repost/item_list/', '/api/challenge/item_list/', '/api/collection/candidate/item_list/'].includes(Path)) {
		RequireMethod(Request, ['GET', 'POST']);
		const Filter = { viewer: User?.id, forYou: ['/api/preload/item_list/', '/api/recommend/item_list/', '/api/related/item_list/', '/api/explore/item_list/'].includes(Path), before: Params.get('cursor') === '0' ? undefined : Params.get('cursor'), limit: Params.get('count') };
		const Empty = () => Json(Response, { statusCode: 0, status_code: 0, itemList: [], cursor: '0', hasMore: false, extra: { logid: 'kittok' } });
		if (Path.includes('/explore/') && (Params.get('categoryType') ?? '120') !== '120') {
			const Type = Number(Params.get('categoryType'));
			if (!Categories.some(([Known]) => Known === Type)) { Empty(); return true; }
			Filter.category = Type;
		}
		if (Path.includes('/repost/') && !Misc.reposts) { Empty(); return true; }
		if (Path.includes('/challenge/') && !Misc.hashtags) { Empty(); return true; }
		if (Path.startsWith('/api/collection/') && !Misc.collections) { Empty(); return true; }
		if (Path.includes('/repost/')) {
			const Reposter = await FindUser(Pool, Params.get('uniqueId') || Params.get('secUid') || User?.id, !Params.get('uniqueId'));
			if (Reposter.private_account && Reposter.id !== User?.id && !(await Pool.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [User?.id ?? null, Reposter.id])).rowCount) { Empty(); return true; }
			Filter.repostedBy = Reposter.id;
		}
		if (Path.includes('/challenge/')) { Filter.tag = await TagName(Pool, String(Params.get('challengeID') ?? '')); if (!Filter.tag) { Empty(); return true; } }
		if (Path.includes('/related/')) Filter.exclude = Params.get('itemID') || Params.get('itemId');
		if (Path.includes('/following/')) { if (!User) throw new HttpError(401, 'NotLoggedIn'); Filter.following = User.id; }
		if (Path.includes('/post/')) Filter.author = (await FindUser(Pool, Params.get('uniqueId') || Params.get('secUid') || User?.id, !Params.get('uniqueId'))).id;
		if (Path === '/api/collection/item_list/') {
			const Collection = (await Pool.query('SELECT id FROM collections WHERE id = $1 AND (public OR user_id = $2::bigint)', [Id(Params.get('collectionId')), User?.id ?? null])).rows[0];
			if (!Collection) { Empty(); return true; }
			Filter.collection = Collection.id;
		} else if (Path.includes('/collection/')) { if (!User) throw new HttpError(401, 'NotLoggedIn'); Filter.savedBy = User.id; }
		if (Path.includes('/favorite/') || Path.includes('/user/collect/')) {
			if (!User || (Params.get('secUid') && Params.get('secUid') !== User.id)) { Json(Response, { statusCode: 0, status_code: 0, itemList: [], cursor: '0', hasMore: false, extra: { logid: 'kittok' } }); return true; }
			Filter[Path.includes('/favorite/') ? 'likedBy' : 'savedBy'] = User.id;
		}
		const Feed = await Videos(Pool, Config.Origin, Filter);
		Json(Response, { statusCode: 0, status_code: 0, itemList: Feed.items, cursor: Feed.cursor, hasMore: Feed.hasMore, extra: { logid: 'kittok' } }); return true;
	}
	if (Path === '/api/item/detail/') {
		RequireMethod(Request, ['GET']);
		const Result = await Videos(Pool, Config.Origin, { id: Params.get('itemId'), viewer: User?.id });
		if (!Result.items.length) throw new HttpError(404, 'VideoNotFound');
		Json(Response, { statusCode: 0, itemInfo: { itemStruct: Result.items[0] } }); return true;
	}
	if (Path === '/api/im/item_detail/') {
		RequireMethod(Request, ['GET']);
		const Result = await Videos(Pool, Config.Origin, { id: Params.get('itemId'), viewer: User?.id });
		Json(Response, Result.items.length ? { statusCode: 0, status_code: 0, itemInfo: { itemStruct: Result.items[0] } } : { statusCode: 10204, status_code: 10204, status_msg: 'Video unavailable' }); return true;
	}
	if (Path === '/v1/list') {
		RequireMethod(Request, ['POST']);
		Request.resume();
		Json(Response, { e: 0 }); return true;
	}
	if (Path === '/api/playlist/name_check') {
		RequireMethod(Request, ['GET']);
		const Name = String(Params.get('name') ?? '').trim();
		Json(Response, { statusCode: 0, status_code: 0, isValid: Name.length > 0 && Name.length <= 30 }); return true;
	}
	if (Path === '/api/challenge/detail/') {
		RequireMethod(Request, ['GET']);
		const Name = Params.get('challengeName') ? String(Params.get('challengeName')).replace(/^#/, '').toLowerCase() : await TagName(Pool, String(Params.get('challengeId') ?? ''));
		if (!Misc.hashtags || !Name || !/^[\p{L}\p{N}_]{1,100}$/u.test(Name)) { Json(Response, { statusCode: 10205, status_code: 10205, statusMsg: 'HashtagNotFound' }); return true; }
		const Stats = (await Pool.query(`SELECT count(*)::int AS videos, coalesce(sum(v.view_count), 0)::bigint AS views FROM videos v JOIN users u ON u.id = v.author_id
			WHERE ${TagSql('v.description').replace('?', '$2')} AND ${VideoVisibleSql('$1::bigint')} AND NOT ${BlockedBetween('$1', 'v.author_id')}`, [User?.id ?? null, Name])).rows[0];
		const Counts = { videoCount: Stats.videos, viewCount: Number(Stats.views) };
		Json(Response, { statusCode: 0, status_code: 0, challengeInfo: {
			challenge: { id: TagId(Name), title: Name, desc: '', profileThumb: '', profileMedium: '', profileLarger: '', coverThumb: '', coverMedium: '', coverLarger: '', isCommerce: false },
			stats: Counts, statsV2: { videoCount: String(Counts.videoCount), viewCount: String(Counts.viewCount) },
		}, shareMeta: { title: `#${Name}`, desc: '' } }); return true;
	}
	if (Path === '/tiktok/v1/upvote/publish' || Path === '/tiktok/v1/upvote/delete') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		if (!Misc.reposts && Path.endsWith('/publish')) throw new HttpError(403, 'RepostsDisabled');
		await SetRelation(Pool, 'reposts', ['user_id', 'video_id'], [User.id, Id(Body.item_id)], Path.endsWith('/publish'));
		Json(Response, { status_code: 0, status_msg: '' }); return true;
	}
	if (Path === '/api/user/detail/') {
		RequireMethod(Request, ['GET']);
		const Target = await FindUser(Pool, Params.get('uniqueId') || Params.get('secUid') || User?.id, !Params.get('uniqueId'));
		Json(Response, { statusCode: 0, userInfo: { user: UserShape({ ...Target, relation: await Relation(Pool, User?.id, Target.id) }, Config.Origin), stats: await UserStats(Pool, Target.id) } }); return true;
	}
	if (Path === '/api/user/list/') {
		RequireMethod(Request, ['GET']);
		const Scene = { 21: 'following', 67: 'followers', 150: 'friends', 151: 'suggested' }[Params.get('scene')];
		const Target = Params.get('secUid') && Scene !== 'suggested' ? Id(Params.get('secUid')) : User?.id;
		const Start = Offset(Params.get('minCursor'));
		const List = Scene && Target ? await FollowList(Pool, User?.id, Target, Scene, Start, PageSize(Params.get('count'), 30)) : { users: [], total: 0 };
		const UserList = await Promise.all(List.users.map(async Row => {
			const Stats = await UserStats(Pool, Row.id);
			return { user: UserShape(Row, Config.Origin), stats: Stats, statsV2: Object.fromEntries(Object.entries(Stats).map(([Key, Value]) => [Key, String(Value)])) };
		}));
		Json(Response, { statusCode: 0, status_code: 0, userList: UserList, total: List.total, minCursor: Start + UserList.length, maxCursor: 0, hasMore: Start + UserList.length < List.total }); return true;
	}
	if (Path === '/api/im/spotlight/relation' || Path === '/api/im/spotlight/relation/') {
		RequireMethod(Request, ['GET']);
		const Start = Offset(Params.get('max_time'));
		const List = User ? await FollowList(Pool, User.id, User.id, 'following', Start, PageSize(Params.get('count'), 30)) : { users: [], total: 0 };
		Json(Response, {
			status_code: 0, max_time: Start, min_time: Start + List.users.length, has_more: Start + List.users.length < List.total ? 1 : 0,
			followings: List.users.map(Row => ApiUser(Row, Config.Origin)),
		}); return true;
	}
	if (Path === '/api/user/settings/') {
		RequireMethod(Request, ['GET']);
		const Settings = User ? await DmSettings(Pool, User.id) : {};
		Json(Response, { status_code: 0, statusCode: 0, settings: { ...Settings, privateAccount: Boolean(User?.private_account), private_account: User?.private_account ? 1 : 0, languageSettings: { videoTranslationLanguages: [] } } }); return true;
	}
	const SettingDefaults = {
		'/tiktok/region/change/status/get/v1': { is_change_region_enabled: false },
		'/api/compliance/settings/': {},
		'/api/privacy/user/effected_count/v1': { no_pa_control_settings: {} },
	};
	if (SettingDefaults[Path]) {
		RequireMethod(Request, ['GET']);
		Json(Response, { status_code: 0, statusCode: 0, ...SettingDefaults[Path] }); return true;
	}
	if (Path === '/api/privacy/setting/restriction/v1/' || Path === '/api/privacy/setting/restriction/v1') {
		RequireMethod(Request, ['GET']);
		const Messages = User && Config.Features?.messages !== false;
		const Choice = { show_type: 0, values: [{ value: 1, show_type: 0 }, { value: 2, show_type: 0 }, { value: 3, show_type: 0 }] };
		const Account = { comment: { show_type: User ? 0 : 2, values: [0, 1, 2, 3].map(value => ({ value, show_type: 0 })) }, private_account: { show_type: User ? 0 : 2 }, ...(Messages ? { direct_message: { show_type: 0 }, message_read_status: { show_type: 0, values: [{ value: 0, show_type: 0 }, { value: 1, show_type: 0 }] }, ...Object.fromEntries(Object.keys(DmAudiences).map(Key => [Key, Choice])) } : {}) };
		Json(Response, { status_code: 0, statusCode: 0, privacy_restriction: { account: Account }, privacy_settings: { private_account: User?.private_account ? 1 : 0, comment: ({everyone:0,friends:1,none:2,followers:3})[User?.comment_permission ?? 'everyone'], ...(Messages ? await DmSettings(Pool, User.id) : {}) } }); return true;
	}
	if (Path === '/api/privacy/unified_config/v1') {
		RequireMethod(Request, ['GET']);
		const Configs = {};
		if (User) {
			Configs.main = { page_tag: 'main', contents: [{ section_tag: 'interactions', section_header: 'Interactions', items: [{ item_type: 0, item_tag: 'comment_entrance', item_info: { item_title: 'Comments', restriction_key: 'comment', setting_key: 'comment' } }] }] };
			Configs.main.contents.unshift({ section_tag: 'discoverability', section_header: 'Discoverability', items: [{ item_type: 1, item_tag: 'kittok_private_account', item_info: { item_title: 'Private account', item_subtitle: 'Only followers you approve can view your posts.', restriction_key: 'private_account', setting_key: 'private_account', checked_value: 1, unchecked_value: 0 } }] });
			Configs.comment_permission = { page_tag: 'comment_permission', page_title: 'Comments', contents: [{ section_tag: 'comment_options', items: [{ item_type: 2, item_tag: 'comment_permission_item', item_info: { item_title: 'Who can comment on your posts', restriction_key: 'comment', setting_key: 'comment', options: [[0,'Everyone'],[3,'Followers'],[1,'Friends'],[2,'No one']].map(([Value,Title]) => ({option_value:Value,option_title:Title,option_tag:'options_comment_' + Value})) } }] }] };
		}
		if (User && Config.Features?.messages !== false) {
			Configs.main.contents.find(Section => Section.section_tag === 'interactions').items.push({ item_type: 0, item_tag: 'direct_message_entrance', item_info: { item_title: 'Direct messages', restriction_key: 'direct_message', setting_key: 'direct_message' } });
			const Audiences = [['dm_setting_friends', 'dm_friends', 'Friends'], ['dm_setting_potential_connection', 'dm_potential_connection', 'Potential connections'], ['dm_setting_others', 'dm_others', 'Others']];
			Configs.direct_message_permission = { page_tag: 'direct_message_permission', page_title: 'Direct messages', contents: [{ section_tag: 'dm_entrances', section_header: 'Who can send you direct messages', items: Audiences.map(([Key, Page, Title]) => ({
				item_type: 0, item_tag: `${Page}_permission_entrance`, item_info: { item_title: Title, restriction_key: Key, setting_key: Key, label_config: [{ option_value: 1, label_title: 'Receive in inbox' }, { option_value: 2, label_title: 'Receive as message request' }, { option_value: 3, label_title: "Don't receive" }] } })) },
				{ section_tag: 'message_preferences', section_header: 'Message preferences', items: [{ item_type: 1, item_tag: 'message_read_status', item_info: { item_title: 'Read status', item_subtitle: 'Share when you’ve read messages. Only visible when both people turn this on.', restriction_key: 'message_read_status', setting_key: 'message_read_status', checked_value: 1, unchecked_value: 0 } }] }] };
			for (const [Key, Page, Title] of Audiences) {
				Configs[Page] = { page_tag: Page, page_title: Title, contents: [{ section_tag: `${Page}_options`, items: [{ item_type: 2, item_tag: `${Page}_permission_item`, item_info: { item_title: Title, restriction_key: Key, setting_key: Key, options: [
					{ option_value: 1, option_title: 'Receive in inbox', option_tag: 'options_inbox' }, { option_value: 2, option_title: 'Receive as message request', option_tag: 'options_request' }, { option_value: 3, option_title: "Don't receive", option_tag: 'options_dont_receive' },
				] } }] }] };
			}
		}
		Json(Response, { status_code: 0, statusCode: 0, configs: JSON.stringify(Configs) }); return true;
	}
	if (Path === '/api/privacy/user/settings/update/v1') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		try {
			if (Body.field === 'private_account') await SetPrivateAccount(Pool, User.id, Body.value);
			else if (Body.field === 'comment') {
				const Permission = ({0:'everyone',1:'friends',2:'none',3:'followers'})[Body.value];
				if (!Permission || !['number','string'].includes(typeof Body.value)) throw new HttpError(400, 'InvalidCommentPermission');
				await Pool.query('UPDATE users SET comment_permission = $2 WHERE id = $1', [User.id, Permission]);
			} else {
				if (Config.Features?.messages === false) throw new HttpError(400, 'MessagesDisabled');
				await SetDmSetting(Pool, User.id, Body.field, Body.value);
			}
		} catch (Error) { if (Error.status !== 400) throw Error; Json(Response, { status_code: 1, statusCode: 1, status_msg: 'This setting is not available on this instance.' }); return true; }
		const Fresh = await FindUser(Pool, User.id, true);
		Json(Response, { status_code: 0, statusCode: 0, privacy_settings: { ...await DmSettings(Pool, User.id), private_account: Fresh.private_account ? 1 : 0, comment: ({everyone:0,friends:1,none:2,followers:3})[Fresh.comment_permission] } }); return true;
	}
	if (Path === '/api/privacy/user/private_account/update/v1') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		await SetPrivateAccount(Pool, User.id, Body.private_account ?? Body.private ?? Body.value);
		Json(Response, { status_code: 0, statusCode: 0 }); return true;
	}
	if (Path === '/tns-api/appeal/status/' || Path === '/aweme/v2/appeal/status/') {
		RequireMethod(Request, ['GET']);
		const Owner = ReadBanTicket(Params.get('verify_ticket'));
		const Ban = Owner && Owner === Params.get('object_id') ? await ActiveBan(Pool, Owner) : null;
		if (!Ban) { Json(Response, { status_code: 1, status_msg: 'TicketExpired', pop_title: 'Sign in again', pop_content: 'This page expired. Sign in again to see your account status.', button_list: [{ btn_type: 0, btn_content: 'OK', btn_style: 0 }] }); return true; }
		const Pending = Ban.appeal_status === 'pending', Upheld = Ban.appeal_status === 'upheld';
		const AppealUrl = new URL('/appeal', Config.Origin);
		AppealUrl.search = new URLSearchParams({ object_id: Owner, appeal_type: '2018', punish_key: Ban.id }).toString();
		Json(Response, { status_code: 0, appeal_type: 2018, pop_title: 'Your account was permanently banned',
			pop_content: `${BanText(Ban)} ${Pending ? 'Your appeal is being reviewed.' : Upheld ? 'We reviewed your appeal and upheld this decision.' : 'If you think we made a mistake, you can appeal.'}`,
			button_list: [...(Pending || Upheld ? [] : [{ btn_type: 4, btn_content: 'Appeal', btn_url: AppealUrl.href, btn_style: 1 }]), { btn_type: 0, btn_content: 'OK', btn_style: 0 }] }); return true;
	}
	if (Path === '/aweme/v1/material/upload/') {
		RequireMethod(Request, ['POST']);
		Limiter.Hit(`material:${Request.socket.remoteAddress}`, 10);
		const Body = await ReadBody(Request);
		let Email = '';
		try { Email = String(JSON.parse(Body.data ?? '{}').email ?? ''); } catch {}
		if (Body.ns !== 'review_account_appeal' || !/^[^\s@]{1,64}@[^\s@]{1,189}$/.test(Email)) { Json(Response, { status_code: 1, status_msg: 'InvalidMaterial' }); return true; }
		Json(Response, { status_code: 0, data: { mid: Buffer.from(Email).toString('base64url') } }); return true;
	}
	if (Path === '/tns-api/appeal/post-commit/' || Path === '/tns-api/appeal/post-commit') {
		RequireMethod(Request, ['POST']);
		const Body = await ReadBody(Request);
		const Owner = ReadBanTicket(Body.verify_ticket);
		if (!Owner || Owner !== String(Body.object_id)) { Json(Response, { status_code: 1, status_msg: 'TicketExpired' }); return true; }
		const Ban = await ActiveBan(Pool, Owner);
		if (!Ban || String(Body.punish_key) !== Ban.id) { Json(Response, { status_code: 1, status_msg: 'NothingToAppeal' }); return true; }
		let Stored = '';
		try { Stored = Buffer.from(String(JSON.parse(Body.extra ?? '{}').mail_address_v2 ?? ''), 'base64url').toString(); } catch {}
		try { await Appeal(Pool, { id: Owner }, Ban.id, String(Body.reason ?? ''), String(Body.mail_address || Stored).trim()); }
		catch (Error) { if (!Error.status) throw Error; Json(Response, { status_code: 1, status_msg: Error.message }); return true; }
		Json(Response, { status_code: 0, status_msg: '' }); return true;
	}
	if (Path === '/aweme/v1/im/msg/feedback/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Restricted = await ActiveRestriction(Pool, User.id, 'message');
		const Decision = Restricted && (await Pool.query('SELECT decision_id FROM moderation_restrictions WHERE id = $1', [Restricted.id])).rows[0].decision_id;
		if (!Decision) { Json(Response, { status_code: 1, status_msg: 'NothingToAppeal' }); return true; }
		try { await Appeal(Pool, User, Decision, `Feedback on a blocked message: ${String(Body.content ?? '').slice(0, 900)}`); }
		catch (Error) { if (Error.status !== 409) throw Error; }
		Json(Response, { status_code: 0, status_msg: '' }); return true;
	}
	if (Path === '/tiktok/v1/im/user/profile/') {
		RequireMethod(Request, ['GET']);
		if (!User) throw new HttpError(401, 'NotLoggedIn');
		let Ids;
		try { Ids = JSON.parse(Params.get('user_ids') ?? '[]').slice(0, 100).map(Id); } catch { throw new HttpError(400, 'InvalidUserIds'); }
		const Result = await Pool.query(`SELECT u.id, u.username, u.display_name, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, ${RelationSql('$2::bigint', 'u.id')} AS relation FROM users u WHERE u.id = ANY($1::bigint[])`, [Ids, User.id]);
		Json(Response, { status_code: 0, users: Result.rows.map(Row => {
			const Avatar = { url_list: [AvatarUrl(Row, Config.Origin)] };
			return { im_user_profile: { user_id: Row.id, unique_id: Row.username, nick_name: Row.display_name, avatars: { avatar_medium: Avatar, avatar_small: Avatar },
				follow_status: FollowStatus(Row.relation), follower_status: [2, 6].includes(Row.relation) ? 1 : 0, block_info: { block: Row.relation === 4 },
				user_verify_reason: Row.verified && Misc.verifiedBadges ? 'Verified account' : '', enterprise_verify_reason: '' } };
		}) }); return true;
	}
	if (Path === '/_kittok/view') {
		RequireMethod(Request, ['POST']);
		Limiter.Hit(`view:${Request.socket.remoteAddress}`, 120);
		const VideoId = Id((await ReadBody(Request, 1024)).id);
		await AssertVideoVisible(Pool, VideoId, User?.id);
		await RecordView(Pool, VideoId, User ? `u:${User.id}` : `ip:${createHmac('sha256', ViewSecret).update(Request.socket.remoteAddress ?? '').digest('hex')}`);
		Response.writeHead(204).end(); return true;
	}
	if (Path === '/api/share/settings/') {
		RequireMethod(Request, ['GET']);
		const Platforms = [...(Misc.reposts ? ['repost'] : []), ...(Config.Features?.messages !== false ? ['message'] : []), 'copy', 'embed', 'whatsapp', 'facebook', 'twitter', 'sms', 'reddit', 'pinterest'];
		Json(Response, { status_code: 0, status_msg: '', share_platforms: Platforms.map(Platform => ({ platform_id: Platform })) }); return true;
	}
	if (Path === '/api/im/stranger/unlimit' || Path === '/api/im/stranger/unlimit/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Accepted = await AcceptRequest(Pool, User.id, Body.conversation_id);
		Json(Response, Accepted ? { status_code: 0, status_msg: '' } : { status_code: 1, status_msg: 'This message request no longer exists.' }); return true;
	}
	if (Path === '/node/report/reasons') {
		RequireMethod(Request, ['GET']);
		Json(Response, { statusCode: 0, status_code: 0, config: '{}', body: ReportReasons.map(([Code, , Text]) => ({ reason_type: Code, reason_code: Code, text: Text, next_reason: [], special_type: -1, audit_type: -1, option: JSON.stringify({ action: { action_type: 'route', action_params: { route_path: 'Detail_WithDesc', title_text: Text, subtitle_text: 'Add details (optional).' } } }) })) }); return true;
	}
	if (Path === '/aweme/v2/aweme/feedback/' || Path === '/aweme/v1/aweme/feedback/') {
		RequireMethod(Request, ['GET', 'POST']); RequireCsrf(Request, User);
		Limiter.Hit(`report:${User.id}`, 30, 3600000);
		const Body = { ...Object.fromEntries(Params), ...(Request.method === 'POST' ? await ReadBody(Request) : {}) };
		const Type = ReportTargets[Body.report_type];
		const Reason = ReportReasons.find(([Code]) => String(Code) === String(Body.reason));
		if (!Type || !Reason) throw new HttpError(400, 'InvalidReport');
		if (Type === 'message') {
			const Ids = String(Body.msg_list ?? '').split(',').filter(Value => /^\d{1,20}$/.test(Value)).slice(0, 20);
			const Rows = (await Pool.query(`SELECT m.id, m.sender_id FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1
				WHERE m.conversation_id = $2 AND m.id = ANY($3::bigint[]) AND m.sender_id <> $1`, [User.id, Id(Body.object_id || Body.target), Ids])).rows;
			if (!Rows.length) throw new HttpError(404, 'ReportTargetNotFound');
			for (const Row of Rows) await Pool.query(`INSERT INTO reports(reporter_id, target_type, target_id, owner_id, category, description) VALUES ($1, 'message', $2, $3, $4, $5)
				ON CONFLICT (reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING`, [User.id, Row.id, Row.sender_id, Reason[1], String(Body.report_desc ?? '').trim().slice(0, 500)]);
			Json(Response, { status_code: 0, statusCode: 0, status_msg: '', data: {} }); return true;
		}
		const Target = Id(Body.object_id || Body.target);
		const Owner = (await Pool.query({ video: 'SELECT author_id AS id FROM videos WHERE id = $1', comment: 'SELECT author_id AS id FROM comments WHERE id = $1', user: 'SELECT id FROM users WHERE id = $1' }[Type], [Target])).rows[0]?.id;
		if (!Owner) throw new HttpError(404, 'ReportTargetNotFound');
		if (Owner === User.id) throw new HttpError(400, 'CannotReportYourself');
		if (Type === 'video') await AssertVideoVisible(Pool, Target, User.id);
		if (Type === 'comment') {
			const Video = (await Pool.query('SELECT video_id FROM comments WHERE id = $1', [Target])).rows[0];
			await AssertVideoVisible(Pool, Video.video_id, User.id);
		}
		await Pool.query(`INSERT INTO reports(reporter_id, target_type, target_id, owner_id, category, description) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING`, [User.id, Type, Target, Owner, Reason[1], String(Body.report_desc ?? '').trim().slice(0, 500)]);
		Json(Response, { status_code: 0, statusCode: 0, status_msg: '', data: {} }); return true;
	}
	if (Path === '/api/inbox/notice_count/') {
		RequireMethod(Request, ['GET']);
		const Unread = User ? await UnreadActivity(Pool, User.id) : {};
		const Count = Kinds => Kinds.reduce((Sum, Kind) => Sum + (Unread[Kind] ?? 0), 0);
		const System = User ? await UnreadModerationNotices(Pool, User.id) : 0;
		Json(Response, { status_code: 0, notice_count: [500, 3, 505, 2, 6, 7, 661].map(Group => ({ group: Group, count: Group === 661 ? System : Count(MentionsOn(NoticeKinds[Group] ?? [])) })) }); return true;
	}
	if (Path === '/api/notice/multi/' || Path === '/api/inbox/notice_list/') {
		RequireMethod(Request, ['GET']);
		let Entry;
		try { Entry = JSON.parse(Params.get('group_list') ?? '[]')[0]; } catch { throw new HttpError(400, 'InvalidGroupList'); }
		const Group = Number(Entry?.group);
		const Max = Number(Entry?.max_time) || 0, Min = Number(Entry?.min_time) || 0;
		const Window = Max > 0 ? { Before: Min || Max } : Min > 0 ? { After: Min } : {};
		const Limit = PageSize(Entry?.count, 20);
		if (Group === 661 || Group === 47) {
			const Rows = User ? await ModerationNotices(Pool, User.id, Window, Limit + 1) : [];
			if (User && Number(Entry?.is_mark_read) === 1) await MarkModerationNoticesRead(Pool, User.id);
			const Page = Rows.slice(0, Limit);
			const Epoch = Row => Row.at.getTime() / 1000;
			Json(Response, { status_code: 0, notice_lists: [{ group: Group, has_more: Rows.length > Limit ? 1 : 0, max_time: Page[0] ? Epoch(Page[0]) : 0, min_time: Page.at(-1) ? Epoch(Page.at(-1)) : 0,
				notice_list: Page.map(Row => ({ nid: Row.id, nid_str: Row.id, type: 47, create_time: Math.floor(Epoch(Row)), has_read: Row.read, user_id: User.id, template_notice: { notice: { title: { title: 'Account updates' }, content: Row.text } } })) }] }); return true;
		}
		if (User && Number(Entry?.is_mark_read) === 1) await MarkActivityRead(Pool, User.id);
		const Rows = User && NoticeKinds[Group] ? await Activity(Pool, User.id, MentionsOn(NoticeKinds[Group]), Window, Limit + 1) : [];
		const Page = Rows.slice(0, Limit);
		Json(Response, { status_code: 0, notice_lists: [{ group: Group, has_more: Rows.length > Limit ? 1 : 0, max_time: Page[0]?.epoch ?? 0, min_time: Page.at(-1)?.epoch ?? 0, notice_list: Page.map(Row => NoticeShape(Row, User.id, Config.Origin)) }] }); return true;
	}
	if (Path === '/api/upload/image/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		Limiter.Hit(`avatar:${User.id}`, 20, 3600000);
		const Restricted = await ActiveRestriction(Pool, User.id, 'profile');
		if (Restricted) { Json(Response, { status_code: 23, status_msg: RestrictionText(Restricted) }); return true; }
		const Form = await new globalThis.Response(await ReadRaw(Request, 5 * 1024 * 1024), { headers: { 'content-type': Request.headers['content-type'] ?? '' } }).formData().catch(() => null);
		const File = Form?.get('file');
		if (!(File instanceof Blob)) throw new HttpError(400, 'InvalidUpload');
		const Name = await SaveAvatar(Config, User.id, Buffer.from(await File.arrayBuffer()));
		Json(Response, { status_code: 0, data: { uri: Name, url_list: [`${Config.Origin}/media/${Name}`] } }); return true;
	}
	if (Path === '/api/update/profile/') {
		RequireMethod(Request, ['POST']);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		RequireCsrf(Request, User, Request.headers['x-csrf-token'] ?? Body.tt_csrf_token);
		const Restricted = await ActiveRestriction(Pool, User.id, 'profile');
		if (Restricted) { Json(Response, { status_code: 23, status_msg: RestrictionText(Restricted) }); return true; }
		const Nickname = Body.nickname === undefined ? null : String(Body.nickname).trim();
		const Bio = Body.signature === undefined ? null : String(Body.signature).trim();
		const Avatar = Body.avatar_uri === undefined ? null : String(Body.avatar_uri);
		if (Nickname !== null && (Nickname.length < 1 || Nickname.length > 50)) { Json(Response, { status_code: 2550, status_msg: 'InvalidNickname' }); return true; }
		if (Bio !== null && Bio.length > 160) throw new HttpError(400, 'BioTooLong');
		if (Avatar !== null && !(new RegExp(`^avatar-${User.id}-[0-9a-f-]{36}\\.jpg$`).test(Avatar) && await AvatarExists(Config, Avatar))) throw new HttpError(400, 'InvalidAvatar');
		const Updated = (await Pool.query(`UPDATE users u SET display_name = COALESCE($2, u.display_name), bio = COALESCE($3, u.bio), avatar_name = COALESCE($4, u.avatar_name)
			FROM (SELECT avatar_name FROM users WHERE id = $1) Previous WHERE u.id = $1
			RETURNING u.id, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, Previous.avatar_name AS previous_avatar`, [User.id, Nickname, Bio, Avatar])).rows[0];
		if (Updated.previous_avatar && Updated.previous_avatar !== Updated.avatar_name) await RemoveMedia(Config, Updated.previous_avatar);
		const Changed = [Nickname !== null && 'name', Bio !== null && 'bio', Avatar !== null && 'avatar'].filter(Boolean);
		if (Changed.length) await RecordEvent(Pool, User.id, 'profile_change', ClientInfo(Request, Config), `Changed ${Changed.join(', ')}`);
		const Url = { url_list: [AvatarUrl(Updated, Config.Origin)] };
		Json(Response, { status_code: 0, status_msg: '', user: { ...ApiUser(Updated, Config.Origin), avatar_larger: Url } }); return true;
	}
	if (Path === '/api/uniqueid/check/') {
		RequireMethod(Request, ['GET']);
		const Name = String(Params.get('unique_id') ?? '').toLowerCase();
		const Valid = /^[a-z0-9_]{3,24}$/.test(Name) && (Name === User?.username || !(await Pool.query('SELECT 1 FROM users WHERE username = $1', [Name])).rowCount);
		Json(Response, { status_code: 0, is_valid: Valid }); return true;
	}
	if (Path === '/api/user/collection_list/') {
		RequireMethod(Request, ['GET']);
		const Owner = Misc.collections ? await FindUser(Pool, Params.get('secUid') || User?.id, true).catch(() => null) : null;
		if (!Owner) { Json(Response, { statusCode: 0, status_code: 0, collectionList: [], cursor: '0', hasMore: false, total: '0' }); return true; }
		const Start = Offset(Params.get('cursor')), Limit = PageSize(Params.get('count'), 30);
		const Rows = (await Pool.query(`SELECT c.id, c.user_id, c.name, c.public, count(*) OVER ()::int AS all_count,
			(SELECT count(*)::int FROM collection_items i WHERE i.collection_id = c.id) AS total,
			(SELECT v.cover_name FROM collection_items i JOIN videos v ON v.id = i.video_id WHERE i.collection_id = c.id ORDER BY i.added_at DESC LIMIT 1) AS cover_name
			FROM collections c WHERE c.user_id = $1 AND (c.public OR c.user_id = $2::bigint) ORDER BY c.id DESC OFFSET $3 LIMIT $4`, [Owner.id, User?.id ?? null, Start, Limit])).rows;
		Json(Response, { statusCode: 0, status_code: 0, collectionList: Rows.map(Row => CollectionShape(Row, Owner, Config.Origin)), cursor: String(Start + Rows.length), hasMore: Start + Rows.length < (Rows[0]?.all_count ?? 0), total: String(Rows[0]?.all_count ?? 0) }); return true;
	}
	if (Path === '/api/collection/create/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		if (!Misc.collections) throw new HttpError(403, 'CollectionsDisabled');
		const Name = String(Body.collectionName ?? '').trim();
		if (!Name || Name.length > 30) throw new HttpError(400, 'InvalidCollectionName');
		const Created = (await Pool.query('INSERT INTO collections(user_id, name, public) VALUES ($1, $2, $3) RETURNING id', [User.id, Name, String(Body.collectionStatus) === '3'])).rows[0];
		Json(Response, { statusCode: 0, status_code: 0, collectionId: Created.id, collectionIdString: Created.id }); return true;
	}
	if (['/api/collection/modify_items/', '/api/collection/move_items/', '/api/collection/modify_info/', '/api/collection/delete/'].includes(Path.replace(/\/?$/, '/'))) {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		if (!Misc.collections) throw new HttpError(403, 'CollectionsDisabled');
		const Ids = Value => String(Value ?? '').split(',').filter(Boolean).slice(0, 200).map(Id);
		const Own = async Value => {
			const Found = (await Pool.query('SELECT id FROM collections WHERE id = $1 AND user_id = $2', [Id(Value), User.id])).rows[0];
			if (!Found) throw new HttpError(404, 'CollectionNotFound');
			return Found.id;
		};
		const Add = (Collection, Videos, Client = Pool) => Client.query('INSERT INTO collection_items(collection_id, user_id, video_id) SELECT $1, $2, f.video_id FROM favorites f WHERE f.user_id = $2 AND f.video_id = ANY($3::bigint[]) ON CONFLICT DO NOTHING', [Collection, User.id, Videos]);
		const Remove = (Collection, Videos, Client = Pool) => Client.query('DELETE FROM collection_items WHERE collection_id = $1 AND video_id = ANY($2::bigint[])', [Collection, Videos]);
		if (Path.startsWith('/api/collection/modify_items')) {
			const Collection = await Own(Body.collectionId);
			await Add(Collection, Ids(Body.commitIds)); await Remove(Collection, Ids(Body.deleteIds));
		} else if (Path.startsWith('/api/collection/move_items')) {
			const From = await Own(Body.fromCollectionID ?? Body.fromCollectionId), Target = await Own(Body.targetCollectionID ?? Body.targetCollectionId);
			const Videos = Ids(Body.itemIDs ?? Body.itemIds);
			if (From !== Target) await Transaction(Pool, async Client => { await Add(Target, Videos, Client); await Remove(From, Videos, Client); });
		} else if (Path.startsWith('/api/collection/modify_info')) {
			const Collection = await Own(Body.collectionId ?? Body.collectionID);
			const Name = Body.collectionName ?? Body.name;
			if (Name !== undefined && (!String(Name).trim() || String(Name).trim().length > 30)) throw new HttpError(400, 'InvalidCollectionName');
			const Status = Body.collectionStatus ?? Body.status;
			await Pool.query('UPDATE collections SET name = coalesce($2, name), public = coalesce($3, public) WHERE id = $1', [Collection, Name === undefined ? null : String(Name).trim(), Status === undefined ? null : String(Status) === '3']);
		} else await Pool.query('DELETE FROM collections WHERE id = $1', [await Own(Body.collectionId ?? Body.collectionID)]);
		Json(Response, { statusCode: 0, status_code: 0 }); return true;
	}
	if (Path === '/api/collection/detail/') {
		RequireMethod(Request, ['GET']);
		const Row = (await Pool.query(`SELECT c.id, c.user_id, c.name, c.public, (SELECT count(*)::int FROM collection_items i WHERE i.collection_id = c.id) AS total,
			(SELECT v.cover_name FROM collection_items i JOIN videos v ON v.id = i.video_id WHERE i.collection_id = c.id ORDER BY i.added_at DESC LIMIT 1) AS cover_name
			FROM collections c WHERE c.id = $1 AND (c.public OR c.user_id = $2::bigint)`, [Id(Params.get('collectionId')), User?.id ?? null])).rows[0];
		if (!Row || !Misc.collections) { Json(Response, { statusCode: 10201, status_code: 10201, statusMsg: 'CollectionNotFound' }); return true; }
		const Owner = await FindUser(Pool, Row.user_id, true);
		Json(Response, { statusCode: 0, status_code: 0, collectionInfo: { ...CollectionShape(Row, Owner, Config.Origin), cover: { urlList: Row.cover_name ? [`${Config.Origin}/media/${Row.cover_name}`] : [] } }, userInfo: { user: UserShape(Owner, Config.Origin) } }); return true;
	}
	async function SearchUsers(Limit) {
		if (Config.Features?.search === false) return [];
		const Query = `%${(Params.get('keyword') ?? '').slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
		const Result = await Pool.query(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, ${RelationSql('$3::bigint', 'u.id')} AS relation FROM users u
			WHERE (u.username ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\') AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = $3::bigint) ORDER BY u.username LIMIT $2`, [Query, Limit, User?.id ?? null]);
		return Promise.all(Result.rows.map(async Row => {
			const Stats = await UserStats(Pool, Row.id);
			return { user_info: { ...ApiUser(Row, Config.Origin), follower_count: Stats.followerCount, following_count: Stats.followingCount, aweme_count: Stats.videoCount, total_favorited: Stats.heartCount } };
		}));
	}
	async function SearchVideos() {
		const Cursor = Params.get('cursor');
		const Keyword = (Params.get('keyword') ?? '').trim();
		if (!Keyword || Config.Features?.search === false) return { items: [], hasMore: false, cursor: Cursor ?? '0' };
		return Videos(Pool, Config.Origin, { query: Keyword, viewer: User?.id, before: Cursor && Cursor !== '0' ? Cursor : undefined, limit: Params.get('count') ?? 12 });
	}
	if (Path === '/api/search/user/full/') {
		RequireMethod(Request, ['GET']);
		Json(Response, { status_code: 0, user_list: await SearchUsers(20), cursor: 0, has_more: 0 }); return true;
	}
	if (Path === '/api/search/item/full/') {
		RequireMethod(Request, ['GET']);
		const Found = await SearchVideos();
		Json(Response, { status_code: 0, item_list: Found.items, cursor: Found.cursor, has_more: Found.hasMore ? 1 : 0, extra: { logid: 'kittok' } }); return true;
	}
	if (Path === '/api/search/general/full/') {
		RequireMethod(Request, ['GET']);
		const First = !Params.get('cursor') || Params.get('cursor') === '0';
		const People = First && Params.get('keyword')?.trim() ? await SearchUsers(5) : [];
		const Found = await SearchVideos();
		const Data = [...(People.length ? [{ type: 4, user_list: People, view_more: People.length === 5, common: {} }] : []), ...Found.items.map(Item => ({ type: 1, item: Item, common: {} }))];
		Json(Response, { status_code: 0, data: Data, cursor: Found.cursor, has_more: Found.hasMore ? 1 : 0, extra: { logid: 'kittok' } }); return true;
	}
	if (Path === '/api/search/photo/full/' || Path === '/api/search/live/full/') {
		RequireMethod(Request, ['GET']);
		Json(Response, { status_code: 0, item_list: [], data: [], cursor: 0, has_more: 0, extra: { logid: 'kittok' } }); return true;
	}
	if (Path === '/api/comment/list/') {
		RequireMethod(Request, ['GET']);
		const VideoId = Id(Params.get('aweme_id') || Params.get('item_id'));
		const Page = await CommentPage(Pool, Config.Origin, User?.id, { video: VideoId, cursor: Params.get('cursor'), count: Params.get('count') });
		const Total = await Pool.query(`SELECT count(*)::int AS count FROM comments c WHERE c.video_id = $1 AND NOT ${RemovedSql('comment', 'c.id')}`, [VideoId]);
		Json(Response, { ...Page, total: Total.rows[0].count }); return true;
	}
	if (Path === '/api/comment/list/reply/') {
		RequireMethod(Request, ['GET']);
		Json(Response, await CommentPage(Pool, Config.Origin, User?.id, { parent: Id(Params.get('comment_id')), cursor: Params.get('cursor'), count: Params.get('count') ?? 3 })); return true;
	}
	if (Path === '/api/comment/delete/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Deleted = await Pool.query('DELETE FROM comments c USING videos v WHERE c.id = $1 AND v.id = c.video_id AND (c.author_id = $2 OR v.author_id = $2 OR $3) RETURNING c.id', [Id(Body.cid), User.id, User.role === 'admin']);
		if (!Deleted.rowCount) throw new HttpError(404, 'CommentNotFound');
		Json(Response, { status_code: 0, statusCode: 0 }); return true;
	}
	if (Path === '/api/comment/digg/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		await SetRelation(Pool, 'comment_likes', ['user_id', 'comment_id'], [User.id, Id(Body.cid)], String(Body.digg_type ?? '1') === '1');
		Json(Response, { status_code: 0, statusCode: 0 }); return true;
	}
	if (Path === '/api/comment/publish/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		if (Config.Features?.comments === false) throw new HttpError(403, 'CommentsDisabled');
		Limiter.Hit(`comment:${User.id}`, 30);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const VideoId = Id(Body.aweme_id);
		const Restricted = await ActiveRestriction(Pool, User.id, 'comment');
		if (Restricted) { Json(Response, { status_code: 22, statusCode: 22, status_msg: RestrictionText(Restricted) }); return true; }
		const Added = await AddComment(Pool, VideoId, User.id, Body.text, Body.reply_id && Body.reply_id !== '0' ? Id(Body.reply_id) : null);
		const VideoAuthor = (await Pool.query('SELECT author_id FROM videos WHERE id = $1', [VideoId])).rows[0]?.author_id;
		Json(Response, { status_code: 0, status_msg: '', comment: CommentShape({ ...User, ...Added, video_id: VideoId, author_id: User.id, video_author: VideoAuthor, relation: 0 }, Config.Origin, await MentionedUsers(Pool, [Added.body])) }); return true;
	}
	if (Path === '/api/commit/item/digg/' || Path === '/api/item/collect/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Collect = Path === '/api/item/collect/';
		const Target = Id(Body.itemId || Body.item_id || Body.aweme_id);
		const Enabled = String(Body.type ?? Body.action ?? '1') === '1';
		await SetRelation(Pool, Collect ? 'favorites' : 'likes', ['user_id', 'video_id'], [User.id, Target], Enabled);
		if (!Collect) { Json(Response, { status_code: 0, statusCode: 0, is_digg: Enabled ? 0 : 1 }); return true; }
		const Count = await Pool.query('SELECT count(*)::int AS count FROM favorites WHERE video_id = $1', [Target]);
		Json(Response, { status_code: 0, statusCode: 0, collected: Enabled, collectCount: Count.rows[0].count }); return true;
	}
	if (Path === '/api/v1/follow-requests') {
		RequireMethod(Request, ['GET']); if (!User) throw new HttpError(401, 'NotLoggedIn');
		Json(Response, { requests: await FollowRequests(Pool, User.id) }); return true;
	}
	if (Path === '/api/user/following/request/list/') {
		RequireMethod(Request, ['GET']); if (!User) throw new HttpError(401, 'NotLoggedIn');
		const Before = Number(Params.get('max_time')) || null, Limit = PageSize(Params.get('count'), 20);
		const Rows = (await Pool.query(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, ${RelationSql('$1::bigint', 'u.id')} AS relation,
			extract(epoch FROM r.created_at)::float8 AS epoch, count(*) OVER ()::int AS total
			FROM follow_requests r JOIN users u ON u.id = r.follower_id
			WHERE r.following_id = $1 AND u.suspended_at IS NULL AND NOT ${BlockedBetween('$1', 'u.id')} AND ($2::float8 IS NULL OR r.created_at < to_timestamp($2))
			ORDER BY r.created_at DESC LIMIT $3`, [User.id, Before, Limit + 1])).rows;
		const Page = Rows.slice(0, Limit);
		const Total = Before ? (await FollowRequests(Pool, User.id)).length : Rows[0]?.total ?? 0;
		Json(Response, { status_code: 0, request_users: Page.map(Row => ApiUser(Row, Config.Origin)), has_more: Rows.length > Limit, min_time: Page.at(-1) ? Math.floor(Page.at(-1).epoch) : 0, total: Total }); return true;
	}
	if (['/api/commit/follow/request/approve/', '/api/commit/follow/request/reject/'].includes(Path)) {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		await DecideFollowRequest(Pool, User.id, Id(Body.from_user_id || Body.user_id || Body.sec_user_id), Path.includes('/approve/'));
		Json(Response, { status_code: 0, statusCode: 0 }); return true;
	}
	if (Path === '/api/commit/follow/user/' || Path === '/api/follow/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Target = Id(Body.user_id || Body.sec_user_id);
		const Following = String(Body.type ?? Body.action_type ?? '1') === '1';
		if (Following) {
			if ((await Pool.query('SELECT 1 FROM users WHERE id = $1 AND suspended_at IS NOT NULL', [Target])).rowCount) { Json(Response, { status_code: 24, statusCode: 24, follow_status: 0 }); return true; }
			const Restricted = await ActiveRestriction(Pool, User.id, 'follow');
			if (Restricted) { Json(Response, { status_code: 2096, statusCode: 2096, status_msg: RestrictionText(Restricted), follow_status: FollowStatus(await Relation(Pool, User.id, Target)) }); return true; }
		}
		await SetRelation(Pool, 'follows', ['follower_id', 'following_id'], [User.id, Target], Following);
		Json(Response, { status_code: 0, statusCode: 0, follow_status: FollowStatus(await Relation(Pool, User.id, Target)) }); return true;
	}
	if (Path === '/api/user/block/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Blocking = String(Body.block_type ?? '1') === '1';
		await SetBlock(Pool, User.id, Id(Body.sec_user_id || Body.user_id), Blocking);
		Json(Response, { status_code: 0, statusCode: 0, block_status: Blocking ? 1 : 0 }); return true;
	}
	if (Path === '/api/block/user_list/') {
		RequireMethod(Request, ['GET']);
		if (!User) throw new HttpError(401, 'NotLoggedIn');
		const Start = Offset(Params.get('offset'));
		const List = await BlockList(Pool, User.id, Start, PageSize(Params.get('count'), 20));
		const UserList = await Promise.all(List.users.map(async Row => ({ user: UserShape(Row, Config.Origin), stats: await UserStats(Pool, Row.id) })));
		Json(Response, { status_code: 0, statusCode: 0, userList: UserList, total: List.total, offset: String(Start + UserList.length), hasMore: Start + UserList.length < List.total }); return true;
	}
	return false;
}
