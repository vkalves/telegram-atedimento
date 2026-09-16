FROM node:24-bookworm-slim

ENV NODE_ENV=production FFMPEG_PATH=/usr/bin/ffmpeg DATA_DIR=/app/data PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY src ./src

RUN mkdir -p /app/data \
    && chown -R node:node /app

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node","src/server.js"]
