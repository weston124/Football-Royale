# Football Royale server image
#   docker build -t football-royale .
#   docker run -p 3000:3000 -e ADMIN_PASSWORD=change-me -v fr-data:/data football-royale
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    FR_DATA_DIR=/data

WORKDIR /app

# dependencies first so they are cached between code changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY shared ./shared
COPY client ./client

# run as the unprivileged "node" user; player data lives in the /data volume
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node directly (not npm) so SIGTERM reaches the server and it can save before exiting
CMD ["node", "server/index.js"]
