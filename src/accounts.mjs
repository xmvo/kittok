import { extname, join } from 'node:path';
import { RemoveMedia } from './media.mjs';
import { MessageText, RemovedSql } from './moderation.mjs';

export async function DeleteAccount(Pool, Config, UserId) {
	const Account = (await Pool.query('SELECT avatar_name FROM users WHERE id = $1', [UserId])).rows[0];
	if (!Account) return false;
	await Pool.query('DELETE FROM invites WHERE created_by = $1', [UserId]);
	const Videos = (await Pool.query('DELETE FROM videos WHERE author_id = $1 RETURNING file_name, cover_name, download_name', [UserId])).rows;
	Videos.push(...(await Pool.query('DELETE FROM message_media WHERE owner_id = $1 RETURNING file_name, cover_name', [UserId])).rows);
	await Pool.query('DELETE FROM users WHERE id = $1', [UserId]);
	for (const Row of Videos) await Promise.all([RemoveMedia(Config, Row.file_name), Row.cover_name && RemoveMedia(Config, Row.cover_name), Row.download_name && RemoveMedia(Config, Row.download_name)]);
	if (Account.avatar_name) await RemoveMedia(Config, Account.avatar_name);
	return true;
}

export async function DeleteExpiredAccounts(Pool, Config) {
	const Due = (await Pool.query('SELECT id FROM users WHERE delete_after < now() AND deactivated_at IS NOT NULL')).rows;
	for (const Row of Due) await DeleteAccount(Pool, Config, Row.id);
	return Due.length;
}

export const DataSections = { profile: 'Profile', video: 'Posts', activity: 'Activity', comment: 'Comments', messages: 'Direct messages', settings: 'App settings' };
const Stamp = Value => Value.toISOString().replace('T', ' ').slice(0, 19);
const Audience = { 1: 'Receive in inbox', 2: 'Receive as message request', 3: "Don't receive" };

function Text(Value) {
	if (Array.isArray(Value)) return Value.map(Text).join(Value.some(Item => Item && typeof Item === 'object') ? '\n' : '');
	if (Value && typeof Value === 'object') return Object.entries(Value).map(([Key, Inner]) => Inner && typeof Inner === 'object' ? `${Key}\n${Text(Inner)}` : `${Key}: ${Inner}`).join('\n') + '\n';
	return `${Value}\n`;
}

