FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
ARG REACT_APP_API_URL=/api
ARG REACT_APP_VERSION=1.6.4
ARG REACT_APP_GIT_SHA=dev
ARG REACT_APP_BUILD_DATE=unknown
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_VERSION=$REACT_APP_VERSION
ENV REACT_APP_GIT_SHA=$REACT_APP_GIT_SHA
ENV REACT_APP_BUILD_DATE=$REACT_APP_BUILD_DATE
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
