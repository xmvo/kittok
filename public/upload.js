(() => {
	const Form = document.getElementById('upload'), Status = document.getElementById('status');
	const Config = JSON.parse(document.getElementById('upload-config').textContent);
	const Input = Form.elements.video, Zone = document.getElementById('drop-zone'), Preview = document.getElementById('video-preview');
	const Progress = document.getElementById('upload-progress'), Posted = document.getElementById('posted-link');
	const Change = document.getElementById('change-video'), Name = document.getElementById('file-name');
	let Selected, PreviewUrl, Busy = false;
	function SetFile(File) {
		if (!File) return;
		if (Config.maxBytes && File.size > Config.maxBytes) { Status.textContent = 'This video is too large.'; return; }
		Selected = File;
		if (PreviewUrl) URL.revokeObjectURL(PreviewUrl);
		if (Preview) { PreviewUrl = URL.createObjectURL(File); Preview.src = PreviewUrl; Preview.hidden = false; Zone.hidden = true; Change.hidden = false; Input.required = false; }
		if (Name) Name.textContent = File.name;
		Status.textContent = ''; if (Posted) Posted.hidden = true;
	}
	Input.addEventListener('change', () => SetFile(Input.files[0]));
	if (Zone) {
		Zone.addEventListener('keydown', Event => { if (['Enter', ' '].includes(Event.key)) { Event.preventDefault(); Input.click(); } });
		Zone.addEventListener('dragover', Event => { Event.preventDefault(); if (!Busy) Zone.classList.add('drag-over'); });
		Zone.addEventListener('dragleave', () => Zone.classList.remove('drag-over'));
		Zone.addEventListener('drop', Event => { Event.preventDefault(); Zone.classList.remove('drag-over'); if (!Busy) SetFile(Event.dataTransfer.files[0]); });
		Change.addEventListener('click', () => Input.click());
		Form.elements.description.addEventListener('input', () => { document.getElementById('caption-count').textContent = `${Form.elements.description.value.length} / 2200`; });
	}
	function Reset() {
		if (PreviewUrl) URL.revokeObjectURL(PreviewUrl); PreviewUrl = null; Selected = null;
		if (Preview) { Preview.removeAttribute('src'); Preview.hidden = true; Zone.hidden = false; Change.hidden = true; Input.required = true; Name.textContent = ''; document.getElementById('caption-count').textContent = '0 / 2200'; }
		if (Progress) { Progress.hidden = true; Progress.value = 0; }
	}
	Form.addEventListener('reset', Event => { if (Busy) { Event.preventDefault(); return; } Reset(); Status.textContent = ''; if (Posted) Posted.hidden = true; });
	Form.addEventListener('submit', Event => {
		Event.preventDefault(); if (Busy) return;
		const File = Selected ?? Input.files[0]; if (!File) { Status.textContent = 'Select a video first.'; return; }
		Busy = true; const Controls = [...Form.querySelectorAll('button,input,textarea,select')]; Controls.forEach(Control => { Control.disabled = true; });
		Status.textContent = 'Uploading…'; if (Progress) { Progress.hidden = false; Progress.value = 0; }
		const Story = Form.elements.story?.checked ?? false;
		const Query = new URLSearchParams({ description: Form.elements.description.value, visibility: Form.elements.visibility?.value ?? 'public', comments: Form.elements.comments?.value ?? 'default', category: Form.elements.category?.value ?? '', story: Story ? '1' : '0' });
		const Request = new XMLHttpRequest(); Request.open('POST', '/api/v1/videos?' + Query);
		Request.setRequestHeader('content-type', File.type || 'video/mp4'); Request.setRequestHeader('x-csrf-token', Config.csrf);
		Request.upload.onprogress = Event => { if (Event.lengthComputable && Progress) Progress.value = Event.loaded / Event.total * 100; if (Event.loaded === Event.total) Status.textContent = 'Processing video…'; };
		Request.onload = () => {
			let Result; try { Result = JSON.parse(Request.responseText); } catch {}
			if (Request.status < 200 || Request.status >= 300 || !Result?.id) { Status.textContent = Result?.error ?? 'Couldn’t post. Try again.'; return; }
			Busy = false; Reset(); Form.reset(); Status.textContent = Story ? 'Your story has been posted. It disappears after 24 hours.' : 'Your video has been posted.';
			if (Posted) { Posted.href = Story ? '/@' + Config.username : '/@' + Config.username + '/video/' + Result.id; Posted.textContent = Story ? 'View profile' : 'View video'; Posted.hidden = false; }
		};
		Request.onerror = () => { Status.textContent = 'Connection lost. Try again.'; };
		Request.onloadend = () => { Busy = false; Controls.forEach(Control => { Control.disabled = false; }); };
		Request.send(File);
	});
	window.addEventListener('beforeunload', Event => { if (Busy) { Event.preventDefault(); Event.returnValue = ''; } });
})();
