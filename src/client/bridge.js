(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	document.documentElement.style.setProperty('--kittok-name', JSON.stringify(Instance.name ?? 'Kittok'));
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
		if (/\/(?:api|passport|node-webapp|tiktok)\//.test(Url.pathname)) return location.origin + Url.pathname + Url.search;
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
	window.addEventListener('securitypolicyviolation', Event => {
		NativeFetch('/_debug/blocked', {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ directive: Event.effectiveDirective, blocked: Event.blockedURI }),
		}).catch(() => {});
	});
})();
