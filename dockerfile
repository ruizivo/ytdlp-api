# Stage 1: Build dependencies (com build tools)
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Runtime 
FROM node:20-alpine

WORKDIR /app

# Runtime dependencies: ffmpeg, libstdc++ (para better-sqlite3), ca-certificates
RUN apk add --no-cache ffmpeg ca-certificates libstdc++ && \
    rm -rf /var/cache/apk/*

RUN mkdir -p /app/bin /app/downloads /app/data

# Copiar node_modules compilado do builder
COPY --from=builder /app/node_modules ./node_modules
COPY src ./src

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Baixar yt-dlp standalone binary
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux -O /app/bin/yt-dlp && \
    chmod +x /app/bin/yt-dlp


USER nodejs

ENV NODE_ENV=production PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "src/server.js"]