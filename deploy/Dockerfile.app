FROM node:22-alpine AS build

RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY worker/package.json worker/package.json
COPY client/package.json client/package.json
COPY sms-gateway/package.json sms-gateway/package.json
RUN npm ci

COPY scripts scripts
COPY server server
COPY worker worker
RUN npm run db:generate && npm run build -w server && npm run build -w worker

FROM build AS migration

CMD ["./node_modules/.bin/prisma", "migrate", "deploy", "--schema", "server/prisma/schema.prisma"]

FROM build AS production-deps

RUN npm prune --omit=dev

FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl && addgroup -S appointit && adduser -S appointit -G appointit
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=appointit:appointit /app/package.json /app/package-lock.json ./
COPY --from=production-deps --chown=appointit:appointit /app/node_modules node_modules
COPY --from=build --chown=appointit:appointit /app/server/package.json server/package.json
COPY --from=production-deps --chown=appointit:appointit /app/server/node_modules server/node_modules
COPY --from=build --chown=appointit:appointit /app/server/dist server/dist
COPY --from=build --chown=appointit:appointit /app/server/prisma server/prisma
COPY --from=build --chown=appointit:appointit /app/worker/package.json worker/package.json
COPY --from=build --chown=appointit:appointit /app/worker/dist worker/dist

USER appointit
EXPOSE 4201
CMD ["node", "server/dist/src/server.js"]
