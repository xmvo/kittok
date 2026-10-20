(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	document.documentElement.style.setProperty('--kittok-name', JSON.stringify(Instance.name ?? 'Kittok'));
	let ShopPromo;
	function ShopPromoText() {
		if (ShopPromo) return ShopPromo;
		try { ShopPromo = JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__').textContent).__DEFAULT_SCOPE__['webapp.i18n-translation'].Webapp.TTSweb_notif_inAppAnnounce_header; } catch {}
		return ShopPromo || 'TikTok Shop is now available on web';
	}
	const AdminIcon = '<svg fill="currentColor" viewBox="0 0 48 48" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M24 3 7 9.5V22c0 11 7.2 20.3 17 23 9.8-2.7 17-12 17-23V9.5L24 3Zm0 4.3 13 5v9.7c0 8.9-5.6 16.6-13 19.1-7.4-2.5-13-10.2-13-19.1v-9.7l13-5Zm7.3 9.3a1 1 0 0 1 1.4 0l1.4 1.4a1 1 0 0 1 0 1.4L22.4 31.1a1 1 0 0 1-1.4 0l-6.1-6.1a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 0l5 5 8.6-10.6Z"/></svg>';
	let UploadSlot;
	const UploadWatch = new MutationObserver(() => SyncAdmin());
	function SyncAdmin() {
		const Upload = document.querySelector('a[data-e2e="nav-upload"]');
		const Existing = document.querySelector('[data-e2e="nav-kittok-admin"]')?.closest('[data-kittok-admin]');
		if (!Upload) { Existing?.remove(); return; }
		const Slot = Upload.parentElement.parentElement;
		if (Slot !== UploadSlot) { UploadSlot = Slot; UploadWatch.disconnect(); UploadWatch.observe(Slot, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] }); }
		let Signature = 0;
		for (const Char of Slot.outerHTML.replace(/ aria-describedby="[^"]*"/g, '')) Signature = (Signature * 31 + Char.charCodeAt(0)) | 0;
		Signature = String(Signature);
		if (Existing?.dataset.kittokAdmin === Signature && Existing.previousElementSibling === Slot) return;
		Existing?.remove();
		const Item = Slot.cloneNode(true);
		Item.dataset.kittokAdmin = Signature;
		const Link = Item.querySelector('a');
		Link.href = '/admin'; Link.setAttribute('data-e2e', 'nav-kittok-admin');
		Item.querySelector('button')?.setAttribute('aria-label', 'Admin');
		const Label = Item.querySelector('.TUXButton-label'); if (Label) Label.textContent = 'Admin';
		const Icon = Item.querySelector('svg');
		if (Icon) Icon.outerHTML = AdminIcon;
		Slot.after(Item);
	}
	const LogoSize = new ResizeObserver(Entries => {
		for (const Entry of Entries) Entry.target.toggleAttribute('data-kittok-compact', Entry.contentRect.width > 0 && Entry.contentRect.width < 80);
	});
	function Brand() {
		if (document.title !== Instance.name) document.title = Instance.name;
		const LoginTitle = document.getElementById('login-modal-title');
		if (LoginTitle?.textContent === 'Log in to TikTok' && LoginTitle.firstChild?.nodeType === 3) LoginTitle.firstChild.nodeValue = `Log in to ${Instance.name}`;
		for (const Logo of document.querySelectorAll('a[data-e2e="tiktok-logo"]')) Logo.setAttribute('aria-label', `Go to ${Instance.name} feed`);
		for (const Channel of document.querySelectorAll('[data-e2e="channel-item"]')) {
			const Google = Channel.querySelector('path[fill="#4285F4"]');
			if (Google) { Channel.setAttribute('data-kittok-google', ''); Channel.setAttribute('aria-label', 'Continue with Google'); }
			if (Google || /^(Continue with |Use QR code)/.test(Channel.textContent.trim())) {
				Channel.setAttribute('data-kittok-unavailable', ''); Channel.setAttribute('aria-disabled', 'true');
				Channel.title = 'This sign-in method is not configured for this instance.';
			}
		}
		if (Instance.account?.role === 'admin') SyncAdmin();
		for (const Logo of document.querySelectorAll('a[data-e2e="tiktok-logo"]:not([data-kittok-sized])')) { Logo.setAttribute('data-kittok-sized', ''); LogoSize.observe(Logo); }
		for (const Item of document.querySelectorAll('[data-e2e="notice-list-item"]')) {
			if (Item.querySelector('[data-e2e="notice-main"]')?.textContent.includes(ShopPromoText())) Item.remove();
		}
		if (document.body && !document.getElementById('kittok-source')) {
			const Source = document.createElement('a'); Source.id = 'kittok-source'; Source.href = '/about'; Source.textContent = 'Kittok · Source'; document.body.append(Source);
		}
	}
	new MutationObserver(Brand).observe(document.documentElement, { childList: true, subtree: true });
	const NativeFetch = window.fetch.bind(window);
	const NativeOpen = XMLHttpRequest.prototype.open;
	function LocalUrl(Value) {
		const Url = new URL(Value, location.origin);
		if (Url.origin === location.origin || ['blob:', 'data:'].includes(Url.protocol)) return Url.href;
		if (Url.hostname === 'www.tiktok.com' && Url.pathname === '/module_meta/common-login/vmok-manifest.json') return location.origin + Url.pathname;
		if (/\/(?:api|passport|node-webapp|tiktok|tns-api|aweme|node)\//.test(Url.pathname)) return location.origin + Url.pathname + Url.search;
		return location.origin + '/_blocked?host=' + encodeURIComponent(Url.hostname);
	}
	window.fetch = (Input, Options) => {
		const IsRequest = Input instanceof Request;
		const Url = LocalUrl(IsRequest ? Input.url : String(Input));
		const RequestHeaders = new Headers(Options?.headers ?? (IsRequest ? Input.headers : undefined));
		if (Instance.csrfToken) RequestHeaders.set('x-csrf-token', Instance.csrfToken);
		return NativeFetch(IsRequest ? new Request(Url, Input) : Url, { ...Options, headers: RequestHeaders });
	};
	XMLHttpRequest.prototype.open = function(Method, Url, ...Args) {
		const Result = NativeOpen.call(this, Method, LocalUrl(String(Url)), ...Args);
		if (Instance.csrfToken) this.setRequestHeader('x-csrf-token', Instance.csrfToken);
		return Result;
	};
	document.addEventListener('click', Event => {
		const Clicked = Event.target instanceof Element ? Event.target : null;
		const Target = Clicked?.closest('a,button,[role="link"]');
		if (!Target) return;
		if (Target.hasAttribute('data-kittok-unavailable')) { Event.preventDefault(); Event.stopImmediatePropagation(); return; }
		if (Instance.account && Target.matches('button[class*="StyledLogoutButton"]') && Target.closest('#login-modal') && Target === Target.parentElement.lastElementChild) {
			Event.preventDefault(); Event.stopImmediatePropagation();
			Target.disabled = true;
			window.fetch('/passport/web/logout/', { method: 'POST' }).then(Response => {
				if (!Response.ok) throw new Error('CouldntLogOut');
				location.href = '/';
			}).catch(() => { Target.disabled = false; Target.textContent = 'Try again'; });
			return;
		}
		const Href = Target.getAttribute('href');
		const Path = Href ? new URL(Href, location.origin).pathname : '';
		if (Path === '/@') { Event.preventDefault(); Event.stopImmediatePropagation(); location.href = Instance.account ? '/@' + Instance.account.username : '/login'; return; }
		if (Target.id === 'header-login-button' || Target.id === 'top-right-action-bar-login-button' || Target.matches('button[class*="SquareTUXButton"][aria-label="Log in"]') || Path === '/login') {
			Event.preventDefault(); Event.stopImmediatePropagation(); location.href = Instance.account ? '/account' : '/login'; return;
		}
		if (Path.startsWith('/tiktokstudio/upload')) {
			Event.preventDefault(); Event.stopImmediatePropagation(); location.href = '/account';
		}
	}, true);
	document.addEventListener('keydown', Event => {
		if ((Event.key === 'Enter' || Event.key === ' ') && Event.target instanceof Element && Event.target.closest('[data-kittok-unavailable]')) { Event.preventDefault(); Event.stopImmediatePropagation(); }
	}, true);
	const Notice = Instance.announcement;
	let Dismissed = null;
	try { Dismissed = localStorage.getItem('kittok-announcement'); } catch {}
	if (Notice?.text && Dismissed !== String(Notice.version)) {
		const Show = () => {
			if (!document.body || document.getElementById('kittok-announcement')) return;
			const Bar = document.createElement('div'); Bar.id = 'kittok-announcement'; Bar.setAttribute('role', 'status');
			const Text = document.createElement('span'); Text.textContent = Notice.text; Bar.append(Text);
			if (Notice.link) { const Link = document.createElement('a'); Link.href = Notice.link; Link.textContent = 'Learn more'; Link.rel = 'noopener'; Bar.append(Link); }
			const Close = document.createElement('button'); Close.type = 'button'; Close.setAttribute('aria-label', 'Close announcement'); Close.textContent = '×';
			Close.addEventListener('click', () => { Bar.remove(); try { localStorage.setItem('kittok-announcement', String(Notice.version)); } catch {} });
			Bar.append(Close); document.body.append(Bar);
		};
		document.body ? Show() : document.addEventListener('DOMContentLoaded', Show);
	}
	const Viewed = new Set();
	document.addEventListener('playing', Event => {
		const Id = Event.target instanceof HTMLVideoElement ? Event.target.closest('[id^="xgwrapper-"]')?.id.match(/-(\d+)$/)?.[1] : null;
		if (!Id || Viewed.has(Id)) return;
		Viewed.add(Id);
		NativeFetch('/_kittok/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: Id }), keepalive: true }).catch(() => {});
	}, true);
	window.addEventListener('securitypolicyviolation', Event => {
		NativeFetch('/_debug/blocked', {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ directive: Event.effectiveDirective, blocked: Event.blockedURI }),
		}).catch(() => {});
	});
})();
