import { HttpError, ReadRaw } from '../http.mjs';
import { Transaction } from '../db.mjs';
import { BlockedBetween } from '../store.mjs';
import { Codec } from '../im/protobuf.mjs';
import { Schema } from '../im/schema.mjs';
import { Push } from '../im/frontier.mjs';

export const Proto = Codec(Schema);

const Cmd = { SendMessage: 100, MessagesByUser: 200, MessagesByUserInitV2: 203, MessagesByUserCombo: 204, MessagesInConversation: 301, MessagesInRange: 304, MarkConversationReadV3: 2002, NewMessageNotify: 500, MarkReadNotify: 501,
	MarkConversationDelete: 603, MarkConversationRead: 604, ParticipantsList: 605, ConversationInfoV2: 608, CreateConversationV2: 609, ConversationInfoListV2: 610,
	MgetParticipants: 654, InputStatus: 411, InputStatusNotify: 510, ReadIndexV3: 2000, MinIndexV3: 2001, UserConversationList: 2006, StrangerConversations: 1000,
	StrangerUnreadCount: 1007, UnreadCount: 2030, BatchReadIndex: 2038 };
const Status = { Ok: 0, InvalidRequest: 4, InvalidCommand: 5, UserForbidden: 11, ResourceExhausted: 429, ConversationNotExist: 1001 };
const SendStatus = { Succeeded: 0, NotInConversation: 1, NotAllowed: 2, Blocked: 5 };
const BodyField = Object.fromEntries(Object.entries(Schema.ResponseBody).map(([Field, [Id]]) => [Id, Field]));
const RequestField = Object.fromEntries(Object.entries(Schema.RequestBody).map(([Field, [Id]]) => [Id, Field]));
const ConversationKey = (A, B) => `0:1:${[A, B].sort((X, Y) => (BigInt(X) < BigInt(Y) ? -1 : 1)).join(':')}`;

class ImError extends Error {
	constructor(Code, Message) { super(Message); this.Code = Code; }
}

function MessageShape(Row) {
	return {
		conversation_id: Row.conversation_key, conversation_type: Row.conversation_type, conversation_short_id: Row.conversation_id, server_message_id: Row.id,
		index_in_conversation: Row.index_in_conversation, index_in_conversation_v2: Row.index_in_conversation, index_in_conversation_v1: Row.index_in_conversation,
		order_in_conversation: Row.index_in_conversation, message_type: Row.message_type, sender: Row.sender_id, sec_sender: Row.sender_id, content: Row.content,
		ext: { ...Row.ext, 's:client_message_id': Row.client_message_id }, create_time: String(new Date(Row.created_at).getTime()), version: '0', status: 0,
	};
}

const MessageColumns = 'm.*, c.conversation_key, c.conversation_type';

async function Conversations(Pool, Viewer, Where, Values) {
	const Result = await Pool.query(`SELECT c.*, me.read_index, me.min_index, me.muted,
		(SELECT coalesce(max(m.index_in_conversation), 0) FROM messages m WHERE m.conversation_id = c.id) AS last_index,
		(SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.index_in_conversation > greatest(me.read_index, me.min_index) AND m.sender_id <> $1) AS unread,
		(SELECT json_agg(json_build_object('user_id', p.user_id::text, 'joined_at', p.joined_at) ORDER BY p.joined_at) FROM conversation_members p WHERE p.conversation_id = c.id) AS members
		FROM conversations c JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1
		WHERE ${Where} ORDER BY (SELECT max(m.id) FROM messages m WHERE m.conversation_id = c.id) DESC NULLS LAST, c.id DESC`, [Viewer, ...Values]);
	return Result.rows;
}