export async function ExportFiles(Pool, Config, Export) {
	const Query = async (Sql, Values = [Export.user_id]) => (await Pool.query(Sql, Values)).rows;
	const Link = Row => `${Config.Origin}/@${Row.username}/video/${Row.video_id}`;
	const Dated = Row => ({ Date: Stamp(Row.created_at), Link: Link(Row) });
	const Person = Row => ({ Date: Stamp(Row.created_at), UserName: Row.username });
	const Data = {}, Media = [];
	if (Export.sections.includes('profile')) {
		const [Account] = await Query(`SELECT u.username, u.display_name, u.bio, u.email, u.avatar_name, u.avatar_decoration, u.pride_flag, u.verified, u.created_at,
			(SELECT count(*) FROM follows WHERE following_id = u.id)::int AS followers, (SELECT count(*) FROM follows WHERE follower_id = u.id)::int AS following,
			(SELECT count(*) FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.author_id = u.id)::int AS likes FROM users u WHERE u.id = $1`);
		const Photo = Account.avatar_name ? `Profile/Profile Photo${extname(Account.avatar_name)}` : '';
		if (Photo) Media.push({ Name: Photo, Path: join(Config.MediaDir, Account.avatar_name) });
		Data.Profile = { 'Profile Information': { ProfileMap: { userName: Account.username, displayName: Account.display_name, bioDescription: Account.bio, emailAddress: Account.email ?? '', profilePhoto: Photo,
			followerCount: Account.followers, followingCount: Account.following, likesReceived: Account.likes, verified: Account.verified, prideFlag: Account.pride_flag, avatarDecoration: Account.avatar_decoration, accountCreated: Stamp(Account.created_at) } } };
	}
	if (Export.sections.includes('video')) {
		const Videos = await Query(`SELECT v.id::text AS video_id, u.username, v.description, v.file_name, v.visibility, v.view_count, v.created_at,
			(SELECT count(*) FROM likes WHERE video_id = v.id)::int AS likes, (SELECT count(*) FROM comments WHERE video_id = v.id)::int AS comments
			FROM videos v JOIN users u ON u.id = v.author_id WHERE v.author_id = $1 ORDER BY v.id DESC`);
		const File = Row => `Video/Videos/${Row.video_id}${extname(Row.file_name)}`;
		for (const Row of Videos) Media.push({ Name: File(Row), Path: join(Config.MediaDir, Row.file_name) });
		Data.Video = { Videos: { VideoList: Videos.map(Row => ({ ...Dated(Row), Title: Row.description, Likes: Row.likes, Views: Number(Row.view_count), Comments: Row.comments,
			WhoCanView: { public: 'Everyone', followers: 'Followers', friends: 'Friends', only_me: 'Only you' }[Row.visibility], File: File(Row) })) } };
	}
	if (Export.sections.includes('activity')) {
		const Saved = Table => Query(`SELECT t.created_at, v.id::text AS video_id, a.username FROM ${Table} t JOIN videos v ON v.id = t.video_id JOIN users a ON a.id = v.author_id WHERE t.user_id = $1 ORDER BY t.created_at DESC`);
		const People = (Mine, Theirs) => Query(`SELECT f.created_at, u.username FROM follows f JOIN users u ON u.id = f.${Theirs} WHERE f.${Mine} = $1 ORDER BY f.created_at DESC`);
		const [Likes, Favorites, Reposts, Following, Followers, Collections, Logins] = await Promise.all([Saved('likes'), Saved('favorites'), Saved('reposts'), People('follower_id', 'following_id'), People('following_id', 'follower_id'),
			Query(`SELECT c.name, c.public, c.created_at, coalesce((SELECT json_agg(json_build_object('video_id', v.id::text, 'username', a.username) ORDER BY i.added_at DESC)
				FROM collection_items i JOIN videos v ON v.id = i.video_id JOIN users a ON a.id = v.author_id WHERE i.collection_id = c.id), '[]') AS videos FROM collections c WHERE c.user_id = $1 ORDER BY c.id DESC`),
			Query("SELECT created_at, country, user_agent FROM user_events WHERE user_id = $1 AND kind = 'login' ORDER BY id DESC")]);
		Data.Activity = {
			'Like List': { ItemFavoriteList: Likes.map(Dated) },
			'Favorite Videos': { FavoriteVideoList: Favorites.map(Dated) },
			'Favorite Collections': { CollectionList: Collections.map(Row => ({ Date: Stamp(Row.created_at), Name: Row.name, Visibility: Row.public ? 'Public' : 'Private', Videos: Row.videos.map(Link) })) },
			'Repost List': { RepostList: Reposts.map(Dated) },
			'Following List': { Following: Following.map(Person) },
			'Follower List': { FansList: Followers.map(Person) },
			'Login History': { LoginHistoryList: Logins.map(Row => ({ Date: Stamp(Row.created_at), IP: '', Country: Row.country ?? '', Device: Row.user_agent ?? '' })) },
		};
	}
	if (Export.sections.includes('comment')) {
		const Comments = await Query('SELECT c.created_at, c.body, v.id::text AS video_id, a.username FROM comments c JOIN videos v ON v.id = c.video_id JOIN users a ON a.id = v.author_id WHERE c.author_id = $1 ORDER BY c.id DESC');
		Data.Comment = { Comments: { CommentsList: Comments.map(Row => ({ Date: Stamp(Row.created_at), Comment: Row.body, Url: Link(Row) })) } };
	}
	if (Export.sections.includes('messages')) {
		const [Chats, Messages] = await Promise.all([
			Query("SELECT me.conversation_id, coalesce(string_agg(u.username, ', ' ORDER BY u.username), '') AS names FROM conversation_members me LEFT JOIN conversation_members o ON o.conversation_id = me.conversation_id AND o.user_id <> me.user_id LEFT JOIN users u ON u.id = o.user_id WHERE me.user_id = $1 GROUP BY me.conversation_id"),
			Query(`SELECT m.conversation_id, m.created_at, m.content, m.message_type, s.username FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1 JOIN users s ON s.id = m.sender_id
				WHERE m.index_in_conversation > me.min_index AND m.recalled_at IS NULL AND m.message_type <> 1031 AND NOT $1 = ANY(m.hidden_for) AND NOT ${RemovedSql('message', 'm.id')} ORDER BY m.conversation_id, m.index_in_conversation`)]);
		const Names = new Map(Chats.map(Row => [Row.conversation_id, Row.names]));
		const History = {};
		for (const Row of Messages) (History[`Chat History with ${Names.get(Row.conversation_id) || 'yourself'}:`] ??= []).push({ Date: Stamp(Row.created_at), From: Row.username, Content: MessageText(Row.content) || ({ 1802: '[Photo]', 1803: '[Video]' })[Row.message_type] || Row.content });
		Data['Direct Messages'] = { 'Chat History': { ChatHistory: History } };
	}
	if (Export.sections.includes('settings')) {
		const [[Account], Blocked] = await Promise.all([Query('SELECT private_account, comment_permission, dm_friends, dm_potential, dm_others, dm_read_status FROM users WHERE id = $1'),
			Query('SELECT b.created_at, u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC')]);
		Data['App Settings'] = {
			Settings: { SettingsMap: { 'Private Account': Account.private_account ? 'Enabled' : 'Disabled', 'Who Can Comment': { everyone: 'Everyone', followers: 'Followers', friends: 'Friends', none: 'No one' }[Account.comment_permission],
				'Direct Messages From Friends': Audience[Account.dm_friends], 'Direct Messages From Potential Connections': Audience[Account.dm_potential], 'Direct Messages From Others': Audience[Account.dm_others], 'Read Status': Account.dm_read_status ? 'On' : 'Off' } },
			'Block List': { BlockList: Blocked.map(Person) },
		};
	}
	const Files = Export.format === 'json' ? [{ Name: 'user_data.json', Data: JSON.stringify(Data, null, '\t') }]
		: Object.entries(Data).flatMap(([Folder, Lists]) => Object.entries(Lists).map(([List, Value]) => ({ Name: `${Folder}/${List}.txt`, Data: Text(Object.values(Value)[0]) }))).filter(File => File.Data.trim());
	return [...Files, ...Media];
}
