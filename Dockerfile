FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json jest.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY clickhouse ./clickhouse
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/clickhouse ./clickhouse
CMD ["node", "dist/server.js"]
