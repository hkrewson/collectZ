#!/bin/bash

# MediaVault Master Setup Script
# This script sets up the entire MediaVault application

set -e

echo "================================"
echo "MediaVault Setup Script"
echo "================================"
echo ""

# Check if required commands exist
command -v docker >/dev/null 2>&1 || { echo "Error: Docker is not installed. Please install Docker first."; exit 1; }
command -v docker compose >/dev/null 2>&1 || { echo "Error: Docker Compose is not installed. Please install Docker Compose first."; exit 1; }

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it first."
    exit 1
fi

echo "✓ Prerequisites check passed"
echo ""

# Create necessary directories
echo "Creating directory structure..."
mkdir -p nginx/conf.d
mkdir -p nginx/ssl
mkdir -p backend/uploads
mkdir -p frontend/public
mkdir -p frontend/src

echo "✓ Directories created"
echo ""

# Backend setup
echo "Setting up backend..."
cd backend

# Create package.json
cat > package.json << 'BACKEND_PKG'
{
  "name": "mediavault-backend",
  "version": "1.0.0",
  "description": "MediaVault Backend API",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "express-rate-limit": "^7.1.5",
    "express-session": "^1.17.3",
    "connect-redis": "^7.1.0",
    "redis": "^4.6.11",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "multer": "^1.4.5-lts.1",
    "pg": "^8.11.3",
    "axios": "^1.6.2"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
BACKEND_PKG

# Create Dockerfile
cat > Dockerfile << 'BACKEND_DOCKER'
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

CMD ["node", "server.js"]
BACKEND_DOCKER

# Create .dockerignore
cat > .dockerignore << 'BACKEND_IGNORE'
node_modules
npm-debug.log
.env
.git
.gitignore
README.md
uploads/*
!uploads/.gitkeep
BACKEND_IGNORE

# Install npm dependencies
echo "Installing backend dependencies..."
npm install --silent

cd ..
echo "✓ Backend setup complete"
echo ""

# Frontend setup
echo "Setting up frontend..."
cd frontend

# Create package.json
cat > package.json << 'FRONTEND_PKG'
{
  "name": "mediavault-frontend",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-scripts": "5.0.1",
    "axios": "^1.6.2",
    "lucide-react": "^0.263.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "eslintConfig": {
    "extends": ["react-app"]
  },
  "browserslist": {
    "production": [">0.2%", "not dead", "not op_mini all"],
    "development": ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
  }
}
FRONTEND_PKG

# Create Dockerfile
cat > Dockerfile << 'FRONTEND_DOCKER'
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
FRONTEND_DOCKER

# Create nginx.conf
cat > nginx.conf << 'FRONTEND_NGINX'
server {
    listen 3000;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
FRONTEND_NGINX

# Create public/index.html
cat > public/index.html << 'FRONTEND_HTML'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta name="description" content="MediaVault - Manage your media collection" />
    <title>MediaVault</title>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>
FRONTEND_HTML

# Create src/index.css
cat > src/index.css << 'FRONTEND_CSS'
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
FRONTEND_CSS

# Create src/index.js
cat > src/index.js << 'FRONTEND_INDEX'
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
FRONTEND_INDEX

# Create src/App.js
cat > src/App.js << 'FRONTEND_APP'
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function App() {
  const [status, setStatus] = useState('Checking connection...');

  useEffect(() => {
    axios.get(`${API_URL}/health`)
      .then(() => setStatus('Connected to backend!'))
      .catch(() => setStatus('Backend connection failed'));
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontFamily: 'system-ui'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>MediaVault</h1>
        <p style={{ fontSize: '1.2rem' }}>{status}</p>
        <p style={{ marginTop: '2rem', opacity: 0.8 }}>
          Your media management solution
        </p>
      </div>
    </div>
  );
}

export default App;
FRONTEND_APP

# Create .dockerignore
cat > .dockerignore << 'FRONTEND_IGNORE'
node_modules
build
.git
.gitignore
README.md
.env
npm-debug.log
FRONTEND_IGNORE

# Install npm dependencies
echo "Installing frontend dependencies..."
npm install --silent

cd ..
echo "✓ Frontend setup complete"
echo ""

# SSL certificate check
echo "Checking SSL certificates..."
if [ ! -f nginx/ssl/fullchain.pem ] || [ ! -f nginx/ssl/privkey.pem ]; then
    echo "⚠ Warning: SSL certificates not found in nginx/ssl/"
    echo "  Creating self-signed certificates for development..."
    
    mkdir -p nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout nginx/ssl/privkey.pem \
        -out nginx/ssl/fullchain.pem \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" 2>/dev/null
    
    echo "✓ Self-signed certificates created"
    echo "  NOTE: For production, replace with proper SSL certificates"
else
    echo "✓ SSL certificates found"
fi
echo ""

# Final checks
echo "Running final checks..."

# Check if server.js exists
if [ ! -f backend/server.js ]; then
    echo "⚠ Warning: backend/server.js not found"
    echo "  Please ensure you've copied the server.js content"
fi

# Check if init.sql exists
if [ ! -f init.sql ]; then
    echo "⚠ Warning: init.sql not found in root directory"
    echo "  Please ensure you've created the database schema file"
fi

echo ""
echo "================================"
echo "Setup Complete!"
echo "================================"
echo ""
echo "Next steps:"
echo "1. Ensure server.js is in the backend/ directory"
echo "2. Ensure init.sql is in the root directory"
echo "3. Verify your .env file has all required variables"
echo "4. Run: docker-compose build"
echo "5. Run: docker-compose up -d"
echo ""
echo "To view logs: docker-compose logs -f"
echo "To stop: docker-compose down"
echo ""