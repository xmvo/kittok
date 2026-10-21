import { HttpError, ReadRaw } from '../http.mjs';
import { Transaction } from '../db.mjs';
import { Misc } from '../settings.mjs';
import { BlockedBetween } from '../store.mjs';
import { Codec } from '../im/protobuf.mjs';
import { Schema } from '../im/schema.mjs';
import { Push } from '../im/frontier.mjs';
import { ActiveRestriction, RemovedSql, RestrictionText } from '../moderation.mjs';

export const Proto = Codec(Schema);

const Cmd = { SendMessage: 100, MessagesByUser: 200, MessagesByUserInitV2: 203, MessagesByUserCombo: 204, MessagesInConversation: 301, MessagesInRange: 304, MarkConversationReadV3: 2002, NewMessageNotify: 500, MarkReadNotify: 501,
	MarkConversationDelete: 603, MarkConversationRead: 604, ParticipantsList: 605, ConversationInfoV2: 608, CreateConversationV2: 609, ConversationInfoListV2: 610,
	MgetParticipants: 654, InputStatus: 411, InputStatusNotify: 510, ReadIndexV3: 2000, MinIndexV3: 2001, UserConversationList: 2006, UnreadCount: 2030, BatchReadIndex: 2038,
	DeleteMessage: 701, RecallMessage: 702, ModifyMessageProperty: 705, StrangerConversations: 1001, StrangerMessages: 1002, DeleteStrangerMessage: 1003, DeleteStrangerConversation: 1004, DeleteAllStrangerConversations: 1005,
	MarkStrangerConversationRead: 1006, MarkAllStrangerConversationsRead: 1007, StrangerUnreadCount: 1008 };
const Status = { Ok: 0, InvalidRequest: 4, InvalidCommand: 5, UserForbidden: 11, ResourceExhausted: 429, ConversationNotExist: 1001 };
const SendStatus = { Succeeded: 0, NotInConversation: 1, NotAllowed: 2, CheckFailed: 3, Blocked: 5 };
const BodyField = Object.fromEntries(Object.entries(Schema.ResponseBody).map(([Field, [Id]]) => [Id, Field]));
const RequestField = Object.fromEntries(Object.entries(Schema.RequestBody).map(([Field, [Id]]) => [Id, Field]));
const FieldOf = Command => Command > 1000 && Command <= 1008 ? Command - 1 : Command;
const ConversationKey = (A, B) => `0:1:${[A, B].sort((X, Y) => (BigInt(X) < BigInt(Y) ? -1 : 1)).join(':')}`;

class ImError extends Error {
	constructor(Code, Message) { super(Message); this.Code = Code; }
}

function PropertyList(Properties) {
	return Object.fromEntries(Object.entries(Properties ?? {}).map(([Key, Items]) => [Key, { Items: Items.map(Item => ({ uid: Item.uid, sec_uid: Item.uid, idempotent_id: Item.idempotent_id, value: Item.value,
		create_time: String(Math.floor(Item.at / 1000)), create_time_micro: String(Item.at * 1000) })) }]));
}

function ReferenceInfo(Row) {
	const Reference = Row.reference;
	if (!Reference) return undefined;
	return { referenced_message_id: Reference.id, hint: Reference.hint ?? '', ref_message_type: String(Reference.type ?? 7), referenced_message_status: Row.reference_status ?? 0,
		root_message_id: Reference.root ?? Reference.id, root_message_conv_index: Reference.root_index ?? '0', sender: Reference.sender };
}

function MessageShape(Row, RequestViewer) {
	return {
		reference_info: ReferenceInfo(Row),
		property_list: PropertyList(Row.properties),
		conversation_id: Row.conversation_key, conversation_type: Row.conversation_type, conversation_short_id: Row.conversation_id, server_message_id: Row.id,
		index_in_conversation: Row.index_in_conversation, index_in_conversation_v2: Row.index_in_conversation, index_in_conversation_v1: Row.index_in_conversation,
		order_in_conversation: Row.index_in_conversation, message_type: Row.message_type, sender: Row.sender_id, sec_sender: Row.sender_id, content: Row.recalled_at ? '{"aweType":0,"text":""}' : Row.content,
		ext: { ...Row.ext, ...(Row.recalled_at ? { 's:is_recalled': 'true' } : {}), 's:client_message_id': Row.client_message_id, ...(RequestViewer ? { stranger: RequestViewer } : {}) }, create_time: String(new Date(Row.created_at).getTime()), version: String(Row.property_version ?? 0), status: 0,
	};
}

const MessageColumns = `m.*, c.conversation_key, c.conversation_type, (SELECT CASE WHEN quoted.recalled_at IS NOT NULL THEN 3 WHEN ${RemovedSql('message', 'quoted.id')} THEN 2 ELSE 0 END
	FROM messages quoted WHERE quoted.id = (m.reference->>'id')::bigint) AS reference_status`;
const Visible = `NOT ${RemovedSql('message', 'm.id')} AND NOT me.user_id = ANY(m.hidden_for)`;
const RequestVisible = `EXISTS (SELECT 1 FROM messages visible_message WHERE visible_message.conversation_id=me.conversation_id AND visible_message.index_in_conversation>me.min_index AND NOT me.user_id = ANY(visible_message.hidden_for) AND NOT ${RemovedSql('message', 'visible_message.id')})
	AND NOT EXISTS (SELECT 1 FROM conversation_members other JOIN users request_author ON request_author.id=other.user_id WHERE other.conversation_id=me.conversation_id AND other.user_id<>me.user_id AND (request_author.suspended_at IS NOT NULL OR ${BlockedBetween('other.user_id', 'me.user_id')}))`;

