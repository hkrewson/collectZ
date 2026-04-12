FROM node:20-alpine AS builder

WORKDIR /app

RUN apk upgrade --no-cache zlib expat libexpat

COPY package*.json ./
RUN npm install

COPY . .
ARG REACT_APP_API_URL=/api
ARG REACT_APP_VERSION
ARG REACT_APP_DEBUG=0
ARG VITE_API_URL=/api
ARG VITE_APP_VERSION
ARG VITE_DEBUG=0
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_VERSION=$REACT_APP_VERSION
ENV REACT_APP_DEBUG=$REACT_APP_DEBUG
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_DEBUG=$VITE_DEBUG
RUN npm run build:vite

FROM nginx:alpine

RUN apk upgrade --no-cache zlib expat libexpat

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
