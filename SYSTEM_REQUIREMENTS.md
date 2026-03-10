# JobRadius System Requirements & Deployment Guide

This document defines the system requirements, dependencies, and deployment steps required to rebuild the JobRadius environment from scratch.

## 1. System Requirements

*   **OS:** Linux (Ubuntu 20.04/22.04 or Debian recommended)
*   **Database:** PostgreSQL 14+
*   **Runtime:** Node.js v18+ (v20 LTS recommended)
*   **Web Server:** Apache 2.4+ (used as a reverse proxy for Node.js)
*   **Process Manager:** PM2 (installed globally via `npm install -g pm2`)

## 2. Infrastructure Setup & Reverse Proxy

JobRadius operates as a Node.js backend/frontend-builder listening on port `3001`, with Apache sitting in front to handle SSL and proxy requests.

**Apache VirtualHost Configuration (Example):**
```apache
<VirtualHost *:80>
    ServerName yourdomain.com
    # Redirect HTTP to HTTPS
    RewriteEngine on
    RewriteCond %{SERVER_NAME} =yourdomain.com
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]
</VirtualHost>

<VirtualHost *:443>
    ServerName yourdomain.com DocumentRoot /path/to/jobradius/public_html
    
    # Proxy all traffic to the Node.js app on port 3001
    ProxyPass / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/
    
    # SSL config (Let's Encrypt usually handles this)
    SSLCertificateFile /etc/letsencrypt/live/yourdomain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/yourdomain.com/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
```

## 3. Environment Variables (.env)

You must create a `.env` file in the root of the application directory (where `package.json` is located). 

```env
# Database Connection (update auth credentials as needed)
DATABASE_URL="postgresql://user:password@localhost:5432/jobradius?schema=public"

# Application
PORT=3001
NODE_ENV=production

# Authentication Secret (Generate a strong random 64-char hex string)
JWT_SECRET="YOUR_RANDOM_SECRET"

# External APIs
APIFY_API_TOKEN="apify_api_..."
GOOGLE_MAPS_API_KEY="AIza..."

# Google OAuth 2.0
GOOGLE_OAUTH_CLIENT_ID="...apps.googleusercontent.com"
GOOGLE_OAUTH_CLIENT_SECRET="..."

# Stripe (Billing)
STRIPE_SECRET_KEY="sk_..."
STRIPE_PUBLISHABLE_KEY="pk_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

## 4. Deployment Steps

From the root directory (`public_html/`), run the following commands to initialize the application:

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Initialize Database (Prisma):**
    ```bash
    npx prisma generate
    npx prisma db push
    ```

3.  **Compile Frontend Assets:**
    ```bash
    npx vite build --config vite.config.mjs
    ```
    *Note: The frontend must be compiled. The production Node.js server serves files from the `dist/` directory, not `src/client/`.*

4.  **Start Background Daemon (PM2):**
    ```bash
    pm2 start src/server/index.js --name "jobradius-api" --time
    pm2 save
    pm2 startup
    ```

## 5. Repository Structure

*   **/src/server/**: Express.js backend API, Apify integration, authentication routes.
*   **/src/client/**: Raw frontend code (HTML, CSS, JS).
*   **/prisma/**: Database schema and migrations.
*   **/dist/**: Compiled production frontend (generated via Vite). This folder is git-tracked and deployed directly by the server.
