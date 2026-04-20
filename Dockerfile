FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

FROM node:20-alpine

RUN apk add --no-cache ca-certificates tini

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

RUN mkdir -p /app/data && chown -R nodejs:nodejs /app

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs

ENV DATABASE_PATH=/app/data/bot.db
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

VOLUME ["/app/data"]

ENTRYPOINT ["tini", "--"]

CMD ["node", "src/index.js"]