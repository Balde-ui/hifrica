FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @hifrica/api...
RUN pnpm --filter @hifrica/api... build
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