async function Disclosures(Pool, Viewer, Room) {
	const Result = await Pool.query(`SELECT me.user_id, peer.user_id AS other, me.request OR peer.request AS pending,
		$3::boolean AND me_user.dm_read_status AND peer_user.dm_read_status AS read_status,
		${BlockedBetween('me.user_id', 'peer.user_id')} OR peer_user.suspended_at IS NOT NULL AS blocked
		FROM conversation_members me JOIN users me_user ON me_user.id=me.user_id
		JOIN conversation_members peer ON peer.conversation_id=me.conversation_id AND peer.user_id<>me.user_id JOIN users peer_user ON peer_user.id=peer.user_id
		WHERE me.conversation_id=$1 AND me.user_id=$2`, [Room.id, Viewer, Misc.readReceipts]);
	return Result.rows;
}

async function ReadIndexes(Pool, Viewer, Rooms) {
	const Result = await Pool.query(`SELECT member.conversation_id::text, member.user_id::text,
		CASE WHEN member.user_id=$2 OR ($3::boolean AND viewer.dm_read_status AND subject.dm_read_status AND NOT me.request AND NOT member.request AND NOT ${BlockedBetween('me.user_id', 'member.user_id')} AND subject.suspended_at IS NULL)
		THEN member.read_index ELSE 0 END AS read_index,
		CASE WHEN member.user_id=$2 THEN member.min_index ELSE 0 END AS min_index
		FROM conversation_members member JOIN users subject ON subject.id=member.user_id
		JOIN conversation_members me ON me.conversation_id=member.conversation_id AND me.user_id=$2 JOIN users viewer ON viewer.id=me.user_id
		WHERE member.conversation_id=ANY($1::bigint[])`, [Rooms, Viewer, Misc.readReceipts]);
	return Result.rows;
}

async function Conversations(Pool, Viewer, Where, Values, Requests = false) {
	const Result = await Pool.query(`SELECT c.*, me.read_index, me.min_index, me.muted, me.request,
		(SELECT coalesce(max(m.index_in_conversation), 0) FROM messages m WHERE m.conversation_id = c.id) AS last_index,
		(SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.index_in_conversation > greatest(me.read_index, me.min_index) AND m.sender_id <> $1 AND m.recalled_at IS NULL AND ${Visible}) AS unread,
		(SELECT json_agg(json_build_object('user_id', p.user_id::text, 'joined_at', p.joined_at, 'request', p.request) ORDER BY p.joined_at) FROM conversation_members p WHERE p.conversation_id = c.id) AS members
		FROM conversations c JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1
		WHERE ${Requests === null ? '' : `me.request = ${Requests} AND `}EXISTS (SELECT 1 FROM conversation_members peer WHERE peer.conversation_id = c.id AND peer.user_id <> $1) AND ${Where} ORDER BY (SELECT max(m.id) FROM messages m WHERE m.conversation_id = c.id) DESC NULLS LAST, c.id DESC`, [Viewer, ...Values]);
	return Result.rows;
}

function ConversationShape(Row, Viewer) {
	const Base = { conversation_id: Row.conversation_key, conversation_short_id: Row.id, conversation_type: Row.conversation_type, inbox_type: Row.request ? 3 : 0 };
	const Participants = Row.members.map((Member, Index) => ({ user_id: Member.user_id, sec_uid: Member.user_id, sort_order: String(Index), role: Member.user_id === String(Row.creator_id) ? 1 : 0 }));
	return {
		...Base, ticket: 'kittok', participants_count: Participants.length, is_participant: true, badge_count: Row.unread, badge_count_v2: Row.unread,
		first_page_participants: { participants: Participants, has_more: false, cursor: '0' },
		user_info: Participants.find(Participant => Participant.user_id === Viewer),
		conversation_core_info: { ...Base, info_version: '1', owner: Row.creator_id ?? '0', creator_uid: Row.creator_id ?? '0', ext: Row.request ? { stranger: Viewer } : {}, first_message_timestamp: String(new Date(Row.created_at).getTime()) },
		conversation_setting_info: { ...Base, min_index: Row.min_index, min_index_v2: Row.min_index, read_index: Row.read_index, read_index_v2: Row.read_index, mute: Row.muted ? 1 : 0, stick_on_top: 0, setting_version: '1', favorite: 0 },
	};
}

async function Conversation(Pool, Viewer, Body) {
	const [Row] = Body.conversation_short_id && Body.conversation_short_id !== '0'
		? await Conversations(Pool, Viewer, 'c.id = $2', [Body.conversation_short_id], null)
		: await Conversations(Pool, Viewer, 'c.conversation_key = $2', [String(Body.conversation_id ?? '')], null);
	if (!Row) throw new ImError(Status.ConversationNotExist, 'ConversationNotExist');
	return Row;
}

async function UserCursor(Pool, Viewer, Before = null, RequestInbox = false) {
	const Result = await Pool.query(`SELECT coalesce(max(m.id), 0)::text AS cursor FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1
		WHERE m.index_in_conversation > me.min_index AND me.request = $3 AND (NOT $3 OR (${RequestVisible})) AND ($2::bigint IS NULL OR m.id < $2)`, [Viewer, Before, RequestInbox]);
	return Result.rows[0].cursor;
}

