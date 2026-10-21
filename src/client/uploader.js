class KittokUploader {
	constructor(Options) {
		this.Options = Options;
		this.Files = new Map();
		this.Handlers = {};
	}
	on(Name, Handler) { this.Handlers[Name] = Handler; }
	addFile(Option) {
		const Key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		this.Files.set(Key, Option);
		return Key;
	}
	start(Key) {
		const Option = this.Files.get(Key), Image = Option.type === 'image', Emit = (Name, Value) => this.Handlers[Name]?.({ key: Key, ...Value });
		const Request = new XMLHttpRequest();
		Request.open('POST', `/api/v1/im/media?type=${Image ? 'image' : 'video'}`);
		Request.setRequestHeader('content-type', Option.file.type || 'application/octet-stream');
		Request.upload.onprogress = Event => Event.lengthComputable && Emit('progress', { percent: Math.min(99, Math.round(Event.loaded / Event.total * 100)) });
		Request.onerror = () => Emit('error', { extra: { message: 'NetworkError', errorCode: 0 } });
		Request.onload = () => {
			let Data = {};
			try { Data = JSON.parse(Request.responseText); } catch {}
			if (Request.status !== 200) return Emit('error', { extra: { message: Data.error ?? 'UploadFailed', errorCode: Request.status } });
			Emit('progress', { percent: 100 });
			Emit('complete', { type: 'success', oid: Data.uri, duration: Data.duration, uploadResult: Image
				? { Uri: Data.uri, ImageWidth: Data.width, ImageHeight: Data.height, ImageFormat: 'jpeg', Encryption: { Uri: Data.uri, SecretKey: '', Algorithm: '', SourceMd5: '' } }
				: { Vid: Data.uri, PosterUri: Data.cover, VideoMeta: { Width: Data.width, Height: Data.height, Duration: Data.duration, Codec: 'h264' } } });
		};
		Request.send(Option.file);
	}
}
