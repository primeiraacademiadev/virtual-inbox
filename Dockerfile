# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY web/package*.json ./web/
RUN npm ci --prefix web --no-audit --no-fund --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
# SDK is compiled by the unit tests and TypeScript build; keep it in builder only.
COPY sdk ./sdk
COPY scripts ./scripts
COPY README.md ./
COPY docs ./docs
COPY web ./web
RUN npm run build

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    SMTP_HOST=0.0.0.0 \
    PORT=3000 \
    HTTPS_PORT=3443 \
    SMTP_PORT=2525 \
    SMTPS_PORT=2465 \
    DEMO_PORT=3001 \
    DEMO_HTTPS_PORT=3444 \
    TLS_MODE=auto \
    TLS_SERVER_NAMES_FILE=/app/config/tls-names.json \
    TLS_CERTIFICATES_DIR=/app/data/certificates \
    TLS_MANAGED_IDENTITY_FILE=/app/data/certificates/imported-identity.json \
    NETWORK_SETTINGS_FILE=/app/data/network-settings.json
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data && chown node:node /app/data
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts && npm cache clean --force
COPY config ./config
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
USER node
VOLUME ["/app/data"]
EXPOSE 3000 3443 2525 2465 3001 3444
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "require('node:http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node","dist/src/server.js"]
