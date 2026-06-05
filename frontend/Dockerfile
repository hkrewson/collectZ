FROM node:24-alpine AS builder

WORKDIR /app

RUN apk upgrade --no-cache zlib expat libexpat

COPY package*.json ./
RUN npm install

COPY . .
ARG VITE_API_URL=/api
ARG VITE_APP_VERSION
ARG VITE_DEBUG=0
ARG VITE_CSRF_COOKIE_NAME=csrf_token
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_DEBUG=$VITE_DEBUG
ENV VITE_CSRF_COOKIE_NAME=$VITE_CSRF_COOKIE_NAME
RUN npm run build

FROM nginx:alpine

RUN apk upgrade --no-cache zlib expat libexpat

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