async function UserMessages(Pool, Viewer, After, Limit, RequestInbox = false) {
	const Result = await Pool.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
		JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1
		WHERE m.id > $2 AND m.index_in_conversation > me.min_index AND me.request = $4 AND (NOT $4 OR (${RequestVisible})) AND ${Visible} ORDER BY m.id LIMIT $3`, [Viewer, After, Limit + 1, RequestInbox]);
	return { Rows: Result.rows.slice(0, Limit), HasMore: Result.rows.length > Limit };
}

function Envelope(Cmd_, Body, InboxType = 0) {
	return { cmd: Cmd_, sequence_id: '0', status_code: Status.Ok, error_desc: '', inbox_type: InboxType, log_id: 'kittok', body: Body ? { [BodyField[FieldOf(Cmd_)]]: Body } : {} };
}

function PushTo(UserIds, Response) {
	const Bytes = Proto.Encode('Frame', { seqid: '0', logid: String(Date.now()), service: 5, method: 1, payload_type: 'pb', payload: Proto.Encode('Response', Response) });
	for (const UserId of UserIds) Push(UserId, Bytes);
}

async function Audience(Pool, Sender, Recipient) {
	const Result = await Pool.query(`SELECT CASE
		WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AND EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) THEN dm_friends
		WHEN EXISTS (SELECT 1 FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)) THEN dm_potential
		ELSE dm_others END AS audience FROM users WHERE id = $2`, [Sender, Recipient]);
	const Delivery = Result.rows[0]?.audience ?? 3;
	return Delivery === 2 && !Misc.messageRequests ? 1 : Delivery;
}

async function CreateDirect(Pool, Viewer, Participants) {
	const Others = [...new Set(Participants.map(String))].filter(Id => Id !== Viewer);
	if (Others.length !== 1) throw new ImError(Status.InvalidRequest, 'OneToOneOnly');
	const Other = Others[0];
	if (!(await Pool.query('SELECT 1 FROM users WHERE id = $1 AND suspended_at IS NULL', [Other])).rowCount) throw new ImError(Status.InvalidRequest, 'UserNotFound');
	if ((await Pool.query(`SELECT ${BlockedBetween('$1::bigint', '$2::bigint')} AS blocked`, [Viewer, Other])).rows[0].blocked) throw new ImError(Status.UserForbidden, 'BlockedRelationship');
	const Delivery = await Audience(Pool, Viewer, Other);
	if (Delivery === 3) throw new ImError(Status.UserForbidden, 'MessagesNotAllowed');
	const Key = ConversationKey(Viewer, Other);
	await Transaction(Pool, async Client => {
		const Created = await Client.query('INSERT INTO conversations(conversation_key, conversation_type, creator_id) VALUES ($1, 1, $2) ON CONFLICT (conversation_key) DO NOTHING RETURNING id', [Key, Viewer]);
		const Id = Created.rows[0]?.id ?? (await Client.query('SELECT id FROM conversations WHERE conversation_key = $1', [Key])).rows[0].id;
		await Client.query('INSERT INTO conversation_members(conversation_id, user_id, request) VALUES ($1, $2, false), ($1, $3, $4) ON CONFLICT DO NOTHING', [Id, Viewer, Other, Delivery === 2]);
		await Client.query('UPDATE conversation_members SET request = false WHERE conversation_id = $1 AND user_id = $2', [Id, Viewer]);
	});
	return (await Conversations(Pool, Viewer, 'c.conversation_key = $2', [Key], null))[0];
}

async function SendMessage(Context, Body) {
	const { Pool, User, Limiter } = Context;
	const Room = await Conversation(Pool, User.id, Body);
	const Others = Room.members.map(Member => Member.user_id).filter(Id => Id !== User.id);
	const Fail = Code => ({ status: Code, client_message_id: Body.client_message_id ?? '', server_message_id: '0', check_code: '0', check_message: '' });
	if (Room.conversation_type === 1 && (await Pool.query(`SELECT ${BlockedBetween('$1::bigint', '$2::bigint')} AS blocked`, [User.id, Others[0]])).rows[0].blocked) return Fail(SendStatus.Blocked);
	if (Room.conversation_type === 1 && await Audience(Pool, User.id, Others[0]) === 3) return Fail(SendStatus.NotAllowed);
	const Restricted = await ActiveRestriction(Pool, User.id, 'message');
	if (Restricted) return { ...Fail(SendStatus.CheckFailed), check_code: '7195', check_message: JSON.stringify({ status_code: 7195, status_msg: { msg_content: { tips: `${RestrictionText(Restricted)} {{1}}`, template: [{ name: 'Feedback', key: '1' }] } } }) };
	const Content = String(Body.content ?? '');
	const ClientId = String(Body.client_message_id ?? '');
	const Type = Number(Body.message_type ?? 0);
	if (!ClientId || ClientId.length > 64 || !Content || Content.length > 20000 || Type <= 0 || Type >= 50000) throw new ImError(Status.InvalidRequest, 'InvalidMessage');
	const Ext = Object.fromEntries(Object.entries(Body.ext ?? {}).filter(([Key]) => Key !== 'stranger' && !Key.startsWith('s:')).slice(0, 30).map(([Key, Value]) => [Key.slice(0, 100), String(Value).slice(0, 2000)]));
	Limiter.Hit(`dm:${User.id}`, 60);
	const Quoted = /^\d{1,19}$/.test(String(Body.ref_msg_info?.referenced_message_id ?? '')) ? (await Pool.query(`SELECT m.id, m.message_type, m.sender_id, m.index_in_conversation, m.reference FROM messages m
		JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $3 WHERE m.id = $1 AND m.conversation_id = $2 AND m.index_in_conversation > me.min_index AND ${Visible}`, [Body.ref_msg_info.referenced_message_id, Room.id, User.id])).rows[0] : undefined;
	const Reference = Quoted ? { id: Quoted.id, type: Quoted.message_type, sender: Quoted.sender_id, hint: String(Body.ref_msg_info.hint ?? '').slice(0, 500),
		root: Quoted.reference?.root ?? Quoted.id, root_index: Quoted.reference?.root_index ?? Quoted.index_in_conversation } : null;
	const Row = await Transaction(Pool, async Client => {
		await Client.query('SELECT pg_advisory_xact_lock(741950193)');
		const Existing = await Client.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.sender_id = $1 AND m.client_message_id = $2`, [User.id, ClientId]);
		if (Existing.rowCount) return { ...Existing.rows[0], Repeated: true };
		const Recipient = (await Client.query('SELECT request, min_index FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 FOR UPDATE', [Room.id, Others[0]])).rows[0];
		if (Recipient?.request) {
			const Count = (await Client.query('SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1 AND sender_id=$2', [Room.id, User.id])).rows[0].count;
			if (BigInt(Recipient.min_index) > 0n || Count >= 3) return { Limited: true };
		}
		const Inserted = await Client.query(`INSERT INTO messages(conversation_id, sender_id, client_message_id, message_type, content, ext, index_in_conversation, reference)
			SELECT $1, $2, $3, $4, $5, $6, coalesce(max(index_in_conversation), 0) + 1, $7 FROM messages WHERE conversation_id = $1 RETURNING *`, [Room.id, User.id, ClientId, Type, Content, Ext, Reference]);
		await Client.query('UPDATE conversation_members SET request = false WHERE conversation_id = $1 AND user_id = $2', [Room.id, User.id]);
		return { ...Inserted.rows[0], conversation_key: Room.conversation_key, conversation_type: Room.conversation_type };
	});
	if (Row.Limited) return { ...Fail(SendStatus.CheckFailed), check_code: '7195', check_message: JSON.stringify({ status_code: 7195, status_msg: { msg_content: { tips: 'You can send up to 3 messages until this person accepts your message request.', template: [] } } }) };
	if (!Row.Repeated) {
		for (const Member of Room.members) {
			const RequestInbox = Member.request && Member.user_id !== User.id;
			const Message = MessageShape(Row, RequestInbox ? Member.user_id : undefined);
			const Previous = await UserCursor(Pool, Member.user_id, Row.id, RequestInbox);
			const Unread = (await Pool.query(`SELECT count(*)::int AS count FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $2
				WHERE m.conversation_id = $1 AND m.sender_id <> $2 AND m.index_in_conversation > greatest(me.read_index, me.min_index)`, [Room.id, Member.user_id])).rows[0].count;
			PushTo([Member.user_id], Envelope(Cmd.NewMessageNotify, {
				conversation_id: Room.conversation_key, conversation_type: Room.conversation_type, notify_type: 1, message: Message, badge_count: Unread, badge_count_v2: Unread, ref_msg_info: Message.reference_info,
				previous_cursor: Previous, next_cursor: Row.id, index_in_conversation: Row.index_in_conversation, index_in_conversation_v2: Row.index_in_conversation,
			}, RequestInbox ? 3 : 0));
		}
	}
	return { status: SendStatus.Succeeded, server_message_id: Row.id, client_message_id: ClientId, check_code: '0', check_message: '', conversation: ConversationShape(await Conversation(Pool, User.id, Body), User.id) };
}

