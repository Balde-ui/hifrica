FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/engine ./apps/engine
RUN pnpm install --frozen-lockfile --filter @hifrica/engine...
RUN pnpm --filter @hifrica/engine... build
WORKDIR /repo/apps/engine
# Après le build (sinon pnpm install sauterait les devDependencies, dont TypeScript).
# En production, WEBHOOK_ALLOW_PRIVATE est ignoré : les webhooks vers des IP privées restent bloqués.
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
