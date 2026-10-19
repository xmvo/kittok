FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run source && mkdir -p /var/lib/kittok/client /var/lib/kittok/media && chown -R node:node /var/lib/kittok
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210 CLIENT_DIR=/var/lib/kittok/client MEDIA_DIR=/var/lib/kittok/media
USER node
EXPOSE 3210
ENTRYPOINT ["sh", "deploy/entrypoint.sh"]
