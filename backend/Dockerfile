FROM node:20-alpine

WORKDIR /app

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

RUN apk upgrade --no-cache \
  && apk add --no-cache su-exec

COPY package*.json ./
RUN npm install --omit=dev \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY . .

RUN mkdir -p uploads && chown -R node:node /app
COPY docker-entrypoint.sh /usr/local/bin/collectz-backend-entrypoint
RUN chmod +x /usr/local/bin/collectz-backend-entrypoint

USER root

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

ENTRYPOINT ["collectz-backend-entrypoint"]
CMD ["node", "server.js"]