function ConversationShape(Row, Viewer) {
	const Base = { conversation_id: Row.conversation_key, conversation_short_id: Row.id, conversation_type: Row.conversation_type, inbox_type: 0 };
	const Participants = Row.members.map((Member, Index) => ({ user_id: Member.user_id, sec_uid: Member.user_id, sort_order: String(Index), role: Member.user_id === String(Row.creator_id) ? 1 : 0 }));
	return {
		...Base, ticket: 'kittok', participants_count: Participants.length, is_participant: true, badge_count: Row.unread, badge_count_v2: Row.unread,
		first_page_participants: { participants: Participants, has_more: false, cursor: '0' },
		user_info: Participants.find(Participant => Participant.user_id === Viewer),
		conversation_core_info: { ...Base, info_version: '1', owner: Row.creator_id ?? '0', creator_uid: Row.creator_id ?? '0', first_message_timestamp: String(new Date(Row.created_at).getTime()) },
		conversation_setting_info: { ...Base, min_index: Row.min_index, min_index_v2: Row.min_index, read_index: Row.read_index, read_index_v2: Row.read_index, mute: Row.muted ? 1 : 0, stick_on_top: 0, setting_version: '1', favorite: 0 },
	};
}

async function Conversation(Pool, Viewer, Body) {
	const [Row] = Body.conversation_short_id && Body.conversation_short_id !== '0'
		? await Conversations(Pool, Viewer, 'c.id = $2', [Body.conversation_short_id])
		: await Conversations(Pool, Viewer, 'c.conversation_key = $2', [String(Body.conversation_id ?? '')]);
	if (!Row) throw new ImError(Status.ConversationNotExist, 'ConversationNotExist');
	return Row;
}

async function UserCursor(Pool, Viewer, Before = null) {
	const Result = await Pool.query(`SELECT coalesce(max(m.id), 0)::text AS cursor FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1
		WHERE m.index_in_conversation > me.min_index AND ($2::bigint IS NULL OR m.id < $2)`, [Viewer, Before]);
	return Result.rows[0].cursor;
}

