(() => {
	const Boot = JSON.parse(document.getElementById('kittok-admin-boot').textContent);
	const Root = document.createElement('div'); Root.id = 'kittok-admin';
	const Layer = document.createElement('div'); Layer.id = 'kittok-admin-layer';
	const IsAdminPath = () => /^\/admin(?:\/|$)/.test(location.pathname);

	const Policies = [
		['spam', 'Spam', 'spam'], ['harassment', 'Harassment', 'harassment and bullying'], ['hate', 'Hate', 'hateful behavior'], ['nudity', 'Nudity', 'nudity and sexual content'],
		['violence', 'Violence', 'violent and graphic content'], ['self_harm', 'Self-harm', 'suicide and self-harm'], ['misinformation', 'Misinformation', 'misinformation'],
		['impersonation', 'Impersonation', 'impersonation'], ['copyright', 'IP', 'intellectual property'], ['other', 'Other', 'our Community Guidelines'],
	];
	const PolicyLabel = Key => Policies.find(Entry => Entry[0] === Key)?.[1] ?? Key;
	const PolicyPhrase = Key => Policies.find(Entry => Entry[0] === Key)?.[2] ?? 'our Community Guidelines';
	const Features = [['upload', 'Posting videos', 'posting videos'], ['comment', 'Commenting', 'commenting'], ['message', 'Direct messages', 'sending messages'], ['live', 'Going LIVE', 'going LIVE'], ['follow', 'Following', 'following accounts'], ['profile', 'Editing profile', 'editing your profile']];
	const FeatureLabel = Key => Features.find(Entry => Entry[0] === Key)?.[1] ?? Key;
	const Durations = [[1, '1 hour'], [24, '24 hours'], [48, '48 hours'], [72, '3 days'], [168, '7 days'], [720, '30 days'], [null, 'Until lifted']];
	const Areas = { video: 'Videos', comment: 'Comments', message: 'Direct messages', profile: 'Profile', live: 'LIVE' };
	const TargetFeature = { video: 'video', comment: 'comment', user: 'profile', message: 'message' };
	const TargetNoun = { video: 'video', comment: 'comment', user: 'account', message: 'message' };
	const Templates = {
		spam: ['Repeated promotional posting', 'Scam or fake giveaway', 'Engagement bait'], harassment: ['Insulting a private individual', 'Targeted bullying', 'Encouraging pile-ons'],
		hate: ['Slurs against a protected group', 'Hateful ideology'], nudity: ['Sexually explicit content', 'Nudity'], violence: ['Graphic violence', 'Threats of violence'],
		self_harm: ['Promotes self-harm', 'Dangerous challenge'], misinformation: ['Harmful health misinformation', 'Manipulated media'], impersonation: ['Pretends to be another person', 'Pretends to be a brand'],
		copyright: ['Reuploaded content they do not own'], other: ['Violates the instance rules'],
	};
	const Errors = {
		InvalidMailSettings: 'Check the server, port, and From address.', MailFailed: 'Couldn’t send the test email. Check the settings.', MailNotConfigured: 'Save email settings first.', InvalidEmail: 'Enter an email address.',
		WrongSecurityKey: 'That isn’t the security key.', NoSecurityKey: 'Set up a security key on the server first.', OptedOut: 'User has opted out from their ip being visible',
		CannotModerateAdmin: 'Admins and your own account can’t be moderated here.', CannotChangeYourself: 'You can’t do that to your own account.', InvalidCsrf: 'Your session changed. Refresh and try again.',
		InvalidReason: 'Write a reason, up to 1,000 characters.', InvalidDecision: 'That combination of actions isn’t allowed for this content.', InvalidRestriction: 'Pick each feature once with a listed duration.',
		ReportAlreadyReviewed: 'Someone already reviewed this ticket.', AppealAlreadyReviewed: 'Someone already reviewed this appeal.', DecisionNotFound: 'That decision was already reversed.',
		RestrictionNotFound: 'That restriction already ended.', TargetNotFound: 'This content no longer exists.', TypeTheUsernameToConfirm: 'Type the username exactly to confirm.',
		InvalidModerationSettings: 'Strike expiry is 7–365 days, limits are 2–100, and each policy is 1–50.', InvalidInvite: 'Invites need 1–100 uses and 1–90 days.', InvalidInstanceName: 'Names are 1–60 characters.',
		InvalidLimits: 'Videos can be 1–2,048 MB and 1–3,600 seconds.', AnnouncementTooLong: 'Announcements are up to 500 characters.', InvalidAnnouncementLink: 'Links start with https:// or /.',
		RulesTooLong: 'Rules are up to 10,000 characters.', InvalidImage: 'Use a PNG, JPEG, or WebP image up to 4096 px.', BodyTooLarge: 'Images are up to 2 MB.', SessionNotFound: 'That session already ended.',
		InvalidVerification: 'Choose whether this account is verified.', InvalidMisc: 'Choose which features are on.',
		InvalidPrideFlag: 'Choose a pride flag from the list, or None.', InvalidUserBadges: 'Choose badges from the list.',
	};
	const Icons = {
		queue: 'M3 13h4l2 3h6l2-3h4M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-8z', appeals: 'M12 3v17M8 20h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z',
		accounts: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
		content: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4', log: 'M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11M4 18l1.2 1.2L7.5 17',
		policies: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3zM9 12l2 2 4-4', instance: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4', invites: 'M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V7zM14 7v10',
		audit: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4M12 8v4l3 2', misc: 'M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6L5 15z', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', back: 'M19 12H5M11 6l-6 6 6 6',
		theme: 'M12 3a9 9 0 1 0 0 18V3z', collapse: 'M4 4h16v16H4zM9 4v16', done: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM8 12l3 3 5-6', video: 'M5 4h14v16H5zM10 9l5 3-5 3V9z',
		comment: 'M4 5h16v11H9l-5 4V5z', message: 'M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0', open: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', keys: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
	};

	let Counts = { tickets: 0, appeals: 0 };
	let Teardown = [];
	let PageKeys = {};

	function El(Tag, Props = {}, ...Children) {
		const Node = document.createElement(Tag);
		for (const [Key, Value] of Object.entries(Props)) {
			if (Value === undefined || Value === null || Value === false) continue;
			if (Key === 'class') Node.className = Value;
			else if (Key.startsWith('on')) Node.addEventListener(Key.slice(2), Value);
			else if (Key === 'value') Node.value = Value;
			else if (Key === 'checked' || Key === 'disabled' || Key === 'selected') Node[Key] = Boolean(Value);
			else Node.setAttribute(Key, Value === true ? '' : Value);
		}
		for (const Child of Children.flat(4)) if (Child !== null && Child !== undefined && Child !== false) Node.append(Child instanceof window.Node ? Child : String(Child));
		return Native(Node);
	}
	let TuxNames;
	function Tux(...Names) {
		if (!TuxNames) {
			TuxNames = new Map();
			for (const Sheet of document.styleSheets) {
				let Rules; try { Rules = Sheet.cssRules; } catch { continue; }
				const Walk = List => { for (const Rule of List) { if (Rule.cssRules) Walk(Rule.cssRules); for (const Match of (Rule.selectorText ?? '').matchAll(/\.(tux-[A-Za-z0-9_-]+?)__([A-Za-z0-9_-]{6})_(v\d+_\d+_\d+)(?![A-Za-z0-9_-])/g)) if (!TuxNames.has(Match[1])) TuxNames.set(Match[1], Match[0].slice(1)); } };
				Walk(Rules);
			}
		}
		return Names.filter(Boolean).map(Name => TuxNames.get(Name) ?? '').filter(Boolean).join(' ');
	}
	function Native(Node) {
		const Has = Name => Node.classList.contains(Name);
		if (Has('Btn')) Node.className += ' tux-web-canary ' + Tux('tux-interaction-container', 'tux-button', Has('Small') ? 'tux-button--small' : 'tux-button--medium');
		else if (Has('Chip')) Node.className += ' tux-web-canary P3-Semibold ' + Tux('tux-tag', Has('Brand') ? 'tux-tag--primary' : 'tux-tag--subtle');
		else if (Has('Tabs')) Node.className += ' ' + Tux('tux-segmented-control', 'tux-segmented-control--capsule', 'tux-segmented-control--small');
		else if (Has('Switch')) {
			const Input = Node.querySelector('input'), Track = Node.querySelector('span');
			if (Input && Track) {
				Node.className += ' tux-web-canary ' + Tux('tux-interaction-container', 'tux-switch', 'tux-switch--small');
				Input.className = Tux('tux-switch__input');
				const Holder = Object.assign(document.createElement('div'), { className: Tux('tux-switch__indicator__container') });
				Holder.append(Object.assign(document.createElement('div'), { className: Tux('tux-switch__indicator', 'tux-switch__indicator--small') }));
				Track.replaceWith(Holder);
				const Checked = Tux('tux-switch--checked'), Sync = () => { for (const Name of Checked.split(' ').filter(Boolean)) Node.classList.toggle(Name, Input.checked); };
				Input.addEventListener('change', Sync); queueMicrotask(Sync);
			}
		}
		return Node;
	}
	const Fill = (Node, ...Children) => Node.replaceChildren(...Children.flat(4).filter(Child => Child !== null && Child !== undefined && Child !== false));
	function Icon(Name, Size = 18) {
		const Node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		for (const [Key, Value] of Object.entries({ viewBox: '0 0 24 24', width: Size, height: Size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) Node.setAttribute(Key, Value);
		const Path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); Path.setAttribute('d', Icons[Name]); Node.append(Path);
		return Node;
	}
	const Link = (Href, Props, ...Children) => El('a', { href: Href, ...Props, onclick: Event => { if (Event.metaKey || Event.ctrlKey || Event.button) return; Event.preventDefault(); Navigate(Href); } }, ...Children);
	const Btn = (Label, OnClick, Class = '', Props = {}) => El('button', { type: 'button', class: `Btn ${Class}`, onclick: OnClick, ...Props }, Label);
	const Chip = (Text, Class = '') => El('span', { class: `Chip ${Class}` }, Text);
	const Spinner = () => El('div', { class: 'Loading' }, El('div', { class: 'Spinner' }));
	function AccountBadges(User) {
		const Badges = Boot.badges.pride.filter(Badge => Badge.id === User.pride_flag);
		return Badges.length ? El('span', { class: 'AccountBadges', 'aria-label': 'Profile badges' }, Badges.map(Badge => El('img', { src: Badge.icon, alt: Badge.label, title: Badge.label, class: Badge.type }))) : null;
	}
	function VerifiedCheck() {
		const Mark = El('span', { class: 'VerifiedCheck', role: 'img', 'aria-label': 'Verified', title: 'Verified' });
		Mark.innerHTML = '<svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true"><path d="M0 24a24 24 0 1 1 48 0 24 24 0 0 1-48 0Z" fill="#20D5EC"/><path fill-rule="evenodd" clip-rule="evenodd" d="M37.12 15.88a3 3 0 0 1 0 4.24l-13.5 13.5a3 3 0 0 1-4.24 0l-8.5-8.5a3 3 0 1 1 4.24-4.24l6.38 6.38 11.38-11.38a3 3 0 0 1 4.24 0Z" fill="#fff"/></svg>';
		return Mark;
	}

	async function Api(Path, Body, Method) {
		const Options = { method: Method ?? (Body === undefined ? 'GET' : 'POST'), headers: { 'x-csrf-token': Boot.csrf } };
		if (Body instanceof FormData) Options.body = Body;
		else if (Body !== undefined) { Options.body = JSON.stringify(Body); Options.headers['content-type'] = 'application/json'; }
		const Response = await fetch('/_kittok/admin/' + Path, Options);
		const Data = await Response.json().catch(() => ({}));
		if (!Response.ok) throw new Error(Errors[Data.error] ?? Data.error ?? `Request failed (${Response.status})`);
		return Data;
	}
	function Toast(Message, Error = false) {
		document.querySelector('.Toast')?.remove();
		const Node = El('div', { class: `Toast${Error ? ' Error' : ''}`, role: 'status' }, Message);
		Layer.append(Node); setTimeout(() => Node.remove(), 3200);
	}
	const Fail = Error => Toast(Error.message, true);
	function Ago(Value) {
		if (!Value) return '';
		const Seconds = Math.max(0, (Date.now() - new Date(Value)) / 1000);
		return Seconds < 60 ? 'just now' : Seconds < 3600 ? `${Math.floor(Seconds / 60)}m` : Seconds < 86400 ? `${Math.floor(Seconds / 3600)}h` : Seconds < 2592000 ? `${Math.floor(Seconds / 86400)}d` : new Date(Value).toLocaleDateString();
	}
	const Left = Value => { const Hours = (new Date(Value) - Date.now()) / 3600000; return Hours < 1 ? `${Math.max(1, Math.round(Hours * 60))}m left` : Hours < 48 ? `${Math.round(Hours)}h left` : `${Math.round(Hours / 24)}d left`; };
	const When = Value => new Date(Value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	const Cap = Text => Text[0].toUpperCase() + Text.slice(1);
	const Short = (Text, Length = 120) => !Text ? '' : Text.length > Length ? Text.slice(0, Length - 1) + '…' : Text;

	function Modal({ Title, Body, Confirm = 'Confirm', Danger = false, OnConfirm }) {
		const Previous = document.activeElement?.closest('.ActionMenu')?.querySelector('[aria-haspopup]') ?? document.activeElement;
		const Close = () => { Shade.remove(); document.removeEventListener('keydown', Escape, true); if (Previous?.isConnected) Previous.focus(); };
		const Escape = Event => {
			if (Event.key === 'Escape') { Event.stopPropagation(); Close(); }
			if (Event.key === 'Tab') {
				const Fields = [...Shade.querySelectorAll('button:not(:disabled),input,textarea,select,a[href]')];
				if (Event.shiftKey && document.activeElement === Fields[0]) { Event.preventDefault(); Fields.at(-1).focus(); }
				else if (!Event.shiftKey && document.activeElement === Fields.at(-1)) { Event.preventDefault(); Fields[0].focus(); }
			}
		};
		const Action = Btn(Confirm, async () => { Action.disabled = true; try { await OnConfirm(); Close(); } catch (Error) { Fail(Error); Action.disabled = false; } }, Danger ? 'Danger' : 'Primary');
		const Shade = El('div', { class: 'Modal', onclick: Event => { if (Event.target === Shade) Close(); } },
			El('div', { class: 'Panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': Title }, El('div', { class: 'PanelHead' }, Title), El('div', { class: 'PanelBody' }, Body), El('div', { class: 'Foot' }, Btn('Cancel', Close, 'Ghost'), Action)));
		Layer.append(Shade); document.addEventListener('keydown', Escape, true);
		(Shade.querySelector('input,textarea,select') ?? Action).focus();
	}
	function AskReason({ Title, Text, Confirm, Danger, Placeholder = 'Reason', OnConfirm }) {
		const Field = El('textarea', { class: 'Text', placeholder: Placeholder, maxlength: 1000 });
		Modal({ Title, Confirm, Danger, Body: [Text && El('p', { class: 'Muted', style: 'margin:0' }, Text), Field], OnConfirm: () => { if (!Field.value.trim()) throw new Error('Write a reason first.'); return OnConfirm(Field.value.trim()); } });
	}

	function NoticeText({ type, category, content_action: Content, account_action: Account, restrictions }) {
		const On = category === 'other' ? 'our Community Guidelines' : `our Community Guidelines on ${PolicyPhrase(category)}`;
		const Parts = [];
		if (Account === 'ban') Parts.push(`Your account was permanently banned for violating ${On}.`);
		else {
			Parts.push(Content === 'remove' ? `Your ${TargetNoun[type]} was removed for violating ${On}.` : Content === 'fyf_ineligible' ? `Your video isn't eligible for the For You feed because it doesn't meet ${On}.` : `Your ${TargetNoun[type]} violated ${On}.`);
			if (Account === 'warning') Parts.push('This is a warning. It does not count toward a ban, but future violations will.');
			if (Account === 'strike') Parts.push('You received a strike on your account. Strikes expire after 90 days.');
		}
		for (const { feature, hours } of restrictions) {
			const Phrase = Features.find(Entry => Entry[0] === feature)[2];
			Parts.push(`You're restricted from ${Phrase}${hours === null ? '' : ` until ${new Date(Date.now() + hours * 3600000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}.`);
		}
		return Parts.join(' ');
	}

	function StandingChip(Standing, Banned) {
		const State = Banned ? 'banned' : Standing?.state ?? 'good';
		return Chip([El('span', { class: 'Dot' }), { good: 'Good standing', at_risk: 'At risk', restricted: 'Restricted', banned: 'Banned' }[State]], { good: 'Good', at_risk: 'Warn', restricted: 'Warn', banned: 'Bad' }[State]);
	}
	function Meters(Standing, Highlight = {}) {
		const Rows = [];
		const Add = (Label, Count, Max, Hot) => {
			const Ratio = Math.min(1, Count / Max);
			Rows.push(El('div', { class: 'Bar', title: `${Count} of ${Max} strikes` }, El('span', { class: 'Clip' }, Label), El('div', { class: 'Track' }, El('div', { class: `Fill ${Ratio >= 0.75 ? 'Bad' : Ratio >= 0.5 ? 'Warn' : 'Cyan'}`, style: `width:${Math.max(Count ? 6 : 0, Ratio * 100)}%;${Hot ? 'box-shadow:0 0 0 1px var(--text)' : ''}` })), El('span', { class: 'Num Faint' }, `${Count}/${Max}`)));
		};
		const T = Standing.thresholds, S = Standing.strikes;
		Add('Account total', S.total, T.total, Highlight.total);
		for (const Area of new Set([...Object.keys(S.feature), ...(Highlight.feature ? [Highlight.feature] : [])])) Add(Areas[Area] ?? Area, S.feature[Area] ?? 0, T.feature, Highlight.feature === Area);
		for (const Policy of new Set([...Object.keys(S.policy), ...(Highlight.policy ? [Highlight.policy] : [])])) Add(PolicyLabel(Policy), S.policy[Policy] ?? 0, T.policy[Policy] ?? T.feature, Highlight.policy === Policy);
		return El('div', { class: 'Bars' }, Rows);
	}
	function Restrictions(Standing, OnChange) {
		if (!Standing.restrictions.length) return El('p', { class: 'Faint', style: 'margin:0' }, 'No active restrictions.');
		return El('div', { class: 'Limits' }, Standing.restrictions.map(Row => El('div', { class: 'Limit On' }, El('span', { class: 'Grow' }, FeatureLabel(Row.feature)), El('span', { class: 'Faint Num' }, Row.expires_at ? Left(Row.expires_at) : 'Until lifted'),
			OnChange && Btn('Lift', () => Modal({ Title: `Lift ${FeatureLabel(Row.feature).toLowerCase()} restriction?`, Body: El('p', { class: 'Muted', style: 'margin:0' }, 'The account can use this feature again right away.'), Confirm: 'Lift', OnConfirm: async () => { await Api(`restrictions/${Row.id}/lift`, {}); Toast('Restriction lifted'); OnChange(); } }), 'Small'))));
	}
	function Timeline(Decisions, OnChange) {
		if (!Decisions.length) return El('p', { class: 'Faint', style: 'margin:0' }, 'No enforcement history.');
		return El('div', { class: 'Timeline' }, Decisions.map(Row => {
			const Action = { warning: ['Warning', 'Info'], strike: ['Strike', 'Warn'], ban: ['Ban', 'Bad'], none: null }[Row.account_action];
			const Content = { remove: 'Removed', fyf_ineligible: 'Not for For You', none: null }[Row.content_action];
			const Color = Row.reversed_at ? 'var(--text-3)' : Row.account_action === 'ban' ? 'var(--bad)' : Row.account_action === 'strike' ? 'var(--warn)' : 'var(--cyan)';
			return El('div', { class: `Event${Row.reversed_at ? ' Reversed' : ''}` }, El('span', { class: 'Dot', style: `color:${Color}` }),
				El('div', {}, El('div', { class: 'Head' }, Action && Chip(Action[0], Action[1]), Content && Chip(Content), Chip(PolicyLabel(Row.category)), Row.severe && Chip('Severe', 'Bad'), Row.reversed_at && Chip('Reversed'), Row.appeal_status && Chip(`Appeal ${Row.appeal_status}`, Row.appeal_status === 'restored' ? 'Good' : ''),
					),
				El('div', { class: 'Faint', style: 'font-size:11px;margin-top:4px' }, `${Cap(TargetNoun[Row.target_type])} · ${Ago(Row.created_at)} ago${Row.moderator ? ' · @' + Row.moderator : ''}`),
				El('p', {}, Row.reason),
				OnChange && !Row.reversed_at && El('div', { style: 'margin-top:6px' }, Btn('Reverse', () => AskReason({ Title: 'Reverse this decision?', Text: 'Lifts its restrictions and, for a ban, restores the account. The record stays in history.', Confirm: 'Reverse', OnConfirm: async Reason => { await Api(`decisions/${Row.id}/reverse`, { reason: Reason }); Toast('Decision reversed'); OnChange(); } }), 'Small Ghost'))));
		}));
	}

	function DecisionPanel({ Type, Standing, Owner, Ticket, OnDone, OnSkip, Compact }) {
		const Prior = Standing?.decisions.some(Row => ['warning', 'strike'].includes(Row.account_action) && !Row.reversed_at);
		const Form = { verdict: Ticket ? null : 'violation', category: Ticket?.top ?? null, content_action: Type === 'user' ? 'none' : 'remove', account_action: 'strike', severe: false, restrictions: {}, reason: '' };
		const Node = El('div', { class: 'Panel Decide' });
		const Submit = async () => {
			const Violation = Form.verdict === 'violation';
			if (!Form.verdict) return Toast('Choose violation or no violation.', true);
			if (Violation && !Form.category) return Toast('Pick the policy it violates.', true);
			if (!Form.reason.trim()) return Toast('Write a reason. The account sees it.', true);
			const Body = { reason: Form.reason.trim() };
			if (Violation) Object.assign(Body, { category: Form.category, content_action: Form.content_action, account_action: Form.account_action, severe: Form.severe, restrictions: Object.entries(Form.restrictions).map(([Feature, Hours]) => ({ feature: Feature, hours: Hours })) });
			try {
				const Result = Ticket ? await Api(`reports/${Ticket.report}/decide`, { verdict: Violation ? 'violation' : 'no_violation', ...Body }) : await Api('enforce', { target_type: Type, target_id: Ticket?.id ?? Owner.target, ...Body });
				Toast(Result.autoBan ? 'Decision recorded. The account reached a strike limit and was banned.' : Violation ? 'Decision recorded' : 'Ticket closed with no violation');
				OnDone(Result);
			} catch (Error) { Fail(Error); }
		};
		const Effective = () => Form.account_action === 'strike' && !Form.severe && !Prior ? 'warning' : Form.account_action;
		function Draw() {
			const Violation = Form.verdict === 'violation';
			const Action = Effective();
			const Hints = [];
			if (Violation && Form.account_action === 'strike' && Action === 'warning') Hints.push(['Info', 'First violation on this account, so this is issued as a warning. Turn on Severe to give a strike.']);
			if (Violation && Action === 'strike' && Standing) {
				const T = Standing.thresholds, S = Standing.strikes, Area = TargetFeature[Type];
				const Limit = (S.feature[Area] ?? 0) + 1 >= T.feature ? `the ${Areas[Area].toLowerCase()} limit` : (S.policy[Form.category] ?? 0) + 1 >= (T.policy[Form.category] ?? T.feature) ? `the ${PolicyLabel(Form.category).toLowerCase()} limit` : S.total + 1 >= T.total ? 'the account limit' : null;
				if (Limit) Hints.push(['Bad', `This strike reaches ${Limit}. The account will be permanently banned.`]);
			}
			if (Violation && Form.account_action === 'ban') Hints.push(['Bad', 'Bans are permanent until reversed or appealed. The account is signed out everywhere.']);
			const Restrictions = Object.entries(Form.restrictions).map(([Feature, Hours]) => ({ feature: Feature, hours: Hours }));
			Fill(Node, 
				!Compact && El('div', { class: 'PanelHead' }, 'Decision', El('span', { class: 'Grow' }), El('button', { class: 'Btn Ghost Small', type: 'button', onclick: ShowKeys, title: 'Keyboard shortcuts' }, Icon('keys', 15), '?')),
				El('div', { class: 'Scroll' },
					Ticket && El('div', { class: 'Step' }, El('span', { class: 'StepTitle' }, 'Verdict'), El('div', { class: 'Verdict' },
						El('button', { type: 'button', class: `Choice${Form.verdict === 'no_violation' ? ' On' : ''}`, onclick: () => { Form.verdict = 'no_violation'; Draw(); } }, 'No violation', El('kbd', {}, 'N')),
						El('button', { type: 'button', class: `Choice Violation${Violation ? ' On' : ''}`, onclick: () => { Form.verdict = 'violation'; Draw(); } }, 'Violation', El('kbd', {}, 'V')))),
					Violation && [
						El('div', { class: 'Step' }, El('span', { class: 'StepTitle' }, 'Policy'), El('div', { class: 'Policies' }, Policies.map(([Key, Label], Index) => El('button', { type: 'button', class: `Policy${Form.category === Key ? ' On' : ''}`, onclick: () => { Form.category = Key; Draw(); } }, Label, El('kbd', {}, String((Index + 1) % 10)))))),
						Type !== 'user' && El('div', { class: 'Step' }, El('span', { class: 'StepTitle' }, 'Content'), El('div', { class: 'Segment' },
							[['none', 'Keep up'], ['remove', 'Remove'], ...(Type === 'video' ? [['fyf_ineligible', 'Not for FYF']] : [])].map(([Key, Label]) => El('button', { type: 'button', class: Form.content_action === Key ? 'On' : '', onclick: () => { Form.content_action = Key; Draw(); } }, Label)))),
						El('div', { class: 'Step' }, El('span', { class: 'StepTitle' }, 'Account', El('span', { class: 'Grow' }), El('label', { class: 'Row', style: 'text-transform:none;letter-spacing:0;font-weight:550;color:var(--text-2);gap:6px' }, El('span', { class: 'Switch' }, El('input', { type: 'checkbox', checked: Form.severe, onchange: Event => { Form.severe = Event.target.checked; Draw(); } }), El('span')), 'Severe')),
							El('div', { class: 'Segment' }, [['none', 'No strike'], ['strike', Action === 'warning' ? 'Warning' : 'Strike'], ['ban', 'Ban']].map(([Key, Label]) => El('button', { type: 'button', class: `${Form.account_action === Key ? 'On' : ''}${Key === 'ban' ? ' Bad' : ''}`, onclick: () => { Form.account_action = Key; Draw(); } }, Label)))),
						Hints.map(([Kind, Text]) => El('div', { class: `Hint ${Kind}` }, Text)),
						Form.account_action !== 'ban' && El('div', { class: 'Step' }, El('span', { class: 'StepTitle' }, 'Restrict features'), El('div', { class: 'Limits' }, Features.map(([Key, Label]) => {
							const On = Key in Form.restrictions;
							return El('div', { class: `Limit${On ? ' On' : ''}` }, El('label', { class: 'Switch', title: Label }, El('input', { type: 'checkbox', checked: On, 'aria-label': `Restrict ${Label.toLowerCase()}`, onchange: Event => { if (Event.target.checked) Form.restrictions[Key] = 24; else delete Form.restrictions[Key]; Draw(); } }), El('span')),
								El('span', { class: 'Grow' }, Label), On && El('select', { class: 'Select Small', 'aria-label': `${Label} duration`, onchange: Event => { Form.restrictions[Key] = Event.target.value === '' ? null : Number(Event.target.value); Draw(); } },
									Durations.map(([Hours, Name]) => El('option', { value: Hours ?? '', selected: Form.restrictions[Key] === Hours }, Name))));
						}))),
					],
					Form.verdict && El('div', { class: 'Step' }, El('span', { class: 'StepTitle' }, Violation ? 'Reason shown to the account' : 'Resolution note'),
						El('textarea', { class: 'Text', maxlength: 1000, placeholder: Violation ? 'What did they do? They see this in their account status.' : 'Why does this not violate a policy?', value: Form.reason, oninput: Event => { Form.reason = Event.target.value; Preview(); } }),
						Violation && Form.category && El('div', { class: 'Templates' }, Templates[Form.category].map(Text => El('button', { type: 'button', class: 'Template', onclick: () => { Form.reason = Text; Draw(); } }, Text)))),
					Violation && Form.category && El('div', { class: 'Preview' }, El('span', { class: 'Faint' }, Icon('comment', 13), 'Account updates notice'), El('p', { class: 'Notice' }))),
				El('div', { class: 'Foot' }, OnSkip && Btn(['Skip', El('kbd', {}, 'S')], OnSkip, 'Ghost'), El('span', { class: 'Grow' }), Btn([Violation ? 'Enforce' : Form.verdict ? 'Close ticket' : 'Submit', El('kbd', { style: 'color:inherit;background:transparent;border-color:rgba(255,255,255,.4)' }, '⌘↵')], Submit, 'Primary', { disabled: !Form.verdict })));
			Preview();
			function Preview() {
				const Target = Node.querySelector('.Notice');
				if (Target) Target.textContent = NoticeText({ type: Type, category: Form.category, content_action: Form.content_action, account_action: Effective(), restrictions: Restrictions });
			}
		}
		Draw();
		Node.Keys = {
			n: () => { if (Ticket) { Form.verdict = 'no_violation'; Draw(); } }, v: () => { Form.verdict = 'violation'; Draw(); },
			r: () => { if (Form.verdict === 'violation' && Type !== 'user') { Form.content_action = Form.content_action === 'remove' ? 'none' : 'remove'; Draw(); } },
			b: () => { if (Form.verdict === 'violation') { Form.account_action = Form.account_action === 'ban' ? 'strike' : 'ban'; Draw(); } },
			s: () => OnSkip?.(), submit: Submit,
			...Object.fromEntries(Policies.map(([Key], Index) => [String((Index + 1) % 10), () => { if (Form.verdict === 'violation') { Form.category = Key; Draw(); } }])),
		};
		return Node;
	}

	function EnforceDrawer({ Type, Target, Owner, Title, OnDone }) {
		let Close;
		const Load = async () => {
			const Standing = Owner?.standing ?? (await Api(`users/${Owner.id}`)).standing;
			const Panel = DecisionPanel({ Type, Standing, Owner: { ...Owner, target: Target }, Compact: true, OnDone: Result => { Close(); OnDone?.(Result); } });
			Fill(Shell, El('div', { class: 'PanelHead' }, Title, El('span', { class: 'Grow' }), Btn('Close', () => Close(), 'Ghost Small')), Panel);
			PageKeys.__drawer = Panel.Keys;
		};
		const Shell = El('div', { class: 'Panel' }, Spinner());
		const Shade = El('div', { class: 'Drawer', onclick: Event => { if (Event.target === Shade) Close(); } }, Shell);
		const Escape = Event => { if (Event.key === 'Escape') Close(); };
		Close = () => { Shade.remove(); delete PageKeys.__drawer; document.removeEventListener('keydown', Escape); };
		Layer.append(Shade); document.addEventListener('keydown', Escape);
		Load().catch(Error => { Fail(Error); Close(); });
	}

	function ShowKeys() {
		const Pairs = [[['J'], 'Next ticket in the queue'], [['K'], 'Previous ticket'], [['Enter'], 'Open the selected ticket'], [['V'], 'Violation'], [['N'], 'No violation'], [['1', '0'], 'Pick a policy'], [['R'], 'Toggle remove content'], [['B'], 'Toggle ban'], [['S'], 'Skip ticket'], [['⌘', '↵'], 'Submit decision'], [['/'], 'Search'], [['?'], 'Show shortcuts']];
		Modal({ Title: 'Keyboard shortcuts', Confirm: 'Done', Body: El('div', { class: 'Keys' }, Pairs.flatMap(([Keys, Text]) => [El('span', {}, Keys.map(Key => El('kbd', {}, Key))), El('span', { class: 'Muted' }, Text)])), OnConfirm: () => {} });
	}

	const Nav = [
		['Moderation'], ['/admin', 'Queue', 'queue', 'tickets'], ['/admin/appeals', 'Appeals', 'appeals', 'appeals'], ['/admin/log', 'Enforcement log', 'log'],
		['Community'], ['/admin/accounts', 'Accounts', 'accounts'], ['/admin/content', 'Content', 'content'],
		['Configure'], ['/admin/policies', 'Policies', 'policies'], ['/admin/instance', 'Instance', 'instance'], ['/admin/misc', 'Misc', 'misc'], ['/admin/invites', 'Invites', 'invites'], ['/admin/audit', 'Audit log', 'audit'],
	];
	const Frame = El('div', { class: 'App' });
	const Title = El('h1');
	const SearchBox = El('input', { type: 'search', placeholder: 'Search accounts, @handles, or IDs', 'aria-label': 'Search', onkeydown: Event => { if (Event.key === 'Enter') Lookup(Event.target.value.trim()); if (Event.key === 'Escape') Event.target.blur(); } });
	const Body = El('main', { class: 'Body', tabindex: '-1' });
	Frame.append(El('header', { class: 'Top' }, Title, El('div', { class: 'Search' }, Icon('search', 16), SearchBox, El('kbd', {}, '/'))), Body);
	Root.append(Frame);

	let NavSignature = '';
	function NavContainer() { return document.querySelector('[class*="DivMainNavContainer"]'); }
	function NavTemplate(Container) { return [...Container.children].find(Child => !Child.hasAttribute('data-kittok-admin-nav') && Child.querySelector(':scope > a[data-e2e="nav-foryou"]')); }
	function DrawSections() {
		const Container = NavContainer(), Template = Container && NavTemplate(Container);
		if (!Template || !Root.isConnected) return;
		const Current = location.pathname.replace(/\/$/, '') || '/admin';
		const Active = Href => Href === '/admin' ? Current === '/admin' || Current.startsWith('/admin/review') : Current.startsWith(Href);
		NavSignature = Template.outerHTML.length + ':' + Template.className + ':' + Template.querySelector('button')?.className;
		const Items = [...Nav.filter(Entry => Entry[1] !== undefined), ['/', `Back to ${Boot.name}`]].map(([Href, Label, Name, Count]) => {
			const Item = Template.cloneNode(true); Item.setAttribute('data-kittok-admin-nav', '');
			const Anchor = Item.querySelector('a'), Button = Item.querySelector('button'), Text = Item.querySelector('.TUXButton-label');
			Anchor.href = Href; Anchor.setAttribute('data-e2e', `nav-kittok-admin-${Name ?? 'back'}`);
			Button.setAttribute('aria-label', Label); Anchor.title = Label;
			if (Text) Text.textContent = Label;
			if (Name) {
				Item.querySelector('svg')?.replaceWith(Object.assign(Icon(Name, '1em'), { classList: 'KittokAdminNavIcon' }));
				Anchor.addEventListener('click', Event => { if (Event.metaKey || Event.ctrlKey || Event.button) return; Event.preventDefault(); Navigate(Href); });
				if (Active(Href)) { Item.setAttribute('data-active', ''); Button.setAttribute('aria-current', 'page'); }
				const Total = Count && Counts[Count];
				if (Total) Item.querySelector('[class*="DivIconWithRedDot"]')?.append(El('span', { class: 'KittokAdminNavCount' }, Total > 99 ? '99+' : String(Total)));
			}
			return Item;
		});
		for (const Old of Container.querySelectorAll(':scope > [data-kittok-admin-nav]')) Old.remove();
		Container.append(...Items);
	}
	new MutationObserver(() => {
		const Container = NavContainer(), Template = Container && NavTemplate(Container);
		if (!Template || !Root.isConnected) return;
		const Signature = Template.outerHTML.length + ':' + Template.className + ':' + Template.querySelector('button')?.className;
		if (Signature !== NavSignature || !Container.querySelector(':scope > [data-kittok-admin-nav]')) DrawSections();
	}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	async function RefreshCounts() {
		try { const Data = await Api('console'); Counts = { tickets: Data.counts.tickets, appeals: Data.counts.appeals }; DrawSections(); return Data; } catch { return null; }
	}
	function SetTitle(Parts) {
		Fill(Title, ...Parts.flatMap((Part, Index) => [Index ? El('span', { class: 'Crumb' }, ' / ') : null, Index < Parts.length - 1 && Array.isArray(Part) ? El('span', { class: 'Crumb' }, Link(Part[1], {}, Part[0])) : Array.isArray(Part) ? Part[0] : Part]));
		document.title = `${(Array.isArray(Parts.at(-1)) ? Parts.at(-1)[0] : Parts.at(-1))} · Admin · ${Boot.name}`;
	}
	async function Lookup(Query) {
		if (!Query) return;
		if (/^\d{6,}$/.test(Query)) {
			for (const [Route, Path] of [['users/' + Query, `/admin/accounts/${Query}`], [`tickets/video/${Query}`, `/admin/review/video/${Query}`], [`tickets/comment/${Query}`, `/admin/review/comment/${Query}`]]) {
				try { const Data = await Api(Route); if (Data.user || Data.content) return Navigate(Path); } catch {}
			}
			return Toast('No account, video, or comment has that ID.', true);
		}
		Navigate(`/admin/accounts?q=${encodeURIComponent(Query.replace(/^@/, ''))}`);
	}

	function Navigate(Href, Replace = false) {
		if (Replace) history.replaceState(null, '', Href); else history.pushState(null, '', Href);
		Route();
	}
	let Routed = '';
	async function Route() {
		Routed = location.pathname + location.search;
		for (const Clean of Teardown) Clean();
		Teardown = []; PageKeys = {};
		document.querySelectorAll('.Drawer,.Modal').forEach(Node => Node.remove());
		DrawSections();
		const Path = location.pathname.replace(/\/$/, '');
		const Params = new URLSearchParams(location.search);
		Fill(Body, Spinner()); Body.scrollTop = 0;
		const Match = Path.match(/^\/admin\/review\/(video|comment|user|message)\/(\d+)$/) ?? Path.match(/^\/admin\/accounts\/(\d+)$/);
		try {
			if (Path === '/admin' || Path === '/admin/queue') await QueuePage(Params);
			else if (Path.startsWith('/admin/review/') && Match) await ReviewPage(Match[1], Match[2]);
			else if (Path === '/admin/appeals') await AppealsPage(Params);
			else if (Path === '/admin/log') await LogPage(Params);
			else if (Path === '/admin/accounts') await AccountsPage(Params);
			else if (Path.startsWith('/admin/accounts/') && Match) await AccountPage(Match[1], Params);
			else if (Path === '/admin/content') await ContentPage(Params);
			else if (Path === '/admin/policies') await PoliciesPage();
			else if (Path === '/admin/instance') await InstancePage();
			else if (Path === '/admin/misc') await MiscPage();
			else if (Path === '/admin/invites') await InvitesPage();
			else if (Path === '/admin/audit') await AuditPage();
			else { SetTitle(['Not found']); Fill(Body, El('div', { class: 'Empty' }, El('strong', {}, 'This page doesn’t exist'), Link('/admin', { class: 'Btn' }, 'Go to the queue'))); }
		} catch (Error) {
			Fill(Body, El('div', { class: 'Empty' }, El('strong', {}, 'Couldn’t load this page'), El('span', {}, Error.message), Btn('Try again', Route)));
		}
	}
	document.addEventListener('keydown', Event => {
		const Typing = /^(INPUT|TEXTAREA|SELECT)$/.test(Event.target.tagName) || Event.target.isContentEditable;
		const Keys = PageKeys.__drawer ?? PageKeys;
		if ((Event.metaKey || Event.ctrlKey) && Event.key === 'Enter' && Keys.submit) { Event.preventDefault(); Keys.submit(); return; }
		if (Typing || Event.metaKey || Event.ctrlKey || Event.altKey || document.querySelector('.Modal')) return;
		if (Event.key === '/') { Event.preventDefault(); SearchBox.focus(); return; }
		if (Event.key === '?') { ShowKeys(); return; }
		const Handler = Keys[Event.key.toLowerCase()] ?? (Event.key === 'Enter' ? Keys.enter : null);
		if (Handler) { Event.preventDefault(); Handler(); }
	});

	function Sparkline(Daily) {
		const Max = Math.max(1, ...Daily.flatMap(Day => [Day.reports, Day.decisions]));
		const Path = Key => Daily.map((Day, Index) => `${Index ? 'L' : 'M'}${(Index / (Daily.length - 1)) * 100} ${44 - (Day[Key] / Max) * 40}`).join(' ');
		const Node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		Node.setAttribute('viewBox', '0 0 100 46'); Node.setAttribute('preserveAspectRatio', 'none');
		Node.innerHTML = `<path d="${Path('reports')}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/><path d="${Path('decisions')}" fill="none" stroke="var(--cyan)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
		return Node;
	}

	async function QueuePage(Params) {
		SetTitle(['Queue']);
		const Type = ['video', 'comment', 'user', 'message'].includes(Params.get('type')) ? Params.get('type') : '';
		const [Console, Data] = await Promise.all([RefreshCounts(), Api(`tickets${Type ? '?type=' + Type : ''}`)]);
		const C = Console?.counts ?? {};
		const Overturn = C.appeals_reviewed ? Math.round((C.appeals_restored / C.appeals_reviewed) * 100) : null;
		let Selected = 0;
		const Rows = Data.tickets.map((Ticket, Index) => El('tr', { class: Index === 0 ? 'Selected' : '', onclick: () => Navigate(`/admin/review/${Ticket.type}/${Ticket.id}`) },
			El('td', { style: 'width:1%' }, El('div', { class: 'Row' }, El('span', { class: `Priority P${Math.floor(Ticket.priority / 10)}`, title: `Priority ${Math.floor(Ticket.priority / 10)}` }),
				Ticket.thumb && ['video', 'message'].includes(Ticket.type) ? El('img', { class: 'Thumb', src: Ticket.thumb, alt: '', loading: 'lazy' }) : Ticket.type === 'user' ? El('img', { class: 'Avatar', src: Ticket.owner?.avatar, alt: '' }) : El('div', { class: 'Glyph' }, Icon(Ticket.type === 'video' ? 'video' : Ticket.type === 'message' ? 'message' : 'comment')))),
			El('td', {}, El('div', { class: 'Faint', style: 'font-size:11px;margin-bottom:2px' }, `${Cap(TargetNoun[Ticket.type])} · `, El('span', { class: 'Mono' }, Ticket.id)), El('div', { class: 'Clamp' }, Ticket.preview || El('span', { class: 'Faint' }, 'No text'))),
			El('td', {}, El('div', { class: 'Row', style: 'flex-wrap:wrap;gap:4px' }, Object.entries(Ticket.reasons).sort((A, B) => B[1] - A[1]).slice(0, 3).map(([Reason, Count]) => Chip([PolicyLabel(Reason), Count > 1 ? El('b', {}, ` ${Count}`) : null], Reason === Ticket.top ? 'Brand' : '')))),
			El('td', { class: 'Num' }, El('b', {}, Ticket.reports)),
			El('td', {}, Ticket.owner && El('div', { class: 'Row', style: 'gap:8px' }, El('img', { class: 'Avatar', src: Ticket.owner.avatar, alt: '' }), El('div', { class: 'Grow' }, El('div', { class: 'Clip' }, `@${Ticket.owner.username}`), El('div', { class: 'Faint', style: 'font-size:11px' }, Ticket.owner.banned ? 'Banned' : `${Ticket.owner.strikes} active strike${Ticket.owner.strikes === 1 ? '' : 's'}`)))),
			El('td', { class: 'Num Faint', title: When(Ticket.first_at) }, Ago(Ticket.first_at))));
		const Select = Index => { if (!Rows.length) return; Rows[Selected].classList.remove('Selected'); Selected = (Index + Rows.length) % Rows.length; Rows[Selected].classList.add('Selected'); Rows[Selected].scrollIntoView({ block: 'nearest' }); };
		PageKeys = { j: () => Select(Selected + 1), k: () => Select(Selected - 1), enter: () => Rows[Selected]?.click() };
		Fill(Body, El('div', { class: 'Page' },
			El('div', { class: 'Metrics' },
				El('div', { class: 'Panel Metric' }, El('div', { class: 'Value' }, C.tickets ?? 0), El('div', { class: 'Name' }, 'Open tickets'), El('div', { class: 'Sub' }, C.oldest_ticket ? `Oldest waiting ${Ago(C.oldest_ticket)}` : 'Queue is clear')),
				El('div', { class: 'Panel Metric' }, El('div', { class: 'Value' }, C.appeals ?? 0), El('div', { class: 'Name' }, 'Pending appeals'), El('div', { class: 'Sub' }, Overturn === null ? 'None reviewed in 30 days' : `${Overturn}% overturned in 30 days`)),
				El('div', { class: 'Panel Metric' }, El('div', { class: 'Value' }, C.decisions_today ?? 0), El('div', { class: 'Name' }, 'Decisions today'), El('div', { class: 'Sub' }, `${C.restrictions ?? 0} active restrictions`)),
				El('div', { class: 'Panel Metric' }, El('div', { class: 'Value' }, C.banned ?? 0), El('div', { class: 'Name' }, 'Banned accounts'), El('div', { class: 'Sub' }, `${C.users ?? 0} accounts · ${C.new_users ?? 0} new this week`)),
				El('div', { class: 'Panel Spark' }, El('div', { class: 'Row' }, El('span', { class: 'Name Muted', style: 'font-size:12px' }, 'Last 14 days'), El('span', { class: 'Grow' }), El('div', { class: 'Legend' }, El('span', {}, El('span', { class: 'Dot', style: 'color:var(--accent)' }), 'Reports'), El('span', {}, El('span', { class: 'Dot', style: 'color:var(--cyan)' }), 'Decisions'))), Console ? Sparkline(Console.daily) : null)),
			El('div', { class: 'Toolbar' }, El('div', { class: 'Tabs', role: 'tablist' }, [['', 'All'], ['video', 'Videos'], ['comment', 'Comments'], ['message', 'Messages'], ['user', 'Accounts']].map(([Key, Label]) => Link(`/admin${Key ? '?type=' + Key : ''}`, { class: `Tab${Type === Key ? ' Active' : ''}`, role: 'tab', 'aria-selected': Type === Key ? 'true' : 'false' }, Label))),
				El('span', { class: 'Grow' }), Data.tickets.length ? Btn(['Start reviewing', El('kbd', { style: 'color:inherit;background:transparent;border-color:rgba(255,255,255,.4)' }, '↵')], () => Rows[Selected].click(), 'Primary') : null),
			El('div', { class: 'Panel', style: 'overflow-x:auto' }, Data.tickets.length ? El('table', { class: 'Table' }, El('thead', {}, El('tr', {}, ['', 'Content', 'Reported for', 'Reports', 'Owner', 'Waiting'].map(Head => El('th', {}, Head)))), El('tbody', {}, Rows))
				: El('div', { class: 'Empty' }, Icon('done', 34), El('strong', {}, 'Queue is clear'), El('span', {}, 'New reports land here, ordered by how harmful the reported policy is.')))));
	}

	async function ReviewPage(Type, Id) {
		const Data = await Api(`tickets/${Type}/${Id}`);
		const Queue = (await Api('tickets').catch(() => ({ tickets: [] }))).tickets;
		const Position = Queue.findIndex(Ticket => Ticket.type === Type && Ticket.id === Id);
		const Next = Queue[Position + 1] ?? Queue.find(Ticket => !(Ticket.type === Type && Ticket.id === Id));
		const Ticket = Position >= 0 ? Queue[Position] : null;
		const GoNext = () => Next ? Navigate(`/admin/review/${Next.type}/${Next.id}`, true) : Navigate('/admin', true);
		const Owner = Data.owner;
		SetTitle([['Queue', '/admin'], `${Cap(TargetNoun[Type])} ${Id}`]);
		const Removed = Data.decisions.some(Row => Row.content_action === 'remove' && !Row.reversed_at);
		const Fyf = Data.decisions.some(Row => Row.content_action === 'fyf_ineligible' && !Row.reversed_at);
		const C = Data.content;
		let Stage;
		if (!C) Stage = El('div', { class: 'Panel Empty' }, El('strong', {}, 'This content was deleted'), El('span', {}, 'You can still close the ticket or act on the account.'));
		else if (Type === 'video') Stage = El('div', {}, El('div', { class: 'Player' }, El('video', { src: C.file, poster: C.cover, controls: true, loop: true, muted: true, autoplay: true, playsinline: true }), Removed && El('div', { class: 'Removed' }, 'Removed')),
			El('div', { class: 'Caption' }, El('p', {}, C.text || El('span', { class: 'Faint' }, 'No caption')), El('div', { class: 'Stats' }, El('span', {}, `${C.views} views`), El('span', {}, `${C.likes} likes`), El('span', {}, `${C.comments} comments`), El('span', {}, `Posted ${Ago(C.created_at)} ago`)), El('div', { class: 'Row', style: 'margin-top:8px;gap:6px' }, Fyf && Chip('Not for For You', 'Warn'), Removed && Chip('Removed', 'Bad'))));
		else if (Type === 'comment') Stage = El('div', { class: 'Panel PanelBody Thread' },
			El('div', { class: 'Context' }, C.cover && El('img', { src: C.cover, alt: '' }), El('div', { class: 'Grow' }, El('div', { class: 'Faint', style: 'font-size:11px' }, 'On video ', El('span', { class: 'Mono' }, C.video_id)), El('div', { class: 'Clamp' }, C.video_text || 'No caption'))),
			C.parent_text && El('div', { class: 'Quote' }, El('span', { class: 'Faint' }, `Replying to @${C.parent_author}`), C.parent_text),
			El('div', { class: 'Quote Focus' }, El('span', { class: 'Faint' }, `@${Owner?.username} · ${Ago(C.created_at)} ago · ${C.likes} likes${Removed ? ' · Removed' : ''}`), C.text));
		else if (Type === 'message') Stage = El('div', { class: 'Panel PanelBody Thread' }, El('div', { class: 'Faint', style: 'font-size:11px' }, 'Direct message conversation'),
			C.thread.map(Row => El('div', { class: `Quote${Row.id === C.id ? ' Focus' : ''}` }, El('span', { class: 'Faint' }, `@${Row.username ?? 'deleted'} · ${Ago(Row.created_at)} ago${Row.id === C.id && Removed ? ' · Removed' : ''}`),
				Row.media && (Row.media.kind === 'image' ? El('img', { class: 'MessageMedia', src: Row.media.url, alt: 'Photo', loading: 'lazy' }) : El('video', { class: 'MessageMedia', src: Row.media.url, poster: Row.media.cover, controls: true, muted: true, playsinline: true, preload: 'metadata' })),
				Row.text || (!Row.media && El('span', { class: 'Faint' }, 'Attachment')))));
		else Stage = El('div', { class: 'Panel Profile' }, El('img', { class: 'Avatar Large', src: Owner?.avatar, alt: '' }), El('div', {}, El('h2', {}, C.text), El('div', { class: 'Muted' }, `@${Owner?.username}`), El('p', { style: 'margin:8px 0 0;overflow-wrap:anywhere' }, C.bio || El('span', { class: 'Faint' }, 'No bio'))));
		const Reasons = {}; for (const Report of Data.reports.filter(Row => Row.status === 'open')) Reasons[Report.category] = (Reasons[Report.category] ?? 0) + 1;
		const MaxReason = Math.max(1, ...Object.values(Reasons));
		const Refresh = () => Navigate(location.pathname, true);
		const Decision = Data.open.length && Owner ? DecisionPanel({ Type, Standing: Owner.standing, Owner, Ticket: { report: Data.open.at(-1), id: Id, top: Ticket?.top }, OnDone: GoNext, OnSkip: Next ? GoNext : null })
			: El('div', { class: 'Panel Decide' }, El('div', { class: 'PanelHead' }, 'Decision'), El('div', { class: 'Scroll' }, El('p', { class: 'Muted', style: 'margin:0' }, 'No open reports on this item.'), Owner && Btn('Take action anyway', () => EnforceDrawer({ Type, Target: Id, Owner, Title: `Act on this ${TargetNoun[Type]}`, OnDone: Refresh }), 'Wide')));
		PageKeys = Decision.Keys ?? {};
		Fill(Body, El('div', { class: 'Page', style: 'max-width:1440px' }, El('div', { class: 'Review' },
			El('div', { class: 'Stage' }, Stage, Data.decisions.length ? El('div', { class: 'Panel', style: 'margin-top:14px' }, El('div', { class: 'PanelHead' }, 'Decisions on this content'), El('div', { class: 'PanelBody' }, Timeline(Data.decisions, Refresh))) : null),
			El('div', { class: 'Stack' },
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Reports', El('span', { class: 'Faint' }, `${Data.open.length} open · ${Data.reports.length} total`)), El('div', { class: 'PanelBody' },
					Object.keys(Reasons).length ? El('div', { class: 'Bars' }, Object.entries(Reasons).sort((A, B) => B[1] - A[1]).map(([Reason, Count]) => El('div', { class: 'Bar' }, El('span', {}, PolicyLabel(Reason)), El('div', { class: 'Track' }, El('div', { class: 'Fill', style: `width:${(Count / MaxReason) * 100}%` })), El('span', { class: 'Num Faint' }, Count)))) : El('p', { class: 'Faint', style: 'margin:0' }, 'No open reports.'),
					El('div', { class: 'Notes' }, Data.reports.slice(0, 8).map(Report => El('div', { class: 'Note' }, El('span', { class: 'Faint' }, `${PolicyLabel(Report.category)} · @${Report.reporter ?? 'deleted'} · ${Ago(Report.created_at)} ago${Report.status !== 'open' ? ' · ' + Report.status : ''}`), Report.description || El('span', { class: 'Faint' }, 'No description')))))),
				Owner && El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Account', El('span', { class: 'Grow' }), Link(`/admin/accounts/${Owner.id}`, { class: 'Btn Ghost Small' }, 'Open', Icon('open', 14))), El('div', { class: 'PanelBody Stack' },
					El('div', { class: 'Owner' }, El('img', { class: 'Avatar', src: Owner.avatar, alt: '', style: 'width:40px;height:40px' }), El('div', { class: 'Grow' }, El('div', { class: 'Name Clip' }, Owner.display_name), El('div', { class: 'Faint' }, `@${Owner.username} · joined ${Ago(Owner.created_at)} ago`)), StandingChip(Owner.standing, Owner.suspended_at)),
					Meters(Owner.standing, { feature: TargetFeature[Type] }), Restrictions(Owner.standing, Refresh),
					El('div', {}, El('div', { class: 'StepTitle', style: 'margin-bottom:6px' }, 'History'), Timeline(Owner.standing.decisions.slice(0, 5), null)))),
			),
			Decision)));
	}

	async function AppealsPage(Params) {
		const Status = ['pending', 'restored', 'upheld'].includes(Params.get('status')) ? Params.get('status') : 'pending';
		SetTitle(['Appeals']);
		const [Data] = await Promise.all([Api(`appeals?status=${Status}`), RefreshCounts()]);
		let Selected = Data.appeals.findIndex(Row => Row.id === Params.get('id')); if (Selected < 0) Selected = 0;
		const Detail = El('div');
		const Items = Data.appeals.map((Row, Index) => El('button', { type: 'button', class: `ListItem${Index === Selected ? ' Selected' : ''}`, onclick: () => Show(Index) },
			El('img', { class: 'Avatar', src: Row.avatar, alt: '' }), El('div', { class: 'Grow' }, El('div', { class: 'Row' }, El('b', { class: 'Clip Grow' }, `@${Row.username}`), El('span', { class: 'Faint Num' }, Ago(Row.created_at))),
				El('div', { class: 'Faint', style: 'font-size:12px' }, `${Row.account_action === 'ban' ? 'Ban' : Row.account_action === 'strike' ? 'Strike' : 'Decision'} · ${PolicyLabel(Row.category)}`), El('div', { class: 'Clamp Muted', style: 'font-size:12px;margin-top:2px' }, Row.reason))));
		async function Show(Index) {
			Items[Selected]?.classList.remove('Selected'); Selected = Index; Items[Index]?.classList.add('Selected');
			const Row = Data.appeals[Index];
			if (!Row) { Fill(Detail, El('div', { class: 'Panel Empty' }, Icon('done', 34), El('strong', {}, Status === 'pending' ? 'No appeals waiting' : 'Nothing here yet'))); return; }
			Fill(Detail, Spinner());
			const Account = await Api(`users/${Row.user_id}`).catch(() => null);
			const Snapshot = Row.snapshot ?? {};
			const Decide = Outcome => AskReason({ Title: Outcome === 'restored' ? 'Restore and reverse the decision?' : 'Uphold the decision?', Text: Outcome === 'restored' ? 'The strike, restrictions, and any ban from it are removed. The account is notified.' : 'The decision stays. The account is notified that the appeal was reviewed.', Confirm: Outcome === 'restored' ? 'Restore' : 'Uphold', Danger: false,
				OnConfirm: async Reason => { await Api(`appeals/${Row.id}/review`, { outcome: Outcome, reason: Reason }); Toast(Outcome === 'restored' ? 'Appeal restored' : 'Appeal upheld'); Navigate(`/admin/appeals?status=${Status}`, true); } });
			PageKeys = Status === 'pending' ? { u: () => Decide('upheld'), r: () => Decide('restored'), j: () => Show(Math.min(Items.length - 1, Selected + 1)), k: () => Show(Math.max(0, Selected - 1)) } : { j: () => Show(Math.min(Items.length - 1, Selected + 1)), k: () => Show(Math.max(0, Selected - 1)) };
			Fill(Detail, El('div', { class: 'Stack' },
				El('div', { class: 'Compare' },
					El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Original decision', El('span', { class: 'Faint' }, Ago(Row.decided_at) + ' ago')), El('div', { class: 'PanelBody Stack' },
						El('div', { class: 'Row', style: 'flex-wrap:wrap;gap:6px' }, Chip(PolicyLabel(Row.category), 'Brand'), Row.content_action !== 'none' && Chip(Row.content_action === 'remove' ? 'Removed' : 'Not for For You'), Row.account_action !== 'none' && Chip(Cap(Row.account_action), Row.account_action === 'ban' ? 'Bad' : 'Warn')),
						El('div', { class: 'Quote' }, El('span', { class: 'Faint' }, `${Cap(TargetNoun[Row.target_type])} at the time`), Snapshot.text || El('span', { class: 'Faint' }, 'No text')),
						El('div', {}, El('div', { class: 'StepTitle', style: 'margin-bottom:4px' }, 'Moderator reason'), El('div', {}, Row.decision_reason)),
						Row.target_type !== 'user' && Link(`/admin/review/${Row.target_type}/${Row.target_id}`, { class: 'Btn Small', style: 'align-self:flex-start' }, 'View content', Icon('open', 14)))),
					El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Appeal', El('span', { class: 'Faint' }, Ago(Row.created_at) + ' ago')), El('div', { class: 'PanelBody Stack' },
						El('div', { class: 'Quote Focus' }, El('span', { class: 'Faint' }, `@${Row.username} wrote`), Row.reason),
						Row.contact_email && El('div', { class: 'Faint' }, 'Contact: ', El('span', { class: 'Mono' }, Row.contact_email)),
						Row.status !== 'pending' ? El('div', { class: `Hint ${Row.status === 'restored' ? 'Info' : 'Warn'}` }, `${Row.status === 'restored' ? 'Restored' : 'Upheld'} by @${Row.reviewer ?? 'unknown'}: ${Row.resolution}`)
							: El('div', { class: 'Row' }, Btn(['Uphold', El('kbd', {}, 'U')], () => Decide('upheld')), Btn(['Restore', El('kbd', { style: 'color:inherit;background:transparent;border-color:rgba(255,255,255,.4)' }, 'R')], () => Decide('restored'), 'Primary'))))),
				Account && El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Account standing', El('span', { class: 'Grow' }), StandingChip(Account.standing, Account.user.suspended_at), Link(`/admin/accounts/${Row.user_id}`, { class: 'Btn Ghost Small' }, 'Open', Icon('open', 14))),
					El('div', { class: 'PanelBody Columns' }, Meters(Account.standing), Timeline(Account.standing.decisions.slice(0, 4), null)))));
		}
		Fill(Body, El('div', { class: 'Page' },
			El('div', { class: 'Toolbar' }, El('div', { class: 'Tabs' }, [['pending', 'Pending'], ['restored', 'Restored'], ['upheld', 'Upheld']].map(([Key, Label]) => Link(`/admin/appeals?status=${Key}`, { class: `Tab${Status === Key ? ' Active' : ''}` }, Label, Key === 'pending' && Counts.appeals ? El('span', { class: 'Count' }, Counts.appeals) : null)))),
			El('div', { class: 'Split' }, El('div', { class: 'Panel List' }, Items.length ? Items : El('div', { class: 'Empty' }, El('span', {}, 'No appeals'))), Detail)));
		await Show(Selected);
	}

	async function LogPage(Params) {
		SetTitle(['Enforcement log']);
		const Filters = { action: Params.get('action') ?? '', category: Params.get('category') ?? '' };
		const Query = () => new URLSearchParams(Object.entries(Filters).filter(([, Value]) => Value)).toString();
		const Tbody = El('tbody');
		const More = Btn('Load more', () => Load(Before), '', { hidden: true });
		let Before = null;
		async function Load(After) {
			const Data = await Api(`decisions?${Query()}${After ? '&before=' + After : ''}`);
			for (const Row of Data.decisions) Tbody.append(El('tr', { onclick: () => Row.target_type === 'user' ? Navigate(`/admin/accounts/${Row.owner_id}`) : Navigate(`/admin/review/${Row.target_type}/${Row.target_id}`), style: Row.reversed_at ? 'opacity:.55' : '' },
				El('td', { class: 'Num Faint', title: When(Row.created_at) }, Ago(Row.created_at)),
				El('td', {}, El('div', { class: 'Row', style: 'gap:8px' }, El('img', { class: 'Avatar', src: Row.avatar, alt: '' }), El('span', { class: 'Clip' }, Row.owner ? `@${Row.owner}` : 'Deleted'))),
				El('td', {}, El('div', { class: 'Faint', style: 'font-size:11px' }, TargetNoun[Row.target_type], ' ', El('span', { class: 'Mono' }, Row.target_id)), El('div', { class: 'Clip', style: 'max-width:280px' }, Short(Row.snapshot?.text ?? '', 80))),
				El('td', {}, Chip(PolicyLabel(Row.category))),
				El('td', {}, El('div', { class: 'Row', style: 'flex-wrap:wrap;gap:4px' }, Row.content_action !== 'none' && Chip(Row.content_action === 'remove' ? 'Removed' : 'Not for FYF'), Row.account_action !== 'none' && Chip(Cap(Row.account_action), { warning: 'Info', strike: 'Warn', ban: 'Bad' }[Row.account_action]), (Row.restrictions ?? []).map(Feature => Chip(FeatureLabel(Feature), 'Warn')))),
				El('td', { class: 'Muted' }, Row.moderator ? `@${Row.moderator}` : 'System'),
				El('td', {}, Row.reversed_at ? Chip('Reversed') : Chip('Active', 'Good'))));
			Before = Data.decisions.at(-1)?.id; More.hidden = !Data.hasMore;
		}
		const Filter = (Key, Options) => El('select', { class: 'Select', 'aria-label': Key, onchange: Event => { Filters[Key] = Event.target.value; Navigate(`/admin/log?${Query()}`, true); } }, Options.map(([Value, Label]) => El('option', { value: Value, selected: Filters[Key] === Value }, Label)));
		Fill(Body, El('div', { class: 'Page' },
			El('div', { class: 'Toolbar' }, Filter('action', [['', 'All actions'], ['warning', 'Warnings'], ['strike', 'Strikes'], ['ban', 'Bans'], ['none', 'Content or restriction only']]), Filter('category', [['', 'All policies'], ...Policies.map(([Key, Label]) => [Key, Label])])),
			El('div', { class: 'Panel', style: 'overflow-x:auto' }, El('table', { class: 'Table' }, El('thead', {}, El('tr', {}, ['When', 'Account', 'Target', 'Policy', 'Actions', 'By', 'Status'].map(Head => El('th', {}, Head)))), Tbody)),
			El('div', { style: 'margin-top:12px;text-align:center' }, More)));
		await Load(null);
		if (!Tbody.children.length) Tbody.append(El('tr', {}, El('td', { colspan: 7 }, El('div', { class: 'Empty' }, El('span', {}, 'No decisions match these filters.')))));
	}

	async function AccountsPage(Params) {
		const Query = Params.get('q') ?? '';
		SetTitle(['Accounts']);
		SearchBox.value = Query;
		const Data = await Api(`users?q=${encodeURIComponent(Query)}`);
		const Field = El('input', { class: 'Input', type: 'search', value: Query, placeholder: 'Username, name, ID, or IP address', style: 'width:320px', onkeydown: Event => { if (Event.key === 'Enter') Navigate(`/admin/accounts?q=${encodeURIComponent(Event.target.value.trim())}`, true); } });
		Fill(Body, El('div', { class: 'Page' },
			El('div', { class: 'Toolbar' }, Field, Query && El('span', { class: 'Faint' }, `${Data.users.length}${Data.hasMore ? '+' : ''} matches`)),
			El('div', { class: 'Panel', style: 'overflow-x:auto' }, Data.users.length ? El('table', { class: 'Table' }, El('thead', {}, El('tr', {}, ['Account', 'ID', 'Role', 'Joined', 'Videos', 'Followers', 'Strikes', 'Status'].map(Head => El('th', {}, Head)))),
				El('tbody', {}, Data.users.map(Row => El('tr', { onclick: () => Navigate(`/admin/accounts/${Row.id}`) },
					El('td', {}, El('div', { class: 'Row' }, El('img', { class: 'Avatar', src: Row.avatar, alt: '' }), El('div', {}, El('div', { class: 'Row', style: 'font-weight:600' }, Row.display_name, Row.verified && VerifiedCheck(), AccountBadges(Row)), El('div', { class: 'Faint' }, `@${Row.username}`)))),
					El('td', { class: 'Mono Faint' }, Row.id), El('td', {}, Row.role === 'admin' ? Chip('Admin', 'Info') : El('span', { class: 'Muted' }, 'Member')),
					El('td', { class: 'Faint Num' }, Ago(Row.created_at)), El('td', { class: 'Num' }, Row.videos), El('td', { class: 'Num' }, Row.followers), El('td', { class: 'Num' }, Row.violations),
					El('td', {}, Row.deactivated_at ? Chip(Row.delete_after ? 'Deleting' : 'Deactivated', 'Warn') : Row.suspended_at ? Chip('Banned', 'Bad') : Chip('Active', 'Good'))))))
				: El('div', { class: 'Empty' }, El('span', {}, 'No accounts match.')))));
		if (!Query) Field.focus();
	}

	let IpKey = '';
	const Unlocked = new Map();
	async function AccountPage(UserId, Params) {
		const Data = await Api(`users/${UserId}`);
		const U = Data.user;
		const Tab = ['enforcement', 'content', 'reports', 'security'].includes(Params.get('tab')) ? Params.get('tab') : 'enforcement';
		SetTitle([['Accounts', '/admin/accounts'], `@${U.username}`]);
		const Refresh = () => Navigate(location.pathname + location.search, true);
		const Owner = { id: U.id, username: U.username, standing: Data.standing };
		const Opened = Unlocked.get(U.id);
		const Reveal = async Key => { Unlocked.set(U.id, await Api(`users/${U.id}/ips`, { key: Key })); IpKey = Key; Refresh(); };
		const AskKey = () => {
			const Input = El('input', { class: 'Input Mono', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Security key', 'aria-label': 'Security key' });
			Modal({ Title: 'Show IPs', Confirm: 'Show', Body: [El('p', { class: 'Muted', style: 'margin:0 0 10px' }, 'Enter the instance security key. Only people who allowed it have an IP to show.'), Input], OnConfirm: () => Reveal(Input.value) });
			setTimeout(() => Input.focus(), 0);
		};
		const OptedOut = U.ip_consent === false;
		const IpButton = OptedOut ? null : !Boot.ipKey ? Btn('Show IPs', null, 'Small', { disabled: true, title: 'Set up a security key on the server with npm run ip-key' })
			: Opened ? null : Btn('Show IPs', () => IpKey ? Reveal(IpKey).catch(() => { IpKey = ''; AskKey(); }) : AskKey(), 'Small');
		const IpCell = (Kind, Row) => {
			if (!Row?.ip) return El('span', { class: 'Faint' }, 'Unknown');
			if (Row.ip === 'hidden') return El('span', { class: 'Faint' }, OptedOut ? 'User has opted out from their ip being visible' : U.ip_consent === true ? 'Recorded before they allowed it' : U.ip_consent === null ? 'Hasn’t answered yet' : 'Hidden');
			const Shown = Opened?.[Kind]?.[Row.id];
			return El('button', { type: 'button', class: 'Mono IpBlur', disabled: !Shown, title: Shown ? 'Click to show' : 'Locked', onclick: Event => Event.currentTarget.classList.toggle('Shown') }, Shown ?? '000.000.000.000');
		};
		const Actions = U.self ? [] : [
			U.role !== 'admin' && !U.deactivated_at && (U.suspended_at ? Btn('Unban', () => AskReason({ Title: `Unban @${U.username}?`, Text: 'Reverses every active ban on the account.', Confirm: 'Unban', OnConfirm: async Reason => { await Api(`users/${U.id}/unsuspend`, { reason: Reason }); Toast('Account unbanned'); Refresh(); } }))
				: Btn('Ban', () => AskReason({ Title: `Ban @${U.username}?`, Text: 'Permanent until reversed or appealed. Signs the account out everywhere and hides its content.', Confirm: 'Ban', Danger: true, OnConfirm: async Reason => { await Api(`users/${U.id}/suspend`, { reason: Reason }); Toast('Account banned'); Refresh(); } }), 'Danger')),
			Btn(U.role === 'admin' ? 'Remove admin' : 'Make admin', () => Modal({ Title: U.role === 'admin' ? `Remove admin from @${U.username}?` : `Make @${U.username} an admin?`, Body: El('p', { class: 'Muted', style: 'margin:0' }, U.role === 'admin' ? 'They lose access to this console.' : 'They get full access to this console and instance settings.'), OnConfirm: async () => { await Api(`users/${U.id}/role`, { role: U.role === 'admin' ? 'member' : 'admin' }); Toast('Role updated'); Refresh(); } })),
			Btn('Delete', () => { const Confirm = El('input', { class: 'Input', placeholder: U.username }); Modal({ Title: `Delete @${U.username}?`, Danger: true, Confirm: 'Delete forever', Body: [El('p', { class: 'Muted', style: 'margin:0' }, 'Deletes the account, its videos and files, and its avatar. This can’t be undone. Type the username to confirm.'), Confirm], OnConfirm: async () => { await Api(`users/${U.id}/delete`, { confirm: Confirm.value }); Toast('Account deleted'); Navigate('/admin/accounts'); } }); }, 'Ghost Danger'),
		];
		Actions.unshift(Btn(U.verified ? 'Remove verification' : 'Verify account', () => Modal({
			Title: U.verified ? `Remove verification from @${U.username}?` : `Verify @${U.username}?`,
			Body: El('p', { class: 'Muted', style: 'margin:0' }, U.verified ? 'Removes the verified badge from this account.' : 'Adds the verified badge to this account on this instance.'),
			Confirm: U.verified ? 'Remove verification' : 'Verify account',
			OnConfirm: async () => { await Api(`users/${U.id}/verification`, { verified: !U.verified }); Toast(U.verified ? 'Verification removed' : 'Account verified'); Refresh(); },
		})));
		Actions.unshift(El('a', { href: '/@' + U.username, target: '_blank', rel: 'noopener', class: 'Btn' }, 'View profile'));
		const Panels = {
			enforcement: () => El('div', { class: 'Columns' },
				El('div', { class: 'Stack' }, El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Strikes', El('span', { class: 'Faint' }, `Expire after ${Data.standing.thresholds.strikeDays} days`)), El('div', { class: 'PanelBody' }, Meters(Data.standing))),
					El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Active restrictions'), El('div', { class: 'PanelBody' }, Restrictions(Data.standing, Refresh)))),
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Enforcement history', El('span', { class: 'Faint' }, Data.standing.decisions.length)), El('div', { class: 'PanelBody' }, Timeline(Data.standing.decisions, Refresh)))),
			content: () => El('div', { class: 'Stack' },
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Videos', El('span', { class: 'Faint' }, Data.videos.length)), El('div', { class: 'PanelBody' }, Data.videos.length ? El('div', { class: 'Grid' }, Data.videos.map(Video => VideoCard(Video, Owner, Refresh))) : El('p', { class: 'Faint', style: 'margin:0' }, 'No videos.'))),
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Comments', El('span', { class: 'Faint' }, Data.comments.length)), Data.comments.length ? El('table', { class: 'Table' }, El('tbody', {}, Data.comments.map(Comment => CommentRow(Comment, Owner, Refresh)))) : El('div', { class: 'PanelBody Faint' }, 'No comments.'))),
			reports: () => El('div', { class: 'Columns' }, [['Reports against this account', Data.reportsAgainst], ['Reports this account filed', Data.reportsFiled]].map(([Heading, Rows]) => El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, Heading, El('span', { class: 'Faint' }, Rows.length)),
				Rows.length ? El('table', { class: 'Table' }, El('tbody', {}, Rows.map(Report => El('tr', { onclick: () => Report.target_type === 'user' ? Navigate(`/admin/review/user/${Report.target_id}`) : Navigate(`/admin/review/${Report.target_type}/${Report.target_id}`) },
					El('td', {}, Chip(PolicyLabel(Report.category))), El('td', { class: 'Grow' }, El('div', { class: 'Faint', style: 'font-size:11px' }, Report.target_type), El('div', { class: 'Clip', style: 'max-width:260px' }, Report.description || Report.comment_body || Report.message_text || Report.video_description || '')),
					El('td', {}, Chip(Report.status, Report.status === 'open' ? 'Brand' : '')), El('td', { class: 'Faint Num' }, Ago(Report.created_at)))))) : El('div', { class: 'PanelBody Faint' }, 'None.')))),
			security: () => El('div', { class: 'Columns' },
				El('div', { class: 'Stack' },
					El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Sign-up', El('span', { class: 'Grow' }), IpButton), El('div', { class: 'PanelBody' }, El('dl', { class: 'Kv', style: 'margin:0' },
						El('dt', {}, 'Joined'), El('dd', {}, When(U.created_at)), El('dt', {}, 'Sign-up IP'), El('dd', {}, IpCell('events', Data.signup)), El('dt', {}, 'Countries'), El('dd', {}, Data.seen.countries.join(', ') || 'Unknown'),
						El('dt', {}, 'Languages'), El('dd', {}, Data.seen.languages.join(', ') || 'Unknown'), El('dt', {}, 'Distinct IPs'), El('dd', { class: 'Num' }, Data.seen.ips)))),
					El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Active sessions', El('span', { class: 'Grow' }), !U.self && Data.sessions.length ? Btn('Sign out everywhere', () => Modal({ Title: 'Sign out every session?', Body: El('p', { class: 'Muted', style: 'margin:0' }, 'Every device has to sign in again.'), Danger: true, Confirm: 'Sign out', OnConfirm: async () => { await Api(`users/${U.id}/sessions/revoke`, { session: 'all' }); Toast('Signed out everywhere'); Refresh(); } }), 'Small') : null),
						Data.sessions.length ? El('table', { class: 'Table' }, El('tbody', {}, Data.sessions.map(Session => El('tr', { style: 'cursor:default' }, El('td', {}, El('div', {}, IpCell('sessions', Session)), El('div', { class: 'Faint Clip', style: 'max-width:260px;font-size:11px' }, Session.user_agent ?? '')),
							El('td', { class: 'Faint Num' }, `Seen ${Ago(Session.last_seen_at)}`), El('td', {}, !U.self && Btn('Revoke', async () => { try { await Api(`users/${U.id}/sessions/revoke`, { session: Session.id }); Toast('Session revoked'); Refresh(); } catch (Error) { Fail(Error); } }, 'Small Ghost')))))) : El('div', { class: 'PanelBody Faint' }, 'No active sessions.')),
					El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Accounts sharing an IP', El('span', { class: 'Faint' }, Data.related.length)), Data.related.length ? El('table', { class: 'Table' }, El('tbody', {}, Data.related.map(Row => El('tr', { onclick: () => Navigate(`/admin/accounts/${Row.id}`) }, El('td', {}, El('div', { class: 'Row' }, El('img', { class: 'Avatar', src: Row.avatar, alt: '' }), `@${Row.username}`)), El('td', { class: 'Faint' }, `${Row.shared} shared IP${Row.shared === 1 ? '' : 's'}`), El('td', {}, Row.suspended_at ? Chip('Banned', 'Bad') : null))))) : El('div', { class: 'PanelBody Faint' }, 'None.'))),
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Activity'), El('table', { class: 'Table' }, El('tbody', {}, Data.events.map(Event => El('tr', { style: 'cursor:default' }, El('td', {}, { signup: 'Signed up', password_reset: 'Reset password by email', login: 'Signed in', login_failed: 'Failed sign-in', username_change: 'Changed username', profile_change: 'Edited profile', deactivated: 'Deactivated account', reactivated: 'Reactivated account', data_requested: 'Requested their data', data_downloaded: 'Downloaded their data' }[Event.kind] ?? Event.kind, Event.detail && El('div', { class: 'Faint', style: 'font-size:11px' }, Event.detail)),
					El('td', { class: 'Faint' }, Event.ip ? IpCell('events', Event) : ''), El('td', { class: 'Faint' }, Event.country ?? ''), El('td', { class: 'Faint Num', title: When(Event.created_at) }, Ago(Event.created_at)))))))),
		};
		Fill(Body, El('div', { class: 'Page Stack' },
			El('div', { class: 'Panel Profile' }, El('img', { class: 'Avatar Large', src: U.avatar, alt: '' }),
				El('div', { class: 'Grow' }, El('div', { class: 'Row' }, El('h2', {}, U.display_name), U.verified && VerifiedCheck(), AccountBadges(U), StandingChip(Data.standing, U.suspended_at && !U.deactivated_at), U.deactivated_at && Chip(U.delete_after ? `Deleting ${new Date(U.delete_after).toLocaleDateString()}` : 'Deactivated', 'Warn'), U.role === 'admin' && Chip('Admin', 'Info')),
					El('div', { class: 'Muted' }, `@${U.username}`), El('div', { class: 'Facts' }, El('span', { class: 'Mono' }, U.id), El('span', {}, `Joined ${new Date(U.created_at).toLocaleDateString()}`), El('span', {}, `${U.stats.followerCount} followers`), El('span', {}, `${U.stats.videoCount} videos`), El('span', {}, `${U.stats.heartCount} likes`)),
					U.bio && El('p', { style: 'margin:8px 0 0;overflow-wrap:anywhere' }, U.bio)),
				El('div', { class: 'ProfileActions' }, !U.self && U.role !== 'admin' && Btn('Take action', () => EnforceDrawer({ Type: 'user', Target: U.id, Owner, Title: `Act on @${U.username}`, OnDone: Refresh }), 'Primary'), Actions)),
			El('div', { class: 'Tabs' }, [['enforcement', 'Enforcement'], ['content', 'Content'], ['reports', 'Reports'], ['security', 'Security']].map(([Key, Label]) => Link(`/admin/accounts/${U.id}?tab=${Key}`, { class: `Tab${Tab === Key ? ' Active' : ''}` }, Label))),
			Panels[Tab]()));
	}

	function VideoCard(Video, Owner, Refresh) {
		return El('div', { class: 'Card' }, El('img', { src: Video.cover, alt: '', loading: 'lazy' }), El('div', { class: 'Tags' }, Video.removed && Chip('Removed', 'Bad')),
			El('div', { class: 'Meta' }, El('div', { class: 'Clamp' }, Video.description || El('span', { class: 'Faint' }, 'No caption')), El('div', { class: 'Faint Num', style: 'margin-top:4px;font-size:11px' }, `${Video.views} views · ${Video.likes} likes · ${Ago(Video.created_at)}`)),
			El('div', { class: 'Actions' }, Link(`/admin/review/video/${Video.id}`, { class: 'Btn Small' }, 'Review'), Owner && Btn('Act', () => EnforceDrawer({ Type: 'video', Target: Video.id, Owner, Title: 'Act on this video', OnDone: Refresh }), 'Small'),
				Btn('Delete', () => Modal({ Title: 'Delete this video?', Danger: true, Confirm: 'Delete', Body: El('p', { class: 'Muted', style: 'margin:0' }, 'Deletes the video and its files without a moderation record. Prefer Act → Remove so the account is told why.'), OnConfirm: async () => { await Api(`videos/${Video.id}/delete`, {}); Toast('Video deleted'); Refresh(); } }), 'Small Ghost Danger')));
	}
	function CommentRow(Comment, Owner, Refresh) {
		return El('tr', { style: 'cursor:default' }, El('td', { style: 'width:100%' }, El('div', { class: 'Faint', style: 'font-size:11px' }, `On @${Comment.video_author}'s video · ${Ago(Comment.created_at)}`), El('div', { style: 'overflow-wrap:anywhere' }, Comment.body)),
			El('td', {}, El('div', { class: 'Row', style: 'gap:6px' }, Link(`/admin/review/comment/${Comment.id}`, { class: 'Btn Small' }, 'Review'), Owner && Btn('Act', () => EnforceDrawer({ Type: 'comment', Target: Comment.id, Owner, Title: 'Act on this comment', OnDone: Refresh }), 'Small'))));
	}

	async function ContentPage(Params) {
		const Tab = Params.get('tab') === 'comments' ? 'comments' : 'videos';
		SetTitle(['Content']);
		const Holder = El('div');
		const More = Btn('Load more', () => Load(Before), '', { hidden: true });
		let Before = null, Grid = null, Tbody = null;
		async function Load(After) {
			const Data = await Api(`${Tab}${After ? '?before=' + After : ''}`);
			const Rows = Tab === 'videos' ? Data.videos : Data.comments;
			if (Tab === 'videos') { Grid ??= Holder.appendChild(El('div', { class: 'Grid' })); for (const Video of Rows) Grid.append(VideoCard({ ...Video }, { id: Video.author_id, username: Video.username }, () => Navigate(location.pathname + location.search, true))); }
			else { Tbody ??= Holder.appendChild(El('div', { class: 'Panel', style: 'overflow-x:auto' }, El('table', { class: 'Table' }, El('tbody')))).querySelector('tbody'); for (const Comment of Rows) Tbody.append(CommentRow(Comment, { id: Comment.author_id, username: Comment.username }, () => Navigate(location.pathname + location.search, true))); }
			Before = Rows.at(-1)?.id; More.hidden = !Data.hasMore;
			if (!Rows.length && !After) Fill(Holder, El('div', { class: 'Panel Empty' }, El('span', {}, `No ${Tab} yet.`)));
		}
		Fill(Body, El('div', { class: 'Page' }, El('div', { class: 'Toolbar' }, El('div', { class: 'Tabs' }, [['videos', 'Videos'], ['comments', 'Comments']].map(([Key, Label]) => Link(`/admin/content?tab=${Key}`, { class: `Tab${Tab === Key ? ' Active' : ''}` }, Label)))), Holder, El('div', { style: 'margin-top:14px;text-align:center' }, More)));
		await Load(null);
	}

	async function PoliciesPage() {
		SetTitle(['Policies']);
		const Settings = await Api('settings');
		const M = structuredClone(Settings.moderation);
		const Number_ = (Value, Set, Min, Max) => El('input', { class: 'Input Num', type: 'number', min: Min, max: Max, value: Value, oninput: Event => Set(Number(Event.target.value)) });
		const Save = Btn('Save policy limits', async () => { try { await Api('settings/moderation', { value: M }); Toast('Policy limits saved'); } catch (Error) { Fail(Error); } }, 'Primary');
		Fill(Body, El('div', { class: 'Page Stack', style: 'max-width:980px' },
			El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'How enforcement works'), El('div', { class: 'PanelBody Muted', style: 'line-height:1.6' },
				'A first violation is a warning and never counts. After that, each violation is a strike that expires after the strike period. Strikes count against the feature where they happened, the policy, and the account total. Reaching any limit permanently bans the account. Severe violations can skip the warning or ban right away. Feature restrictions are separate and timed.')),
			El('div', { class: 'Columns' },
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Account limits'), El('div', { class: 'PanelBody Form' },
					El('label', { class: 'Field' }, El('span', {}, 'Strike expiry (days)'), Number_(M.strikeDays, Value => { M.strikeDays = Value; }, 7, 365)),
					El('label', { class: 'Field' }, El('span', {}, 'Strikes per feature'), Number_(M.feature, Value => { M.feature = Value; }, 2, 50), El('small', {}, 'Videos, comments, direct messages, profile, LIVE.')),
					El('label', { class: 'Field' }, El('span', {}, 'Strikes on the account'), Number_(M.total, Value => { M.total = Value; }, 2, 100)))),
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Strikes per policy', El('span', { class: 'Faint' }, 'Lower means stricter')), El('table', { class: 'Table Thresholds' }, El('tbody', {},
					Policies.map(([Key, Label, Phrase]) => El('tr', { style: 'cursor:default' }, El('td', {}, El('div', { style: 'font-weight:600' }, Label), El('div', { class: 'Faint', style: 'font-size:11px' }, Phrase)), El('td', { style: 'text-align:right' }, Number_(M.policy[Key], Value => { M.policy[Key] = Value; }, 1, 50)))))))),
			El('div', { class: 'Row' }, El('span', { class: 'Grow' }), Save)));
	}

	async function InstancePage() {
		SetTitle(['Instance']);
		const S = await Api('settings');
		const Saver = (Key, Read, Label) => async () => { try { await Api(`settings/${Key}`, { value: Read() }); Toast(`${Label} saved`); } catch (Error) { Fail(Error); } };
		const Name = El('input', { class: 'Input', value: S.name, maxlength: 60 });
		const Registration = El('select', { class: 'Select' }, [['open', 'Open: anyone can sign up'], ['invite', 'Invite only'], ['closed', 'Closed']].map(([Value, Label]) => El('option', { value: Value, selected: S.registration === Value }, Label)));
		const FeatureNames = Boot.features;
		const Features = Object.fromEntries(Object.keys(FeatureNames).map(Key => [Key, S.features[Key] !== false]));
		const MB = El('input', { class: 'Input Num', type: 'number', value: S.limits.videoMB, min: 1, max: 2048 }), Seconds = El('input', { class: 'Input Num', type: 'number', value: S.limits.videoSeconds, min: 1, max: 3600 });
		const Announcement = El('textarea', { class: 'Text', maxlength: 500, value: S.announcement.text, placeholder: 'Shown as a banner across the app' }), AnnouncementLink = El('input', { class: 'Input', value: S.announcement.link, placeholder: 'https://… or /path (optional)' });
		const Rules = El('textarea', { class: 'Text', style: 'min-height:160px', maxlength: 10000, value: S.rules, placeholder: 'Shown at /rules and during sign-up' });
		const Slots = { wordmarkDark: 'Wordmark on dark', wordmarkLight: 'Wordmark on light', icon: 'App icon', favicon: 'Favicon', avatar: 'Default profile photo' };
		const M = S.mail;
		const MailHost = El('input', { class: 'Input', value: M.host, placeholder: 'smtp.example.com', autocomplete: 'off' });
		const MailPort = El('input', { class: 'Input Num', type: 'number', value: M.port, min: 1, max: 65535, style: 'width:110px' });
		const MailSecure = El('select', { class: 'Select' }, [['starttls', 'STARTTLS'], ['tls', 'SSL/TLS']].map(([Value, Label]) => El('option', { value: Value, selected: M.secure === Value }, Label)));
		MailSecure.addEventListener('change', () => { if (['465', '587', ''].includes(MailPort.value)) MailPort.value = MailSecure.value === 'tls' ? 465 : 587; });
		const MailUser = El('input', { class: 'Input', value: M.username, autocomplete: 'off', placeholder: 'Optional' });
		const MailPassword = El('input', { class: 'Input', type: 'password', autocomplete: 'new-password', placeholder: M.hasPassword ? 'Unchanged' : 'Optional' });
		const MailFrom = El('input', { class: 'Input', value: M.from, placeholder: 'Kittok <no-reply@example.com>' });
		const MailTo = El('input', { class: 'Input', type: 'email', placeholder: 'you@example.com' });
		const MailSource = El('span', { class: 'Faint' }, M.source === 'env' ? 'From .env' : M.source === 'admin' ? 'Set here' : 'Not set up');
		Fill(Body, El('div', { class: 'Page Stack', style: 'max-width:980px' },
			El('div', { class: 'Columns' },
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Identity and sign-up'), El('div', { class: 'PanelBody Form' }, El('label', { class: 'Field' }, El('span', {}, 'Instance name'), Name), El('label', { class: 'Field' }, El('span', {}, 'Registration'), Registration),
					El('label', { class: 'ToggleRow' }, El('span', { class: 'Switch' }, El('input', { type: 'checkbox', checked: S.mailCodes, disabled: !S.mailReady, onchange: async Event => { try { await Api('settings/mailcodes', { value: Event.target.checked }); Toast('Email codes saved'); } catch (Error) { Event.target.checked = !Event.target.checked; Fail(Error); } } }), El('span')), El('span', {}, 'Email code at sign-up', El('small', {}, S.mailReady ? 'New accounts confirm their email with a 6-digit code' : 'Needs SMTP_URL and MAIL_FROM; sign-up skips the code until then'))),
					El('div', { class: 'Row' }, El('span', { class: 'Grow' }), Btn('Save', async () => { await Saver('name', () => Name.value.trim(), 'Name')(); await Saver('registration', () => Registration.value, 'Registration')(); }, 'Primary')))),
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Uploads'), El('div', { class: 'PanelBody Form' }, El('label', { class: 'Field' }, El('span', {}, 'Largest video (MB)'), MB), El('label', { class: 'Field' }, El('span', {}, 'Longest video (seconds)'), Seconds),
					El('div', { class: 'Row' }, El('span', { class: 'Grow' }), Btn('Save', Saver('limits', () => ({ videoMB: Number(MB.value), videoSeconds: Number(Seconds.value) }), 'Upload limits'), 'Primary'))))),
			El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Email (SMTP)', MailSource), El('div', { class: 'PanelBody Form' },
				El('div', { class: 'Row', style: 'gap:12px;flex-wrap:wrap;align-items:flex-end' }, El('label', { class: 'Field Grow' }, El('span', {}, 'Server'), MailHost), El('label', { class: 'Field' }, El('span', {}, 'Port'), MailPort), El('label', { class: 'Field' }, El('span', {}, 'Security'), MailSecure)),
				El('div', { class: 'Row', style: 'gap:12px;flex-wrap:wrap' }, El('label', { class: 'Field Grow' }, El('span', {}, 'Username'), MailUser), El('label', { class: 'Field Grow' }, El('span', {}, 'Password'), MailPassword)),
				El('label', { class: 'Field' }, El('span', {}, 'From'), MailFrom),
				El('div', { class: 'Row', style: 'gap:12px;flex-wrap:wrap;align-items:flex-end' }, El('label', { class: 'Field Grow' }, El('span', {}, 'Send a test to'), MailTo), Btn('Send test', async () => { try { await Api('mail/test', { to: MailTo.value.trim() }); Toast('Test email sent'); } catch (Error) { Fail(Error); } }),
					El('span', { class: 'Grow' }), Btn('Save', async () => { try { await Api('settings/mail', { value: { host: MailHost.value.trim(), port: Number(MailPort.value), secure: MailSecure.value, username: MailUser.value.trim(), password: MailPassword.value, from: MailFrom.value.trim() } }); Toast(MailHost.value.trim() ? 'Email settings saved' : 'Email settings cleared'); Navigate(location.pathname, true); } catch (Error) { Fail(Error); } }, 'Primary')))),
			El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Features', El('span', { class: 'Faint' }, 'Turning one off hides it in the app')), El('div', { class: 'PanelBody' }, El('div', { class: 'Toggles' }, Object.keys(FeatureNames).map(Key => El('label', { class: 'ToggleRow' }, El('span', { class: 'Switch' }, El('input', { type: 'checkbox', checked: Features[Key], onchange: async Event => { Features[Key] = Event.target.checked; await Saver('features', () => Features, FeatureNames[Key])(); } }), El('span')), FeatureNames[Key]))))),
			El('div', { class: 'Columns' },
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Announcement'), El('div', { class: 'PanelBody Form' }, Announcement, AnnouncementLink, El('div', { class: 'Row' }, El('span', { class: 'Grow' }), Btn('Publish', Saver('announcement', () => ({ text: Announcement.value.trim(), link: AnnouncementLink.value.trim() }), 'Announcement'), 'Primary')))),
				El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Rules'), El('div', { class: 'PanelBody Form' }, Rules, El('div', { class: 'Row' }, El('span', { class: 'Grow' }), Btn('Save', Saver('rules', () => Rules.value.trim(), 'Rules'), 'Primary'))))),
			El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Brand images', El('span', { class: 'Faint' }, 'PNG, JPEG, or WebP up to 2 MB')), El('div', { class: 'PanelBody' }, El('div', { class: 'Grid', style: 'grid-template-columns:repeat(auto-fill,minmax(200px,1fr))' }, Object.entries(Slots).map(([Slot, Label]) => {
				const Picker = El('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async Event => { const File = Event.target.files[0]; if (!File) return; const Form = new FormData(); Form.append('file', File); try { await Api(`brand/${Slot}`, Form); Toast(`${Label} updated`); Navigate(location.pathname, true); } catch (Error) { Fail(Error); } } });
				return El('div', { class: 'Card' }, El('div', { style: `display:grid;place-items:center;height:96px;background:${Slot === 'wordmarkLight' ? '#fff' : '#111'}` }, El('img', { src: `${S.brand[Slot].url}?v=${Date.now()}`, alt: '', style: 'max-width:80%;max-height:64px;width:auto;aspect-ratio:auto;background:none' })),
					El('div', { class: 'Meta Row' }, El('span', { class: 'Grow' }, Label), S.brand[Slot].custom && Chip('Custom', 'Info')), El('div', { class: 'Actions' }, Picker, Btn('Upload', () => Picker.click(), 'Small'), S.brand[Slot].custom && Btn('Reset', async () => { try { await Api(`brand/${Slot}/reset`, {}); Toast(`${Label} reset`); Navigate(location.pathname, true); } catch (Error) { Fail(Error); } }, 'Small Ghost')));
			}))))));
	}

	async function MiscPage() {
		SetTitle(['Misc']);
		const S = await Api('settings');
		const Names = Boot.misc;
		const State = Object.fromEntries(Object.keys(Names).map(Key => [Key, S.misc[Key] !== false]));
		const Save = async (Key, Input) => {
			State[Key] = Input.checked;
			try { await Api('settings/misc', { value: State }); Toast(`${Names[Key][0]} ${Input.checked ? 'on' : 'off'}`); } catch (Error) { State[Key] = Input.checked = !Input.checked; Fail(Error); }
		};
		Fill(Body, El('div', { class: 'Page Stack', style: 'max-width:980px' },
			El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Kittok features', El('span', { class: 'Faint' }, 'Changes apply on the next page load')), El('div', { class: 'PanelBody' }, El('div', { class: 'Toggles MiscToggles' }, Object.entries(Names).map(([Key, [Label, Hint]]) => {
				const Input = El('input', { type: 'checkbox', checked: State[Key], onchange: () => Save(Key, Input) });
				return El('label', { class: 'ToggleRow' }, El('span', { class: 'Switch' }, Input, El('span')), El('span', { class: 'Stack', style: 'gap:2px' }, El('span', {}, Label), El('span', { class: 'Faint', style: 'font-size:12px' }, Hint)));
			}))))));
	}

	async function InvitesPage() {
		SetTitle(['Invites']);
		const Data = await Api('invites');
		const Uses = El('input', { class: 'Input Num', type: 'number', value: 1, min: 1, max: 100, style: 'width:90px' }), Days = El('input', { class: 'Input Num', type: 'number', value: 7, min: 1, max: 90, style: 'width:90px' });
		const Created = El('div');
		Fill(Body, El('div', { class: 'Page Stack', style: 'max-width:980px' },
			Data.registration !== 'invite' && El('div', { class: 'Hint Warn' }, `Registration is ${Data.registration}, so invites aren’t required right now.`),
			El('div', { class: 'Panel' }, El('div', { class: 'PanelHead' }, 'Create an invite'), El('div', { class: 'PanelBody Row', style: 'flex-wrap:wrap;gap:12px' }, El('label', { class: 'Field' }, El('span', {}, 'Uses'), Uses), El('label', { class: 'Field' }, El('span', {}, 'Valid for (days)'), Days), El('span', { class: 'Grow' }),
				Btn('Create invite', async () => { try { const Invite = await Api('invites', { uses: Number(Uses.value), days: Number(Days.value) }); Fill(Created, El('div', { class: 'Hint Info', style: 'margin-top:12px' }, 'Copy this now. It is shown once. Code: ', El('span', { class: 'Mono', style: 'user-select:all;color:var(--text)' }, Invite.code), El('br'), 'Sign-up link: ', El('span', { class: 'Mono', style: 'user-select:all;color:var(--text);overflow-wrap:anywhere' }, `${location.origin}/signup?invite=${Invite.code}`))); } catch (Error) { Fail(Error); } }, 'Primary')), El('div', { style: 'padding:0 14px 14px' }, Created)),
			El('div', { class: 'Panel', style: 'overflow-x:auto' }, El('div', { class: 'PanelHead' }, 'Open invites', El('span', { class: 'Faint' }, Data.invites.length)), Data.invites.length ? El('table', { class: 'Table' }, El('thead', {}, El('tr', {}, ['Invite', 'Created by', 'Used', 'Expires', ''].map(Head => El('th', {}, Head)))), El('tbody', {}, Data.invites.map(Invite => El('tr', { style: 'cursor:default' },
				El('td', { class: 'Mono' }, Invite.id.slice(0, 12)), El('td', {}, `@${Invite.username}`), El('td', { class: 'Num' }, `${Invite.uses} of ${Invite.max_uses}`), El('td', { class: 'Faint' }, new Date(Invite.expires_at).toLocaleDateString()),
				El('td', {}, Btn('Revoke', () => Modal({ Title: 'Revoke this invite?', Danger: true, Confirm: 'Revoke', Body: El('p', { class: 'Muted', style: 'margin:0' }, 'Nobody can sign up with it anymore.'), OnConfirm: async () => { await Api(`invites/${Invite.id}/delete`, {}); Toast('Invite revoked'); Navigate(location.pathname, true); } }), 'Small Ghost Danger'))))))
				: El('div', { class: 'PanelBody Faint' }, 'No open invites.'))));
	}

	async function AuditPage() {
		SetTitle(['Audit log']);
		const Tbody = El('tbody');
		const More = Btn('Load more', () => Load(Before), '', { hidden: true });
		let Before = null;
		async function Load(After) {
			const Data = await Api(`audit${After ? '?before=' + After : ''}`);
			for (const Row of Data.actions) Tbody.append(El('tr', { style: 'cursor:default' }, El('td', { class: 'Faint Num', title: When(Row.created_at) }, Ago(Row.created_at)), El('td', {}, Row.username ? `@${Row.username}` : 'Deleted'), El('td', {}, Chip(Row.action)), El('td', { class: 'Mono' }, Row.target), El('td', { class: 'Muted', style: 'overflow-wrap:anywhere' }, Row.detail)));
			Before = Data.actions.at(-1)?.id; More.hidden = !Data.hasMore;
		}
		Fill(Body, El('div', { class: 'Page' }, El('div', { class: 'Panel', style: 'overflow-x:auto' }, El('table', { class: 'Table' }, El('thead', {}, El('tr', {}, ['When', 'Admin', 'Action', 'Target', 'Detail'].map(Head => El('th', {}, Head)))), Tbody)), El('div', { style: 'margin-top:12px;text-align:center' }, More)));
		await Load(null);
	}

	setInterval(() => { if (document.visibilityState === 'visible' && Root.isConnected) RefreshCounts(); }, 60000);

	function Column() { return document.querySelector('[id^="main-content"]'); }
	function Mount() {
		const Main = Column();
		if (!Main) return false;
		if (Root.parentElement !== Main) Main.append(Root);
		if (!Layer.isConnected) document.body.append(Layer);
		document.documentElement.dataset.kittokAdmin = '';
		return true;
	}
	function Unmount() {
		for (const Clean of Teardown) Clean();
		Teardown = []; PageKeys = {};
		Root.remove(); Layer.replaceChildren(); delete document.documentElement.dataset.kittokAdmin;
		for (const Item of document.querySelectorAll('[data-kittok-admin-nav]')) Item.remove();
	}
	for (const Method of ['pushState', 'replaceState']) {
		const Native = history[Method].bind(history);
		history[Method] = (...Arguments) => { Native(...Arguments); if (!IsAdminPath() && Root.isConnected) Unmount(); };
	}
	addEventListener('kittok-admin-route', () => { if (Root.isConnected) Route(); else location.reload(); });
	setInterval(() => {
		if (Root.isConnected && IsAdminPath() && location.pathname + location.search !== Routed) Route();
		else if (Routed && Root.isConnected !== IsAdminPath()) location.reload();
	}, 150);
	let Restored = false;
	const Restore = () => {
		if (Restored || !document.querySelector('#app > *')) return;
		Restored = true; history.replaceState(null, '', window.__KittokAdminPath ?? '/admin');
	};
	const Start = () => {
		Restore();
		if (!Mount()) return false;
		Restore(); Route();
		return true;
	};
	if (!Start()) {
		const Waiting = new MutationObserver(() => { if (Start()) Waiting.disconnect(); });
		Waiting.observe(document.documentElement, { childList: true, subtree: true });
	}
	new MutationObserver(() => { if (IsAdminPath() && !Root.isConnected && Column()) Mount(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
