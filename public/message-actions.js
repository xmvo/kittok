(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	if (!Instance.account) return;
	let MessageId, Scheduled = false;
	const Seen = new WeakMap();
	function Track(Event) {
		const Anchor = Event.target instanceof Element && Event.target.closest('[id^="more-action-icon-msg-"]');
		if (Anchor) MessageId = /^more-action-icon-msg-(\d+)$/.exec(Anchor.id)?.[1];
	}
	for (const Event of ['pointerover', 'pointerdown', 'focusin', 'click']) document.addEventListener(Event, Track, true);
	function Confirm(Id) {
		if (document.querySelector('[data-kittok-unsend-dialog]')) return;
		const Dialog = document.createElement('dialog'); Dialog.className = 'KittokBadgeDialog'; Dialog.setAttribute('data-kittok-unsend-dialog', ''); Dialog.setAttribute('aria-label', 'Delete for everyone');
		const Title = document.createElement('h2'); Title.textContent = 'Delete for everyone?';
		const Text = document.createElement('p'); Text.textContent = 'This message will be removed from the chat for both people. You can do this within 3 minutes of sending.';
		const Status = document.createElement('p'); Status.setAttribute('role', 'status');
		const Actions = document.createElement('div'); Actions.className = 'KittokBadgeButtons';
		const Cancel = document.createElement('button'); Cancel.textContent = 'Cancel'; Cancel.addEventListener('click', () => Dialog.close());
		const Delete = document.createElement('button'); Delete.textContent = 'Delete for everyone';
		Delete.addEventListener('click', async () => {
			Delete.disabled = true; Status.textContent = 'Deleting…';
			try {
				const Response = await fetch('/api/v1/messages/' + Id, { method: 'DELETE', headers: { 'x-csrf-token': Instance.csrfToken } });
				if (!Response.ok) throw new Error();
				Dialog.close();
			} catch { Status.textContent = 'Couldn’t delete. The 3-minute limit may have passed. You can still delete it for yourself.'; Delete.disabled = false; }
		});
		Actions.append(Cancel, Delete); Dialog.append(Title, Text, Status, Actions); Dialog.addEventListener('close', () => Dialog.remove());
		document.body.append(Dialog); Dialog.showModal(); Cancel.focus();
	}
	function Activate(Event) {
		const Item = Event.target instanceof Element && Event.target.closest('[data-kittok-message-action]');
		if (!Item || (Event.type === 'keydown' && !['Enter', ' '].includes(Event.key))) return;
		Event.preventDefault(); Event.stopImmediatePropagation(); Confirm(Item.dataset.kittokMessageAction);
	}
	for (const Event of ['pointerdown', 'click', 'keydown']) document.addEventListener(Event, Activate, true);
	async function Sync() {
		Scheduled = false;
		const Focused = document.activeElement?.closest('[id^="more-action-icon-msg-"]');
		if (Focused) MessageId = /^more-action-icon-msg-(\d+)$/.exec(Focused.id)?.[1] ?? MessageId;
		const Id = MessageId, Menu = document.querySelector('[role="menu"]');
		if (location.pathname !== '/messages' || !Id || !Menu || Seen.get(Menu) === Id) return;
		const Original = [...Menu.querySelectorAll('button,[role="button"]')].find(Button => Button.textContent.trim() === 'Delete');
		if (!Original) return;
		Seen.set(Menu, Id);
		try {
			const Response = await fetch('/api/v1/messages/' + Id + '/actions');
			if (!Response.ok || !(await Response.json()).canUnsend || !Menu.isConnected || MessageId !== Id) return;
			const Item = (Original.closest('[role="menuitem"]') ?? Original.parentElement).cloneNode(true);
			Item.dataset.kittokMessageAction = Id;
			const Button = Item.matches('button,[role="button"]') ? Item : Item.querySelector('button,[role="button"]');
			Button.removeAttribute('id'); Button.removeAttribute('data-e2e');
			const Label = Button.querySelector('.TUXMenuItem-label');
			if (Label) Label.textContent = 'Delete for everyone'; else Button.textContent = 'Delete for everyone';
			(Menu.querySelector('.TUXMenu') ?? Menu).append(Item);
		} catch {}
	}
	new MutationObserver(() => { if (!Scheduled) { Scheduled = true; queueMicrotask(Sync); } }).observe(document.body, { childList: true, subtree: true });
})();
