# Dev-only: runs Vite dev server with HMR
# Production builds are handled by nginx/Dockerfile (combined frontend+nginx)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]
