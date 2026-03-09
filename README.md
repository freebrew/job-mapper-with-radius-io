# JobRadius - Multi-Radius Job Search

JobRadius is a fast, interactive mapping application that allows users to perform hyper-localized geographic job searches using multiple **inclusive** and **exclusive** radius zones. 

Instead of traditional "search within 25 miles of X", JobRadius allows you to drop precise geographic perimeters on a 3D WebGL Google Map to fine-tune your commute requirements.

## 🚀 Features
- **Multi-Radius Search**: Add overlapping green (inclusive) and red (exclusive) zones visually on the map.
- **Premium Dark UI**: Built with a custom glassmorphism, neon-accented dark theme for high visibility.
- **Google Maps API (WebGL)**: Fully utilizes Google's modern vector maps for 45-degree 3D tilt and advanced transit routing.
- **Indeed Integration**: Backend fetches, parses, and geometrically scopes jobs scraped actively from Indeed via Apify.
- **Job Notebook**: Bookmark jobs, add interview notes, and hide rejected jobs.
- **Stripe Day Passes**: Gated access behind a 24-Hour Pass checkout flow using Stripe Webhooks.

---

## 🏗️ Tech Stack
- **Frontend**: Vite.js, Vanilla JS (ES6 Modules), Custom CSS.
- **Backend API**: Node.js, Express, `jsonwebtoken`.
- **Database**: PostgreSQL with Prisma ORM (`v7`).
- **External Services**: Google Maps API, Google Identity SSO, Stripe API, Apify.

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- Node.js `v18+`
- PostgreSQL instance running locally (e.g. `postgresql://user:pass@localhost:5432/jobdb`)

### 2. Environment Variables
Create a `.env` file in the root directory:
```env
PORT=3000
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/jobradius"
JWT_SECRET="your-secret-key"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
APIFY_API_TOKEN="your-apify-token"
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

### 3. Database Initialization
Install dependencies and sync the Prisma schema:
```powershell
npm install
npx prisma generate
npx prisma db push
```

### 4. Running the Development Server
This project requires both the Express Backend and the Vite Frontend to run simultaneously. You can use the provided concurrent script:
```powershell
./run_dev.ps1
# Or manually if on bash: npm run dev
```
- **Backend API**: `http://localhost:3000`
- **Frontend Client**: `http://localhost:5173` (or `5174`)

---

## 📂 Architecture & Routing
The application strictly enforces a separation of concerns:
- `/src/server/` contains the Express routing (`jobs.routes.js`, `auth.routes.js`) and database middleware (`auth.js`).
- `/src/client/` contains the static UI assets served by Vite.
  - `/js/map/mapController.js`: Manages the Google Maps WebGL instance.
  - `/js/map/radiusManager.js`: Handles Google Maps geometry spheres.
  - `/js/app.js`: Connects DOM events, handles API fetch requests, and orchestrates the async map boot sequences safely.

## 🛡️ License & Deployment
Designed for deployment via Docker or standard Node PAAS (Heroku, Vercel Backend). Ensure all environment variables are securely mapped before exposing to production.
