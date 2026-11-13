FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api
# Simulateurs livrés : exemple du prompt IA (A1) et import du catalogue au démarrage (C5).
COPY simulators ./simulators
RUN pnpm install --frozen-lockfile --filter @hifrica/api...
RUN pnpm --filter @hifrica/api... build
WORKDIR /repo/apps/api
# Après le build (sinon pnpm install sauterait les devDependencies, dont TypeScript).
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
