(() => {
	const Boot = JSON.parse(document.getElementById('kittok-admin-boot').textContent);
	const Root = document.getElementById('kittok-admin');
	const Errors = {
		TypeTheUsernameToConfirm: 'Type the username exactly to confirm.', CannotChangeYourself: 'You can’t do that to your own account.', InvalidCsrf: 'Your session changed. Refresh and try again.',
		InvalidInvite: 'Invites need 1–100 uses and 1–90 days.', UserNotFound: 'That user doesn’t exist.', VideoNotFound: 'That video was already removed.', CommentNotFound: 'No comment has that ID.',
		InviteNotFound: 'That invite was already used or revoked.', SessionNotFound: 'That session already ended.', ViolationNotFound: 'That violation was already revoked.',
		InvalidCategory: 'Pick a category.', InvalidReason: 'Write a reason (up to 1,000 characters).', VideoNotTheirs: 'That video isn’t theirs.', CommentNotTheirs: 'That comment isn’t theirs.',
		InvalidInstanceName: 'Names are 1–60 characters.', InvalidLimits: 'Videos can be 1–2,048 MB and 1–3,600 seconds.', AnnouncementTooLong: 'Announcements are up to 500 characters.',
		InvalidAnnouncementLink: 'Links start with https:// or /.', RulesTooLong: 'Rules are up to 10,000 characters.', InvalidImage: 'Use a PNG, JPEG, or WebP image up to 4096 px.', BodyTooLarge: 'Images are up to 2 MB.', InvalidUpload: 'Choose an image.',
	};
	const CategoryLabels = { spam: 'Spam', harassment: 'Harassment or bullying', hate: 'Hate speech', nudity: 'Nudity or sexual content', violence: 'Violence', self_harm: 'Self-harm', misinformation: 'Misinformation', impersonation: 'Impersonation', copyright: 'Copyright', other: 'Other' };
	const EventLabels = { signup: 'Signed up', login: 'Logged in', login_failed: 'Failed login', username_change: 'Changed username', profile_change: 'Edited profile' };
	const Icons = {
		overview: 'M6 38V22h6v16H6Zm10 0V10h6v28h-6Zm10 0V16h6v22h-6Zm10 0V26h6v12h-6Z',
		users: 'M18 6a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 40c0-7.7 6.3-12 14-12s14 4.3 14 12h-4c0-5-4.4-8-10-8S8 35 8 40H4Zm28-17.5a6 6 0 0 0 0-11.5V7a10 10 0 0 1 0 19.6v-4Zm4 7c4.6 1.6 8 4.9 8 10.5h-4c0-3.5-2.1-5.6-5-6.7l1-3.8Z',
		videos: 'M8 8h32a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Zm2 4v24h28V12H10Zm10 4.5 10 7.5-10 7.5v-15Z',
		comments: 'M8 8h32a2 2 0 0 1 2 2v22a2 2 0 0 1-2 2H22l-9 7v-7H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Zm2 4v18h7v3l4-3h17V12H10Zm4 5h20v3H14v-3Zm0 6h14v3H14v-3Z',
		invites: 'M6 12a2 2 0 0 1 2-2h32a2 2 0 0 1 2 2v7a5 5 0 0 0 0 10v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7a5 5 0 0 0 0-10v-7Zm4 2v3.3a9 9 0 0 1 0 13.4V34h28v-3.3a9 9 0 0 1 0-13.4V14H10Zm8 4h4v3h-4v-3Zm0 5h4v3h-4v-3Zm0 5h4v3h-4v-3Z',
		settings: 'M8 12h16v-3h4v10h-4v-3H8v-4Zm24 0h8v4h-8v-4ZM8 26h6v-3h4v10h-4v-3H8v-4Zm14 0h18v4H22v-4Z',
		audit: 'M24 6a18 18 0 1 1-17.1 23.6l3.8-1.2A14 14 0 1 0 12 15.5V20H6V8h4v4.3A18 18 0 0 1 24 6Zm-2 8h4v9.2l7 4.1-2 3.4-9-5.3V14Z',
		back: 'M20.6 9.4 23.4 12.2 13.6 22H42v4H13.6l9.8 9.8-2.8 2.8L6 24 20.6 9.4Z',
		theme: 'M24 6a18 18 0 1 0 0 36 18 18 0 0 0 0-36Zm0 4v28a14 14 0 0 1 0-28Z',
	};
	const Nav = [['/admin', 'Overview', 'overview'], ['/admin/users', 'Users', 'users'], ['/admin/videos', 'Videos', 'videos'], ['/admin/comments', 'Comments', 'comments'], ['/admin/invites', 'Invites', 'invites'], ['/admin/settings', 'Settings', 'settings'], ['/admin/audit', 'Audit log', 'audit']];

	function El(Tag, Props = {}, ...Children) {
		const Created = document.createElement(Tag);
		for (const [Key, Value] of Object.entries(Props)) {
			if (Value === undefined || Value === null || Value === false) continue;
			if (Key === 'class') Created.className = Value;
			else if (Key.startsWith('on')) Created.addEventListener(Key.slice(2), Value);
			else if (Key === 'value') Created.value = Value;
			else if (Key === 'checked') Created.checked = Boolean(Value);
			else Created.setAttribute(Key, Value === true ? '' : Value);
		}
		for (const Child of Children.flat(3)) if (Child !== null && Child !== undefined && Child !== false) Created.append(Child instanceof Node ? Child : String(Child));
		return Created;
	}
	function Svg(Path, Size = 24) {
		const Node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		Node.setAttribute('viewBox', '0 0 48 48'); Node.setAttribute('width', Size); Node.setAttribute('height', Size); Node.setAttribute('fill', 'currentColor'); Node.setAttribute('aria-hidden', 'true');
		const Shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); Shape.setAttribute('d', Path); Shape.setAttribute('fill-rule', 'evenodd'); Node.append(Shape);
		return Node;
	}
	function Button(Label, OnClick, { Kind = 'secondary', Size = 'small', Type = 'button' } = {}) {
		return El('button', { type: Type, class: `TUXButton TUXButton--capsule TUXButton--${Size} TUXButton--${Kind}`, onclick: OnClick }, El('div', { class: 'TUXButton-content' }, El('div', { class: 'TUXButton-label' }, Label)));
	}
	const Link = (Href, ...Children) => El('a', { href: Href, 'data-link': '' }, ...Children);
	const Muted = Text => El('span', { class: 'muted' }, Text);
	const Count = (Value, Word) => `${Number(Value).toLocaleString()} ${Word}${Number(Value) === 1 ? '' : 's'}`;
	function Ago(Value) {
		if (!Value) return 'Never';
		const Seconds = Math.round((Date.now() - new Date(Value)) / 1000);
		for (const [Unit, Size] of [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]]) if (Seconds >= Size) return `${Math.floor(Seconds / Size)}${Unit} ago`;
		return 'Just now';
	}
	const Exact = Value => Value ? new Date(Value).toLocaleString() : '—';
	function Device(Agent) {
		if (!Agent) return 'Unknown device';
		const Browser = /Edg\//.test(Agent) ? 'Edge' : /OPR\//.test(Agent) ? 'Opera' : /Firefox\//.test(Agent) ? 'Firefox' : /Chrome\//.test(Agent) ? 'Chrome' : /Safari\//.test(Agent) ? 'Safari' : /curl|node|python/i.test(Agent) ? 'Script' : 'Browser';
		const System = /iPhone|iPad/.test(Agent) ? 'iOS' : /Android/.test(Agent) ? 'Android' : /Windows/.test(Agent) ? 'Windows' : /Mac OS X/.test(Agent) ? 'macOS' : /CrOS/.test(Agent) ? 'ChromeOS' : /Linux/.test(Agent) ? 'Linux' : 'unknown OS';
		return `${Browser} on ${System}`;
	}
	const Flag = Code => Code ? `${String.fromCodePoint(...[...Code].map(Letter => 127397 + Letter.charCodeAt(0)))} ${Code}` : 'Unknown';
	function Language(Tag) { if (!Tag) return 'Unknown'; try { return `${new Intl.DisplayNames(['en'], { type: 'language' }).of(Tag)} (${Tag})`; } catch { return Tag; } }

	function Toast(Message, Negative = false) {
		const Node = El('div', { class: `toast${Negative ? ' negative' : ''}`, role: Negative ? 'alert' : 'status' }, Message);
		document.body.append(Node); setTimeout(() => Node.remove(), 3200);
	}
	function Dialog({ Title, Message, Confirm = 'Confirm', Danger = true, Body = null, Read = null }) {
		return new Promise(Resolve => {
			function Close(Value) { Overlay.remove(); document.removeEventListener('keydown', Key); Resolve(Value); }
			function Key(Event) { if (Event.key === 'Escape') Close(null); }
			const Overlay = El('div', { class: 'overlay', onclick: Event => Event.target === Overlay && Close(null) },
				El('form', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title', onsubmit: Event => { Event.preventDefault(); Close(Read ? Read() : true); } },
					El('h2', { id: 'dialog-title' }, Title), Message ? El('p', {}, Message) : null, Body,
					El('div', { class: 'dialog-actions' }, Button('Cancel', () => Close(null), { Size: 'medium' }), Button(Confirm, null, { Kind: Danger ? 'primary' : 'secondary', Size: 'medium', Type: 'submit' }))));
			document.body.append(Overlay); document.addEventListener('keydown', Key);
			(Overlay.querySelector('input,textarea,select') ?? Overlay.querySelector('button[type=submit]')).focus();
		});
	}

	async function Api(Path, Body) {
		const Options = Body instanceof FormData ? { method: 'POST', headers: { 'x-csrf-token': Boot.csrf }, body: Body } : Body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': Boot.csrf }, body: JSON.stringify(Body) } : {};
		const Response = await fetch('/_kittok/admin/' + Path, Options);
		const Result = await Response.json().catch(() => ({}));
		if (!Response.ok) throw new Error(Errors[Result.error] ?? 'That didn’t work. Try again.');
		return Result;
	}
	async function Act(Path, Body, Success, After = Render) {
		try { const Result = await Api(Path, Body ?? {}); Toast(Success); await After(Result); return Result; } catch (Error) { Toast(Error.message, true); return null; }
	}

	const Avatar = (Src, Size = 40) => El('img', { class: 'avatar', src: Src, alt: '', width: Size, height: Size, loading: 'lazy' });
	const Card = (Title, ...Children) => El('section', { class: 'card' }, Title ? El('h2', {}, Title) : null, ...Children);
	const Empty = Message => El('p', { class: 'empty' }, Message);
	const Field = (Label, Input, Hint) => El('label', { class: 'field' }, El('span', {}, Label), Input, Hint ? El('small', {}, Hint) : null);
	const Input = (Props = {}) => El('input', { class: 'input', ...Props });
	const Facts = Rows => El('dl', { class: 'facts' }, Rows.filter(Boolean).map(([Label, Value]) => El('div', {}, El('dt', {}, Label), El('dd', {}, Value))));
	const Tag = (Text, Negative) => El('span', { class: `tag${Negative ? ' negative' : ''}` }, Text);

	function ViolationForm(UserId, { Video = '', Comment = '' } = {}) {
		const Category = El('select', { class: 'input', 'aria-label': 'Category' }, El('option', { value: '' }, 'Choose a category'), Boot.categories.map(Key => El('option', { value: Key }, CategoryLabels[Key])));
		const Reason = El('textarea', { class: 'input', rows: 3, maxlength: 1000, placeholder: 'What happened? Users don’t see this.' });
		const VideoId = Input({ placeholder: 'Video ID (optional)', value: Video, inputmode: 'numeric' });
		const CommentId = Input({ placeholder: 'Comment ID (optional)', value: Comment, inputmode: 'numeric' });
		return Dialog({ Title: 'Add a violation', Confirm: 'Add violation', Body: El('div', { class: 'stack' }, Field('Category', Category), Field('Reason', Reason), El('div', { class: 'row' }, VideoId, CommentId)),
			Read: () => ({ category: Category.value, reason: Reason.value, video_id: VideoId.value.trim() || undefined, comment_id: CommentId.value.trim() || undefined }) })
			.then(Value => Value && Act(`users/${UserId}/violations`, Value, 'Violation added'));
	}
	function ViolationList(Rows) {
		if (!Rows.length) return Empty('No violations.');
		return El('ul', { class: 'list' }, Rows.map(Row => El('li', { class: Row.revoked_at ? 'revoked' : '' },
			El('div', { class: 'grow' }, El('strong', {}, CategoryLabels[Row.category] ?? Row.category, Row.revoked_at ? Tag('Revoked') : null), El('p', { class: 'body' }, Row.reason),
				Muted(`By ${Row.admin ? '@' + Row.admin : 'a deleted admin'} · ${Ago(Row.created_at)}${Row.video_id ? ` · video ${Row.video_id}` : ''}${Row.comment_id ? ` · comment ${Row.comment_id}` : ''}`)),
			Row.revoked_at ? null : Button('Revoke', async () => { if (await Dialog({ Title: 'Revoke this violation?', Message: 'It stays in the history, marked as revoked.', Confirm: 'Revoke', Danger: false })) Act(`violations/${Row.id}/revoke`, null, 'Violation revoked'); }))));
	}
	function CommentRow(Comment, { Author = true } = {}) {
		return El('li', {},
			Author ? Link(`/admin/users/${Comment.author_id}`, Avatar(Comment.avatar, 36)) : null,
			El('div', { class: 'grow' },
				Author ? El('strong', {}, Link(`/admin/users/${Comment.author_id}`, Comment.display_name), ' ', Muted('@' + Comment.username)) : null,
				El('p', { class: 'body' }, Comment.body),
				Muted(`${Comment.parent_id ? 'Reply · ' : ''}${Ago(Comment.created_at)} · ID ${Comment.id}`)),
			El('div', { class: 'actions' }, Button('Open', () => Go(`/admin/comments/${Comment.id}`))));
	}
	function VideoGrid(Rows) {
		if (!Rows.length) return Empty('No videos.');
		return El('div', { class: 'grid' }, Rows.map(Video => El('div', { class: 'tile' },
			El('a', { class: 'cover', href: `/@${Video.username ?? ''}/video/${Video.id}`, target: '_blank', rel: 'noopener', 'aria-label': Video.description || 'Untitled video' }, El('img', { src: Video.cover, alt: '', loading: 'lazy' }), El('span', {}, `▶ ${Number(Video.views).toLocaleString()}`)),
			El('p', { class: 'caption' }, Video.description || 'Untitled'),
			Muted(`${Video.username ? '@' + Video.username + ' · ' : ''}${Count(Video.likes, 'like')} · ${Count(Video.comments, 'comment')} · ${Ago(Video.created_at)}`),
			El('div', { class: 'actions' },
				Video.author_id ? Button('Violation', () => ViolationForm(Video.author_id, { Video: Video.id })) : null,
				Button('Remove', async () => { if (await Dialog({ Title: 'Remove this video?', Message: 'The video, its files, likes, and comments are deleted permanently.', Confirm: 'Remove' })) Act(`videos/${Video.id}/delete`, null, 'Video removed'); }, { Kind: 'primary' })))));
	}
	function More(Has, Load) { return Has ? El('div', { class: 'more' }, Button('Load more', Load, { Size: 'medium' })) : null; }

	const Pages = {
		async overview() {
			const Data = await Api('overview');
			const Stats = [['Users', Data.stats.users], ['New this week', Data.stats.new_users], ['Suspended', Data.stats.suspended], ['Violations (30 days)', Data.stats.violations], ['Videos', Data.stats.videos], ['Views', Data.stats.views], ['Comments', Data.stats.comments], ['Likes', Data.stats.likes], ['Active sessions', Data.stats.sessions], ['Open invites', Data.stats.invites]];
			return ['Overview', [
				El('div', { class: 'stats' }, Stats.map(([Label, Value]) => El('div', { class: 'stat' }, El('strong', {}, Number(Value).toLocaleString()), El('span', {}, Label)))),
				El('div', { class: 'columns' },
					Card('Newest accounts', El('ul', { class: 'list' }, Data.signups.map(User => El('li', {}, Link(`/admin/users/${User.id}`, Avatar(User.avatar, 36)), El('div', { class: 'grow' }, El('strong', {}, Link(`/admin/users/${User.id}`, User.display_name)), Muted(`@${User.username} · ${Flag(User.country)} · ${Ago(User.created_at)}`)))))),
					Card('Unimplemented client calls', Muted('Since this server started.'), Data.missing.length ? El('ul', { class: 'list compact' }, Data.missing.map(Row => El('li', {}, El('code', { class: 'grow' }, Row.call), Muted(String(Row.count))))) : Empty('None.'))),
			]];
		},
		async users(Query = new URLSearchParams(location.search).get('q') ?? '', Before = null, Rows = []) {
			const Data = await Api(`users?q=${encodeURIComponent(Query)}${Before ? '&before=' + Before : ''}`);
			const All = [...Rows, ...Data.users];
			const Search = Input({ type: 'search', placeholder: 'Search by username, name, user ID, or IP', 'aria-label': 'Search users', value: Query });
			const Submit = Event => { Event.preventDefault(); Go(`/admin/users${Search.value.trim() ? '?q=' + encodeURIComponent(Search.value.trim()) : ''}`); };
			return ['Users', [
				El('form', { class: 'search', onsubmit: Submit }, Search),
				All.length ? El('ul', { class: 'list' }, All.map(User => El('li', {},
					Link(`/admin/users/${User.id}`, Avatar(User.avatar, 44)),
					El('div', { class: 'grow' }, El('strong', {}, Link(`/admin/users/${User.id}`, User.display_name), User.role === 'admin' ? Tag('Admin') : null, User.suspended_at ? Tag('Suspended', true) : null, User.violations ? Tag(Count(User.violations, 'violation'), true) : null),
						Muted(`@${User.username} · ${Count(User.followers, 'follower')} · ${Count(User.videos, 'video')} · joined ${Ago(User.created_at)}`)),
					El('div', { class: 'actions' }, Button('Open', () => Go(`/admin/users/${User.id}`)))))) : Empty(Query ? 'No users match.' : 'No users yet.'),
				More(Data.hasMore, async () => Fill(...await Pages.users(Query, All.at(-1).id, All))),
			]];
		},
		async user(Id) {
			const Data = await Api(`users/${Id}`);
			const User = Data.user;
			const Self = User.self;
			const Header = El('section', { class: 'card profile' },
				Avatar(User.avatar, 96),
				El('div', { class: 'grow' },
					El('h2', {}, User.display_name, User.role === 'admin' ? Tag('Admin') : null, User.suspended_at ? Tag('Suspended', true) : null),
					El('p', { class: 'handle' }, '@' + User.username),
					User.bio ? El('p', { class: 'body' }, User.bio) : Muted('No bio.'),
					El('p', { class: 'counts' }, El('strong', {}, Number(User.stats.followingCount).toLocaleString()), ' Following  ', El('strong', {}, Number(User.stats.followerCount).toLocaleString()), ' Followers  ', El('strong', {}, Number(User.stats.heartCount).toLocaleString()), ' Likes  ', El('strong', {}, Number(User.stats.videoCount).toLocaleString()), ' Videos')),
				El('div', { class: 'actions vertical' },
					Button('View profile', () => open('/@' + User.username, '_blank', 'noopener')),
					Button('Add violation', () => ViolationForm(User.id), { Kind: 'primary' }),
					Self ? null : User.suspended_at
						? Button('Unsuspend', () => Act(`users/${User.id}/unsuspend`, null, `@${User.username} unsuspended`))
						: Button('Suspend', async () => { if (await Dialog({ Title: `Suspend @${User.username}?`, Message: 'They’ll be signed out everywhere and can’t log in until you unsuspend them.', Confirm: 'Suspend' })) Act(`users/${User.id}/suspend`, null, `@${User.username} suspended`); }),
					Self ? null : Button(User.role === 'admin' ? 'Make member' : 'Make admin', async () => { if (await Dialog({ Title: User.role === 'admin' ? `Remove @${User.username}’s admin access?` : `Make @${User.username} an admin?`, Message: User.role === 'admin' ? 'They’ll lose access to this panel.' : 'Admins can see everyone’s security details, suspend, delete, and change settings.', Confirm: User.role === 'admin' ? 'Make member' : 'Make admin', Danger: User.role !== 'admin' })) Act(`users/${User.id}/role`, { role: User.role === 'admin' ? 'member' : 'admin' }, 'Role changed'); }),
					Self ? null : Button('Delete account', async () => { const Confirm = Input({ placeholder: User.username, autocomplete: 'off', 'aria-label': `Type ${User.username} to confirm` }); const Value = await Dialog({ Title: `Delete @${User.username}?`, Message: 'This permanently deletes the account, their videos and files, comments, likes, and follows.', Confirm: 'Delete', Body: Confirm, Read: () => Confirm.value }); if (Value !== null) Act(`users/${User.id}/delete`, { confirm: Value }, `@${User.username} deleted`, () => Go('/admin/users')); })));
			const Signup = Data.signup;
			const Account = Card('Account', Facts([
				['User ID', El('code', {}, User.id)], ['Joined', `${Exact(User.created_at)} (${Ago(User.created_at)})`],
				['Sign-up country', Flag(Signup?.country)], ['Sign-up language', Language(Signup?.language)],
				['Sign-up IP', Signup?.ip ? El('code', {}, Signup.ip) : 'Not recorded'], ['Sign-up device', Device(Signup?.user_agent)],
				['Countries seen', Data.seen.countries.length ? Data.seen.countries.map(Flag).join(', ') : 'Unknown'],
				['Languages seen', Data.seen.languages.length ? Data.seen.languages.map(Language).join(', ') : 'Unknown'],
				['Distinct IPs', String(Data.seen.ips)], ['Status', User.suspended_at ? `Suspended ${Exact(User.suspended_at)}` : 'Active'],
				['Last read notifications', Exact(User.notices_read_at)],
			]));
			const Sessions = Card('Sessions', Data.sessions.length ? El('ul', { class: 'list' }, Data.sessions.map(Row => El('li', {},
				El('div', { class: 'grow' }, El('strong', {}, Device(Row.user_agent)), Muted(`${Flag(Row.country)} · ${Row.ip ?? 'no IP'} · active ${Ago(Row.last_seen_at)} · signed in ${Ago(Row.created_at)}`)),
				Self ? null : Button('Sign out', () => Act(`users/${User.id}/sessions/revoke`, { session: Row.id }, 'Session ended'))))) : Empty('Not signed in anywhere.'),
				!Self && Data.sessions.length > 1 ? El('div', { class: 'more' }, Button('Sign out everywhere', () => Act(`users/${User.id}/sessions/revoke`, { session: 'all' }, 'Signed out everywhere'))) : null);
			const Violations = Card(`Violations (${Data.violations.filter(Row => !Row.revoked_at).length} active)`, ViolationList(Data.violations));
			const Related = Card('Accounts on the same IPs', Data.related.length ? El('ul', { class: 'list' }, Data.related.map(Row => El('li', {}, Link(`/admin/users/${Row.id}`, Avatar(Row.avatar, 36)),
				El('div', { class: 'grow' }, El('strong', {}, Link(`/admin/users/${Row.id}`, Row.display_name), Row.suspended_at ? Tag('Suspended', true) : null), Muted(`@${Row.username} · ${Row.ips.join(', ')}`))))) : Empty('No other accounts share an IP with this one.'));
			const Events = Card('Activity log', Data.events.length ? El('table', { class: 'table' }, El('thead', {}, El('tr', {}, ['Event', 'When', 'IP', 'Country', 'Language', 'Device'].map(Label => El('th', {}, Label)))),
				El('tbody', {}, Data.events.map(Row => El('tr', {}, El('td', {}, EventLabels[Row.kind] ?? Row.kind, Row.detail ? El('br') : null, Row.detail ? Muted(Row.detail) : null), El('td', { title: Exact(Row.created_at) }, Ago(Row.created_at)), El('td', {}, Row.ip ? El('code', {}, Row.ip) : '—'), El('td', {}, Flag(Row.country)), El('td', {}, Row.language ?? '—'), El('td', { title: Row.user_agent ?? '' }, Device(Row.user_agent)))))) : Empty('No recorded activity yet.'), Muted('IP addresses are wiped after 90 days.'));
			return [`@${User.username}`, [
				El('p', { class: 'crumbs' }, Link('/admin/users', 'Users'), ' / ', '@' + User.username), Header,
				El('div', { class: 'columns' }, Account, El('div', { class: 'stack' }, Violations, Sessions)),
				Related, Events,
				Card(`Videos (${Data.videos.length})`, VideoGrid(Data.videos.map(Video => ({ ...Video, author_id: User.id })))),
				Card(`Comments (${Data.comments.length})`, Data.comments.length ? El('ul', { class: 'list' }, Data.comments.map(Comment => CommentRow({ ...Comment, author_id: User.id }, { Author: false }))) : Empty('No comments.')),
			]];
		},
		async videos(Before = null, Rows = []) {
			const Data = await Api('videos' + (Before ? '?before=' + Before : ''));
			const All = [...Rows, ...Data.videos];
			return ['Videos', [VideoGrid(All), More(Data.hasMore, async () => Fill(...await Pages.videos(All.at(-1).id, All)))]];
		},
		async comments(Before = null, Rows = []) {
			const Data = await Api('comments' + (Before ? '?before=' + Before : ''));
			const All = [...Rows, ...Data.comments];
			const Lookup = Input({ placeholder: 'Comment ID', inputmode: 'numeric', 'aria-label': 'Comment ID', pattern: '[0-9]+' });
			return ['Comments', [
				El('form', { class: 'search', onsubmit: Event => { Event.preventDefault(); if (/^\d+$/.test(Lookup.value.trim())) Go(`/admin/comments/${Lookup.value.trim()}`); else Toast('Comment IDs are numbers.', true); } }, Lookup, Button('Find', null, { Size: 'medium', Type: 'submit', Kind: 'primary' })),
				Card('Latest comments', All.length ? El('ul', { class: 'list' }, All.map(Comment => CommentRow(Comment))) : Empty('No comments yet.'), More(Data.hasMore, async () => Fill(...await Pages.comments(All.at(-1).id, All)))),
			]];
		},
		async comment(Id) {
			const Data = await Api(`comments/${Id}`);
			const Comment = Data.comment;
			return [`Comment ${Comment.id}`, [
				El('p', { class: 'crumbs' }, Link('/admin/comments', 'Comments'), ' / ', Comment.id),
				El('div', { class: 'columns' },
					El('div', { class: 'stack' },
						Card(null, El('div', { class: 'quote' }, Link(`/admin/users/${Comment.author_id}`, Avatar(Comment.avatar, 48)),
							El('div', { class: 'grow' }, El('strong', {}, Link(`/admin/users/${Comment.author_id}`, Comment.display_name), ' ', Muted('@' + Comment.username)), El('p', { class: 'body large' }, Comment.body),
								Muted(`${Exact(Comment.created_at)} · ${Count(Comment.likes, 'like')} · ${Number(Comment.replies).toLocaleString()} ${Number(Comment.replies) === 1 ? 'reply' : 'replies'}`))),
							El('div', { class: 'actions' }, Button('Add violation', () => ViolationForm(Comment.author_id, { Comment: Comment.id }), { Kind: 'primary' }),
								Button('Remove', async () => { if (await Dialog({ Title: Comment.parent_id ? 'Remove this reply?' : 'Remove this comment?', Message: Comment.parent_id ? 'This reply is deleted permanently.' : 'This comment and its replies are deleted permanently.', Confirm: 'Remove' })) Act(`comments/${Comment.id}/delete`, null, 'Comment removed', () => Go('/admin/comments')); }))),
						Data.parent ? Card('Replying to', El('ul', { class: 'list' }, CommentRow(Data.parent))) : null,
						Card(`Replies (${Data.replies.length})`, Data.replies.length ? El('ul', { class: 'list' }, Data.replies.map(Reply => CommentRow(Reply))) : Empty('No replies.')),
						Card('Violations for this comment', ViolationList(Data.violations))),
					Card('Video', El('a', { class: 'cover small', href: `/@${Comment.video_author}/video/${Comment.video_id}`, target: '_blank', rel: 'noopener' }, El('img', { src: Comment.cover, alt: '' })), El('p', { class: 'caption' }, Comment.video_description || 'Untitled'), Muted(`@${Comment.video_author} · video ${Comment.video_id}`))),
			]];
		},
		async invites() {
			const Data = await Api('invites');
			const Uses = Input({ type: 'number', min: 1, max: 100, value: 1 });
			const Days = Input({ type: 'number', min: 1, max: 90, value: 7 });
			const Created = El('div');
			return ['Invites', [
				Data.registration === 'invite' ? null : El('p', { class: 'notice' }, `Sign-up is ${Data.registration}, so invites ${Data.registration === 'open' ? 'are optional' : 'won’t work'} until you choose “Invite only” in Settings.`),
				El('div', { class: 'columns' },
					Card('Create an invite', El('div', { class: 'row' }, Field('Uses', Uses), Field('Valid for days', Days)), El('div', { class: 'more left' }, Button('Create invite', async () => {
						try { const Result = await Api('invites', { uses: Uses.value, days: Days.value }); Created.replaceChildren(El('div', { class: 'code' }, El('p', {}, 'Copy this invite now. It won’t be shown again.'), El('code', {}, Result.code), Button('Copy', () => navigator.clipboard.writeText(Result.code).then(() => Toast('Invite copied'))))); Toast('Invite created'); }
						catch (Error) { Toast(Error.message, true); }
					}, { Kind: 'primary', Size: 'medium' })), Created),
					Card('Open invites', Data.invites.length ? El('ul', { class: 'list' }, Data.invites.map(Invite => El('li', {}, El('div', { class: 'grow' }, El('code', {}, Invite.id.slice(0, 12) + '…'), Muted(`By @${Invite.username} · used ${Invite.uses} of ${Invite.max_uses} · expires ${new Date(Invite.expires_at).toLocaleDateString()}`)),
						Button('Revoke', async () => { if (await Dialog({ Title: 'Revoke this invite?', Message: 'Nobody will be able to sign up with it.', Confirm: 'Revoke' })) Act(`invites/${Invite.id}/delete`, null, 'Invite revoked'); })))) : Empty('No open invites.'))),
			]];
		},
		async settings() {
			const Data = await Api('settings');
			const Save = (Key, Value, Message = 'Saved') => Act(`settings/${Key}`, { value: Value }, Message);
			const Modes = [['invite', 'Invite only', 'A code is needed to sign up.'], ['open', 'Open', 'Anyone can sign up; codes are optional.'], ['closed', 'Closed', 'No new accounts.']];
			const Mode = El('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Sign-up' }, Modes.map(([Value, Label, Hint]) => El('label', { class: 'choice' }, El('input', { type: 'radio', name: 'registration', value: Value, checked: Data.registration === Value }), El('span', {}, El('strong', {}, Label), Muted(Hint)))));
			const Name = Input({ value: Data.name, maxlength: 60 });
			const FeatureBoxes = Object.entries(Boot.features).map(([Key, Label]) => El('label', { class: 'check' }, El('input', { type: 'checkbox', 'data-feature': Key, checked: Data.features[Key] !== false }), Label));
			const VideoMB = Input({ type: 'number', min: 1, max: 2048, value: Data.limits.videoMB });
			const VideoSeconds = Input({ type: 'number', min: 1, max: 3600, value: Data.limits.videoSeconds });
			const NoticeText = El('textarea', { class: 'input', rows: 3, maxlength: 500 }); NoticeText.value = Data.announcement?.text ?? '';
			const NoticeLink = Input({ value: Data.announcement?.link ?? '', placeholder: 'https://… or /rules' });
			const Rules = El('textarea', { class: 'input', rows: 8, maxlength: 10000 }); Rules.value = Data.rules ?? '';
			const Slots = [['wordmarkDark', 'Wordmark on dark themes', 'dark'], ['wordmarkLight', 'Wordmark on the light theme', 'light'], ['icon', 'Icon (narrow sidebar, sign-in pages)', 'dark'], ['favicon', 'Browser tab icon', 'dark']];
			function BrandCard([Slot, Label, Shade]) {
				const Info = Data.brand[Slot];
				const File = El('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async () => {
					if (!File.files[0]) return; const Form = new FormData(); Form.append('file', File.files[0]);
					await Act(`brand/${Slot}`, Form, 'Image updated');
				} });
				return El('div', { class: 'brand-card' }, El('h3', {}, Label), El('div', { class: `preview ${Shade}` }, El('img', { src: `${Info.url}?v=${Date.now()}`, alt: '' })),
					El('div', { class: 'row tight' }, Button('Upload', () => File.click()), Info.custom ? Button('Use default', () => Act(`brand/${Slot}/reset`, {}, 'Default restored')) : Muted('Default'), File));
			}
			return ['Settings', [
				El('div', { class: 'settings' },
					Card('Sign-up', Mode, El('div', { class: 'more left' }, Button('Save', () => Save('registration', Mode.querySelector('input:checked')?.value)))),
					Card('Name', Field('Instance name', Name, 'Shown in page titles and on the sign-in page.'), El('div', { class: 'more left' }, Button('Save', () => Save('name', Name.value)))),
					Card('Features', Muted('Switched-off features disappear from everyone’s sidebar; uploads, comments, and search are also refused by the server.'), El('div', { class: 'checks' }, FeatureBoxes),
						El('div', { class: 'more left' }, Button('Save', () => Save('features', Object.fromEntries([...Root.querySelectorAll('[data-feature]')].map(Box => [Box.dataset.feature, Box.checked])))))),
					Card('Upload limits', Field('Video size, MB', VideoMB), Field('Video length, seconds', VideoSeconds), El('div', { class: 'more left' }, Button('Save', () => Save('limits', { videoMB: Number(VideoMB.value), videoSeconds: Number(VideoSeconds.value) })))),
					Card('Announcement', Muted('A banner at the top of everyone’s feed until they close it. Saving new text shows it again to everyone.'), Field('Text (empty removes the banner)', NoticeText), Field('Link (optional)', NoticeLink),
						El('div', { class: 'more left' }, Button('Save', () => Save('announcement', { text: NoticeText.value, link: NoticeLink.value })))),
					Card('Rules', El('p', { class: 'muted' }, 'Shown at ', El('a', { href: '/rules', target: '_blank' }, '/rules'), ' and linked from sign-up. A blank line starts a new paragraph.'), Rules, El('div', { class: 'more left' }, Button('Save', () => Save('rules', Rules.value))))),
				El('h2', { class: 'section' }, 'Logo and icons'), Muted('PNG, JPEG, or WebP up to 2 MB. Transparency is kept.'),
				El('div', { class: 'brand-grid' }, Slots.map(BrandCard)),
			]];
		},
		async audit(Before = null, Rows = []) {
			const Data = await Api('audit' + (Before ? '?before=' + Before : ''));
			const All = [...Rows, ...Data.actions];
			return ['Audit log', [All.length ? El('table', { class: 'table' }, El('thead', {}, El('tr', {}, ['When', 'Admin', 'Action', 'Target', 'Detail'].map(Label => El('th', {}, Label)))),
				El('tbody', {}, All.map(Row => El('tr', {}, El('td', { title: Exact(Row.created_at) }, Ago(Row.created_at)), El('td', {}, Row.username ? '@' + Row.username : 'Deleted admin'), El('td', {}, El('code', {}, Row.action)), El('td', {}, Row.target), El('td', {}, Row.detail))))) : Empty('No admin actions yet.'),
				More(Data.hasMore, async () => Fill(...await Pages.audit(All.at(-1).id, All)))]];
		},
	};

	const Main = El('main', { class: 'content', id: 'content' });
	function Fill(Title, Nodes) {
		document.title = `${Title} · Admin · ${Boot.name}`;
		Main.replaceChildren(El('h1', {}, Title), ...[Nodes].flat(2).filter(Boolean));
	}
	function Route() {
		const Path = location.pathname.replace(/\/+$/, '') || '/admin';
		let Match;
		if ((Match = Path.match(/^\/admin\/users\/(\d+)$/))) return ['users', () => Pages.user(Match[1])];
		if ((Match = Path.match(/^\/admin\/comments\/(\d+)$/))) return ['comments', () => Pages.comment(Match[1])];
		const Section = { '/admin': 'overview', '/admin/users': 'users', '/admin/videos': 'videos', '/admin/comments': 'comments', '/admin/invites': 'invites', '/admin/settings': 'settings', '/admin/audit': 'audit' }[Path];
		return Section ? [Section, () => Pages[Section]()] : ['overview', async () => ['Not found', [Empty('That admin page doesn’t exist.')]]];
	}
	async function Render() {
		const [Section, Load] = Route();
		for (const Item of Root.querySelectorAll('nav [data-section]')) Item.toggleAttribute('aria-current', Item.dataset.section === Section);
		Main.setAttribute('aria-busy', 'true');
		try { Fill(...await Load()); } catch (Error) { Fill('Something went wrong', [Empty(Error.message)]); }
		Main.removeAttribute('aria-busy');
	}
	function Go(Path) { if (Path !== location.pathname + location.search) history.pushState(null, '', Path); window.scrollTo(0, 0); Render(); }

	const Theme = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
	const Logo = El('img', { class: 'logo', alt: Boot.name, src: Theme() === 'light' ? '/brand/wordmarkLight' : '/brand/wordmarkDark' });
	Root.append(
		El('aside', { class: 'sidebar' },
			El('a', { href: '/admin', 'data-link': '', class: 'logo-link', 'aria-label': `${Boot.name} admin` }, Logo),
			El('nav', { 'aria-label': 'Admin' }, Nav.map(([Href, Label, Icon]) => El('a', { href: Href, 'data-link': '', 'data-section': Icon }, Svg(Icons[Icon]), El('span', {}, Label))),
				El('a', { href: '/' }, Svg(Icons.back), El('span', {}, `Back to ${Boot.name}`))),
			El('div', { class: 'me' }, Avatar(Boot.me.avatar, 28), Muted(`@${Boot.me.username} · admin`),
				El('button', { type: 'button', class: 'theme', 'aria-label': 'Switch light or dark theme', onclick: () => {
					const Next = Theme() === 'light' ? 'dark' : 'light';
					document.documentElement.dataset.theme = Next; Logo.src = Next === 'light' ? '/brand/wordmarkLight' : '/brand/wordmarkDark';
					try { localStorage.setItem('kittok-admin-theme', Next); } catch {}
				} }, Svg(Icons.theme, 20)))),
		Main);
	Root.addEventListener('click', Event => {
		const Anchor = Event.target.closest('a[data-link]');
		if (!Anchor || Event.metaKey || Event.ctrlKey || Event.shiftKey || Event.button !== 0) return;
		Event.preventDefault(); Go(Anchor.getAttribute('href'));
	});
	addEventListener('popstate', Render);
	Render();
})();
