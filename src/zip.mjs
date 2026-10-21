import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { crc32, deflateRawSync } from 'node:zlib';

const Max = 0xFFFFFFFF;

function Record(Fields) {
	const Out = Buffer.alloc(Fields.reduce((Total, [Bytes]) => Total + Bytes, 0));
	let At = 0;
	for (const [Bytes, Value] of Fields) {
		if (Bytes === 8) Out.writeBigUInt64LE(BigInt(Value), At);
		else if (Bytes === 4) Out.writeUInt32LE(Value, At);
		else Out.writeUInt16LE(Value, At);
		At += Bytes;
	}
	return Out;
}

export async function* Zip(Files, When = new Date()) {
	const Time = (When.getHours() << 11) | (When.getMinutes() << 5) | (When.getSeconds() >> 1);
	const Day = (Math.max(When.getFullYear() - 1980, 0) << 9) | ((When.getMonth() + 1) << 5) | When.getDate();
	const Entries = [];
	let Offset = 0;
	for (const File of Files) {
		let Data = null, Size, Crc = 0, Method = 0;
		if (File.Data !== undefined) {
			const Raw = Buffer.from(File.Data);
			const Packed = deflateRawSync(Raw);
			[Data, Method, Size, Crc] = [Packed.length < Raw.length ? Packed : Raw, Packed.length < Raw.length ? 8 : 0, Raw.length, crc32(Raw)];
		} else {
			const Info = await stat(File.Path).catch(() => null);
			if (!Info?.isFile()) continue;
			Size = Info.size;
			if (Size) for await (const Chunk of createReadStream(File.Path, { end: Size - 1 })) Crc = crc32(Chunk, Crc);
		}
		const Packed = Data ? Data.length : Size, Name = Buffer.from(File.Name);
		const Wide = Size >= Max || Packed >= Max, Version = Wide || Offset >= Max ? 45 : 20;
		const Extra = Wide ? Record([[2, 1], [2, 16], [8, Size], [8, Packed]]) : Buffer.alloc(0);
		Entries.push({ Name, Size, Packed, Crc, Method, Version, Offset });
		const Header = Buffer.concat([Record([[4, 0x04034b50], [2, Version], [2, 0x0800], [2, Method], [2, Time], [2, Day], [4, Crc], [4, Wide ? Max : Packed], [4, Wide ? Max : Size], [2, Name.length], [2, Extra.length]]), Name, Extra]);
		yield Header;
		if (Data) yield Data;
		else if (Size) yield* createReadStream(File.Path, { end: Size - 1 });
		Offset += Header.length + Packed;
	}
	const Start = Offset;
	for (const Entry of Entries) {
		const Wide = [Entry.Size, Entry.Packed, Entry.Offset].filter(Value => Value >= Max);
		const Extra = Wide.length ? Record([[2, 1], [2, Wide.length * 8], ...Wide.map(Value => [8, Value])]) : Buffer.alloc(0);
		const Header = Buffer.concat([Record([[4, 0x02014b50], [2, 45], [2, Entry.Version], [2, 0x0800], [2, Entry.Method], [2, Time], [2, Day], [4, Entry.Crc], [4, Math.min(Entry.Packed, Max)], [4, Math.min(Entry.Size, Max)],
			[2, Entry.Name.length], [2, Extra.length], [2, 0], [2, 0], [2, 0], [4, 0], [4, Math.min(Entry.Offset, Max)]]), Entry.Name, Extra]);
		yield Header;
		Offset += Header.length;
	}
	const Size = Offset - Start, Count = Entries.length;
	if (Count >= 0xFFFF || Start >= Max || Size >= Max) {
		yield Record([[4, 0x06064b50], [8, 44], [2, 45], [2, 45], [4, 0], [4, 0], [8, Count], [8, Count], [8, Size], [8, Start]]);
		yield Record([[4, 0x07064b50], [4, 0], [8, Offset], [4, 1]]);
	}
	yield Record([[4, 0x06054b50], [2, 0], [2, 0], [2, Math.min(Count, 0xFFFF)], [2, Math.min(Count, 0xFFFF)], [4, Math.min(Size, Max)], [4, Math.min(Start, Max)], [2, 0]]);
}
