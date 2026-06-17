FROM node:20-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /workspace
COPY ops/sizing/collectz-sizing-snapshot.js /app/collectz-sizing-snapshot.js
RUN chown -R node:node /workspace /app

USER node

ENTRYPOINT ["node", "/app/collectz-sizing-snapshot.js"]
