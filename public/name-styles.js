// TODO: check the name style and nameplate pickers at phone width and in the light theme
(() => {
	const Instance = JSON.parse(document.getElementById('kittok-instance')?.textContent ?? '{}');
	const Fonts = { 11: 'Default', 12: 'Tempo', 3: 'Sakura', 4: 'Jellybean', 6: 'Modern', 7: 'Medieval', 8: '8Bit', 10: 'Vampyre', 13: 'Monkey Bars', 14: 'Mainframe', 15: 'Headbang', 16: 'Journal' };
	const FontOrder = [11, 12, 3, 4, 6, 7, 8, 10, 13, 14, 15, 16];
	const Effects = { 1: 'Solid', 2: 'Gradient', 3: 'Neon', 4: 'Toon', 5: 'Pop', 8: 'Gummy', 7: 'Prism' };
	const EffectOrder = [1, 2, 3, 4, 5, 8, 7];
	const Counts = { 2: 2, 8: 4, 7: 5 };
	const Singles = [2417517, 1874155, 0xc32aff, 0xda0149, 0xf93722, 0xc6a615].map(Color => [Color]);
	const Presets = {
		2: [[2797222, 16762000], [0xe45eff, 2522592], [0xefb4aa, 0xe46ce2], [0xdf4232, 0xbd8fff], [2535780, 9497343], [0xf5983c, 0xe55ae7]],
		8: [[0xe9a9d5, 0xa9ddf0, 0xb9a7ee, 0xb9eacb], [0xff6fc2, 0xf54fa8, 0xff9bd6, 0xd96ab7], [0xffb57a, 0xff936f, 0xff7c78, 0xf06b8a], [0xc4ed65, 0x98de60, 7130467, 4570214], [8173823, 9363664, 0x9d94f5, 6737904], [0xd77bff, 0xb56bff, 0xe45ce5, 9137407]],
		7: [[0xfe9242, 3534206, 0xffe047, 0xff4cd2, 5793266], [0xff3d3d, 0xff8a2a, 0xffd447, 0xff4fa3, 8086015], [7997702, 0xc81e12, 0xf45a18, 0xff9500, 0xffd447], [8316888, 8178687, 8359167, 0xb56dff, 0xf38ad8], [3528287, 1497266, 2147829, 2850047, 7032319], [0xa7e8a1, 0xd9f08c, 0xffe08a, 0xffc4a8, 0xf3b6d9]],
	};
	const PresetsOf = Effect => Presets[Effect] ?? Singles;
	const Defaults = { 1: [], 2: [2797222, 16762000], 3: [6888941], 4: [0xf42098], 5: [1036166], 8: Presets[8][0], 7: Presets[7][0] };
	const Shifts = [[-18, .54, .72], [-5, .66, .6], [9, .56, .68], [22, .6, .63]];
	const Layered = new Set(['Toon', 'Pop', 'Gummy']);

	const Hex = Value => '#' + Value.toString(16).padStart(6, '0');
	const Channels = Value => [(Value >> 16) & 255, (Value >> 8) & 255, Value & 255];
	const Turn = Hue => ((Hue % 360) + 360) % 360;
	function ToHsl(Value) {
		const [R, G, B] = Channels(Value).map(Channel => Channel / 255);
		const Max = Math.max(R, G, B), Min = Math.min(R, G, B), L = (Max + Min) / 2, D = Max - Min;
		if (!D) return [0, 0, L];
		const H = Max === R ? (G - B) / D + (G < B ? 6 : 0) : Max === G ? (B - R) / D + 2 : (R - G) / D + 4;
		return [H * 60, D / (1 - Math.abs(2 * L - 1)), L];
	}
	function FromHsl(H, S, L) {
		const A = S * Math.min(L, 1 - L);
		const F = N => { const K = (N + Turn(H) / 30) % 12; return Math.round(255 * (L - A * Math.max(-1, Math.min(K - 3, 9 - K, 1)))); };
		return (F(0) << 16) | (F(8) << 8) | F(4);
	}
	const Lightness = (Value, Change) => { const [H, S, L] = ToHsl(Value); return FromHsl(H, S, Math.min(1, Math.max(0, Change(L)))); };
	const Luminance = Value => { const [R, G, B] = Channels(Value).map(Channel => { Channel /= 255; return Channel <= .03928 ? Channel / 12.92 : ((Channel + .055) / 1.055) ** 2.4; }); return .2126 * R + .7152 * G + .0722 * B; };
	const Contrast = (A, B) => { const [X, Y] = [Luminance(A), Luminance(B)].sort((P, Q) => Q - P); return (X + .05) / (Y + .05); };
	function Readable(Color, Background, Minimum) {
		const Up = Luminance(Background) < .5;
		let Out = Color;
		for (let Step = 0; Step < 50 && Contrast(Out, Background) < Minimum; Step++) Out = Lightness(Out, L => L + (Up ? .02 : -.02));
		return Out;
	}
	function Tones(Main) {
		const [H, S, L] = ToHsl(Main);
		return { main: Main, light1: Lightness(Main, L => L * 1.2), light2: Lightness(Main, L => L * 1.6), dark2: Lightness(Main, L => L * .2), toon: Lightness(Main, L => Math.max(.12, L * .4)), neon: FromHsl(H, Math.min(1, S * 1.2), Math.min(.6, L + .1)) };
	}
	const FromHue = Hue => FromHsl(Hue, .78, .72);
	const GummyFrom = Hue => Shifts.map(([Shift, S, L]) => FromHsl(Hue + Shift, S, L));
	const HueOf = Color => ToHsl(Color)[0];
	const Same = (A, B) => A.length === B.length && A.every((Value, Index) => Value === B[Index]);

	function BackgroundOf(Node) {
		for (let Item = Node; Item instanceof Element; Item = Item.parentElement) {
			const Match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(Item).backgroundColor);
			if (Match && (Match[4] === undefined || Number(Match[4]) > .5)) return (Number(Match[1]) << 16) | (Number(Match[2]) << 8) | Number(Match[3]);
		}
		return 0x121212;
	}
	const OwnTexts = Node => [...Node.childNodes].filter(Child => Child.nodeType === Node.TEXT_NODE && Child.nodeValue.trim());
	const OwnText = Node => OwnTexts(Node).map(Child => Child.nodeValue).join('').trim();
	const Letters = Text => [...new Intl.Segmenter().segment(Text)].map(Part => Part.segment);
	const Variables = ['--kittok-main', '--kittok-light1', '--kittok-light2', '--kittok-dark2', '--kittok-toon', '--kittok-neon', '--kittok-stops', '--kittok-cycle', '--kittok-x', '--kittok-y', '--kittok-w', '--kittok-h'];

	function Measure(Node) {
		if (!Layered.has(Node.dataset.kittokEffect)) return;
		const Texts = OwnTexts(Node);
		if (!Texts.length) return;
		const Span = document.createRange(); Span.setStartBefore(Texts[0]); Span.setEndAfter(Texts.at(-1));
		const Box = Span.getBoundingClientRect(), Outer = Node.getBoundingClientRect(), Scale = Outer.width / (Node.offsetWidth || 1) || 1;
		const X = (Box.left - Outer.left) / Scale - Node.clientLeft, Y = (Box.top - Outer.top) / Scale - Node.clientTop;
		const Width = Node.clientWidth ? Math.max(0, Math.min(Box.width / Scale, Node.clientWidth - X)) : Box.width / Scale;
		for (const [Name, Value] of [['--kittok-x', X], ['--kittok-y', Y], ['--kittok-w', Width], ['--kittok-h', Box.height / Scale]]) Node.style.setProperty(Name, Value.toFixed(2) + 'px');
	}
	const Watched = new Set();
	const Resized = new ResizeObserver(Entries => { for (const Entry of Entries) Measure(Entry.target); });
	document.fonts?.addEventListener('loadingdone', () => { for (const Node of Watched) Node.isConnected ? Measure(Node) : Watched.delete(Node); });

	function Clear(Node) {
		if (!Node.hasAttribute('data-kittok-style')) return;
		for (const Name of ['kittokStyle', 'kittokFont', 'kittokEffect', 'kittokName', 'kittokLive']) delete Node.dataset[Name];
		for (const Name of Variables) Node.style.removeProperty(Name);
		if (Node.hasAttribute('data-kittok-positioned')) { Node.style.removeProperty('position'); Node.removeAttribute('data-kittok-positioned'); }
		Node.querySelector(':scope > .KittokGummy')?.remove();
		Resized.unobserve(Node); Watched.delete(Node);
	}
	function Name(Node, Style, Live = false) {
		const Text = OwnText(Node);
		const Signature = Style && Text && (Style.font !== 11 || Style.effect !== 1 || Style.colors.length) ? JSON.stringify([Style.font, Style.effect, Style.colors, Text, Live]) : '';
		if (Node.dataset.kittokStyle === Signature && (Node.dataset.kittokEffect !== 'Gummy' || Node.querySelector(':scope > .KittokGummy'))) { if (Signature) Measure(Node); return; }
		Clear(Node);
		if (!Signature) return;
		Node.dataset.kittokStyle = Signature;
		if (Style.font !== 11) Node.dataset.kittokFont = Style.font;
		if (Live) Node.dataset.kittokLive = '';
		const Effect = Effects[Style.effect] ?? 'Solid', Chosen = Style.colors.length ? Style.colors : Defaults[Style.effect] ?? [];
		if (!Chosen.length) return;
		const Background = Style.effect === 4 ? 0x333333 : BackgroundOf(Node.parentElement ?? Node);
		const Colors = Chosen.map(Color => Readable(Color, Background, Style.effect === 2 || Style.effect === 7 ? 2.5 : 3));
		const Tone = Tones(Colors[0]);
		Node.dataset.kittokEffect = Effect; Node.dataset.kittokName = Text;
		for (const Key of ['main', 'light1', 'light2', 'dark2', 'toon', 'neon']) Node.style.setProperty('--kittok-' + Key, Hex(Tone[Key]));
		if (Effect === 'Gradient') {
			const Stops = Colors.length > 1 ? Colors : [Colors[0], Colors[0]];
			Node.style.setProperty('--kittok-stops', Stops.map((Color, Index) => `${Hex(Color)} ${10 + 80 * Index / (Stops.length - 1)}%`).join(', '));
		}
		if (Effect === 'Prism') {
			Node.style.setProperty('--kittok-stops', Array.from({ length: Colors.length + 1 }, (_, Index) => `${Hex(Colors[Index % Colors.length])} ${(100 * Index / Colors.length).toFixed(3)}%`).join(', '));
			Node.style.setProperty('--kittok-cycle', `max(${Letters(Text).length}ch, 38px)`);
		}
		if (Effect === 'Gummy') {
			const Overlay = document.createElement('span'); Overlay.className = 'KittokGummy'; Overlay.setAttribute('aria-hidden', 'true');
			Overlay.append(...Letters(Text).map((Letter, Index) => { const Part = document.createElement('span'); Part.textContent = Letter; Part.style.color = Hex(Colors[Index % Colors.length]); Part.style.setProperty('--kittok-letter', Index); return Part; }));
			Node.append(Overlay);
		}
		if (Layered.has(Effect)) {
			if (!Node.isConnected || getComputedStyle(Node).position === 'static') { Node.style.position = 'relative'; Node.setAttribute('data-kittok-positioned', ''); }
			Measure(Node); Watched.add(Node); Resized.observe(Node);
		}
	}

	function Plate(Row, Chosen, Kind) {
		let Layer = Row.querySelector(':scope > .KittokPlate');
		if (!Chosen) { if (Layer) { Layer.remove(); delete Row.dataset.kittokPlate; } return; }
		if (Layer?.dataset.id === Chosen.id && Row.dataset.kittokPlate === Kind) return;
		Layer?.remove();
		Layer = document.createElement('div'); Layer.className = 'KittokPlate'; Layer.dataset.id = Chosen.id; Layer.setAttribute('aria-hidden', 'true');
		Layer.style.setProperty('--kittok-plate', (Luminance(BackgroundOf(Row)) < .5 ? Chosen.palette.dark : Chosen.palette.light) || '#808080');
		const Art = document.createElement('img'); Art.src = Chosen.image; Art.alt = ''; Art.decoding = 'async'; Art.loading = 'lazy'; Art.dataset.video = Chosen.video;
		Layer.append(Art);
		Row.dataset.kittokPlate = Kind; Row.prepend(Layer);
		if (getComputedStyle(Row).position === 'static') Row.style.position = 'relative';
	}
	const Motion = matchMedia('(prefers-reduced-motion: reduce)');
	function PlayPlate(Row, On) {
		const Layer = Row.querySelector(':scope > .KittokPlate');
		if (!Layer || (On && Motion.matches)) return;
		let Video = Layer.querySelector('video');
		if (On && !Video) {
			Video = document.createElement('video'); Video.muted = true; Video.loop = true; Video.playsInline = true; Video.src = Layer.querySelector('img').dataset.video;
			Video.addEventListener('playing', () => Layer.classList.add('Playing'));
			Layer.append(Video);
		}
		if (!Video) return;
		if (On) Video.play().catch(() => {}); else { Video.pause(); Layer.classList.remove('Playing'); }
	}
	document.addEventListener('pointerover', Event => {
		const Row = Event.target instanceof Element && Event.target.closest('[data-kittok-plate]');
		if (Row && !(Event.relatedTarget instanceof Node && Row.contains(Event.relatedTarget))) PlayPlate(Row, true);
	});
	document.addEventListener('pointerout', Event => {
		const Row = Event.target instanceof Element && Event.target.closest('[data-kittok-plate]');
		if (Row && !(Event.relatedTarget instanceof Node && Row.contains(Event.relatedTarget))) PlayPlate(Row, false);
	});

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
	const Icons = {
		Back: '<svg width="24" height="24" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path d="M14.04 24 30.3 7.74a1 1 0 0 0 0-1.41l-1.42-1.42a1 1 0 0 0-1.41 0L9.8 22.59a2 2 0 0 0 0 2.82l17.67 17.68a1 1 0 0 0 1.41 0l1.42-1.42a1 1 0 0 0 0-1.41L14.04 24Z"/></svg>',
		Pencil: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m13.96 5.46 4.58 4.58a1 1 0 0 0 1.42 0l1.38-1.38a2 2 0 0 0 0-2.82l-3.18-3.18a2 2 0 0 0-2.82 0l-1.38 1.38a1 1 0 0 0 0 1.42ZM2.11 20.16l.73-4.22a3 3 0 0 1 .83-1.61l7.87-7.87a1 1 0 0 1 1.42 0l4.58 4.58a1 1 0 0 1 0 1.42l-7.87 7.87a3 3 0 0 1-1.6.83l-4.23.73a1.5 1.5 0 0 1-1.73-1.73Z"/></svg>',
		Check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
		Dice: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M6 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H6Zm2 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm9.5-1.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9.5 16a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM16 17.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>',
		None: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
	};
	const Stripes = Colors => El('span', { className: 'KittokStripes' }, Colors.map(Color => El('span', { style: `background:${Hex(Color)}` })));

	async function Save(Path, Body) {
		const Response = await fetch(Path, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': Instance.csrfToken }, body: JSON.stringify(Body) });
		if (!Response.ok) throw new Error('CouldntSave');
		return Response.json();
	}
	function Panel(Modal, Title, Label) {
		const Back = El('button', { type: 'button', 'aria-label': 'Back', innerHTML: Icons.Back });
		const Body = El('div', { className: 'KittokNamesBody' });
		const Status = El('p', { className: 'KittokDecorationStatus', role: 'status' });
		const Cancel = El('button', { type: 'button', textContent: 'Cancel' });
		const Apply = El('button', { type: 'button', className: 'Primary', textContent: 'Apply' });
		const Footer = El('div', { className: 'KittokDecorationFooter' }, Status, Cancel, Apply);
		const Root = El('div', { className: 'KittokDecorationPanel KittokNamesPanel', role: 'group', 'aria-label': Label }, El('div', { className: 'KittokDecorationHeader' }, Back, El('h1', { textContent: Title })), Body, Footer);
		const Close = () => Root.remove();
		Back.addEventListener('click', Close); Cancel.addEventListener('click', Close);
		Root.addEventListener('keydown', Event => { if (Event.key === 'Escape' && !Event.defaultPrevented) { Event.stopPropagation(); Close(); } });
		Modal.append(Root); Back.focus();
		return { Root, Body, Status, Apply, Footer, Close };
	}
	function Preview(Modal) {
		const Avatar = Modal.querySelector('[data-e2e="edit-profile-avatar"] img')?.src;
		const DisplayName = Modal.querySelector('[data-e2e="edit-profile-name"] input')?.value.trim() || Instance.account?.displayName || Instance.account?.username || '';
		const Big = El('span', { className: 'KittokNamesBig', textContent: DisplayName });
		const Small = El('span', { className: 'KittokNamesSmall', textContent: DisplayName });
		const Row = El('div', { className: 'KittokNamesComment' }, El('span', { className: 'KittokNamesAvatar' }, Avatar && El('img', { src: Avatar, alt: '' })), El('span', { className: 'KittokNamesLines' }, Small, El('span', { textContent: 'nice video' })));
		return { Node: El('div', { className: 'KittokNamesPreview', 'data-kittok-live': true }, Big, Row), Big, Small, Row };
	}

	function Hue(Value, ToColor, OnChange, OnDone) {
		const Thumb = El('span', { className: 'KittokHueThumb' });
		const Track = El('div', { className: 'KittokHue', role: 'slider', tabIndex: 0, 'aria-label': 'Pick a color', 'aria-valuemin': 0, 'aria-valuemax': 360 }, Thumb);
		Track.style.setProperty('--kittok-track', `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(Degrees => Hex(ToColor(Degrees))).join(', ')})`);
		let Current = Turn(Value);
		const Show = () => { Thumb.style.left = `${Current / 360 * 100}%`; Thumb.style.background = Hex(ToColor(Current)); Track.setAttribute('aria-valuenow', Math.round(Current)); };
		const Set = Degrees => { Current = Math.min(359, Math.max(0, Degrees)); Show(); OnChange(Current); };
		const At = Event => { const Box = Track.getBoundingClientRect(); Set((Event.clientX - Box.left) / Box.width * 360); };
		Track.addEventListener('pointerdown', Event => { Track.setPointerCapture(Event.pointerId); At(Event); });
		Track.addEventListener('pointermove', Event => { if (Track.hasPointerCapture(Event.pointerId)) At(Event); });
		Track.addEventListener('keydown', Event => {
			const Keys = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 };
			if (Event.key in Keys) Set(Current + Keys[Event.key]);
			else if (Event.key === 'Home') Set(0);
			else if (Event.key === 'End') Set(359);
			else if (Event.key === 'Enter' || Event.key === ' ' || Event.key === 'Escape') OnDone();
			else return;
			Event.preventDefault(); Event.stopPropagation();
		});
		Show();
		return Track;
	}

	function EditStyle(Modal, Current, OwnPlate, OnSaved) {
		if (Modal.querySelector('.KittokNamesPanel')) return;
		const { Body, Status, Apply, Footer, Close } = Panel(Modal, 'Display name style', 'Display name style');
		let Font = Current?.font ?? 11, Effect = Current?.effect ?? 1, Popover = null;
		const Picked = { [Effect]: [...(Current?.colors ?? [])] };
		const ColorsOf = Id => Picked[Id] ?? [...Defaults[Id]];
		const View = Preview(Modal);
		Plate(View.Row, OwnPlate, 'Comment');
		const Heading = Text => El('h2', { className: 'KittokNamesHeading', textContent: Text });
		const FontGrid = El('div', { className: 'KittokNamesGrid KittokNamesFonts' }, FontOrder.map(Id => El('button', { type: 'button', className: 'KittokNamesTile', title: Fonts[Id], 'aria-label': Fonts[Id], 'data-id': Id, onclick: () => { Font = Id; Draw(); } }, El('span', { textContent: 'Gg', 'data-kittok-font': Id === 11 ? undefined : Id }))));
		const EffectGrid = El('div', { className: 'KittokNamesGrid KittokNamesEffects', 'data-kittok-live': true }, EffectOrder.map(Id => {
			const Sample = El('span', { textContent: Effects[Id] });
			Name(Sample, { font: 11, effect: Id, colors: Id === 1 ? [] : Defaults[Id] }, true);
			return El('button', { type: 'button', className: 'KittokNamesTile', 'aria-label': Effects[Id], 'data-id': Id, onclick: () => { Effect = Id; Draw(); } }, Sample);
		}));
		const ColorRow = El('div', { className: 'KittokNamesColors' });
		Body.append(View.Node, Heading('Choose Font'), FontGrid, Heading('Choose Effect'), EffectGrid, Heading('Choose Color'), ColorRow);
		const Surprise = El('button', { type: 'button', className: 'KittokNamesSurprise', innerHTML: Icons.Dice, onclick: () => {
			Font = FontOrder[Math.floor(Math.random() * FontOrder.length)]; Effect = EffectOrder[Math.floor(Math.random() * EffectOrder.length)];
			const Options = PresetsOf(Effect); Picked[Effect] = [...Options[Math.floor(Math.random() * Options.length)]]; Draw();
		} }, 'Surprise me');
		Footer.prepend(Surprise);

		function Custom() {
			const Colors = ColorsOf(Effect), Count = Counts[Effect] ?? 1;
			let Stop = 0;
			const Dismiss = () => { Popover?.remove(); Popover = null; ColorRow.querySelector('.KittokNamesCustom')?.focus(); };
			const Box = El('div', { className: 'KittokHuePopover', role: 'dialog', 'aria-label': 'Custom color' });
			const Draw = () => {
				const Colors = ColorsOf(Effect);
				const Chips = Count > 1 && Effect !== 8 ? El('div', { className: 'KittokHueStops' }, Colors.map((Color, Index) => El('button', { type: 'button', 'aria-label': `Color ${Index + 1}`, 'aria-pressed': String(Index === Stop), style: `background:${Hex(Color)}`, onclick: () => { Stop = Index; Draw(); } }))) : null;
				const Slider = Effect === 8
					? Hue(HueOf(Colors[0]) + 18, Degrees => GummyFrom(Degrees)[0], Degrees => { Picked[8] = GummyFrom(Degrees); Paint(); }, Dismiss)
					: Hue(HueOf(Colors[Stop] ?? FromHue(0)), FromHue, Degrees => { const Next = [...ColorsOf(Effect)]; while (Next.length < Count) Next.push(Next.at(-1) ?? FromHue(0)); Next[Stop] = FromHue(Degrees); Picked[Effect] = Next; Paint(); Chips?.children[Stop]?.style.setProperty('background', Hex(Next[Stop])); }, Dismiss);
				Box.replaceChildren(...[Chips, Slider].filter(Boolean));
				Slider.focus();
			};
			if (!Colors.length) Picked[Effect] = Array.from({ length: Count }, () => FromHue(0));
			Popover = Box; ColorRow.append(Box); Draw(); Paint();
		}
		document.addEventListener('pointerdown', function Outside(Event) {
			if (!Body.isConnected) { document.removeEventListener('pointerdown', Outside, true); return; }
			if (Popover && !Popover.contains(Event.target) && !Event.target.closest?.('.KittokNamesCustom')) { Popover.remove(); Popover = null; }
		}, true);

		const Style = () => ({ font: Font, effect: Effect, colors: Effect === 1 && Same(ColorsOf(1), []) ? [] : ColorsOf(Effect) });
		function Paint() {
			const Chosen = Style();
			Name(View.Big, Chosen, true); Name(View.Small, Chosen, true);
			const Colors = ColorsOf(Effect), Matched = (Effect === 1 && !Colors.length) || PresetsOf(Effect).some(Preset => Same(Preset, Colors));
			const CustomTile = ColorRow.querySelector('.KittokNamesCustom');
			if (CustomTile) {
				CustomTile.setAttribute('aria-pressed', String(!Matched));
				CustomTile.querySelector('.KittokStripes')?.replaceWith(Stripes(Matched ? [] : Colors));
			}
			for (const Tile of ColorRow.querySelectorAll('[data-preset]')) Tile.setAttribute('aria-pressed', String(Tile.dataset.preset === JSON.stringify(Colors)));
		}
		function Draw() {
			for (const Tile of FontGrid.children) Tile.setAttribute('aria-pressed', String(Number(Tile.dataset.id) === Font));
			for (const Tile of EffectGrid.children) Tile.setAttribute('aria-pressed', String(Number(Tile.dataset.id) === Effect));
			Popover?.remove(); Popover = null;
			const Swatch = Colors => El('button', { type: 'button', className: 'KittokNamesSwatch', 'data-preset': JSON.stringify(Colors), 'aria-label': Colors.length ? Colors.map(Hex).join(', ') : 'Default color',
				onclick: () => { Picked[Effect] = [...Colors]; Paint(); } }, Stripes(Colors.length ? Colors : [Luminance(BackgroundOf(ColorRow)) < .5 ? 0xffffff : 0x161823]), El('span', { className: 'KittokNamesTick', innerHTML: Icons.Check }));
			ColorRow.replaceChildren(
				El('button', { type: 'button', className: 'KittokNamesSwatch KittokNamesCustom', title: 'Custom color', 'aria-label': 'Custom color', onclick: () => Popover ? (Popover.remove(), Popover = null) : Custom() }, Stripes([]), El('span', { className: 'KittokNamesPencil', innerHTML: Icons.Pencil })),
				...(Effect === 1 ? [Swatch([])] : []), ...PresetsOf(Effect).map(Swatch));
			Paint();
		}
		Draw();
		Apply.addEventListener('click', async () => {
			const Chosen = Style();
			Apply.disabled = true; Status.textContent = 'Saving';
			try {
				const Saved = await Save('/api/v1/profile/name-style', { style: Chosen.font === 11 && Chosen.effect === 1 && !Chosen.colors.length ? null : Chosen });
				OnSaved(Saved.style); Close();
			} catch { Status.textContent = 'CouldntSave'; Apply.disabled = false; }
		});
	}

	let Catalog = null;
	async function EditPlate(Modal, Current, Style, OnSaved) {
		if (Modal.querySelector('.KittokNamesPanel')) return;
		const { Body, Status, Apply, Close } = Panel(Modal, 'Nameplate', 'Nameplate');
		const View = Preview(Modal);
		if (Style) { Name(View.Big, Style, true); Name(View.Small, Style, true); }
		const Search = El('input', { type: 'search', className: 'KittokNamesSearch', placeholder: 'Search nameplates', 'aria-label': 'Search nameplates', disabled: true });
		const List = El('div', { className: 'KittokNamesPlates' });
		Body.append(View.Node, Search, List);
		Status.textContent = 'Loading'; Apply.disabled = true;
		let Selected = Current;
		const Show = Chosen => {
			Selected = Chosen;
			Plate(View.Row, Chosen, 'Comment');
			for (const Tile of List.querySelectorAll('button')) Tile.setAttribute('aria-pressed', String((Tile.dataset.id || null) === (Chosen?.id ?? null)));
		};
		try {
			Catalog ??= fetch('/_kittok/nameplates/catalog').then(Response => { if (!Response.ok) throw new Error('CouldntLoad'); return Response.json(); }).catch(Failure => { Catalog = null; throw Failure; });
			const Data = await Catalog, Items = [];
			const Tile = Chosen => {
				const Button = El('button', { type: 'button', className: 'KittokNamesPlate', 'data-id': Chosen?.id ?? '', title: Chosen?.name ?? 'None', 'aria-label': Chosen ? `${Chosen.name}. ${Chosen.label}` : 'No nameplate', onclick: () => Show(Chosen) });
				if (!Chosen) { Button.innerHTML = Icons.None; return Button; }
				Button.style.setProperty('--kittok-plate', Chosen.palette.dark || '#808080');
				Button.append(El('img', { src: Chosen.image, alt: '', loading: 'lazy', decoding: 'async' }), El('span', { textContent: Chosen.name }));
				return Button;
			};
			List.append(El('section', {}, El('div', { className: 'KittokNamesPlateGrid' }, Tile(null))));
			for (const Collection of Data.collections) {
				const Grid = El('div', { className: 'KittokNamesPlateGrid' }, Collection.items.map(Chosen => { const Button = Tile(Chosen); Items.push([Button, `${Chosen.name} ${Chosen.label} ${Collection.name}`.toLowerCase()]); return Button; }));
				List.append(El('section', {}, El('h2', { className: 'KittokNamesHeading', textContent: Collection.name }), Grid));
			}
			Search.addEventListener('input', () => {
				const Query = Search.value.trim().toLowerCase();
				for (const [Button, Text] of Items) Button.hidden = Boolean(Query) && !Text.includes(Query);
				for (const Section of List.querySelectorAll('section')) Section.hidden = Boolean(Query) && ![...Section.querySelectorAll('button')].some(Button => !Button.hidden && Button.dataset.id);
				Status.textContent = Query && !Items.some(([Button]) => !Button.hidden) ? 'NoResults' : '';
			});
			Show(Current); Status.textContent = ''; Search.disabled = false; Apply.disabled = false;
		} catch { Status.textContent = 'CouldntLoad'; }
		Apply.addEventListener('click', async () => {
			Apply.disabled = true; Status.textContent = 'Saving';
			try { const Saved = await Save('/api/v1/profile/nameplate', { nameplate: Selected?.id ?? '' }); OnSaved(Saved.nameplate); Close(); } catch { Status.textContent = 'CouldntSave'; Apply.disabled = false; }
		});
	}

	window.KittokNames = { Name, Clear, Plate, EditStyle, EditPlate, Fonts, Effects };
})();
