import { createHash } from 'node:crypto';

const Guid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MaxPayload = 1024 * 1024;
const Sockets = new Map();

function FrameBytes(Opcode, Payload) {
	const Length = Payload.length;
	const Header = Length < 126 ? Buffer.from([0x80 | Opcode, Length]) : Length < 65536 ? Buffer.from([0x80 | Opcode, 126, Length >> 8, Length & 255]) : Buffer.concat([Buffer.from([0x80 | Opcode, 127]), (() => { const Size = Buffer.alloc(8); Size.writeBigUInt64BE(BigInt(Length)); return Size; })()]);
	return Buffer.concat([Header, Payload]);
}

function Send(Socket, Opcode, Payload) {
	if (!Socket.destroyed && Socket.writable) Socket.write(FrameBytes(Opcode, Payload));
}

export function Upgrade(Request, Socket, { User, OnBinary }) {
	const Key = Request.headers['sec-websocket-key'];
	if (!User || !Key || Request.headers.upgrade?.toLowerCase() !== 'websocket') {
		Socket.end(`HTTP/1.1 ${User ? 400 : 401} ${User ? 'Bad Request' : 'Unauthorized'}\r\nconnection: close\r\n\r\n`);
		return;
	}
	const Offered = (Request.headers['sec-websocket-protocol'] ?? '').split(',').map(Value => Value.trim()).filter(Boolean);
	const Protocol = ['pbbp2', 'binary'].find(Value => Offered.includes(Value)) ?? Offered[0];
	const Accept = createHash('sha1').update(Key + Guid).digest('base64');
	Socket.write(['HTTP/1.1 101 Switching Protocols', 'upgrade: websocket', 'connection: Upgrade', `sec-websocket-accept: ${Accept}`, ...(Protocol ? [`sec-websocket-protocol: ${Protocol}`] : []), '', ''].join('\r\n'));
	Socket.setNoDelay(true);
	Socket.SessionHash = User.token_hash;
	const Connections = Sockets.get(User.id) ?? new Set();
	Connections.add(Socket); Sockets.set(User.id, Connections);
	let Buffered = Buffer.alloc(0), Fragments = [], FragmentOpcode = 0;
	const Close = () => {
		Connections.delete(Socket);
		if (!Connections.size && Sockets.get(User.id) === Connections) Sockets.delete(User.id);
		Socket.destroy();
	};
	Socket.setTimeout(90000, Close);
	Socket.on('error', Close);
	Socket.on('close', Close);
	Socket.on('data', Chunk => {
		Buffered = Buffer.concat([Buffered, Chunk]);
		while (Buffered.length >= 2) {
			const Fin = Buffered[0] & 0x80, Opcode = Buffered[0] & 0x0f, Masked = Buffered[1] & 0x80;
			let Length = Buffered[1] & 0x7f, Offset = 2;
			if (Length === 126) { if (Buffered.length < 4) return; Length = Buffered.readUInt16BE(2); Offset = 4; }
			else if (Length === 127) { if (Buffered.length < 10) return; const Big = Buffered.readBigUInt64BE(2); if (Big > BigInt(MaxPayload)) return Close(); Length = Number(Big); Offset = 10; }
			if (!Masked || Length > MaxPayload) return Close();
			if (Buffered.length < Offset + 4 + Length) return;
			const Mask = Buffered.subarray(Offset, Offset + 4);
			const Payload = Buffer.from(Buffered.subarray(Offset + 4, Offset + 4 + Length));
			for (let Index = 0; Index < Payload.length; Index++) Payload[Index] ^= Mask[Index & 3];
			Buffered = Buffered.subarray(Offset + 4 + Length);
			if (Opcode === 8) { Send(Socket, 8, Payload.subarray(0, 2)); return Close(); }
			if (Opcode === 9) { Send(Socket, 10, Payload); continue; }
			if (Opcode === 10) continue;
			if (Opcode === 0 || !Fin) {
				if (Opcode !== 0) FragmentOpcode = Opcode;
				Fragments.push(Payload);
				if (Fragments.reduce((Sum, Part) => Sum + Part.length, 0) > MaxPayload) return Close();
				if (!Fin) continue;
			}
			const Message = Fragments.length ? Buffer.concat(Fragments) : Payload;
			const Kind = Fragments.length ? FragmentOpcode : Opcode;
			Fragments = [];
			if (Kind === 1) { if (Message.toString() === 'hi') Send(Socket, 1, Buffer.from('hi')); continue; }
			if (Kind === 2) Promise.resolve(OnBinary(Message)).then(Reply => { if (Reply) Send(Socket, 2, Reply); }).catch(() => Close());
		}
	});
}

export async function Sweep(Valid) {
	const All = [...Sockets.values()].flatMap(Connections => [...Connections]);
	if (!All.length) return;
	const Live = await Valid([...new Set(All.map(Socket => Socket.SessionHash))]);
	for (const Socket of All) if (!Live.has(Socket.SessionHash)) Socket.destroy();
}

export function Push(UserId, Bytes) {
	for (const Socket of Sockets.get(String(UserId)) ?? []) Send(Socket, 2, Bytes);
}
