(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	const Cache = new Map();
	const Shown = Instance.misc?.profileBadges !== false, Checked = Instance.misc?.verifiedBadges !== false, Decorated = Instance.misc?.avatarDecorations !== false;
	const Names = window.KittokNames, Styled = Boolean(Names) && Instance.misc?.nameStyles !== false, Plated = Boolean(Names) && Instance.misc?.nameplates !== false;
	const Blank = { badges: [], verified: false, decoration: null, style: null, plate: null };
	const Check = '<svg viewBox="0 0 48 48" width="1em" height="1em" aria-label="Verified" role="img"><path d="M0 24a24 24 0 1 1 48 0 24 24 0 0 1-48 0Z" fill="#20D5EC"/><path fill-rule="evenodd" clip-rule="evenodd" d="M37.12 15.88a3 3 0 0 1 0 4.24l-13.5 13.5a3 3 0 0 1-4.24 0l-8.5-8.5a3 3 0 1 1 4.24-4.24l6.38 6.38 11.38-11.38a3 3 0 0 1 4.24 0Z" fill="#fff"/></svg>';
	let Timer, Running = false;
	const Handle = Value => /^\/@([a-z0-9_]{3,24})\/?$/i.exec(Value)?.[1].toLowerCase();
	let Flags;
	const FlagIcon = Flag => {
		const Icon = document.createElement(Flag.icon ? 'img' : 'span'); Icon.className = 'KittokFlagIcon'; Icon.setAttribute('aria-hidden', 'true');
		if (Flag.icon) { Icon.src = Flag.icon; Icon.alt = ''; }
		return Icon;
	};
	async function FlagRow() {
		const Modal = Shown && Instance.account && document.querySelector('[data-e2e="edit-profile-popup"]');
		const Name = Modal?.querySelector('[data-e2e="edit-profile-name"]')?.parentElement;
		if (!Name || Modal.querySelector('[data-kittok-flag-row]')) return;
		const Row = document.createElement('div'); Row.className = Name.className; Row.setAttribute('data-kittok-flag-row', '');
		const Label = document.createElement('div'); Label.className = Name.children[0].className; Label.textContent = 'Pride flag'; Label.id = 'kittok-pride-flag-label';
		const Area = document.createElement('div'); Area.className = Name.children[1]?.className ?? '';
		const Picker = document.createElement('div'); Picker.className = 'KittokFlagPicker';
		const Button = document.createElement('button'); Button.type = 'button'; Button.className = (Name.querySelector('input')?.className ?? '') + ' KittokFlagButton'; Button.disabled = true;
		Button.setAttribute('aria-haspopup', 'listbox'); Button.setAttribute('aria-expanded', 'false'); Button.setAttribute('aria-labelledby', 'kittok-pride-flag-label kittok-pride-flag-value');
		const Value = document.createElement('span'); Value.id = 'kittok-pride-flag-value'; Value.className = 'KittokFlagValue';
		Button.innerHTML = '<svg class="KittokFlagCaret" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>'; Button.prepend(Value);
		const List = document.createElement('ul'); List.className = 'KittokFlagList'; List.setAttribute('role', 'listbox'); List.setAttribute('aria-labelledby', 'kittok-pride-flag-label'); List.tabIndex = -1; List.hidden = true;
		const Tip = document.createElement('p'); Tip.className = Name.querySelector('p')?.className ?? ''; Tip.setAttribute('role', 'status'); Tip.textContent = 'Optional. Shown beside your name.';
		Picker.append(Button, List); Area.append(Picker, Tip); Row.append(Label, Area);
		Name.after(Row);
		try {
			Flags ??= fetch('/_kittok/badges/catalog').then(Response => { if (!Response.ok) throw new Error('CouldntLoad'); return Response.json(); }).catch(Error => { Flags = null; throw Error; });
			const [Catalog, Session] = await Promise.all([Flags, fetch('/api/v1/session').then(Response => Response.json())]);
			if (!Session.user) throw new Error('NotLoggedIn');
			const Choices = [{ id: '', label: 'None' }, ...Catalog.pride];
			let Current = Session.user.prideFlag, Active = 0;
			const Options = Choices.map((Flag, Index) => {
				const Option = document.createElement('li'); Option.id = 'kittok-pride-flag-' + (Flag.id || 'none'); Option.setAttribute('role', 'option'); Option.dataset.id = Flag.id;
				const Text = document.createElement('span'); Text.textContent = Flag.label;
				Option.append(FlagIcon(Flag), Text);
				Option.addEventListener('pointerdown', Event => Event.preventDefault());
				Option.addEventListener('click', () => Choose(Index));
				List.append(Option);
				return Option;
			});
			const Show = () => {
				const Flag = Choices.find(Choice => Choice.id === Current) ?? Choices[0];
				Value.replaceChildren(FlagIcon(Flag), Object.assign(document.createElement('span'), { textContent: Flag.label }));
				for (const Option of Options) Option.setAttribute('aria-selected', String(Option.dataset.id === Current));
			};
			const Highlight = Index => {
				Active = (Index + Options.length) % Options.length;
				for (const [Position, Option] of Options.entries()) Option.classList.toggle('Active', Position === Active);
				List.setAttribute('aria-activedescendant', Options[Active].id); Options[Active].scrollIntoView({ block: 'nearest' });
			};
			const Toggle = Open => {
				List.hidden = !Open; Button.setAttribute('aria-expanded', String(Open));
				if (Open) {
					const Bounds = (Picker.closest('[class*="DivContentContainer"]') ?? document.documentElement).getBoundingClientRect(), Box = Button.getBoundingClientRect();
					List.classList.toggle('Up', Bounds.bottom - Box.bottom < Math.min(260, List.scrollHeight) + 8 && Box.top - Bounds.top > Bounds.bottom - Box.bottom);
					Highlight(Math.max(0, Choices.findIndex(Choice => Choice.id === Current))); List.focus();
				}
			};
			async function Choose(Index) {
				Toggle(false); Button.focus();
				const Previous = Current; Current = Choices[Index].id; Show();
				if (Current === Previous) return;
				Button.disabled = true; Tip.textContent = 'Saving';
				try {
					const Response = await fetch('/api/v1/profile/badges', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': Session.csrfToken }, body: JSON.stringify({ prideFlag: Current }) });
					if (!Response.ok) throw new Error('CouldntSave');
					const Updated = await Response.json();
					Cache.set(Session.user.uniqueId, { ...(Cache.get(Session.user.uniqueId) ?? Blank), at: Date.now(), badges: Updated.kittokBadges });
					for (const [Host, Username] of Targets()) if (Username === Session.user.uniqueId) Render(Host, Username, Updated.kittokBadges);
					Tip.textContent = 'Saved';
				} catch { Current = Previous; Show(); Tip.textContent = 'CouldntSave'; }
				Button.disabled = false;
				if (document.activeElement === document.body) Button.focus();
			}
			Button.addEventListener('click', () => Toggle(List.hidden));
			Button.addEventListener('keydown', Event => { if (Event.key === 'ArrowDown' || Event.key === 'ArrowUp') { Event.preventDefault(); Toggle(true); } });
			List.addEventListener('keydown', Event => {
				const Keys = { ArrowDown: () => Highlight(Active + 1), ArrowUp: () => Highlight(Active - 1), Home: () => Highlight(0), End: () => Highlight(Options.length - 1), Enter: () => Choose(Active), ' ': () => Choose(Active), Escape: () => { Toggle(false); Button.focus(); }, Tab: () => Toggle(false) };
				if (!Keys[Event.key]) return;
				if (Event.key !== 'Tab') { Event.preventDefault(); Event.stopPropagation(); }
				Keys[Event.key]();
			});
			List.addEventListener('focusout', Event => { if (!Picker.contains(Event.relatedTarget)) Toggle(false); });
			Show(); Button.disabled = false;
		} catch { Tip.textContent = 'CouldntLoad'; }
	}
	function AvatarOwner(Span) {
		if (Span.closest('[data-e2e="edit-profile-avatar"], .KittokDecorationPreview')) return Instance.account?.username;
		const Link = Span.closest('a[href*="/@"]');
		const Url = Link && new URL(Link.getAttribute('href'), location.origin);
		if (Url) return Url.origin === location.origin ? Handle(Url.pathname) : undefined;
		if (Span.closest('[data-e2e="user-avatar"]')) return Handle(location.pathname);
	}
	function Avatars() {
		const Found = new Map();
		if (!Decorated) return Found;
		for (const Image of document.querySelectorAll('[data-e2e="user-avatar"] img, [data-e2e="edit-profile-avatar"] img, a[href*="/@"] img')) {
			if (Image.classList.contains('KittokDecoration') || Image.offsetWidth < 20) continue;
			let Span = Image, Round = false;
			for (let Depth = 0; Span && Depth < 4; Depth++, Span = Span.parentElement) {
				if (Span !== Image && Span.offsetWidth > Image.offsetWidth + 2) break;
				const Style = getComputedStyle(Span);
				const Radius = parseFloat(Style.borderRadius);
				if (Style.overflow !== 'visible' && (Style.borderRadius.endsWith('%') ? Radius >= 50 : Radius >= Span.offsetWidth / 2 - 1)) { Round = true; break; }
			}
			if (!Round) continue;
			while (Span?.parentElement && Span.parentElement.offsetWidth === Span.offsetWidth && getComputedStyle(Span.parentElement).overflow !== 'visible') Span = Span.parentElement;
			const Username = Span && Span.tagName !== 'A' && AvatarOwner(Span);
			if (Username) Found.set(Span, Username);
		}
		return Found;
	}
	const Watched = new WeakMap();
	const Resized = new ResizeObserver(Entries => { for (const Entry of Entries) { const Span = Watched.get(Entry.target); if (Span?.isConnected) Place(Span); } });
	function Place(Span) {
		const Frame = Span.nextElementSibling, Host = Span.parentElement;
		if (!Frame?.classList.contains('KittokDecoration') || !Host) return;
		const Face = Span.tagName === 'IMG' ? Span : Span.querySelector('img') ?? Span;
		const Outer = Host.getBoundingClientRect(), Inner = Face.getBoundingClientRect();
		const Scale = Outer.width / (Host.offsetWidth || 1) || 1, Size = Face.offsetWidth;
		const Values = { width: Size * 1.2, height: Size * 1.2, left: (Inner.left - Outer.left) / Scale - Host.clientLeft - Size * 0.1, top: (Inner.top - Outer.top) / Scale - Host.clientTop - Size * 0.1 };
		for (const [Property, Pixels] of Object.entries(Values)) Frame.style.setProperty(Property, Pixels + 'px', 'important');
	}
	function Decorate(Span, Decoration) {
		const Host = Span.parentElement;
		let Frame = Span.nextElementSibling?.classList.contains('KittokDecoration') ? Span.nextElementSibling : null;
		if (!Decoration) { Frame?.remove(); return; }
		if (!Frame) {
			Frame = document.createElement('img'); Frame.className = 'KittokDecoration'; Frame.alt = ''; Frame.setAttribute('aria-hidden', 'true');
			Span.after(Frame);
		}
		if (Frame.getAttribute('src') !== Decoration.image) Frame.src = Decoration.image;
		if (getComputedStyle(Host).position === 'static') Host.style.position = 'relative';
		const Face = Span.tagName === 'IMG' ? Span : Span.querySelector('img') ?? Span;
		if (!Watched.has(Face)) { Watched.set(Face, Span); Resized.observe(Face); }
		Place(Span);
	}
	function PaintAvatars(Found = Avatars()) {
		for (const [Span, Username] of Found) if (Cache.has(Username)) Decorate(Span, Cache.get(Username).decoration);
	}
	async function EditDecoration(Modal) {
		if (Modal.querySelector('.KittokDecorationPanel')) return;
		const Own = Instance.account?.username;
		const Panel = document.createElement('div'); Panel.className = 'KittokDecorationPanel'; Panel.setAttribute('role', 'group'); Panel.setAttribute('aria-label', 'Edit avatar');
		const Header = document.createElement('div'); Header.className = 'KittokDecorationHeader';
		const Back = document.createElement('button'); Back.type = 'button'; Back.setAttribute('aria-label', 'Back'); Back.innerHTML = '<svg width="24" height="24" viewBox="0 0 48 48" fill="currentColor"><path d="M14.04 24 30.3 7.74a1 1 0 0 0 0-1.41l-1.42-1.42a1 1 0 0 0-1.41 0L9.8 22.59a2 2 0 0 0 0 2.82l17.67 17.68a1 1 0 0 0 1.41 0l1.42-1.42a1 1 0 0 0 0-1.41L14.04 24Z"/></svg>';
		const Title = document.createElement('h1'); Title.textContent = 'Edit avatar';
		Header.append(Back, Title);
		const Body = document.createElement('div'); Body.className = 'KittokDecorationBody';
		const Top = document.createElement('div'); Top.className = 'KittokDecorationTop';
		const Preview = document.createElement('div'); Preview.className = 'KittokDecorationPreview';
		const Photo = document.createElement('span'); Photo.className = 'KittokDecorationPhoto';
		const Current = Modal.querySelector('[data-e2e="edit-profile-avatar"] img');
		if (Current) { const Image = document.createElement('img'); Image.src = Current.src; Image.alt = ''; Photo.append(Image); }
		const Frame = document.createElement('img'); Frame.className = 'KittokDecorationFrame'; Frame.alt = ''; Frame.hidden = true;
		Preview.append(Photo, Frame);
		const Side = document.createElement('div'); Side.className = 'KittokDecorationSide';
		const Chosen = document.createElement('p'); Chosen.className = 'KittokDecorationName';
		const Change = document.createElement('button'); Change.type = 'button'; Change.className = 'KittokDecorationChange'; Change.textContent = 'Change photo';
		const Search = document.createElement('input'); Search.type = 'search'; Search.placeholder = 'Search decorations'; Search.setAttribute('aria-label', 'Search decorations'); Search.disabled = true;
		Side.append(Chosen, Change, Search); Top.append(Preview, Side);
		const List = document.createElement('div'); List.className = 'KittokDecorationList';
		const Status = document.createElement('p'); Status.className = 'KittokDecorationStatus'; Status.setAttribute('role', 'status'); Status.textContent = 'Loading';
		Body.append(Top, Status, List);
		const Footer = document.createElement('div'); Footer.className = 'KittokDecorationFooter';
		const Cancel = document.createElement('button'); Cancel.type = 'button'; Cancel.textContent = 'Cancel';
		const Apply = document.createElement('button'); Apply.type = 'button'; Apply.className = 'Primary'; Apply.textContent = 'Apply'; Apply.disabled = true;
		Footer.append(Cancel, Apply);
		Panel.append(Header, Body, Footer); Modal.append(Panel);
		const Close = () => Panel.remove();
		Back.addEventListener('click', Close); Cancel.addEventListener('click', Close);
		Panel.addEventListener('keydown', Event => { if (Event.key === 'Escape') { Event.stopPropagation(); Close(); } });
		Change.addEventListener('click', () => { Close(); Modal.querySelector('[data-e2e="edit-profile-avatar-edit-icon"] input[type="file"]')?.click(); });
		Back.focus();
		let Selected = null, Items = [];
		const Show = Decoration => {
			Selected = Decoration;
			Frame.hidden = !Decoration; if (Decoration) Frame.src = Decoration.image;
			Chosen.textContent = Decoration ? Decoration.name : 'No decoration';
			for (const Button of List.querySelectorAll('button')) Button.setAttribute('aria-pressed', String((Button.dataset.id || null) === (Decoration?.id ?? null)));
		};
		try {
			const [CatalogResponse, LookupResponse] = await Promise.all([fetch('/_kittok/decorations/catalog'), fetch('/_kittok/badges?users=' + encodeURIComponent(Own))]);
			if (!CatalogResponse.ok || !LookupResponse.ok) throw new Error('CouldntLoadDecorations');
			const Catalog = await CatalogResponse.json(), Lookup = await LookupResponse.json();
			const Tile = Decoration => {
				const Button = document.createElement('button'); Button.type = 'button'; Button.dataset.id = Decoration?.id ?? ''; Button.title = Decoration?.name ?? 'None';
				Button.setAttribute('aria-label', Decoration ? `${Decoration.name}. ${Decoration.label}` : 'No decoration');
				if (Decoration) {
					const Image = document.createElement('img'); Image.src = Decoration.still; Image.alt = ''; Image.loading = 'lazy'; Image.decoding = 'async';
					Button.addEventListener('pointerenter', () => { Image.src = Decoration.image; });
					Button.addEventListener('pointerleave', () => { Image.src = Decoration.still; });
					Button.append(Image);
				} else Button.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>';
				Button.addEventListener('click', () => Show(Decoration));
				return Button;
			};
			const None = document.createElement('section'); const NoneGrid = document.createElement('div'); NoneGrid.className = 'KittokDecorationGrid'; NoneGrid.append(Tile(null)); None.append(NoneGrid); List.append(None);
			for (const Collection of Catalog.collections) {
				const Section = document.createElement('section');
				const Heading = document.createElement('h2'); Heading.textContent = Collection.name;
				const Grid = document.createElement('div'); Grid.className = 'KittokDecorationGrid';
				for (const Decoration of Collection.items) { const Button = Tile(Decoration); Grid.append(Button); Items.push([Button, Decoration, Collection.name.toLowerCase()]); }
				Section.append(Heading, Grid); List.append(Section);
			}
			Search.addEventListener('input', () => {
				const Query = Search.value.trim().toLowerCase();
				for (const [Button, Decoration, Collection] of Items) Button.hidden = Boolean(Query) && !`${Decoration.name} ${Decoration.label} ${Collection}`.toLowerCase().includes(Query);
				for (const Section of List.querySelectorAll('section')) Section.hidden = Boolean(Query) && ![...Section.querySelectorAll('button')].some(Button => !Button.hidden && Button.dataset.id);
				Status.textContent = Query && !Items.some(([Button]) => !Button.hidden) ? 'NoResults' : '';
			});
			Show(Lookup.decorations?.[Own] ?? null);
			Status.textContent = ''; Search.disabled = false; Apply.disabled = false;
			Apply.addEventListener('click', async () => {
				Apply.disabled = true; Status.textContent = 'Saving';
				try {
					const Response = await fetch('/api/v1/profile/decoration', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': Instance.csrfToken }, body: JSON.stringify({ decoration: Selected?.id ?? '' }) });
					if (!Response.ok) throw new Error('CouldntSave');
					const Updated = await Response.json();
					Cache.set(Own, { ...(Cache.get(Own) ?? Blank), at: Date.now(), decoration: Updated.decoration });
					PaintAvatars(); Close();
				} catch { Status.textContent = 'CouldntSave'; Apply.disabled = false; }
			});
		} catch { Status.textContent = 'CouldntLoad'; }
	}
	document.addEventListener('click', Event => {
		if (!Decorated || !Instance.account || Event.target.matches?.('input[type="file"]')) return;
		const Avatar = Event.target.closest?.('[data-e2e="edit-profile-avatar"]');
		const Modal = Avatar?.closest('[data-e2e="edit-profile-popup"]');
		if (!Modal) return;
		Event.preventDefault(); Event.stopPropagation();
		EditDecoration(Modal);
	}, true);
	document.addEventListener('keydown', Event => {
		if (!Decorated || (Event.key !== 'Enter' && Event.key !== ' ') || !Event.target.matches?.('[data-e2e="edit-profile-avatar-edit-icon"]')) return;
		const Modal = Event.target.closest('[data-e2e="edit-profile-popup"]');
		if (Modal) { Event.preventDefault(); Event.stopPropagation(); EditDecoration(Modal); }
	}, true);
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
	let Partners = {}, PartnersAt = 0;
	const Partner = Item => {
		const Key = Item.dataset.convId ?? '';
		if (!/^0:1:/.test(Key)) return null;
		if (!Object.hasOwn(Partners, Key) && Date.now() - PartnersAt > 10000) {
			PartnersAt = Date.now();
			fetch('/_kittok/dm-partners').then(Response => Response.ok ? Response.json() : null).then(Data => { if (Data) { Partners = Data.partners; Schedule(); } }).catch(() => {});
		}
		return Partners[Key] ?? null;
	};
	const Texty = Node => !Node.closest('[data-kittok-badges], .KittokGummy, .KittokVerified, .KittokDecorationPanel, svg') && [...Node.childNodes].some(Child => Child.nodeType === Node.TEXT_NODE && Child.nodeValue.trim());
	const Within = (Root, Username, Live = false) => [Root, ...Root.querySelectorAll('*')].filter(Texty).map(Node => [Node, Username, Live]);
	function Labels() {
		const Found = [];
		if (!Styled) return Found;
		for (const Link of document.querySelectorAll('a[href*="/@"]')) {
			const Url = new URL(Link.getAttribute('href'), location.origin);
			const Username = Url.origin === location.origin && Handle(Url.pathname);
			if (Username) Found.push(...Within(Link, Username));
		}
		const Title = document.querySelector('[data-e2e="user-title"]'), Profile = Handle(location.pathname);
		if (Title && Profile) Found.push(...Within(Title, Profile, true));
		const Chat = ChatHeader();
		if (Chat) Found.push(...Within(Chat[0], Chat[1]));
		for (const Item of document.querySelectorAll('[data-e2e="dm-new-conversation-item"]')) {
			const Username = Partner(Item), Nickname = Item.querySelector('[data-e2e="dm-new-conversation-nickname"]');
			if (Username && Nickname) Found.push(...Within(Nickname, Username));
		}
		return Found;
	}
	function Plates() {
		const Found = [];
		if (!Plated) return Found;
		for (const Label of document.querySelectorAll('[data-e2e^="comment-username-"]')) {
			const Href = (Label.closest('a[href*="/@"]') ?? Label.querySelector('a[href*="/@"]'))?.getAttribute('href') ?? '', Username = Handle(Href);
			let Row = Label.parentElement;
			while (Username && Row && Row !== document.body && !Row.querySelector(`a[href="${CSS.escape(Href)}"] img`)) Row = Row.parentElement;
			if (Username && Row && Row !== document.body) Found.push([Row, Username, 'Comment']);
		}
		for (const Item of document.querySelectorAll('[data-e2e="dm-new-conversation-item"]')) { const Username = Partner(Item); if (Username) Found.push([Item, Username, 'Chat']); }
		return Found;
	}
	const Plain = '[data-e2e*="subtitle"], [data-e2e*="uniqueid" i], [data-e2e*="unique-id"]';
	function PaintNames(Found = Labels(), Rows = Plates()) {
		for (const [Node, Username, Live] of Found) {
			const Style = Cache.get(Username)?.style;
			if (!Cache.has(Username)) continue;
			const Text = [...Node.childNodes].filter(Child => Child.nodeType === Node.TEXT_NODE).map(Child => Child.nodeValue).join('').trim();
			Names.Name(Node, Style && Text === (Style.name || Username) && !Node.closest(Plain) ? Style : null, Live);
		}
		for (const [Row, Username, Kind] of Rows) if (Cache.has(Username)) Names.Plate(Row, Cache.get(Username).plate, Kind);
	}
	function NameRows() {
		const Modal = (Styled || Plated) && Instance.account && document.querySelector('[data-e2e="edit-profile-popup"]');
		const Name = Modal?.querySelector('[data-e2e="edit-profile-name"]')?.parentElement;
		if (!Name || Modal.querySelector('[data-kittok-name-row]')) return;
		const Own = Instance.account.username;
		const Fresh = async () => {
			if (Date.now() - (Cache.get(Own)?.at ?? 0) > 5000) {
				const Data = await (await fetch('/_kittok/badges?users=' + encodeURIComponent(Own))).json();
				Cache.set(Own, { ...(Cache.get(Own) ?? Blank), at: Date.now(), style: Data.styles?.[Own] ?? null, plate: Data.nameplates?.[Own] ?? null });
			}
			return Cache.get(Own);
		};
		const Rows = [];
		const Row = (Title, Open) => {
			const Line = document.createElement('div'); Line.className = Name.className; Line.setAttribute('data-kittok-name-row', '');
			const Label = document.createElement('div'); Label.className = Name.children[0].className; Label.textContent = Title;
			const Area = document.createElement('div'); Area.className = Name.children[1]?.className ?? '';
			const Button = document.createElement('button'); Button.type = 'button'; Button.className = (Name.querySelector('input')?.className ?? '') + ' KittokNamesRowButton'; Button.setAttribute('aria-label', Title);
			const Text = document.createElement('span'); Text.className = 'KittokNamesRowName';
			Button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="flex:none;opacity:.7"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>'; Button.prepend(Text);
			Button.addEventListener('click', async () => { try { Open(await Fresh()); } catch { Text.textContent = 'CouldntLoad'; } });
			Area.append(Button); Line.append(Label, Area); Rows.push(Line);
			return [Button, Text];
		};
		const Saved = Change => { Cache.set(Own, { ...(Cache.get(Own) ?? Blank), at: Date.now(), ...Change }); Show(); Schedule(); };
		const Style = Styled && Row('Name style', Entry => Names.EditStyle(Modal, Entry.style, Entry.plate, Value => Saved({ style: Value })));
		const Plate = Plated && Row('Nameplate', Entry => Names.EditPlate(Modal, Entry.plate, Entry.style, Value => Saved({ plate: Value })));
		function Show() {
			const Entry = Cache.get(Own) ?? Blank, Shown = Instance.account.displayName || Own;
			if (Style) { Style[1].textContent = Shown; Names.Name(Style[1], Entry.style, true); }
			if (Plate) { Plate[1].textContent = Entry.plate?.name ?? 'None'; Names.Plate(Plate[0], Entry.plate, 'Row'); }
		}
		Name.after(...Rows);
		Show();
		Fresh().then(Show).catch(() => {});
	}
	async function Sync() {
		Timer = null;
		if (Running) return;
		FlagRow(); NameRows();
		const Found = Targets(), Faces = Avatars(), Missing = new Set();
		const Named = Labels(), Rows = Plates();
		PaintNames(Named, Rows);
		for (const [, Username] of [...Named, ...Rows]) { const Entry = Cache.get(Username); if (!Entry || Date.now() - Entry.at > 30000) Missing.add(Username); }
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
		for (const [Span, Username] of Faces) {
			const Entry = Cache.get(Username);
			if (Entry) Decorate(Span, Entry.decoration);
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
				for (const Username of Batch) if (!Cache.has(Username) || Cache.get(Username).at <= Started) Cache.set(Username, { at: Date.now(), badges: Object.hasOwn(Data.users, Username) ? Data.users[Username] : [], verified: Data.verified?.includes(Username) ?? false, decoration: Data.decorations?.[Username] ?? null, style: Data.styles?.[Username] ?? null, plate: Data.nameplates?.[Username] ?? null });
			}
			while (Cache.size > 500) Cache.delete(Cache.keys().next().value);
			for (const [Host, Username] of Targets()) if (Cache.has(Username)) Render(Host, Username, Cache.get(Username).badges);
			PaintAvatars();
			if (Names) PaintNames();
			const Header = ChatHeader();
			if (Header && Cache.has(Header[1])) MarkChat(...Header);
		} catch {
			for (const Username of Missing) Cache.set(Username, { ...Blank, ...Cache.get(Username), at: Date.now() });
		} finally { Running = false; }
	}
	function Schedule() { if (!Timer && !Running) Timer = setTimeout(Sync, 80); }
	new MutationObserver(Schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
	window.addEventListener('focus', () => { Cache.clear(); Schedule(); });
	window.addEventListener('resize', () => PaintAvatars());
	setInterval(() => { if (document.visibilityState === 'visible') Schedule(); }, 30000);
	Schedule();
})();
