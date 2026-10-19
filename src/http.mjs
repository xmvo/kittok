export class HttpError extends Error {
	constructor(Status, Code) { super(Code); this.status = Status; }
}

export function Json(Response, Value, Code = 200) {
	Response.writeHead(Code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
	Response.end(JSON.stringify(Value));
}

export async function ReadRaw(Request, Limit) {
	if (Number(Request.headers['content-length']) > Limit) throw new HttpError(413, 'BodyTooLarge');
	const Chunks = [];
	let Size = 0;
	for await (const Chunk of Request) {
		Size += Chunk.length;
		if (Size > Limit) throw new HttpError(413, 'BodyTooLarge');
		Chunks.push(Chunk);
	}
	return Buffer.concat(Chunks);
}

export async function ReadBody(Request, Limit = 16384) {
	const Text = (await ReadRaw(Request, Limit)).toString('utf8');
	try {
		if (Request.headers['content-type']?.startsWith('application/json')) {
			const Value = JSON.parse(Text || '{}');
			if (!Value || typeof Value !== 'object' || Array.isArray(Value)) throw new Error();
			return Value;
		}
		return Object.fromEntries(new URLSearchParams(Text));
	} catch { throw new HttpError(400, 'InvalidBody'); }
}

export function RequireMethod(Request, Allowed) {
	if (!Allowed.includes(Request.method)) throw new HttpError(405, 'MethodNotAllowed');
}

export function Escape(Value) {
	return String(Value).replace(/[&<>"']/g, Char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[Char]);
}

export function Id(Value) {
	if (!/^[1-9]\d{0,18}$/.test(String(Value)) || BigInt(Value) > 9223372036854775807n) throw new HttpError(400, 'InvalidId');
	return String(Value);
}
