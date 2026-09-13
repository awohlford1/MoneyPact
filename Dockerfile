FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build

WORKDIR /workspace
ENV CI=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    SCARF_ANALYTICS=false

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/budget-domain/package.json packages/budget-domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/data-access/package.json packages/data-access/package.json
COPY packages/migrations/package.json packages/migrations/package.json
COPY packages/rate-limit/package.json packages/rate-limit/package.json
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci

COPY tsconfig.base.json ./
COPY config/authorization-policy-release-history.json config/authorization-policy-release-history.json
COPY config/rate-limit config/rate-limit
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages/contracts packages/contracts
COPY packages/data-access packages/data-access
COPY packages/migrations packages/migrations
COPY packages/rate-limit packages/rate-limit
RUN npm run build --workspace=@cobudget/api \
    && npm run build --workspace=@cobudget/worker

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime-dependencies

WORKDIR /workspace
ENV CI=true \
    PUPPETEER_SKIP_DOWNLOAD=true \
    SCARF_ANALYTICS=false

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/budget-domain/package.json packages/budget-domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/data-access/package.json packages/data-access/package.json
COPY packages/migrations/package.json packages/migrations/package.json
COPY packages/rate-limit/package.json packages/rate-limit/package.json
RUN npm ci --omit=dev \
    --workspace=@cobudget/api \
    --workspace=@cobudget/worker \
    --workspace=@cobudget/contracts \
    --workspace=@cobudget/data-access \
    --workspace=@cobudget/migrations \
    --workspace=@cobudget/rate-limit \
    && rm -rf node_modules/@scarf

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    API_LISTEN_ADDRESS=0.0.0.0

COPY --from=runtime-dependencies --chown=node:node /workspace/node_modules node_modules
COPY --from=build --chown=node:node /workspace/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /workspace/apps/worker/package.json apps/worker/package.json
COPY --from=build --chown=node:node /workspace/apps/worker/dist apps/worker/dist
COPY --from=build --chown=node:node /workspace/packages/contracts packages/contracts
# The authorization startup guard walks up from the process directory to find
# the released policy history; without it every process fails closed.
COPY --from=build --chown=node:node /workspace/config/authorization-policy-release-history.json config/authorization-policy-release-history.json
COPY --from=build --chown=node:node /workspace/packages/data-access packages/data-access
COPY --from=build --chown=node:node /workspace/packages/migrations packages/migrations
COPY --from=build --chown=node:node /workspace/packages/rate-limit packages/rate-limit
# The rate-limit registry imports its checked-in records from config/rate-limit.
COPY --from=build --chown=node:node /workspace/config/rate-limit config/rate-limit

# The processes invoke Node directly. Remove npm and its documentation from the
# runtime image so build-only tooling and credential-shaped examples cannot ship.
# Dependency READMEs go too: pg's documentation carries example connection
# URLs with embedded passwords that the image scan (CBD-254) rightly refuses,
# and no process reads a README at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && find node_modules packages -type f \( -iname '*.md' -o -iname '*.markdown' -o -iname 'CHANGELOG*' -o -iname 'LICENSE*' -o -iname 'README*' \) -delete

USER node
EXPOSE 3000

# The same image runs either unit. The default is the API; deployments select
# the worker by replacing CMD with ["apps/worker/dist/main.js"].
ENTRYPOINT ["node"]
CMD ["apps/api/dist/main.js"]
