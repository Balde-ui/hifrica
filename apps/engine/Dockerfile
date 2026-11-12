FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/engine ./apps/engine
RUN pnpm install --frozen-lockfile --filter @hifrica/engine...
RUN pnpm --filter @hifrica/engine... build
WORKDIR /repo/apps/engine
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