async function UserMessages(Pool, Viewer, After, Limit) {
	const Result = await Pool.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
		JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1
		WHERE m.id > $2 AND m.index_in_conversation > me.min_index ORDER BY m.id LIMIT $3`, [Viewer, After, Limit + 1]);
	return { Rows: Result.rows.slice(0, Limit), HasMore: Result.rows.length > Limit };
}

function Envelope(Cmd_, Body) {
	return { cmd: Cmd_, sequence_id: '0', status_code: Status.Ok, error_desc: '', inbox_type: 0, log_id: 'kittok', body: Body ? { [BodyField[Cmd_]]: Body } : {} };
}

function PushTo(UserIds, Response) {
	const Bytes = Proto.Encode('Frame', { seqid: '0', logid: String(Date.now()), service: 5, method: 1, payload_type: 'pb', payload: Proto.Encode('Response', Response) });
	for (const UserId of UserIds) Push(UserId, Bytes);
}

async function MayMessage(Pool, Sender, Recipient) {
	const Result = await Pool.query(`SELECT dm_policy = 'everyone' OR (dm_policy = 'following' AND EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1)) AS allowed FROM users WHERE id = $2`, [Sender, Recipient]);
	return Result.rows[0]?.allowed === true;
}

async function CreateDirect(Pool, Viewer, Participants) {
	const Others = [...new Set(Participants.map(String))].filter(Id => Id !== Viewer);
	if (Others.length !== 1) throw new ImError(Status.InvalidRequest, 'OneToOneOnly');
	const Other = Others[0];
	if (!(await Pool.query('SELECT 1 FROM users WHERE id = $1 AND suspended_at IS NULL', [Other])).rowCount) throw new ImError(Status.InvalidRequest, 'UserNotFound');
	if ((await Pool.query(`SELECT ${BlockedBetween('$1::bigint', '$2::bigint')} AS blocked`, [Viewer, Other])).rows[0].blocked) throw new ImError(Status.UserForbidden, 'BlockedRelationship');
	if (!(await MayMessage(Pool, Viewer, Other))) throw new ImError(Status.UserForbidden, 'MessagesNotAllowed');
	const Key = ConversationKey(Viewer, Other);
	await Transaction(Pool, async Client => {
		const Created = await Client.query('INSERT INTO conversations(conversation_key, conversation_type, creator_id) VALUES ($1, 1, $2) ON CONFLICT (conversation_key) DO NOTHING RETURNING id', [Key, Viewer]);
		const Id = Created.rows[0]?.id ?? (await Client.query('SELECT id FROM conversations WHERE conversation_key = $1', [Key])).rows[0].id;
		await Client.query('INSERT INTO conversation_members(conversation_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING', [Id, Viewer, Other]);
	});
	return (await Conversations(Pool, Viewer, 'c.conversation_key = $2', [Key]))[0];
}

async function SendMessage(Context, Body) {
	const { Pool, User, Limiter } = Context;
	const Room = await Conversation(Pool, User.id, Body);
	const Others = Room.members.map(Member => Member.user_id).filter(Id => Id !== User.id);
	const Fail = Code => ({ status: Code, client_message_id: Body.client_message_id ?? '', server_message_id: '0', check_code: '0', check_message: '' });
	if (Room.conversation_type === 1 && (await Pool.query(`SELECT ${BlockedBetween('$1::bigint', '$2::bigint')} AS blocked`, [User.id, Others[0]])).rows[0].blocked) return Fail(SendStatus.Blocked);
	if (Room.conversation_type === 1 && !(await MayMessage(Pool, User.id, Others[0]))) return Fail(SendStatus.NotAllowed);
	const Content = String(Body.content ?? '');
	const ClientId = String(Body.client_message_id ?? '');
	const Type = Number(Body.message_type ?? 0);
	if (!ClientId || ClientId.length > 64 || !Content || Content.length > 20000 || Type <= 0 || Type >= 50000) throw new ImError(Status.InvalidRequest, 'InvalidMessage');
	const Ext = Object.fromEntries(Object.entries(Body.ext ?? {}).slice(0, 30).map(([Key, Value]) => [Key.slice(0, 100), String(Value).slice(0, 2000)]));
	Limiter.Hit(`dm:${User.id}`, 60);
	const Row = await Transaction(Pool, async Client => {
		await Client.query('SELECT pg_advisory_xact_lock(741950193)');
		const Existing = await Client.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.sender_id = $1 AND m.client_message_id = $2`, [User.id, ClientId]);
		if (Existing.rowCount) return { ...Existing.rows[0], Repeated: true };
		const Inserted = await Client.query(`INSERT INTO messages(conversation_id, sender_id, client_message_id, message_type, content, ext, index_in_conversation)
			SELECT $1, $2, $3, $4, $5, $6, coalesce(max(index_in_conversation), 0) + 1 FROM messages WHERE conversation_id = $1 RETURNING *`, [Room.id, User.id, ClientId, Type, Content, Ext]);
		return { ...Inserted.rows[0], conversation_key: Room.conversation_key, conversation_type: Room.conversation_type };
	});
	if (!Row.Repeated) {
		const Message = MessageShape(Row);
		for (const Member of Room.members) {
			const Previous = await UserCursor(Pool, Member.user_id, Row.id);
			const Unread = (await Pool.query(`SELECT count(*)::int AS count FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $2
				WHERE m.conversation_id = $1 AND m.sender_id <> $2 AND m.index_in_conversation > greatest(me.read_index, me.min_index)`, [Room.id, Member.user_id])).rows[0].count;
			PushTo([Member.user_id], Envelope(Cmd.NewMessageNotify, {
				conversation_id: Room.conversation_key, conversation_type: Room.conversation_type, notify_type: 1, message: Message, badge_count: Unread, badge_count_v2: Unread,
				previous_cursor: Previous, next_cursor: Row.id, index_in_conversation: Row.index_in_conversation, index_in_conversation_v2: Row.index_in_conversation,
			}));
		}
	}
	return { status: SendStatus.Succeeded, server_message_id: Row.id, client_message_id: ClientId, check_code: '0', check_message: '', conversation: ConversationShape(await Conversation(Pool, User.id, Body), User.id) };
}

const EmptyInbox = { [Cmd.MessagesByUserInitV2]: Body => ({ conversations: [], messages: [], per_user_cursor: '0', next_cursor: '0', has_more: false }),
	[Cmd.MessagesByUser]: Body => ({ messages: [], next_cursor: Body.cursor ?? '0', has_more: false }) };