const EmptyInbox = { [Cmd.MessagesByUserInitV2]: Body => ({ conversations: [], messages: [], per_user_cursor: '0', next_cursor: '0', has_more: false }),
	[Cmd.MessagesByUser]: Body => ({ messages: [], next_cursor: Body.cursor ?? '0', has_more: false }) };

const Handlers = {
	async [Cmd.MessagesByUserInitV2]({ Pool, User, InboxType }) {
		const RequestInbox = InboxType === 3;
		const Rooms = RequestInbox ? await Requests(Pool, User.id) : await Conversations(Pool, User.id, 'true', []);
		const Recent = await Pool.query(`SELECT * FROM (SELECT ${MessageColumns}, row_number() OVER (PARTITION BY m.conversation_id ORDER BY m.index_in_conversation DESC) AS rank
			FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1
			WHERE m.index_in_conversation > me.min_index AND me.request = $2 AND (NOT $2 OR (${RequestVisible})) AND ${Visible}) recent WHERE rank <= 20 ORDER BY id`, [User.id, RequestInbox]);
		const Allowed = new Set(Rooms.map(Room => Room.id));
		const Cursor = await UserCursor(Pool, User.id, null, RequestInbox);
		return { conversations: Rooms.map(Row => ConversationShape(Row, User.id)), messages: Recent.rows.filter(Row => !RequestInbox || Allowed.has(Row.conversation_id)).map(Row => MessageShape(Row, RequestInbox ? User.id : undefined)), per_user_cursor: Cursor, next_cursor: Cursor, has_more: false, cmd_start_index: '0', next_conversation_version: '0' };
	},
	async [Cmd.MessagesByUser]({ Pool, User, InboxType }, Body) {
		const After = String(Body.cursor ?? '0');
		const Page = await UserMessages(Pool, User.id, After, Math.min(Math.max(Number(Body.limit) || 50, 1), 200), InboxType === 3);
		return { messages: Page.Rows.map(Row => MessageShape(Row, InboxType === 3 ? User.id : undefined)), next_cursor: Page.Rows.at(-1)?.id ?? After, has_more: Page.HasMore, next_conversation_version: '0', next_cmd_index: '0' };
	},
	async [Cmd.MessagesByUserCombo]({ Pool, User }, Body) {
		const Inboxes = await Promise.all((Body.inboxes ?? []).slice(0, 5).map(async Inbox => {
			const After = String(Inbox.cursor ?? '0');
			const Base = { inbox_type: Inbox.inbox_type ?? 0, cursor_type: Inbox.cursor_type ?? 0, next_interval: '30', status_code: 0 };
			if (![0, 3].includes(Inbox.inbox_type ?? 0) || (Inbox.cursor_type ?? 0) !== 0) return { ...Base, messages: [], next_cursor: After, has_more: false };
			const Page = await UserMessages(Pool, User.id, After, Math.min(Math.max(Number(Inbox.limit) || 50, 1), 200), Inbox.inbox_type === 3);
			return { ...Base, messages: Page.Rows.map(Row => MessageShape(Row, Inbox.inbox_type === 3 ? User.id : undefined)), next_cursor: Page.Rows.at(-1)?.id ?? After, has_more: Page.HasMore };
		}));
		return { inboxes: Inboxes, need_reset: false };
	},
	[Cmd.SendMessage]: SendMessage,
	async [Cmd.DeleteMessage]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Updated = await Pool.query('UPDATE messages SET hidden_for = array_append(hidden_for, $3::bigint) WHERE id = $1 AND conversation_id = $2 AND NOT $3::bigint = ANY(hidden_for) RETURNING id', [Body.message_id ?? '0', Room.id, User.id]);
		if (!Updated.rowCount && !(await Pool.query('SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2', [Body.message_id ?? '0', Room.id])).rowCount) throw new ImError(Status.InvalidRequest, 'MessageNotFound');
		return null;
	},
	async [Cmd.RecallMessage]({ Pool, User }, Body) {
		if (!Misc.unsend) throw new ImError(Status.InvalidRequest, 'UnsendDisabled');
		const Room = await Conversation(Pool, User.id, Body);
		const Updated = await Pool.query(`UPDATE messages SET recalled_at = COALESCE(recalled_at, now()) WHERE id = $1 AND conversation_id = $2 AND sender_id = $3 AND (recalled_at IS NOT NULL OR created_at >= now() - interval '3 minutes') RETURNING *`, [Body.server_message_id ?? '0', Room.id, User.id]);
		if (!Updated.rowCount) throw new ImError(Status.InvalidRequest, 'CannotUnsendMessage');
		const Row = { ...Updated.rows[0], conversation_key: Room.conversation_key, conversation_type: Room.conversation_type };
		for (const Member of Room.members) {
			const RequestInbox = Member.request;
			const Cursor = await UserCursor(Pool, Member.user_id, null, RequestInbox);
			PushTo([Member.user_id], Envelope(Cmd.NewMessageNotify, { conversation_id: Room.conversation_key, conversation_type: Room.conversation_type, previous_cursor: Cursor, next_cursor: Cursor,
				message: { ...MessageShape({ ...Row, recalled_at: null, message_type: 50021, content: '{}', client_message_id: `recall:${Row.id}` }, RequestInbox ? Member.user_id : undefined), ext: { 's:server_message_id': Row.id, 's:is_recalled': 'true', ...(RequestInbox ? { stranger: Member.user_id } : {}) } }
			}, RequestInbox ? 3 : 0));
		}
		return null;
	},
	async [Cmd.ModifyMessageProperty]({ Pool, User, Limiter }, Body) {
		const Change = Body.property_list ?? {};
		const Fail = Code => ({ status: Code, version: '0' });
		if (!Misc.messageReactions) return Fail(3);
		const Room = await Conversation(Pool, User.id, Change);
		const Others = Room.members.map(Member => Member.user_id).filter(Id => Id !== User.id);
		if (Room.conversation_type === 1 && (await Pool.query(`SELECT ${BlockedBetween('$1::bigint', '$2::bigint')} AS blocked`, [User.id, Others[0]])).rows[0].blocked) return Fail(3);
		if (await ActiveRestriction(Pool, User.id, 'message')) return Fail(3);
		const Contents = (Change.modify_property_content ?? []).slice(0, 10);
		if (!Contents.length || Contents.some(Content => ![0, 1].includes(Number(Content.operation ?? 0)) || !/^e:[^\s]{1,40}$/u.test(String(Content.key ?? '')) || String(Content.value ?? '').length > 200)) return Fail(2);
		Limiter.Hit(`reaction:${User.id}`, 120);
		const Row = await Transaction(Pool, async Client => {
			const Target = (await Client.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $3
				WHERE m.id = $1 AND m.conversation_id = $2 AND m.recalled_at IS NULL AND m.index_in_conversation > me.min_index AND ${Visible} FOR UPDATE OF m`, [Change.server_message_id ?? '0', Room.id, User.id])).rows[0];
			if (!Target) return null;
			const Properties = structuredClone(Target.properties ?? {});
			for (const Content of Contents) {
				const Key = String(Content.key), Items = (Properties[Key] ?? []).filter(Item => Item.idempotent_id !== User.id);
				if (Number(Content.operation ?? 0) === 0) Items.push({ uid: User.id, idempotent_id: User.id, value: String(Content.value ?? ''), at: Date.now() });
				if (Items.length) Properties[Key] = Items; else delete Properties[Key];
			}
			const Mine = Object.entries(Properties).filter(([, Items]) => Items.some(Item => Item.idempotent_id === User.id));
			if (Mine.length > 3 || Object.keys(Properties).length > 30) return { Rejected: true };
			return (await Client.query('UPDATE messages SET properties = $2, property_version = property_version + 1 WHERE id = $1 RETURNING *', [Target.id, Properties])).rows.map(Updated => ({ ...Updated, conversation_key: Room.conversation_key, conversation_type: Room.conversation_type }))[0];
		});
		if (!Row) throw new ImError(Status.InvalidRequest, 'MessageNotFound');
		if (Row.Rejected) return Fail(2);
		for (const Member of Room.members) {
			const RequestInbox = Member.request;
			const Cursor = await UserCursor(Pool, Member.user_id, null, RequestInbox);
			PushTo([Member.user_id], Envelope(Cmd.NewMessageNotify, { conversation_id: Room.conversation_key, conversation_type: Room.conversation_type, previous_cursor: Cursor, next_cursor: Cursor,
				message: { ...MessageShape({ ...Row, message_type: 70002, content: '{}' }, RequestInbox ? Member.user_id : undefined), ext: { 's:client_message_id': Row.client_message_id, 's:server_message_id': Row.id, ...(RequestInbox ? { stranger: Member.user_id } : {}) } }
			}, RequestInbox ? 3 : 0));
		}
		return { status: 0, version: String(Row.property_version) };
	},
	async [Cmd.CreateConversationV2]({ Pool, User }, Body) {
		if (Number(Body.conversation_type ?? 1) !== 1) throw new ImError(Status.InvalidRequest, 'GroupChatsUnsupported');
		return { conversation: ConversationShape(await CreateDirect(Pool, User.id, Body.participants ?? []), User.id), status: 0, check_code: '0' };
	},
	async [Cmd.ConversationInfoV2]({ Pool, User }, Body) {
		return { conversation_info: ConversationShape(await Conversation(Pool, User.id, Body), User.id) };
	},
	async [Cmd.ConversationInfoListV2]({ Pool, User }, Body) {
		const Ids = (Body.conversation_info_list ?? []).map(Entry => Entry.conversation_short_id).filter(Id => Id && Id !== '0').slice(0, 100);
		const Keys = (Body.conversation_info_list ?? []).map(Entry => Entry.conversation_id).filter(Boolean).slice(0, 100);
		const Rows = await Conversations(Pool, User.id, '(c.id = ANY($2::bigint[]) OR c.conversation_key = ANY($3::text[]))', [Ids, Keys], null);
		return { conversation_info_list: Rows.map(Row => ConversationShape(Row, User.id)) };
	},
	async [Cmd.UserConversationList]({ Pool, User, InboxType }, Body) {
		const Offset = Math.max(Number(Body.cursor) || 0, 0), Limit = Math.min(Math.max(Number(Body.limit) || 50, 1), 100);
		const Rows = InboxType === 3 ? await Requests(Pool, User.id) : await Conversations(Pool, User.id, 'true', []);
		const Page = Rows.slice(Offset, Offset + Limit);
		return { list: Page.map(Row => ConversationShape(Row, User.id)), has_more: Offset + Limit < Rows.length, next_cursor: String(Offset + Page.length) };
	},
	async [Cmd.MessagesInConversation]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Limit = Math.min(Math.max(Number(Body.limit) || 20, 1), 100);
		const Newer = [2, 4].includes(Number(Body.direction));
		const Anchor = Body.anchor_index && Body.anchor_index !== '0' ? Body.anchor_index : null;
		const Result = await Pool.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
			JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $5
			WHERE m.conversation_id = $1 AND m.index_in_conversation > $2 AND ${Visible} AND ($3::bigint IS NULL OR m.index_in_conversation ${Newer ? '>' : '<'} $3)
			ORDER BY m.index_in_conversation ${Newer ? 'ASC' : 'DESC'} LIMIT $4`, [Room.id, Room.min_index, Anchor, Limit + 1, User.id]);
		const Rows = Result.rows.slice(0, Limit);
		return { messages: Rows.map(Row => MessageShape(Row, Room.request ? User.id : undefined)), has_more: Result.rows.length > Limit, next_cursor: Rows.at(-1)?.index_in_conversation ?? '0' };
	},
	async [Cmd.MarkConversationRead]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Index = BigInt(Body.read_message_index ?? '0') > BigInt(Room.last_index) ? Room.last_index : String(Body.read_message_index ?? '0');
		await Pool.query('UPDATE conversation_members SET read_index = greatest(read_index, $3) WHERE conversation_id = $1 AND user_id = $2', [Room.id, User.id, Index]);
		const Peers = (await Disclosures(Pool, User.id, Room)).filter(Peer => Peer.read_status && !Peer.pending && !Peer.blocked).map(Peer => Peer.other);
		PushTo([User.id, ...Peers], Envelope(Cmd.MarkReadNotify, { conversation_id: Room.conversation_key, conversation_type: Room.conversation_type, read_index: Index, read_index_v2: Index, user_id: User.id }));
		return null;
	},
	async [Cmd.MarkConversationReadV3](Context, Body) { return Handlers[Cmd.MarkConversationRead](Context, Body); },
	async [Cmd.MessagesInRange]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Limit = Math.min(Math.max(Number(Body.limit) || 20, 1), 100);
		const Range = Body.message_range ?? {};
		const Result = await Pool.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
			JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $6
			WHERE m.conversation_id = $1 AND m.index_in_conversation > $2 AND ${Visible} AND m.index_in_conversation >= $3 AND ($4::bigint = 0 OR m.index_in_conversation <= $4)
			ORDER BY m.index_in_conversation LIMIT $5`, [Room.id, Room.min_index, Range.min_conv_index ?? '0', Range.max_conv_index ?? '0', Limit + 1, User.id]);
		const Rows = Result.rows.slice(0, Limit);
		return { messages_pb: Rows.map(Row => Proto.Encode('MessageBody', MessageShape(Row, Room.request ? User.id : undefined))), has_more: Result.rows.length > Limit, next_cursor: Rows.at(-1)?.index_in_conversation ?? '0' };
	},
	async [Cmd.MarkConversationDelete]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		await Pool.query('UPDATE conversation_members SET min_index = $3, read_index = greatest(read_index, $3) WHERE conversation_id = $1 AND user_id = $2', [Room.id, User.id, Room.last_index]);
		return null;
	},
	async [Cmd.ParticipantsList]({ Pool, User }, Body) {
		return { participants_page: ConversationShape(await Conversation(Pool, User.id, Body), User.id).first_page_participants };
	},
	async [Cmd.MgetParticipants]({ Pool, User }, Body) {
		const Wanted = new Set((Body.participants ?? []).map(String));
		return { participants: ConversationShape(await Conversation(Pool, User.id, Body), User.id).first_page_participants.participants.filter(Participant => !Wanted.size || Wanted.has(Participant.user_id)) };
	},
	async [Cmd.ReadIndexV3]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Rows = await ReadIndexes(Pool, User.id, [Room.id]);
		return { indexes: Rows.map(Row => ({ user_id: Row.user_id, sec_uid: Row.user_id, index: Row.read_index, index_v2: Row.read_index, index_min: Row.min_index })) };
	},
	async [Cmd.MinIndexV3]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Rows = await ReadIndexes(Pool, User.id, [Room.id]);
		return { indexes: Rows.map(Row => ({ user_id: Row.user_id, sec_uid: Row.user_id, index: Row.min_index, index_v2: Row.min_index })) };
	},
	async [Cmd.BatchReadIndex]({ Pool, User }, Body) {
		const Rows = await Conversations(Pool, User.id, '(c.id = ANY($2::bigint[]) OR c.conversation_key = ANY($3::text[]))', [(Body.conversation_short_id ?? []).slice(0, 100), (Body.conversation_id ?? []).slice(0, 100)]);
		const Members = await ReadIndexes(Pool, User.id, Rows.map(Row => Row.id));
		return { conversationParticipantsReadIndex: Rows.map(Row => ({ conversation_id: Row.conversation_key, conversation_short_id: Row.id,
			participantReadIndex: Members.filter(Member => Member.conversation_id === Row.id).map(Member => ({ user_id: Member.user_id, sec_uid: Member.user_id, index: Member.read_index, index_v2: Member.read_index, index_min: Member.min_index })) })) };
	},
	async [Cmd.UnreadCount]({ Pool, User }) {
		const Rows = await Conversations(Pool, User.id, 'true', []);
		return { total_unread_count: String(Rows.reduce((Sum, Row) => Sum + Row.unread, 0)), conv_unread_count: Object.fromEntries(Rows.map(Row => [Row.id, String(Row.unread)])) };
	},
	async [Cmd.InputStatus]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		PushTo((await Disclosures(Pool, User.id, Room)).filter(Peer => !Peer.pending && !Peer.blocked).map(Peer => Peer.other), Envelope(Cmd.InputStatusNotify, {
			sender: User.id, conversation_id: Room.conversation_key, conversation_short_id: Room.id, conversation_type: Room.conversation_type, input_status: Number(Body.status ?? 0), create_time: String(Date.now()) }));
		return {};
	},
	async [Cmd.StrangerConversations]({ Pool, User }, Body) {
		const Rows = (await Requests(Pool, User.id));
		const Offset = Math.max(Number(Body.cursor) || 0, 0), Limit = Math.min(Math.max(Number(Body.count) || 10, 1), 50);
		const Page = Rows.slice(Offset, Offset + Limit);
		const Last = Page.length ? (await Pool.query(`SELECT DISTINCT ON (m.conversation_id) ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
			JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $2
			WHERE m.conversation_id = ANY($1::bigint[]) AND ${Visible} ORDER BY m.conversation_id, m.index_in_conversation DESC`, [Page.map(Row => Row.id), User.id])).rows : [];
		return { next_cursor: String(Offset + Page.length), has_more: Offset + Limit < Rows.length, total_unread: Rows.reduce((Sum, Row) => Sum + Row.unread, 0),
			conversation_list: Page.map(Row => {
				const Shape = ConversationShape(Row, User.id);
				const Message = Last.find(Entry => Entry.conversation_id === Row.id);
				return { conversation_short_id: Row.id, conversation_id: Row.conversation_key, unread: Row.unread, badge_count: Row.unread, ext: { stranger: User.id }, participants: Shape.first_page_participants.participants, ...(Message ? { last_message: MessageShape(Message, User.id) } : {}) };
			}) };
	},
	async [Cmd.StrangerMessages]({ Pool, User }, Body) {
		const Room = await RequestRoom(Pool, User.id, Body);
		const Result = await Pool.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
			JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $3
			WHERE m.conversation_id = $1 AND m.index_in_conversation > $2 AND ${Visible} ORDER BY m.index_in_conversation DESC LIMIT 100`, [Room.id, Room.min_index, User.id]);
		if (Body.reset_unread_count) await Pool.query('UPDATE conversation_members SET read_index = $3 WHERE conversation_id = $1 AND user_id = $2', [Room.id, User.id, Room.last_index]);
		return { messages: Result.rows.reverse().map(Row => MessageShape(Row, User.id)) };
	},
	async [Cmd.DeleteStrangerMessage](Context, Body) { return Handlers[Cmd.DeleteMessage](Context, { ...Body, message_id: Body.server_message_id }); },
	async [Cmd.DeleteStrangerConversation]({ Pool, User }, Body) {
		const Room = await RequestRoom(Pool, User.id, Body);
		await Pool.query('UPDATE conversation_members SET min_index = $3, read_index = $3 WHERE conversation_id = $1 AND user_id = $2', [Room.id, User.id, Room.last_index]);
		return null;
	},
	async [Cmd.DeleteAllStrangerConversations]({ Pool, User }) {
		await Pool.query(`UPDATE conversation_members me SET min_index = l.last, read_index = l.last FROM (SELECT conversation_id, max(index_in_conversation) AS last FROM messages GROUP BY conversation_id) l
			WHERE me.user_id = $1 AND me.request AND l.conversation_id = me.conversation_id`, [User.id]);
		return null;
	},
	async [Cmd.MarkStrangerConversationRead]({ Pool, User }, Body) {
		const Room = await RequestRoom(Pool, User.id, Body);
		await Pool.query('UPDATE conversation_members SET read_index = $3 WHERE conversation_id = $1 AND user_id = $2', [Room.id, User.id, Room.last_index]);
		return null;
	},
	async [Cmd.MarkAllStrangerConversationsRead]({ Pool, User }) {
		await Pool.query(`UPDATE conversation_members me SET read_index = l.last FROM (SELECT conversation_id, max(index_in_conversation) AS last FROM messages GROUP BY conversation_id) l
			WHERE me.user_id = $1 AND me.request AND l.conversation_id = me.conversation_id`, [User.id]);
		return null;
	},
	async [Cmd.StrangerUnreadCount]({ Pool, User }) {
		return { user_unread_count: String((await Requests(Pool, User.id)).filter(Row => Row.unread).length) };
	},
};

