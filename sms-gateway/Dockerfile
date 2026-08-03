FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY sms-gateway/package.json sms-gateway/package.json
RUN npm ci --workspace @appointit/sms-gateway --include-workspace-root=false

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY sms-gateway ./sms-gateway
WORKDIR /app/sms-gateway
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/sms-gateway/dist ./dist
COPY sms-gateway/package.json ./package.json
RUN mkdir -p /data/outbox
EXPOSE 4100
CMD ["node", "dist/src/server.js"]
