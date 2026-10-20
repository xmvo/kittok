const Varint = 0, Fixed64 = 1, Delimited = 2, Fixed32 = 5;
const Scalars = { int32: Varint, uint32: Varint, sint32: Varint, int64: Varint, uint64: Varint, sint64: Varint, bool: Varint, enum: Varint, double: Fixed64, fixed64: Fixed64, sfixed64: Fixed64, float: Fixed32, fixed32: Fixed32, sfixed32: Fixed32, string: Delimited, bytes: Delimited };
const Mask64 = (1n << 64n) - 1n;

class Writer {
	constructor() { this.Parts = []; this.Size = 0; }
	Push(Part) { this.Parts.push(Part); this.Size += Part.length; }
	Varint(Value) {
		let Big = BigInt.asUintN(64, BigInt(Value));
		const Bytes = [];
		while (Big > 0x7fn) { Bytes.push(Number(Big & 0x7fn) | 0x80); Big >>= 7n; }
		Bytes.push(Number(Big));
		this.Push(Uint8Array.from(Bytes));
	}
	Tag(Id, Wire) { this.Varint((Id << 3) | Wire); }
	Finish() { return Buffer.concat(this.Parts, this.Size); }
}

class Reader {
	constructor(Bytes) { this.Bytes = Bytes; this.Pos = 0; }
	Varint() {
		let Result = 0n, Shift = 0n;
		for (;;) {
			if (this.Pos >= this.Bytes.length) throw new Error('ProtobufTruncated');
			const Byte = this.Bytes[this.Pos++];
			Result |= BigInt(Byte & 0x7f) << Shift;
			if (Byte < 0x80) return Result & Mask64;
			Shift += 7n;
			if (Shift > 63n) throw new Error('ProtobufVarintTooLong');
		}
	}
	Take(Length) {
		if (this.Pos + Length > this.Bytes.length) throw new Error('ProtobufTruncated');
		const Part = this.Bytes.subarray(this.Pos, this.Pos + Length);
		this.Pos += Length;
		return Part;
	}
	Skip(Wire) {
		if (Wire === Varint) this.Varint();
		else if (Wire === Fixed64) this.Take(8);
		else if (Wire === Delimited) this.Take(Number(this.Varint()));
		else if (Wire === Fixed32) this.Take(4);
		else throw new Error('ProtobufUnsupportedWireType');
	}
}

function WriteScalar(Out, Type, Value) {
	switch (Type) {
		case 'string': { const Bytes = Buffer.from(String(Value), 'utf8'); Out.Varint(Bytes.length); Out.Push(Bytes); return; }
		case 'bytes': { const Bytes = typeof Value === 'string' ? Buffer.from(Value, 'base64') : Buffer.from(Value); Out.Varint(Bytes.length); Out.Push(Bytes); return; }
		case 'bool': Out.Varint(Value ? 1 : 0); return;
		case 'sint32': case 'sint64': { const Big = BigInt(Value); Out.Varint(Big >= 0n ? Big << 1n : ((-Big) << 1n) - 1n); return; }
		case 'double': { const Bytes = Buffer.alloc(8); Bytes.writeDoubleLE(Number(Value)); Out.Push(Bytes); return; }
		case 'float': { const Bytes = Buffer.alloc(4); Bytes.writeFloatLE(Number(Value)); Out.Push(Bytes); return; }
		case 'fixed64': case 'sfixed64': { const Bytes = Buffer.alloc(8); Bytes.writeBigUInt64LE(BigInt.asUintN(64, BigInt(Value))); Out.Push(Bytes); return; }
		case 'fixed32': case 'sfixed32': { const Bytes = Buffer.alloc(4); Bytes.writeUInt32LE(Number(Value) >>> 0); Out.Push(Bytes); return; }
		default: Out.Varint(typeof Value === 'number' ? Math.trunc(Value) : Value);
	}
}

