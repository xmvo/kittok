(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	const Cache = new Map();
	const Shown = Instance.misc?.profileBadges !== false, Checked = Instance.misc?.verifiedBadges !== false;
	const Check = '<svg viewBox="0 0 48 48" width="1em" height="1em" aria-label="Verified" role="img"><path d="M0 24a24 24 0 1 1 48 0 24 24 0 0 1-48 0Z" fill="#20D5EC"/><path fill-rule="evenodd" clip-rule="evenodd" d="M37.12 15.88a3 3 0 0 1 0 4.24l-13.5 13.5a3 3 0 0 1-4.24 0l-8.5-8.5a3 3 0 1 1 4.24-4.24l6.38 6.38 11.38-11.38a3 3 0 0 1 4.24 0Z" fill="#fff"/></svg>';
	let Timer, Running = false;
	const Handle = Value => /^\/@([a-z0-9_]{3,24})\/?$/i.exec(Value)?.[1].toLowerCase();
	async function EditFlag() {
		if (document.querySelector('.KittokBadgeDialog')) return;
		const Dialog = document.createElement('dialog'); Dialog.className = 'KittokBadgeDialog'; Dialog.setAttribute('aria-label', 'Profile badges');
		const Form = document.createElement('form'); Form.method = 'dialog';
		const Heading = document.createElement('h2'); Heading.textContent = 'Profile badges';
		const Help = document.createElement('p'); Help.textContent = 'Your pride flag is public beside your name. You can change or remove it anytime.';
		const Label = document.createElement('label'); Label.textContent = 'Pride flag (optional)';
		const Select = document.createElement('select'); Select.name = 'prideFlag'; Select.disabled = true; Label.append(Select);
		const Preview = document.createElement('div'); Preview.className = 'KittokBadgePreview';
		const Status = document.createElement('p'); Status.setAttribute('role', 'status'); Status.textContent = 'Loading…';
		const Buttons = document.createElement('div'); Buttons.className = 'KittokBadgeButtons';
		const Cancel = document.createElement('button'); Cancel.type = 'button'; Cancel.textContent = 'Cancel'; Cancel.addEventListener('click', () => Dialog.close());
		const Save = document.createElement('button'); Save.type = 'submit'; Save.textContent = 'Save'; Save.disabled = true;
		Buttons.append(Cancel, Save); Form.append(Heading, Help, Preview, Label, Status, Buttons); Dialog.append(Form);
		Dialog.addEventListener('close', () => Dialog.remove());
		document.body.append(Dialog); Dialog.showModal();
		try {
			const [CatalogResponse, SessionResponse] = await Promise.all([fetch('/_kittok/badges/catalog'), fetch('/api/v1/session')]);
			if (!CatalogResponse.ok || !SessionResponse.ok) throw new Error();
			const Catalog = await CatalogResponse.json(), Session = await SessionResponse.json();
			if (!Session.user) throw new Error();
			for (const Flag of [{ id: '', label: 'None / prefer not to say' }, ...Catalog.pride]) {
				const Option = document.createElement('option'); Option.value = Flag.id; Option.textContent = Flag.label; Select.append(Option);
			}
			Select.value = Session.user.prideFlag;
			const Community = Session.user.kittokBadges.filter(Badge => Badge.type === 'community');
			const Update = () => {
				Preview.replaceChildren();
				const Badges = [...Catalog.pride.filter(Badge => Badge.id === Select.value), ...Community];
				if (Badges.length) Render(Preview, Session.user.uniqueId, Badges);
				else Preview.textContent = 'No profile badges';
			};
			Select.addEventListener('change', Update); Update();
			Status.textContent = ''; Select.disabled = false; Save.disabled = false; Select.focus();
			Form.addEventListener('submit', async Event => {
				Event.preventDefault(); Save.disabled = true; Status.textContent = 'Saving…';
				try {
					const Response = await fetch('/api/v1/profile/badges', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': Session.csrfToken }, body: JSON.stringify({ prideFlag: Select.value }) });
					if (!Response.ok) throw new Error();
					const Updated = await Response.json();
					Cache.set(Session.user.uniqueId, { ...Cache.get(Session.user.uniqueId), at: Date.now(), badges: Updated.kittokBadges });
					for (const [Host, Username] of Targets()) if (Username === Session.user.uniqueId) Render(Host, Username, Updated.kittokBadges);
					Dialog.close(); Schedule();
				} catch { Status.textContent = 'Couldn’t save. Try again.'; Save.disabled = false; }
			});
		} catch { Status.textContent = 'Couldn’t load your badges. Try again.'; }
	}
	function EditorButton() {
		const Existing = document.querySelector('[data-kittok-badge-editor]');
		const Edit = Shown && Handle(location.pathname) === Instance.account?.username && document.querySelector('[data-e2e="edit-profile-entrance"]');
		if (!Edit) { Existing?.remove(); return; }
		const Slot = Edit.parentElement;
		if (Existing?.previousElementSibling === Slot) return;
		Existing?.remove();
		const Item = Slot.cloneNode(true); Item.setAttribute('data-kittok-badge-editor', '');
		const Button = Item.querySelector('button'); Button.setAttribute('data-e2e', 'kittok-badges-entrance'); Button.removeAttribute('aria-expanded'); Button.removeAttribute('aria-haspopup');
		const Text = Button.querySelector('[data-testid="tux-web-text"]');
		if (Text) Text.textContent = 'Profile badges'; else Button.textContent = 'Profile badges';
		Button.addEventListener('click', EditFlag); Slot.after(Item);
	}
	function ChatHeader() {
		const Name = document.querySelector('[data-e2e="dm-new-chat-nickname"]');
		const Username = Name && /^@([a-z0-9_]{3,24})$/i.exec(Name.nextElementSibling?.textContent.trim() ?? '')?.[1].toLowerCase();
		return Name && Username ? [Name, Username] : null;
	}
	function MarkChat(Name, Username) {
		const Mark = Name.querySelector(':scope > [data-kittok-verified]');
		const Want = Checked && Cache.get(Username)?.verified ? Username : null;
		if (Mark?.dataset.kittokVerified === Want) return;
		Mark?.remove();
		if (!Want) return;
		const Span = document.createElement('span'); Span.className = 'KittokVerified'; Span.dataset.kittokVerified = Want; Span.innerHTML = Check;
		Name.append(Span);
	}
	function Targets() {
		const Found = new Map();
		const Subtitle = document.querySelector('[data-e2e="user-subtitle"]');
		const Profile = Handle(location.pathname);
		if (Subtitle && Profile && Subtitle.textContent.trim() === Profile) Found.set(Subtitle.parentElement, Profile);
		for (const Link of document.querySelectorAll('a[href*="/@"]')) {
			const Url = new URL(Link.getAttribute('href'), location.origin);
			const Username = Url.origin === location.origin && Handle(Url.pathname);
			if (!Username || Link.querySelector('img') || Link.closest('[data-kittok-badges]')) continue;
			const Name = Link.querySelector('[data-e2e="following-user-title"] > div, p, h3, [data-e2e*="username"]') ?? (Link.matches('[data-e2e*="username"],[data-e2e*="author"]') ? Link : null);
			if (!Name || !Name.textContent.trim()) continue;
			let Host = Name;
			if (Name !== Link && Name.parentElement !== Link && getComputedStyle(Name.parentElement).display === 'flex') Host = Name.parentElement;
			if (Host.closest('a') !== Link && Host !== Link) continue;
			Found.set(Host, Username);
		}
		return Found;
	}
	function Verified(Host) {
		const Wrapper = Host.closest('a')?.parentElement;
		if (!Wrapper) return null;
		for (let Node = Host; Node; Node = Node.parentElement) {
			if (Node.nextElementSibling?.tagName.toLowerCase() === 'svg') return Node.nextElementSibling;
			if (Node === Wrapper) return null;
		}
		return null;
	}
	function Render(Host, Username, Badges) {
		if (!Shown) Badges = [];
		const Badge = Verified(Host);
		const Inner = [...Host.children].find(Child => Child.hasAttribute('data-kittok-badges'));
		let Row = Badge ? (Badge.nextElementSibling?.hasAttribute('data-kittok-badges') ? Badge.nextElementSibling : null) : Inner;
		if (Badge) Inner?.remove();
		if (!Badges.length) { Row?.remove(); return; }
		const Signature = Username + ':' + Badges.map(Badge => Badge.id).join(',');
		if (Row?.dataset.signature === Signature) { if (!Badge && Row !== Host.lastElementChild) Host.append(Row); return; }
		Row?.remove();
		Row = document.createElement('span'); Row.className = 'KittokBadges'; Row.dataset.kittokBadges = Username; Row.dataset.signature = Signature;
		for (const Badge of Badges) {
			const Image = document.createElement('img'); Image.src = Badge.icon; Image.alt = Badge.label; Image.title = Badge.label;
			Image.className = Badge.type; Image.width = Badge.type === 'pride' ? 22 : 17; Image.height = 16;
			Row.append(Image);
		}
		if (Badge) Badge.after(Row); else Host.append(Row);
	}
	async function Sync() {
		Timer = null;
		if (Running) return;
		EditorButton();
		const Found = Targets(), Missing = new Set();
		const Chat = ChatHeader();
		if (Chat) {
			const Entry = Cache.get(Chat[1]);
			if (Entry) MarkChat(...Chat);
			if (!Entry || Date.now() - Entry.at > 30000) Missing.add(Chat[1]);
		}
		for (const [Host, Username] of Found) {
			for (const Row of Host.querySelectorAll(':scope > [data-kittok-badges]')) if (Row.dataset.kittokBadges !== Username) Row.remove();
			const Entry = Cache.get(Username);
			if (Entry) Render(Host, Username, Entry.badges);
			if (!Entry || Date.now() - Entry.at > 30000) Missing.add(Username);
		}
		if (!Missing.size) return;
		Running = true;
		try {
			const Names = [...Missing];
			for (let Start = 0; Start < Names.length; Start += 50) {
				const Batch = Names.slice(Start, Start + 50);
				const Started = Date.now();
				const Response = await fetch('/_kittok/badges?users=' + encodeURIComponent(Batch.join(',')));
				if (!Response.ok) throw new Error('CouldntLoadBadges');
				const Data = await Response.json();
				for (const Username of Batch) if (!Cache.has(Username) || Cache.get(Username).at <= Started) Cache.set(Username, { at: Date.now(), badges: Object.hasOwn(Data.users, Username) ? Data.users[Username] : [], verified: Data.verified?.includes(Username) ?? false });
			}
			while (Cache.size > 500) Cache.delete(Cache.keys().next().value);
			for (const [Host, Username] of Targets()) if (Cache.has(Username)) Render(Host, Username, Cache.get(Username).badges);
			const Header = ChatHeader();
			if (Header && Cache.has(Header[1])) MarkChat(...Header);
		} catch {
			for (const Username of Missing) Cache.set(Username, { at: Date.now(), badges: Cache.get(Username)?.badges ?? [], verified: Cache.get(Username)?.verified ?? false });
		} finally { Running = false; }
	}
	function Schedule() { if (!Timer && !Running) Timer = setTimeout(Sync, 80); }
	new MutationObserver(Schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
	window.addEventListener('focus', () => { Cache.clear(); Schedule(); });
	setInterval(() => { if (document.visibilityState === 'visible') Schedule(); }, 30000);
	Schedule();
})();
