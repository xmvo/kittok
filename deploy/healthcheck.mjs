const Response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3210}/health/ready`, {
	headers: { host: new URL(process.env.PUBLIC_ORIGIN).host },
	signal: AbortSignal.timeout(4000),
});
if (!Response.ok) process.exit(1);
