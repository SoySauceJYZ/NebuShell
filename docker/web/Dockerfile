# NebuShell Web edition — headless server image.
#
#   docker build -f docker/web/Dockerfile -t nebushell-web .
#   docker run -d --name nebushell -p 127.0.0.1:8080:8080 -v nebushell-data:/data nebushell-web
#
# Put an HTTPS reverse proxy in front (docs/web/README.md). The vault, settings and
# history live in /data; keep that volume.

# ---- build ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /src
# Electron and the desktop-only native modules are not needed to build the web bundles.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_ignore_scripts=true
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:web:client && npm run build:web:server

# ---- runtime -------------------------------------------------------------------------
FROM node:22-bookworm-slim
# tar: directory downloads to the browser; openssh-client/ca-certificates: handy for the
# server-local shell the agent may use (git, curl over https, ssh-keygen …).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tar ca-certificates openssh-client curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system nebushell \
 && useradd --system --gid nebushell --home-dir /data --shell /bin/bash nebushell \
 && mkdir -p /data /app \
 && chown nebushell:nebushell /data

WORKDIR /app
# The server bundle is self-contained (no node_modules needed at runtime).
COPY --from=build /src/out/web/server ./server
COPY --from=build /src/out/web/client ./client

ENV NODE_ENV=production \
    NEBUSHELL_HOST=0.0.0.0 \
    NEBUSHELL_PORT=8080 \
    NEBUSHELL_DATA_DIR=/data \
    NEBUSHELL_STATIC_DIR=/app/client
USER nebushell
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NEBUSHELL_PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/app/server/index.js"]