function ReadScalar(In, Type) {
	switch (Type) {
		case 'string': return Buffer.from(In.Take(Number(In.Varint()))).toString('utf8');
		case 'bytes': return Buffer.from(In.Take(Number(In.Varint())));
		case 'bool': return In.Varint() !== 0n;
		case 'int32': case 'enum': return Number(BigInt.asIntN(32, In.Varint()));
		case 'uint32': return Number(BigInt.asUintN(32, In.Varint()));
		case 'sint32': { const Value = In.Varint(); return Number((Value >> 1n) ^ -(Value & 1n)); }
		case 'int64': return BigInt.asIntN(64, In.Varint()).toString();
		case 'uint64': return In.Varint().toString();
		case 'sint64': { const Value = In.Varint(); return ((Value >> 1n) ^ -(Value & 1n)).toString(); }
		case 'double': return Buffer.from(In.Take(8)).readDoubleLE();
		case 'float': return Buffer.from(In.Take(4)).readFloatLE();
		case 'fixed64': return Buffer.from(In.Take(8)).readBigUInt64LE().toString();
		case 'sfixed64': return Buffer.from(In.Take(8)).readBigInt64LE().toString();
		case 'fixed32': return Buffer.from(In.Take(4)).readUInt32LE();
		case 'sfixed32': return Buffer.from(In.Take(4)).readInt32LE();
	}
	throw new Error('ProtobufUnknownType');
}

export function Codec(Schema) {
	const Lookup = Name => Schema[Name] ?? (() => { throw new Error(`ProtobufUnknownMessage:${Name}`); })();
	const ById = new Map(Object.entries(Schema).map(([Name, Fields]) => [Name, new Map(Object.entries(Fields).map(([Field, Spec]) => [Spec[0], [Field, ...Spec.slice(1)]]))]));

	function WriteValue(Out, Id, Type, Value) {
		if (Type in Scalars) { Out.Tag(Id, Scalars[Type]); WriteScalar(Out, Type, Value); return; }
		const Bytes = EncodeMessage(Type, Value);
		Out.Tag(Id, Delimited); Out.Varint(Bytes.length); Out.Push(Bytes);
	}

	function EncodeMessage(Name, Value) {
		const Out = new Writer();
		for (const [Field, [Id, Type, Rule, KeyType = 'string']] of Object.entries(Lookup(Name))) {
			const Item = Value?.[Field];
			if (Item === undefined || Item === null) continue;
			if (Rule === 'repeated') { for (const Entry of Item) WriteValue(Out, Id, Type, Entry); continue; }
			if (Rule === 'map') {
				for (const [Key, Entry] of Object.entries(Item)) {
					const Pair = new Writer();
					Pair.Tag(1, Scalars[KeyType]); WriteScalar(Pair, KeyType, Key);
					WriteValue(Pair, 2, Type, Entry);
					const Bytes = Pair.Finish();
					Out.Tag(Id, Delimited); Out.Varint(Bytes.length); Out.Push(Bytes);
				}
				continue;
			}
			WriteValue(Out, Id, Type, Item);
		}
		return Out.Finish();
	}

	function ReadValue(In, Type, Wire) {
		if (Type in Scalars) return ReadScalar(In, Type);
		if (Wire !== Delimited) throw new Error('ProtobufWireMismatch');
		return DecodeMessage(Type, In.Take(Number(In.Varint())));
	}

	function DecodeMessage(Name, Bytes) {
		const Fields = ById.get(Name) ?? Lookup(Name);
		const In = new Reader(Bytes);
		const Result = {};
		while (In.Pos < Bytes.length) {
			const Key = Number(In.Varint());
			const Id = Key >>> 3, Wire = Key & 7;
			const Spec = Fields.get(Id);
			if (!Spec) { In.Skip(Wire); continue; }
			const [Field, Type, Rule, KeyType = 'string'] = Spec;
			if (Rule === 'map') {
				const Pair = new Reader(In.Take(Number(In.Varint())));
				let MapKey = KeyType === 'string' ? '' : '0', MapValue;
				while (Pair.Pos < Pair.Bytes.length) {
					const PairKey = Number(Pair.Varint());
					if (PairKey >>> 3 === 1) MapKey = ReadScalar(Pair, KeyType);
					else if (PairKey >>> 3 === 2) MapValue = ReadValue(Pair, Type, PairKey & 7);
					else Pair.Skip(PairKey & 7);
				}
				(Result[Field] ??= {})[MapKey] = MapValue ?? (Type in Scalars ? (Type === 'string' ? '' : 0) : {});
			} else if (Rule === 'repeated') {
				Result[Field] ??= [];
				if (Wire === Delimited && Type in Scalars && Scalars[Type] !== Delimited) {
					const Packed = new Reader(In.Take(Number(In.Varint())));
					while (Packed.Pos < Packed.Bytes.length) Result[Field].push(ReadScalar(Packed, Type));
				} else Result[Field].push(ReadValue(In, Type, Wire));
			} else Result[Field] = ReadValue(In, Type, Wire);
		}
		return Result;
	}

	return { Encode: EncodeMessage, Decode: (Name, Bytes) => DecodeMessage(Name, Bytes instanceof Uint8Array ? Bytes : new Uint8Array(Bytes)) };
}