const Handlers = {
	async [Cmd.MessagesByUserInitV2]({ Pool, User }) {
		const Rooms = await Conversations(Pool, User.id, 'true', []);
		const Recent = await Pool.query(`SELECT * FROM (SELECT ${MessageColumns}, row_number() OVER (PARTITION BY m.conversation_id ORDER BY m.index_in_conversation DESC) AS rank
			FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $1
			WHERE m.index_in_conversation > me.min_index) recent WHERE rank <= 20 ORDER BY id`, [User.id]);
		const Cursor = await UserCursor(Pool, User.id);
		return { conversations: Rooms.map(Row => ConversationShape(Row, User.id)), messages: Recent.rows.map(MessageShape), per_user_cursor: Cursor, next_cursor: Cursor, has_more: false, cmd_start_index: '0', next_conversation_version: '0' };
	},
	async [Cmd.MessagesByUser]({ Pool, User }, Body) {
		const After = String(Body.cursor ?? '0');
		const Page = await UserMessages(Pool, User.id, After, Math.min(Math.max(Number(Body.limit) || 50, 1), 200));
		return { messages: Page.Rows.map(MessageShape), next_cursor: Page.Rows.at(-1)?.id ?? After, has_more: Page.HasMore, next_conversation_version: '0', next_cmd_index: '0' };
	},
	async [Cmd.MessagesByUserCombo]({ Pool, User }, Body) {
		const Inboxes = await Promise.all((Body.inboxes ?? []).slice(0, 5).map(async Inbox => {
			const After = String(Inbox.cursor ?? '0');
			const Base = { inbox_type: Inbox.inbox_type ?? 0, cursor_type: Inbox.cursor_type ?? 0, next_interval: '30', status_code: 0 };
			if ((Inbox.inbox_type ?? 0) !== 0 || (Inbox.cursor_type ?? 0) !== 0) return { ...Base, messages: [], next_cursor: After, has_more: false };
			const Page = await UserMessages(Pool, User.id, After, Math.min(Math.max(Number(Inbox.limit) || 50, 1), 200));
			return { ...Base, messages: Page.Rows.map(MessageShape), next_cursor: Page.Rows.at(-1)?.id ?? After, has_more: Page.HasMore };
		}));
		return { inboxes: Inboxes, need_reset: false };
	},
	[Cmd.SendMessage]: SendMessage,
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
		const Rows = await Conversations(Pool, User.id, '(c.id = ANY($2::bigint[]) OR c.conversation_key = ANY($3::text[]))', [Ids, Keys]);
		return { conversation_info_list: Rows.map(Row => ConversationShape(Row, User.id)) };
	},
	async [Cmd.UserConversationList]({ Pool, User }, Body) {
		const Offset = Math.max(Number(Body.cursor) || 0, 0), Limit = Math.min(Math.max(Number(Body.limit) || 50, 1), 100);
		const Rows = await Conversations(Pool, User.id, 'true', []);
		const Page = Rows.slice(Offset, Offset + Limit);
		return { list: Page.map(Row => ConversationShape(Row, User.id)), has_more: Offset + Limit < Rows.length, next_cursor: String(Offset + Page.length) };
	},
	async [Cmd.MessagesInConversation]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Limit = Math.min(Math.max(Number(Body.limit) || 20, 1), 100);
		const Newer = [2, 4].includes(Number(Body.direction));
		const Anchor = Body.anchor_index && Body.anchor_index !== '0' ? Body.anchor_index : null;
		const Result = await Pool.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
			WHERE m.conversation_id = $1 AND m.index_in_conversation > $2 AND ($3::bigint IS NULL OR m.index_in_conversation ${Newer ? '>' : '<'} $3)
			ORDER BY m.index_in_conversation ${Newer ? 'ASC' : 'DESC'} LIMIT $4`, [Room.id, Room.min_index, Anchor, Limit + 1]);
		const Rows = Result.rows.slice(0, Limit);
		return { messages: Rows.map(MessageShape), has_more: Result.rows.length > Limit, next_cursor: Rows.at(-1)?.index_in_conversation ?? '0' };
	},
	async [Cmd.MarkConversationRead]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Index = BigInt(Body.read_message_index ?? '0') > BigInt(Room.last_index) ? Room.last_index : String(Body.read_message_index ?? '0');
		await Pool.query('UPDATE conversation_members SET read_index = greatest(read_index, $3) WHERE conversation_id = $1 AND user_id = $2', [Room.id, User.id, Index]);
		PushTo(Room.members.map(Member => Member.user_id), Envelope(Cmd.MarkReadNotify, { conversation_id: Room.conversation_key, conversation_type: Room.conversation_type, read_index: Index, read_index_v2: Index, user_id: User.id }));
		return null;
	},
	async [Cmd.MarkConversationReadV3](Context, Body) { return Handlers[Cmd.MarkConversationRead](Context, Body); },
	async [Cmd.MessagesInRange]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Limit = Math.min(Math.max(Number(Body.limit) || 20, 1), 100);
		const Range = Body.message_range ?? {};
		const Result = await Pool.query(`SELECT ${MessageColumns} FROM messages m JOIN conversations c ON c.id = m.conversation_id
			WHERE m.conversation_id = $1 AND m.index_in_conversation > $2 AND m.index_in_conversation >= $3 AND ($4::bigint = 0 OR m.index_in_conversation <= $4)
			ORDER BY m.index_in_conversation LIMIT $5`, [Room.id, Room.min_index, Range.min_conv_index ?? '0', Range.max_conv_index ?? '0', Limit + 1]);
		const Rows = Result.rows.slice(0, Limit);
		return { messages_pb: Rows.map(Row => Proto.Encode('MessageBody', MessageShape(Row))), has_more: Result.rows.length > Limit, next_cursor: Rows.at(-1)?.index_in_conversation ?? '0' };
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
		const Result = await Pool.query('SELECT user_id::text, read_index, min_index FROM conversation_members WHERE conversation_id = $1', [Room.id]);
		return { indexes: Result.rows.map(Row => ({ user_id: Row.user_id, sec_uid: Row.user_id, index: Row.read_index, index_v2: Row.read_index, index_min: Row.min_index })) };
	},
	async [Cmd.MinIndexV3]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		const Result = await Pool.query('SELECT user_id::text, min_index FROM conversation_members WHERE conversation_id = $1', [Room.id]);
		return { indexes: Result.rows.map(Row => ({ user_id: Row.user_id, sec_uid: Row.user_id, index: Row.min_index, index_v2: Row.min_index })) };
	},
	async [Cmd.BatchReadIndex]({ Pool, User }, Body) {
		const Rows = await Conversations(Pool, User.id, '(c.id = ANY($2::bigint[]) OR c.conversation_key = ANY($3::text[]))', [(Body.conversation_short_id ?? []).slice(0, 100), (Body.conversation_id ?? []).slice(0, 100)]);
		const Members = await Pool.query('SELECT conversation_id::text, user_id::text, read_index, min_index FROM conversation_members WHERE conversation_id = ANY($1::bigint[])', [Rows.map(Row => Row.id)]);
		return { conversationParticipantsReadIndex: Rows.map(Row => ({ conversation_id: Row.conversation_key, conversation_short_id: Row.id,
			participantReadIndex: Members.rows.filter(Member => Member.conversation_id === Row.id).map(Member => ({ user_id: Member.user_id, sec_uid: Member.user_id, index: Member.read_index, index_v2: Member.read_index, index_min: Member.min_index })) })) };
	},
	async [Cmd.UnreadCount]({ Pool, User }) {
		const Rows = await Conversations(Pool, User.id, 'true', []);
		return { total_unread_count: String(Rows.reduce((Sum, Row) => Sum + Row.unread, 0)), conv_unread_count: Object.fromEntries(Rows.map(Row => [Row.id, String(Row.unread)])) };
	},
	async [Cmd.InputStatus]({ Pool, User }, Body) {
		const Room = await Conversation(Pool, User.id, Body);
		PushTo(Room.members.map(Member => Member.user_id).filter(Id => Id !== User.id), Envelope(Cmd.InputStatusNotify, {
			sender: User.id, conversation_id: Room.conversation_key, conversation_short_id: Room.id, conversation_type: Room.conversation_type, input_status: Number(Body.status ?? 0), create_time: String(Date.now()) }));
		return {};
	},
	[Cmd.StrangerConversations]: () => ({ next_cursor: '0', has_more: false, total_unread: 0, conversation_list: [] }),
	[Cmd.StrangerUnreadCount]: () => ({ user_unread_count: '0' }),
};

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
		const Input = Request.body?.[RequestField[Request.cmd]] ?? Object.values(Request.body ?? {})[0] ?? {};
		const Body = (Request.inbox_type ?? 0) !== 0 && EmptyInbox[Request.cmd] ? EmptyInbox[Request.cmd](Input) : await Handler(Context, Input);
		if (Body) Response.body = { [BodyField[Request.cmd]]: Body };
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
