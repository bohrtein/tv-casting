# Built on the server by tv-casting-torrent.service (docker build), so
# there's no registry and nothing to publish. Debian-based, not Alpine:
# webtorrent's native parts (uTP) ship prebuilt only for glibc.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
ENV DATA_DIR=/data PORT_FILE=/gluetun/forwarded_port PORT=11480
CMD ["node", "src/index.js"]
