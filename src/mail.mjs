import { connect as Plain } from 'node:net';
import { connect as Secure } from 'node:tls';
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.mjs';

export function MailConfigured(Config) {
	return Boolean(Config.SmtpUrl && Config.MailFrom);
}

export function SignupCodes(Config) {
	return MailConfigured(Config) && Config.MailCodes !== false;
}

function Session(Socket) {
	let Buffered = '', Pending = null, Failure = null;
	const Lines = [];
	const Wake = () => { const Next = Pending; Pending = null; Next?.(); };
	const Feed = Chunk => {
		Buffered += Chunk.toString('utf8');
		let Index;
		while ((Index = Buffered.indexOf('\r\n')) >= 0) { Lines.push(Buffered.slice(0, Index)); Buffered = Buffered.slice(Index + 2); }
		Wake();
	};
	const Fail = Error => { Failure ??= Error ?? new globalThis.Error('SmtpClosed'); Wake(); };
	const Watch = Target => { Target.on('data', Feed); Target.on('error', Fail); Target.on('close', () => Fail()); };
	Watch(Socket);
	async function Reply(Expected) {
		const Collected = [];
		for (;;) {
			while (!Lines.length) { if (Failure) throw Failure; await new Promise(Resolve => { Pending = Resolve; }); }
			const Line = Lines.shift(); Collected.push(Line);
			if (Line[3] !== '-') break;
		}
		const Code = Number(Collected.at(-1).slice(0, 3));
		if (!Expected.includes(Code)) throw new Error(`Smtp${Code}`);
		return Collected;
	}
	const Send = (Line, Expected) => { Socket.write(Line + '\r\n'); return Reply(Expected); };
	const Release = () => { Socket.off('data', Feed); Socket.removeAllListeners('close'); Socket.removeAllListeners('error'); Socket.on('error', () => {}); };
	return { Reply, Send, Release, Rebind: Next => { Watch(Next); Socket = Next; } };
}

const Header = Value => /^[\x20-\x7e]*$/.test(Value) ? Value : `=?UTF-8?B?${Buffer.from(Value).toString('base64')}?=`;

export async function SendMail(Config, { To, Subject, Text, Html }) {
	if (!MailConfigured(Config)) throw new HttpError(503, 'MailNotConfigured');
	const Url = new URL(Config.SmtpUrl);
	const Implicit = Url.protocol === 'smtps:', Port = Number(Url.port || (Implicit ? 465 : 587)), Host = Url.hostname;
	const From = Config.MailFrom, Address = /<([^>]+)>/.exec(From)?.[1] ?? From;
	let Socket = Implicit ? Secure({ host: Host, port: Port, servername: Host }) : Plain({ host: Host, port: Port });
	Socket.setTimeout(20000, () => Socket.destroy(new Error('SmtpTimeout')));
	try {
		const Smtp = Session(Socket);
		await Smtp.Reply([220]);
		const Name = new URL(Config.Origin).hostname;
		let Features = await Smtp.Send(`EHLO ${Name}`, [250]);
		if (!Implicit) {
			const Local = ['localhost', '127.0.0.1', '[::1]'].includes(Host);
			if (!Features.some(Line => /STARTTLS/i.test(Line)) && !Local) throw new Error('SmtpNoStartTls');
		}
		if (!Implicit && Features.some(Line => /STARTTLS/i.test(Line))) {
			await Smtp.Send('STARTTLS', [220]);
			Smtp.Release();
			const Upgraded = Secure({ socket: Socket, servername: Host });
			await new Promise((Resolve, Reject) => { Upgraded.once('secureConnect', Resolve); Upgraded.once('error', Reject); });
			Smtp.Rebind(Upgraded); Socket = Upgraded;
			Features = await Smtp.Send(`EHLO ${Name}`, [250]);
		}
		if (Url.username) {
			const User = decodeURIComponent(Url.username), Pass = decodeURIComponent(Url.password);
			await Smtp.Send(`AUTH PLAIN ${Buffer.from(`\0${User}\0${Pass}`).toString('base64')}`, [235]);
		}
		await Smtp.Send(`MAIL FROM:<${Address}>`, [250]);
		await Smtp.Send(`RCPT TO:<${To}>`, [250, 251]);
		await Smtp.Send('DATA', [354]);
		const Boundary = randomUUID();
		const Body = [
			`From: ${From}`, `To: <${To}>`, `Subject: ${Header(Subject)}`, `Date: ${new Date().toUTCString()}`,
			`Message-ID: <${randomUUID()}@${Name}>`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${Boundary}"`, '',
			`--${Boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', ...Buffer.from(Text).toString('base64').match(/.{1,76}/g),
			`--${Boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', ...Buffer.from(Html).toString('base64').match(/.{1,76}/g),
			`--${Boundary}--`,
		].join('\r\n');
		await Smtp.Send(`${Body}\r\n.`, [250]);
		await Smtp.Send('QUIT', [221]).catch(() => {});
	} finally { Socket.destroy(); }
}
