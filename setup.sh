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
    "axios": "^1.6.2",
    "form-data": "^4.0.0"
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
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL
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
  font-family: 'Avenir Next', 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
}

#root {
  min-height: 100vh;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: linear-gradient(145deg, #f7f8fb 0%, #d9e7ff 50%, #eef6ef 100%);
}

.auth-card {
  width: min(460px, 100%);
  background: #ffffff;
  border: 1px solid #d9e0ee;
  border-radius: 18px;
  padding: 1.5rem;
  box-shadow: 0 18px 45px rgba(16, 36, 73, 0.12);
}

.auth-card h1 {
  color: #15315f;
  font-size: 2rem;
}

.subtitle {
  margin-top: 0.25rem;
  color: #5d6a84;
}

.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin: 1rem 0 1.25rem;
}

.tabs button {
  border: 1px solid #d4ddf1;
  background: #f5f8ff;
  color: #2c4678;
  border-radius: 10px;
  height: 40px;
  cursor: pointer;
}

.tabs button.active {
  border-color: #2f5ec9;
  background: #2f5ec9;
  color: #ffffff;
}

form {
  display: grid;
  gap: 0.9rem;
}

label {
  display: grid;
  gap: 0.35rem;
  color: #2f3e5a;
  font-size: 0.95rem;
}

input {
  height: 42px;
  padding: 0 0.75rem;
  border: 1px solid #cad4ea;
  border-radius: 10px;
  font-size: 1rem;
}

input:focus {
  outline: 2px solid #b8cbf8;
  border-color: #5f85db;
}

.submit {
  margin-top: 0.5rem;
  height: 44px;
  border: 0;
  border-radius: 10px;
  background: #15315f;
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.message {
  margin-top: 0.85rem;
  padding: 0.7rem 0.8rem;
  border-radius: 10px;
  font-size: 0.92rem;
}

.message.error {
  background: #fff0f2;
  color: #9a1c2f;
  border: 1px solid #f0c2cb;
}

.message.success {
  background: #eefcf3;
  color: #166a39;
  border: 1px solid #badfc8;
}

.token {
  margin-top: 0.85rem;
  color: #4e5d78;
  font-size: 0.86rem;
  word-break: break-all;
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
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

function App() {
  const [route, setRoute] = useState(window.location.pathname === '/register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [token, setToken] = useState('');
  const pageTitle = useMemo(() => (route === 'register' ? 'Create account' : 'Welcome back'), [route]);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(window.location.pathname === '/register' ? 'register' : 'login');
      setError('');
      setSuccess('');
    };

    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  const navigate = (nextRoute) => {
    const path = nextRoute === 'register' ? '/register' : '/login';
    window.history.pushState({}, '', path);
    setRoute(nextRoute);
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const payload = route === 'register'
        ? { email, password, name }
        : { email, password };
      const endpoint = route === 'register' ? '/auth/register' : '/auth/login';
      const response = await axios.post(`${API_URL}${endpoint}`, payload);

      setToken(response.data?.token || '');
      setSuccess(
        route === 'register'
          ? 'Account created. You are now logged in.'
          : 'Login successful.'
      );
      setPassword('');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="auth-card">
        <h1>MediaVault</h1>
        <p className="subtitle">{pageTitle}</p>

        <div className="tabs">
          <button
            type="button"
            className={route === 'login' ? 'active' : ''}
            onClick={() => navigate('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={route === 'register' ? 'active' : ''}
            onClick={() => navigate('register')}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {route === 'register' && (
            <label>
              Name
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="submit" type="submit" disabled={loading}>
            {loading ? 'Submitting...' : route === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {error && <p className="message error">{error}</p>}
        {success && <p className="message success">{success}</p>}
        {token && (
          <p className="token">
            Token issued: <code>{`${token.slice(0, 24)}...`}</code>
          </p>
        )}
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
