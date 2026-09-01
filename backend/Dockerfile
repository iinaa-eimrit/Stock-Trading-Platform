FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Run as non-root user for security
RUN groupadd -r exchange && useradd -r -g exchange exchange
RUN mkdir -p /app/data && chown -R exchange:exchange /app/data
USER exchange

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/db/migrations ./dist/db/migrations

EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