async function Requests(Pool, Viewer) {
	return Conversations(Pool, Viewer, RequestVisible, [], true);
}

async function RequestRoom(Pool, Viewer, Body) {
	const [Row] = await Conversations(Pool, Viewer, 'c.id = $2', [Body.conversation_short_id ?? '0'], true);
	if (!Row) throw new ImError(Status.ConversationNotExist, 'ConversationNotExist');
	return Row;
}

export async function AcceptRequest(Pool, Viewer, ConversationKey_) {
	const Accepted = await Transaction(Pool, async Client => {
		const Cursor = await UserCursor(Client, Viewer, null, true);
		const Result = await Client.query(`UPDATE conversation_members me SET request = false FROM conversations c WHERE c.id = me.conversation_id AND c.conversation_key = $2 AND me.user_id = $1 AND me.request AND (${RequestVisible}) RETURNING c.id`, [Viewer, String(ConversationKey_ ?? '')]);
		if (!Result.rowCount) return null;
		const Last = (await Client.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.conversation_id=$1 ORDER BY m.id DESC LIMIT 1`, [Result.rows[0].id])).rows[0];
		return { Cursor, Last };
	});
	if (!Accepted) return false;
	const { Cursor, Last } = Accepted;
	PushTo([Viewer], Envelope(Cmd.NewMessageNotify, {
		conversation_id: Last.conversation_key, conversation_type: Last.conversation_type, notify_type: 1,
		message: MessageShape({ ...Last, message_type: 50010, content: '{}', client_message_id: `accept:${Last.conversation_id}` }, Viewer),
		previous_cursor: Cursor, next_cursor: Cursor, index_in_conversation: Last.index_in_conversation, index_in_conversation_v2: Last.index_in_conversation,
	}, 3));
	return true;
}

export async function UnsendMessage(Context, MessageId) {
	const Row = (await Context.Pool.query('SELECT conversation_id FROM messages WHERE id = $1 AND sender_id = $2', [MessageId, Context.User.id])).rows[0];
	if (!Row) throw new HttpError(404, 'MessageNotFound');
	try { await Handlers[Cmd.RecallMessage](Context, { conversation_short_id: Row.conversation_id, server_message_id: MessageId }); }
	catch (Error) { if (!(Error instanceof ImError)) throw Error; throw new HttpError(403, 'CannotUnsendMessage'); }
}

export async function HandleRequest(Context, Bytes) {
	const Request = Proto.Decode('Request', Bytes);
	const Response = Envelope(Request.cmd, null);
	Response.sequence_id = Request.sequence_id ?? '0';
	Response.inbox_type = Request.inbox_type ?? 0;
	const Handler = Handlers[Request.cmd];
	try {
		if (!Handler) {
			if (Context.Unknown.size < 500) Context.Unknown.set(`IM ${Request.cmd}`, (Context.Unknown.get(`IM ${Request.cmd}`) ?? 0) + 1);
			throw new ImError(Status.InvalidCommand, 'InvalidCommand');
		}
		const Input = Request.body?.[RequestField[FieldOf(Request.cmd)]] ?? Object.values(Request.body ?? {})[0] ?? {};
		const InboxType = Request.inbox_type ?? 0;
		const Body = ![0, 3].includes(InboxType) && EmptyInbox[Request.cmd] ? EmptyInbox[Request.cmd](Input) : await Handler({ ...Context, InboxType }, Input);
		if (Body) Response.body = { [BodyField[FieldOf(Request.cmd)]]: Body };
	} catch (Error) {
		if (Error instanceof ImError) { Response.status_code = Error.Code; Response.error_desc = Error.message; }
		else if (Error instanceof HttpError && Error.status === 429) { Response.status_code = Status.ResourceExhausted; Response.error_desc = Error.message; }
		else throw Error;
	}
	return Proto.Encode('Response', Response);
}

export async function Im(Context) {
	const { Request, Response, Url, User } = Context;
	if (!/^\/v[1-3]\/[a-z_/]+$/.test(Url.pathname) || Request.method !== 'POST' || !Request.headers['content-type']?.startsWith('application/x-protobuf')) return false;
	if (!User) throw new HttpError(401, 'NotLoggedIn');
	if (Context.Config.Features?.messages === false) throw new HttpError(403, 'MessagesDisabled');
	const Bytes = await HandleRequest(Context, await ReadRaw(Request, 1024 * 1024));
	Response.writeHead(200, { 'content-type': 'application/x-protobuf', 'cache-control': 'no-store' });
	Response.end(Bytes);
	return true;
}
