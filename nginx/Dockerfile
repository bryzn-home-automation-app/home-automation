FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .

# WiFi credentials shown on the /wifi tab. Inlined into the bundle at build time
# by Vite (import.meta.env.VITE_*). Passed as build args from docker-compose so
# the real values live in the root .env, not in source control.
ARG VITE_WIFI_SSID
ARG VITE_WIFI_PASSWORD
ENV VITE_WIFI_SSID=$VITE_WIFI_SSID \
    VITE_WIFI_PASSWORD=$VITE_WIFI_PASSWORD

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
