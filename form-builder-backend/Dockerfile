# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . .
RUN npm run build
RUN npx prisma generate

# Stage 2: Production Runtime
FROM node:20-alpine AS production

WORKDIR /app
# Copy built files and dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start:prod"]
