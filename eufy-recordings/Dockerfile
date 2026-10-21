FROM node:24-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Runs as root: the bridge's session file it reads (mounted read-only) is root-only (0600).
CMD ["node", "src/server.mjs"]
