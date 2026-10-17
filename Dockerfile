FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
COPY tests ./tests
COPY tools/claude-bridge ./tools/claude-bridge
# Runtime-gate fixtures import the real adapter from this independent package.
RUN pnpm --dir tools/claude-bridge install --frozen-lockfile
COPY scripts/build-mcp-browser.mjs ./scripts/build-mcp-browser.mjs
# Read by tests/native-live-mac-wake-broker-fallback.test.ts in the runtime gate.
COPY scripts/native-live-mac-daemon.ts ./scripts/native-live-mac-daemon.ts
RUN pnpm build
# The production build gate verifies committed native Wake cursor receipts,
# including stale Wake continuation. Rebuild after updating its test contract.
RUN pnpm test:production-runtime-gate

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
ENV PNPM_CONFIG_ONLY_BUILT_DEPENDENCIES=esbuild
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle

USER node
EXPOSE 3000
CMD ["node", "dist/app/index.js"]
