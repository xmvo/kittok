(() => {
	const Sections = [['overview', 'Overview'], ['users', 'Users'], ['videos', 'Videos'], ['comments', 'Comments'], ['invites', 'Invites']];
	const Errors = {
		TypeTheUsernameToConfirm: 'Type the username exactly to confirm.', CannotChangeYourself: 'You can’t change your own account here.',
		InvalidCsrf: 'Your session changed. Refresh and try again.', InvalidInvite: 'Invites need 1–100 uses and 1–90 days.',
		UserNotFound: 'That user no longer exists.', VideoNotFound: 'That video was already removed.', CommentNotFound: 'That comment was already removed.', InviteNotFound: 'That invite was already used or revoked.',
	};
	let Section = Sections.some(([Id]) => '#' + Id === location.hash) ? location.hash.slice(1) : 'overview';
	let Root, Body;

	function El(Tag, Props = {}, ...Children) {
		const Created = document.createElement(Tag);
		for (const [Key, Value] of Object.entries(Props)) {
			if (Value === undefined || Value === null || Value === false) continue;
			if (Key === 'class') Created.className = Value;
			else if (Key.startsWith('on')) Created.addEventListener(Key.slice(2), Value);
			else Created.setAttribute(Key, Value === true ? '' : Value);
		}
		for (const Child of Children.flat()) if (Child !== null && Child !== undefined && Child !== false) Created.append(Child instanceof Node ? Child : String(Child));
		return Created;
	}
	const Text = (Value, Class = '') => El('span', { class: Class }, Value);
	function Button(Label, OnClick, { Kind = 'secondary', Size = 'small' } = {}) {
		return El('button', { type: 'button', class: `TUXButton TUXButton--capsule TUXButton--${Size} TUXButton--${Kind}`, onclick: OnClick }, El('div', { class: 'TUXButton-content' }, El('div', { class: 'TUXButton-label' }, Label)));
	}
	const Count = (Value, Word) => `${Number(Value).toLocaleString()} ${Word}${Number(Value) === 1 ? '' : 's'}`;
	function Ago(Value) {
		const Seconds = Math.round((Date.now() - new Date(Value)) / 1000);
		for (const [Unit, Size] of [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60]]) if (Seconds >= Size) return `${Math.floor(Seconds / Size)}${Unit} ago`;
		return 'Just now';
	}

	function Toast(Message, Negative = false) {
		const Node = El('div', { class: `kittok-admin-toast${Negative ? ' negative' : ''}`, role: Negative ? 'alert' : 'status' }, Message);
		document.body.append(Node);
		setTimeout(() => Node.remove(), 3200);
	}
	function Dialog({ Title, Message, Confirm = 'Confirm', Type = '', Danger = true }) {
		return new Promise(Resolve => {
			const Input = Type ? El('input', { class: 'kittok-admin-input', 'aria-label': `Type ${Type} to confirm`, placeholder: Type, autocomplete: 'off' }) : null;
			function Close(Value) { Overlay.remove(); document.removeEventListener('keydown', Key); Resolve(Value); }
			function Key(Event) { if (Event.key === 'Escape') Close(null); }
			const Overlay = El('div', { class: 'kittok-admin-overlay', onclick: Event => Event.target === Overlay && Close(null) },
				El('div', { class: 'kittok-admin-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kittok-admin-dialog-title' },
					El('h2', { id: 'kittok-admin-dialog-title' }, Title), El('p', {}, Message), Input,
					El('div', { class: 'kittok-admin-dialog-actions' }, Button('Cancel', () => Close(null), { Size: 'medium' }), Button(Confirm, () => Close(Input ? Input.value : true), { Kind: Danger ? 'primary' : 'secondary', Size: 'medium' }))));
			document.body.append(Overlay);
			document.addEventListener('keydown', Key);
			(Input ?? Overlay.querySelector('button:last-child')).focus();
		});
	}

	async function Api(Path, Body) {
		const Response = await fetch('/_kittok/admin/' + Path, Body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Body) } : {});
		const Result = await Response.json().catch(() => ({}));
		if (!Response.ok) throw new Error(Errors[Result.error] ?? 'That didn’t work. Try again.');
		return Result;
	}
	async function Act(Path, Body, Success) {
		try { await Api(Path, Body ?? {}); Toast(Success); await Render(); } catch (Error) { Toast(Error.message, true); }
	}

	function Avatar(Src, Size = 48) { return El('img', { class: 'kittok-admin-avatar', src: Src, alt: '', width: Size, height: Size }); }
	function Empty(Message) { return El('p', { class: 'kittok-admin-empty' }, Message); }
	function More(Has, Load) { return Has ? El('div', { class: 'kittok-admin-more' }, Button('Load more', Load, { Size: 'medium' })) : null; }

	const Views = {
		async overview() {
			const Data = await Api('overview');
			const Cards = [['Users', Data.stats.users], ['Suspended', Data.stats.suspended], ['Admins', Data.stats.admins], ['Videos', Data.stats.videos], ['Views', Data.stats.views], ['Comments', Data.stats.comments], ['Likes', Data.stats.likes], ['Active sessions', Data.stats.sessions], ['Open invites', Data.stats.invites]];
			return [
				El('p', { class: 'kittok-admin-sub' }, 'Registration is ', El('strong', {}, Data.registration), '.'),
				El('div', { class: 'kittok-admin-stats' }, Cards.map(([Label, Value]) => El('div', { class: 'kittok-admin-stat' }, El('strong', {}, Number(Value).toLocaleString()), El('span', {}, Label)))),
				El('h2', {}, 'Recent admin actions'),
				Data.actions.length ? El('ul', { class: 'kittok-admin-list' }, Data.actions.map(Row => El('li', {}, El('div', { class: 'kittok-admin-main' }, El('strong', {}, Row.action), Text(`${Row.target}${Row.detail ? ' · ' + Row.detail : ''}`, 'kittok-admin-meta')), Text(`${Row.username ? '@' + Row.username : 'Deleted admin'} · ${Ago(Row.created_at)}`, 'kittok-admin-meta')))) : Empty('No admin actions yet.'),
				El('h2', {}, 'Unimplemented client calls'), El('p', { class: 'kittok-admin-sub' }, 'Since this server started.'),
				Data.missing.length ? El('ul', { class: 'kittok-admin-list' }, Data.missing.map(Row => El('li', {}, El('code', {}, Row.call), Text(String(Row.count), 'kittok-admin-meta')))) : Empty('None.'),
			];
		},
		async users(Query = '', Before = null, Rows = []) {
			const Data = await Api(`users?q=${encodeURIComponent(Query)}${Before ? '&before=' + Before : ''}`);
			const All = [...Rows, ...Data.users];
			const Search = El('input', { class: 'kittok-admin-input', type: 'search', placeholder: 'Search users', 'aria-label': 'Search users', value: Query });
			Search.addEventListener('keydown', async Event => { if (Event.key === 'Enter') Fill(await Views.users(Search.value)); });
			return [
				El('form', { class: 'kittok-admin-search', onsubmit: async Event => { Event.preventDefault(); Fill(await Views.users(Search.value)); } }, Search),
				All.length ? El('ul', { class: 'kittok-admin-list' }, All.map(User => El('li', {},
					El('a', { href: '/@' + User.username, class: 'kittok-admin-person' }, Avatar(User.avatar),
						El('div', { class: 'kittok-admin-main' }, El('strong', {}, User.display_name, User.role === 'admin' ? El('span', { class: 'kittok-admin-tag' }, 'Admin') : null, User.suspended_at ? El('span', { class: 'kittok-admin-tag negative' }, 'Suspended') : null),
							Text(`@${User.username} · ${Count(User.followers, 'follower')} · ${Count(User.videos, 'video')} · joined ${Ago(User.created_at)}`, 'kittok-admin-meta'))),
					El('div', { class: 'kittok-admin-actions' }, User.self ? Text('You', 'kittok-admin-meta') : [
						User.suspended_at
							? Button('Unsuspend', () => Act(`users/${User.id}/unsuspend`, null, `@${User.username} unsuspended`))
							: Button('Suspend', async () => { if (await Dialog({ Title: `Suspend @${User.username}?`, Message: 'They’ll be signed out everywhere and can’t log in until you unsuspend them.', Confirm: 'Suspend' })) Act(`users/${User.id}/suspend`, null, `@${User.username} suspended`); }),
						Button(User.role === 'admin' ? 'Make member' : 'Make admin', async () => { if (await Dialog({ Title: User.role === 'admin' ? `Remove @${User.username}’s admin access?` : `Make @${User.username} an admin?`, Message: User.role === 'admin' ? 'They’ll lose access to this panel.' : 'Admins can suspend, delete, and remove anything on this instance.', Confirm: User.role === 'admin' ? 'Make member' : 'Make admin', Danger: User.role !== 'admin' })) Act(`users/${User.id}/role`, { role: User.role === 'admin' ? 'member' : 'admin' }, `@${User.username} is now ${User.role === 'admin' ? 'a member' : 'an admin'}`); }),
						Button('Delete', async () => { const Typed = await Dialog({ Title: `Delete @${User.username}?`, Message: 'This permanently deletes the account, their videos, comments, likes, and follows.', Confirm: 'Delete', Type: User.username }); if (Typed !== null) Act(`users/${User.id}/delete`, { confirm: Typed }, `@${User.username} deleted`); }, { Kind: 'primary' }),
					])))) : Empty(Query ? 'No users match.' : 'No users yet.'),
				More(Data.hasMore, async () => Fill(await Views.users(Query, All.at(-1).id, All))),
			];
		},
		async videos(Before = null, Rows = []) {
			const Data = await Api('videos' + (Before ? '?before=' + Before : ''));
			const All = [...Rows, ...Data.videos];
			return [
				All.length ? El('div', { class: 'kittok-admin-grid' }, All.map(Video => El('div', { class: 'kittok-admin-card' },
					El('a', { href: `/@${Video.username}/video/${Video.id}`, class: 'kittok-admin-cover', 'aria-label': Video.description || 'Untitled video' }, El('img', { src: Video.cover, alt: '' }), El('span', { class: 'kittok-admin-views' }, `▶ ${Video.views.toLocaleString()}`)),
					El('p', { class: 'kittok-admin-caption' }, Video.description || 'Untitled'),
					Text(`@${Video.username} · ${Count(Video.likes, 'like')} · ${Count(Video.comments, 'comment')} · ${Ago(Video.created_at)}`, 'kittok-admin-meta'),
					Button('Remove', async () => { if (await Dialog({ Title: 'Remove this video?', Message: 'The video, its files, likes, and comments are deleted permanently.', Confirm: 'Remove' })) Act(`videos/${Video.id}/delete`, null, 'Video removed'); }, { Kind: 'primary' })))) : Empty('No videos yet.'),
				More(Data.hasMore, async () => Fill(await Views.videos(All.at(-1).id, All))),
			];
		},
		async comments(Before = null, Rows = []) {
			const Data = await Api('comments' + (Before ? '?before=' + Before : ''));
			const All = [...Rows, ...Data.comments];
			return [
				All.length ? El('ul', { class: 'kittok-admin-list' }, All.map(Comment => El('li', {},
					El('div', { class: 'kittok-admin-person' }, Avatar(Comment.avatar, 40),
						El('div', { class: 'kittok-admin-main' }, Text(Comment.display_name, 'kittok-admin-name'), El('p', { class: 'kittok-admin-comment' }, Comment.body),
							Text(`${Comment.parent_id ? 'Reply · ' : ''}@${Comment.username} · ${Ago(Comment.created_at)} · `, 'kittok-admin-meta'), El('a', { href: `/@${Comment.video_author}/video/${Comment.video_id}`, class: 'kittok-admin-meta' }, 'View video'))),
					El('div', { class: 'kittok-admin-actions' }, Button('Remove', async () => { if (await Dialog({ Title: Comment.parent_id ? 'Remove this reply?' : 'Remove this comment?', Message: Comment.parent_id ? 'This reply is deleted permanently.' : 'This comment and its replies are deleted permanently.', Confirm: 'Remove' })) Act(`comments/${Comment.id}/delete`, null, 'Comment removed'); }, { Kind: 'primary' }))))) : Empty('No comments yet.'),
				More(Data.hasMore, async () => Fill(await Views.comments(All.at(-1).id, All))),
			];
		},
		async invites() {
			const Data = await Api('invites');
			const Uses = El('input', { class: 'kittok-admin-input', type: 'number', min: 1, max: 100, value: 1, 'aria-label': 'Uses' });
			const Days = El('input', { class: 'kittok-admin-input', type: 'number', min: 1, max: 90, value: 7, 'aria-label': 'Valid for days' });
			const Created = El('div');
			return [
				Data.registration === 'invite' ? null : El('p', { class: 'kittok-admin-notice' }, `Registration is ${Data.registration}, so invites ${Data.registration === 'open' ? 'aren’t needed' : 'won’t be accepted'} until REGISTRATION_MODE=invite.`),
				El('h2', {}, 'Create an invite'),
				El('div', { class: 'kittok-admin-form' }, El('label', {}, 'Uses', Uses), El('label', {}, 'Valid for days', Days), Button('Create invite', async () => {
					try {
						const Result = await Api('invites', { uses: Uses.value, days: Days.value });
						Created.replaceChildren(El('div', { class: 'kittok-admin-code' }, El('p', {}, 'Copy this invite now. It won’t be shown again.'), El('code', {}, Result.code), Button('Copy', () => navigator.clipboard.writeText(Result.code).then(() => Toast('Invite copied')))));
						Toast('Invite created');
					} catch (Error) { Toast(Error.message, true); }
				}, { Kind: 'primary', Size: 'medium' })),
				Created,
				El('h2', {}, 'Open invites'),
				Data.invites.length ? El('ul', { class: 'kittok-admin-list' }, Data.invites.map(Invite => El('li', {},
					El('div', { class: 'kittok-admin-main' }, El('code', {}, Invite.id.slice(0, 12) + '…'), Text(`By @${Invite.username} · used ${Invite.uses} of ${Invite.max_uses} · expires ${new Date(Invite.expires_at).toLocaleDateString()}`, 'kittok-admin-meta')),
					El('div', { class: 'kittok-admin-actions' }, Button('Revoke', async () => { if (await Dialog({ Title: 'Revoke this invite?', Message: 'Nobody will be able to sign up with it.', Confirm: 'Revoke' })) Act(`invites/${Invite.id}/delete`, null, 'Invite revoked'); }, { Kind: 'primary' }))))) : Empty('No open invites.'),
			];
		},
	};

	function Fill(Nodes) { Body.replaceChildren(...[Nodes].flat(2).filter(Boolean)); }
	async function Render() {
		for (const Tab of Root.querySelectorAll('[role="tab"]')) Tab.setAttribute('aria-selected', String(Tab.dataset.section === Section));
		Body.setAttribute('aria-busy', 'true');
		try { Fill(await Views[Section]()); } catch (Error) { Fill(Empty(Error.message)); }
		Body.removeAttribute('aria-busy');
	}
	function Mount(Main) {
		Root = El('div', { id: 'kittok-admin' },
			El('h1', { class: 'TUXText TUXText--tiktok-display TUXText--weight-bold' }, 'Admin'),
			El('div', { class: 'kittok-admin-tabs', role: 'tablist' }, Sections.map(([Id, Label]) => El('button', { type: 'button', role: 'tab', 'data-section': Id, onclick: () => { Section = Id; history.replaceState(null, '', '/admin#' + Id); Render(); } }, Label))));
		Body = El('div', { class: 'kittok-admin-body', role: 'tabpanel' });
		Root.append(Body);
		Main.append(Root);
		document.documentElement.classList.add('kittok-admin-active');
		document.title = `Admin · ${document.title}`;
		Render();
	}
	function Start() {
		const Main = document.querySelector('main');
		if (!Main || !Main.textContent.trim()) return setTimeout(Start, 100);
		history.replaceState(null, '', '/admin' + (Section === 'overview' ? '' : '#' + Section));
		Mount(Main);
		addEventListener('kittok-admin-navigate', () => {
			const Next = location.hash.slice(1) || 'overview';
			if (Sections.some(([Id]) => Id === Next) && Next !== Section) { Section = Next; Render(); }
		});
		const Watch = setInterval(() => {
			if (location.pathname !== '/admin') { clearInterval(Watch); Root.remove(); document.documentElement.classList.remove('kittok-admin-active'); return; }
			const Current = document.querySelector('main');
			if (Current && !Current.contains(Root)) Current.append(Root);
		}, 250);
	}
	Start();
})();
