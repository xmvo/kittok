window.KittokStudioUploader = class {
	constructor(Options) {
		this.Options = Options ?? {};
		this.Files = new Map();
		this.Handlers = {};
		this.Requests = new Map();
	}
	use() { return this; }
	refreshSTSToken() {}
	selectRoute() {}
	on(Name, Handler) { (this.Handlers[Name] ??= []).push(Handler); return this; }
	off(Name, Handler) { this.Handlers[Name] = (this.Handlers[Name] ?? []).filter(Item => Handler && Item !== Handler); return this; }
	removeAllListeners(Name) { if (Name) delete this.Handlers[Name]; else this.Handlers = {}; return this; }
	emit(Name, Value) { for (const Handler of this.Handlers[Name] ?? []) Handler(Value); }
	addFile(Option) {
		const Key = `kittok-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		this.Files.set(Key, Option);
		return Key;
	}
	removeFile(Key) { this.cancel(Key); this.Files.delete(Key); }
	removeAsset(Key) { this.removeFile(Key); }
	cancel(Key) { this.Requests.get(Key)?.abort(); this.Requests.delete(Key); }
	pause(Key) { this.cancel(Key); }
	resume(Key) { this.start(Key); }
	restart(Key) { this.start(Key); }
	start(Key) {
		const Option = this.Files.get(Key);
		if (!Option) return;
		const File = Option.file, Image = Option.type === 'image' || /^image\//.test(File?.type ?? ''), Started = Date.now();
		const Emit = (Name, Value) => this.emit(Name, { key: Key, startTime: Started, ...Value });
		const Request = new XMLHttpRequest();
		this.Requests.set(Key, Request);
		Request.open('POST', `/api/v1/kittok/studio/upload?type=${Image ? 'image' : 'video'}`);
		Request.setRequestHeader('content-type', File.type || 'application/octet-stream');
		Request.upload.onprogress = Event => Event.lengthComputable && Emit('progress', { percent: Math.min(99, Math.round(Event.loaded / Event.total * 100)), stage: 'uploading' });
		Request.onerror = () => Emit('error', { stage: 'upload', extra: { message: 'NetworkError', errorCode: 0 } });
		Request.onload = () => {
			this.Requests.delete(Key);
			let Data = {};
			try { Data = JSON.parse(Request.responseText); } catch {}
			if (Request.status !== 200) return Emit('error', { stage: 'upload', extra: { message: Data.error ?? 'UploadFailed', errorCode: Request.status } });
			Emit('progress', { percent: 100, stage: 'uploading' });
			Emit('complete', { type: 'success', percent: 100, stage: 'complete', oid: Data.uri, uploadResult: Image
				? { Uri: Data.uri, ImageUri: Data.uri, ImageWidth: Data.width, ImageHeight: Data.height, ImageFormat: 'jpeg', Encryption: { Uri: Data.uri, SecretKey: '', Algorithm: '', SourceMd5: '' } }
				: { Vid: Data.uri, Uri: Data.uri, PosterUri: Data.cover, VideoMeta: { Width: Data.width, Height: Data.height, Duration: Data.duration, Codec: 'h264', Uri: Data.uri, FileType: 'video' } } });
		};
		Request.send(File);
	}
	uploadImage(File) {
		return new Promise((Resolve, Reject) => {
			const Key = this.addFile({ file: File, type: 'image' });
			this.on('complete', Value => Value.key === Key && Resolve(Value.uploadResult));
			this.on('error', Value => Value.key === Key && Reject(new Error(Value.extra.message)));
			this.start(Key);
		});
	}
};
