(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	const Icon = Size => `<svg width="${Size}" height="${Size}" viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="24" style="fill:var(--tux-v2-color-ui-shape-neutral-4,rgba(128,128,128,.2))"/><path d="M24 13v16m-7-7 7 7 7-7M15 34h18" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
	let Trigger = null;
	for (const Event of ['pointerover', 'pointerdown', 'focusin', 'click']) document.addEventListener(Event, Entry => {
		const Button = Entry.target instanceof Element && Entry.target.closest('[data-e2e="share-btn"], [data-e2e="feed-share-group"], [data-e2e="browse-share-group"]');
		if (Button) Trigger = Button;
	}, true);
	const VideoId = Panel => {
		const Detail = /\/video\/(\d+)/.exec(location.pathname)?.[1];
		const Scope = Panel.closest('article, [data-e2e="recommend-list-item-container"]') ?? Trigger?.closest('article, [data-e2e="recommend-list-item-container"], [data-e2e="detail-video"], main');
		const Player = Scope?.querySelector('[id^="xgwrapper-"]')?.id.split('-').at(-1);
		const Link = /\/video\/(\d+)/.exec(Scope?.querySelector('a[href*="/video/"]')?.getAttribute('href') ?? '')?.[1];
		return [Detail, Player, Link].find(Value => /^\d+$/.test(Value ?? ''));
	};
	async function Downloadable(Panel) {
		const Id = VideoId(Panel);
		if (!Id) return null;
		try {
			const Item = (await (await fetch(`/api/item/detail/?itemId=${Id}`)).json()).itemInfo?.itemStruct;
			const Mine = Item?.author?.uniqueId === Instance.account?.username;
			return Item?.video?.downloadAddr && (Mine || (!Item.authorPrivate && Item.downloadSetting === 0)) ? Item : null;
		} catch { return null; }
	}
	async function Save(Address, Label) {
		const Previous = Label?.textContent;
		if (Label) Label.textContent = 'Downloading…';
		try {
			const Response = await fetch(Address, { credentials: 'include' });
			if (!Response.ok) throw new Error('DownloadFailed');
			const Link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await Response.blob()), download: 'Download' });
			document.body.append(Link); Link.click();
			setTimeout(() => { URL.revokeObjectURL(Link.href); Link.remove(); }, 0);
			if (Label) Label.textContent = Previous;
		} catch { if (Label) Label.textContent = 'Couldn’t download'; }
	}
	const PanelOf = Link => { let Node = Link.parentElement; while (Node && Node.querySelectorAll('a[data-e2e^="video-share-"]').length < 2) Node = Node.parentElement; return Node; };
	const UnitOf = (Panel, Link) => [...Panel.children].find(Child => Child.contains(Link));
	async function Add(Panel) {
		Panel.setAttribute('data-kittok-download', '');
		const Item = await Downloadable(Panel);
		if (!Item) return;
		const Copy = Panel.querySelector('a[data-e2e="video-share-copy"]') ?? Panel.querySelector('a[data-e2e^="video-share-"]');
		const Unit = UnitOf(Panel, Copy)?.cloneNode(true);
		const Node = Unit?.matches('a') ? Unit : Unit?.querySelector('a[data-e2e^="video-share-"]');
		if (!Node) return;
		Node.id = 'icon-element-kittok-download'; Node.setAttribute('data-e2e', 'video-share-kittok-download'); Node.setAttribute('aria-label', 'Download video');
		Node.href = '#'; Node.removeAttribute('target'); Node.removeAttribute('rel');
		const Svg = Node.querySelector('svg'), Size = Svg?.getAttribute('width') ?? '24';
		if (Svg) Svg.outerHTML = Icon(Size);
		const Label = [...Node.children].find(Child => Child.tagName.toLowerCase() !== 'svg' && Child.textContent.trim());
		if (Label) Label.textContent = 'Download video';
		Node.addEventListener('click', Event => { Event.preventDefault(); Event.stopPropagation(); Save(Item.video.downloadAddr, Label); });
		Node.addEventListener('keydown', Event => { if (Event.key === 'Enter' || Event.key === ' ') { Event.preventDefault(); Event.stopPropagation(); Save(Item.video.downloadAddr, Label); } });
		UnitOf(Panel, Copy).after(Unit);
	}
	async function AddRow(Copy) {
		let Row = Copy.parentElement;
		while (Row && getComputedStyle(Row).overflowX !== 'auto') Row = Row.parentElement;
		if (!Row || Row.nextElementSibling?.hasAttribute('data-kittok-download-row')) return;
		const Holder = document.createElement('div'); Holder.setAttribute('data-kittok-download-row', ''); Holder.className = 'KittokDownloadRow';
		Row.after(Holder);
		const Item = await Downloadable(Row);
		if (!Item) { Holder.remove(); return; }
		const Node = Copy.cloneNode(true);
		Node.setAttribute('data-e2e', 'share-kittok-download');
		const Glyph = Node.querySelector('[tabindex]')?.firstElementChild, Label = Node.querySelector('p');
		if (Glyph) Glyph.innerHTML = Icon(Math.round(Copy.querySelector('svg, img')?.getBoundingClientRect().width || 48));
		if (Label) Label.textContent = 'Download video';
		const Start = Event => { Event.preventDefault(); Event.stopPropagation(); Save(Item.video.downloadAddr, Label); };
		Node.addEventListener('click', Start);
		Node.addEventListener('keydown', Event => { if (Event.key === 'Enter' || Event.key === ' ') Start(Event); });
		Holder.append(Node);
	}
	function Sync() {
		for (const Link of document.querySelectorAll('a[data-e2e^="video-share-"]:not([data-e2e="video-share-kittok-download"])')) {
			const Panel = PanelOf(Link);
			if (Panel && !Panel.hasAttribute('data-kittok-download')) Add(Panel);
		}
		for (const Copy of document.querySelectorAll('[data-e2e="share-copy"]')) AddRow(Copy);
	}
	let Scheduled = false;
	new MutationObserver(() => { if (!Scheduled) { Scheduled = true; requestAnimationFrame(() => { Scheduled = false; Sync(); }); } }).observe(document.documentElement, { childList: true, subtree: true });
})();
