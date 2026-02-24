FROM node:20-alpine

WORKDIR /app

ARG APP_VERSION=1.9.21
ARG GIT_SHA=dev
ARG BUILD_DATE=unknown
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
ENV BUILD_DATE=$BUILD_DATE

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

CMD ["node", "server.js"]
