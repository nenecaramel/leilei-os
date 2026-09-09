FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts/build-bridge-browser.mjs ./scripts/build-bridge-browser.mjs
COPY scripts/build-thinking-block-browser.mjs ./scripts/build-thinking-block-browser.mjs
RUN pnpm build

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
