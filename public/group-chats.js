(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	if (!Instance.account || Instance.misc?.groupChats === false) return;
	let ActiveKey = '';
	const PeoplePlus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/></svg>';
	const Dots = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
	const Messages = { OnlyFriendsCanBeAdded: 'You can only add friends: people you follow who follow you back.', GroupNeeds2To31People: 'Pick at least 2 friends, up to 31.', OnlyTheOwnerCanRemove: 'Only the group owner can remove people.', MessageRestricted: 'You can’t send messages right now.', TryLater: 'Too many changes. Try again later.' };
	const El = (Tag, Props = {}, ...Children) => {
		const Node = document.createElement(Tag);
		for (const [Key, Value] of Object.entries(Props)) {
			if (Value === undefined || Value === null || Value === false) continue;
			if (Key.startsWith('on')) Node.addEventListener(Key.slice(2), Value);
			else if (Key in Node && !Key.includes('-')) Node[Key] = Value;
			else Node.setAttribute(Key, Value === true ? '' : Value);
		}
		Node.append(...Children.flat().filter(Child => Child !== null && Child !== undefined && Child !== false));
		return Node;
	};
	async function Api(Path, Method = 'GET', Body) {
		const Response = await fetch('/api/v1/im/groups' + Path, { method: Method, headers: Body ? { 'content-type': 'application/json' } : {}, body: Body ? JSON.stringify(Body) : undefined });
		const Data = await Response.json().catch(() => ({}));
		if (!Response.ok) throw new Error(Data.error ?? 'CouldntSave');
		return Data;
	}
	function Open(Title) {
		const Dialog = El('dialog', { className: 'KittokBadgeDialog KittokGroupDialog', 'aria-label': Title });
		Dialog.addEventListener('close', () => Dialog.remove());
		document.body.append(Dialog);
		Dialog.showModal();
		return Dialog;
	}
	const Person = (Friend, ...Extra) => [El('img', { src: Friend.avatar, alt: '', loading: 'lazy' }), El('span', { className: 'KittokGroupWho' }, El('b', { textContent: Friend.name }), El('small', { textContent: '@' + Friend.username })), ...Extra];
	const Act = (Status, Work) => async Event => {
		const Button = Event.currentTarget;
		Button.disabled = true; Status.textContent = '';
		try { await Work(); location.reload(); } catch (Failure) { Status.textContent = Messages[Failure.message] ?? 'Something went wrong. Try again.'; Button.disabled = false; }
	};

	async function Pick({ Title, Action, Named = false, Exclude = [], Minimum, Submit }) {
		const Dialog = Open(Title), Chosen = new Set(), Status = El('p', { role: 'status' });
		const Name = Named && El('input', { className: 'KittokGroupInput', placeholder: 'Group name (optional)', maxLength: 50, 'aria-label': 'Group name' });
		const Search = El('input', { className: 'KittokGroupInput', type: 'search', placeholder: 'Search friends', 'aria-label': 'Search friends' });
		const List = El('ul', { className: 'KittokGroupList' });
		const Go = El('button', { type: 'submit', textContent: Action, disabled: true, onclick: Act(Status, () => Submit([...Chosen], Name?.value ?? '')) });
		const Count = () => { Go.disabled = Chosen.size < Minimum; Go.textContent = Chosen.size ? `${Action} (${Chosen.size})` : Action; };
		Dialog.append(...[El('h2', { textContent: Title }), Name, Search, List, Status, El('div', { className: 'KittokBadgeButtons' }, El('button', { type: 'button', textContent: 'Cancel', onclick: () => Dialog.close() }), Go)].filter(Boolean));
		let Friends = [];
		try { Friends = (await Api('/friends')).friends.filter(Friend => !Exclude.includes(Friend.id)); } catch { Status.textContent = 'Couldn’t load your friends.'; }
		const Draw = () => {
			const Query = Search.value.trim().toLowerCase();
			const Shown = Friends.filter(Friend => !Query || `${Friend.name} ${Friend.username}`.toLowerCase().includes(Query));
			List.replaceChildren(...Shown.map(Friend => El('li', {}, El('label', {}, El('input', { type: 'checkbox', checked: Chosen.has(Friend.id), onchange: Event => { Event.currentTarget.checked ? Chosen.add(Friend.id) : Chosen.delete(Friend.id); Count(); } }), ...Person(Friend)))));
			if (!Shown.length) List.append(El('li', { className: 'KittokGroupEmpty', textContent: Friends.length ? 'No matches' : 'Only friends can be added: people you follow who follow you back.' }));
		};
		Search.addEventListener('input', Draw);
		Draw(); Count();
		(Name || Search).focus();
	}

	async function Manage(Key) {
		const Dialog = Open('Group chat'), Status = El('p', { role: 'status' });
		let Group;
		try { Group = await Api('/' + Key); } catch { Dialog.append(El('h2', { textContent: 'Group chat' }), El('p', { textContent: 'Couldn’t load this group.' })); return; }
		const Owner = Group.owner === Group.you;
		const Name = El('input', { className: 'KittokGroupInput', value: Group.name, placeholder: Group.title, maxLength: 50, 'aria-label': 'Group name' });
		const Save = El('button', { type: 'button', className: 'KittokGroupSave', textContent: 'Save', hidden: true, onclick: Act(Status, () => Api('/' + Key, 'PATCH', { name: Name.value })) });
		Name.addEventListener('input', () => { Save.hidden = Name.value.trim() === Group.name; });
		const Members = El('ul', { className: 'KittokGroupList' }, Group.members.map(Member => El('li', {}, ...Person(Member,
			Member.id === Group.owner && El('span', { className: 'KittokGroupChip', textContent: 'Owner' }),
			Owner && Member.id !== Group.you && El('button', { type: 'button', textContent: 'Remove', 'aria-label': `Remove ${Member.name}`, onclick: Act(Status, () => Api(`/${Key}/members/${Member.id}`, 'DELETE')) })))));
		const Add = Group.members.length < Group.limit && El('button', { type: 'button', textContent: 'Add people', onclick: () => { Dialog.close(); Pick({ Title: 'Add people', Action: 'Add', Exclude: Group.members.map(Member => Member.id), Minimum: 1, Submit: Ids => Api(`/${Key}/members`, 'POST', { members: Ids }) }); } });
		const Leave = El('button', { type: 'button', className: 'KittokGroupLeave', textContent: 'Leave group', onclick: Act(Status, () => Api(`/${Key}/members/${Group.you}`, 'DELETE')) });
		Dialog.append(El('h2', { textContent: Group.title }), El('div', { className: 'KittokGroupName' }, Name, Save), El('h3', { textContent: `Members · ${Group.members.length}/${Group.limit}` }), Members, Status,
			El('div', { className: 'KittokBadgeButtons' }, Leave, Add, El('button', { type: 'button', textContent: 'Done', onclick: () => Dialog.close() })));
	}

	const KeyOf = Item => Item?.querySelector('[id^="more-action-icon-"]')?.id.slice('more-action-icon-'.length) ?? '';
	document.addEventListener('click', Event => {
		const Key = KeyOf(Event.target instanceof Element ? Event.target.closest('[data-e2e="dm-new-conversation-item"]') : null);
		if (Key) ActiveKey = Key;
	}, true);
	const OpenKey = async Header => {
		const Title = Header.querySelector('[data-e2e="dm-new-chat-nickname"]')?.textContent ?? '';
		const Size = Number.parseInt(Header.querySelector('[class*="PGroupSize"]')?.textContent ?? '', 10);
		const Matches = (await Api('')).groups.filter(Group => Group.title === Title && (!Size || Group.members === Size));
		return (Matches.find(Group => Group.id === ActiveKey) ?? Matches[0])?.id ?? '';
	};
	function Sync() {
		if (!location.pathname.startsWith('/messages')) return;
		const Header = document.querySelector('[class*="DivV3AnimLeftHeaderArea"] [class*="DivHeaderContainer"]');
		if (Header && !Header.querySelector('.KittokGroupNew')) Header.append(El('button', { type: 'button', className: 'KittokGroupIcon KittokGroupNew', title: 'New group', 'aria-label': 'New group', innerHTML: PeoplePlus,
			onclick: () => Pick({ Title: 'New group', Action: 'Create', Named: true, Minimum: 2, Submit: (Ids, Name) => Api('', 'POST', { members: Ids, name: Name }) }) }));
		const Chat = document.querySelector('[class*="DivChatHeader"]');
		const Info = Chat?.querySelector('.KittokGroupInfo'), Group = Boolean(Chat?.querySelector('[class*="PGroupSize"]'));
		if (Group && !Info) Chat.append(El('button', { type: 'button', className: 'KittokGroupIcon KittokGroupInfo', title: 'Group chat', 'aria-label': 'Group chat', innerHTML: Dots, onclick: async () => { const Key = await OpenKey(Chat).catch(() => ''); if (Key) Manage(Key); } }));
		else if (!Group && Info) Info.remove();
	}
	let Scheduled = false;
	new MutationObserver(() => { if (!Scheduled) { Scheduled = true; requestAnimationFrame(() => { Scheduled = false; Sync(); }); } }).observe(document.documentElement, { childList: true, subtree: true });
})();
