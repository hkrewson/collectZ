#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ciDir = path.join(root, '.ci');
fs.mkdirSync(ciDir, { recursive: true });

const buildOverride = `services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
      args:
        APP_VERSION: \${APP_VERSION:-}
    image: collectz-backend:ci
    environment:
      PLAYWRIGHT_E2E_BYPASS_TOKEN: \${PLAYWRIGHT_E2E_BYPASS_TOKEN:-}
    volumes:
      - ./init.sql:/init.sql:ro
      - ./docker-compose.yml:/docker-compose.yml:ro
      - ./backend:/backend:ro
      - ./frontend:/frontend:ro
      - ./package.json:/package.json:ro
      - ./playwright.config.js:/playwright.config.js:ro
      - ./docs:/docs:ro
      - ./ops:/ops:ro
      - ./scripts:/scripts:ro
      - ./tests:/tests:ro
      - ./.github:/.github:ro

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_API_URL: /api
        VITE_APP_VERSION: \${APP_VERSION:-}
        VITE_DEBUG: \${DEBUG:-0}
        VITE_CSRF_COOKIE_NAME: \${CSRF_COOKIE_NAME:-csrf_token}
    image: collectz-frontend:ci
`;

const platformOverride = `services:
  backend:
    environment:
      APP_EDITION: platform
`;

fs.writeFileSync(path.join(ciDir, 'docker-compose.build.yml'), buildOverride);
fs.writeFileSync(path.join(ciDir, 'docker-compose.platform.yml'), platformOverride);
console.log('Wrote CI compose overrides.');
