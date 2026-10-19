(() => {
	const Form = document.getElementById('upload');
	const Status = document.getElementById('status');
	const Config = JSON.parse(document.getElementById('upload-config').textContent);
	Form.addEventListener('submit', async Event => {
		Event.preventDefault();
		const Button = Form.querySelector('button');
		Button.disabled = true; Status.textContent = 'Uploading';
		try {
			const File = Form.elements.video.files[0];
			const Response = await fetch('/api/v1/videos?description=' + encodeURIComponent(Form.elements.description.value), {
				method: 'POST', headers: { 'content-type': File.type || 'video/mp4', 'x-csrf-token': Config.csrf }, body: File,
			});
			const Result = await Response.json();
			if (!Response.ok) throw new Error(Result.error);
			Status.textContent = 'Uploaded'; Form.reset();
		} catch (Error) { Status.textContent = Error.message || 'CouldntUpload'; }
		finally { Button.disabled = false; }
	});
})();
