(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	const Me = Instance.account?.username;
	if (!Me) return;
	let Trigger = null;
	document.addEventListener('click', Event => { const Button = Event.target.closest?.('[data-e2e="more-menu-icon"]'); if (Button) Trigger = Button; }, true);
	const PinIcon = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4-1-6Z"/></svg>';
	const GearIcon = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>';
	const GridIcon = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
	function Item(Template, Name, Icon, Label, OnClick) {
		const Node = Template.cloneNode(true);
		Node.setAttribute('data-e2e', `more-menu-popover_kittok-${Name}`); Node.setAttribute('data-kittok-menu', '');
		const Leading = Node.querySelector('.TUXMenuItem-leadingIcon'); if (Leading) Leading.innerHTML = Icon;
		for (const Extra of Node.querySelectorAll('.TUXMenuItem-trailingIcon, [class*="Switch"], input')) Extra.remove();
		const Text = Node.querySelector('.TUXText') ?? Node; Text.textContent = Label;
		Node.addEventListener('click', Event => { Event.preventDefault(); Event.stopPropagation(); OnClick(Node, Text); });
		return Node;
	}
	const Close = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	async function Fill(Popover) {
		Popover.setAttribute('data-kittok-menu-done', '');
		const Id = Trigger?.dataset.moreMenuItemId;
		const Author = /^\/@([^/?#]+)/.exec(Trigger?.closest('article, [data-e2e="detail-video"], main')?.querySelector('a[href^="/@"]')?.getAttribute('href') ?? '')?.[1]?.toLowerCase();
		const Template = Popover.querySelector('[data-e2e="more-menu-popover_mini-player"], .TUXMenuItem:not([data-e2e$="speed-flat"])');
		if (!Id || Author !== Me || !Template) return;
		let Pinned = false;
		try { Pinned = Boolean((await (await fetch(`/api/item/detail/?itemId=${Id}`)).json()).itemInfo?.itemStruct?.isPinnedItem); } catch {}
		const Pin = Item(Template, 'pin', PinIcon, Pinned ? 'Unpin from profile' : 'Pin to profile', async (Node, Text) => {
			try {
				const Response = await fetch(`/api/v1/videos/${Id}/pin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': Instance.csrfToken }, body: JSON.stringify({ pinned: !Pinned }) });
				if (Response.status === 409) { Text.textContent = 'You can pin up to 3 videos'; return; }
				if (!Response.ok) throw new Error('CouldntSave');
				Pinned = !Pinned; Close();
				if (location.pathname === '/@' + Me) location.reload();
			} catch { Text.textContent = 'Couldn’t save. Try again'; }
		});
		const Settings = Item(Template, 'post-settings', GearIcon, 'Post settings', () => { location.href = `/account/posts/${Id}`; });
		const Manage = Item(Template, 'manage-posts', GridIcon, 'Manage posts', () => { location.href = '/account/posts'; });
		Template.parentElement.prepend(Pin, Settings, Manage);
	}
	new MutationObserver(() => { for (const Popover of document.querySelectorAll('[data-e2e="more-menu-popover"]:not([data-kittok-menu-done])')) Fill(Popover); }).observe(document.documentElement, { childList: true, subtree: true });
})();
