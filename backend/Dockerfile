FROM node:20-alpine

WORKDIR /app

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

RUN apk upgrade --no-cache

COPY package*.json ./
RUN npm install --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY . .

RUN mkdir -p uploads && chown -R node:node /app

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

CMD ["node", "server.js"]
