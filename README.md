# JobRadius — Multi-Radius Job Search

JobRadius is a fast, interactive mapping application for hyper-localized geographic job searches using multiple **inclusive** and **exclusive** radius zones on a live 3D WebGL Google Map.

Instead of a traditional "search within 25 miles of X", JobRadius lets you drop precise geographic perimeters to fine-tune commute requirements, pin high-interest jobs, add private notes, and navigate directly to job sites.

---

## 🚀 Features

### Map & Search
- **Multi-Radius Zones**: Overlay green (inclusive) and red (exclusive) circles visually on the 3D vector map.
- **Real-Time Indeed Scraping**: Backend streams jobs via Apify's Indeed scraper using NDJSON chunked transfer — results appear progressively as they arrive.
- **Salary Filter**: Jobs without salary/pay information are automatically excluded.
- **Search Result Persistence**: Results survive page refresh (stored in `sessionStorage`) until a new search is performed or the tab is closed — no repeat API calls needed.
- **Google Maps WebGL (Vector)**: 45° 3D tilt, real-time building extrusion, cinematic fly-to animations.

### Job Detail Panel
- **Permanent Left Sidebar (Desktop)**: Job details open in the fixed panel, not as an inline map popup. The map pin stays visible as a compact marker.
- **Bottom Sheet (Mobile/Tablet)**: Job details open as a full-screen bottom sheet with gesture-based navigation.
- **Apply for Job**: Links directly to the original Indeed posting.
- **Route Button**: Calculates driving directions from your search centre to the job location. The map auto-offsets so the full route (start ↔ end) is visible to the right of the sidebar panel.
- **Pin / Unpin**: Bookmarks a job with a gold border on its map marker. Pinned jobs persist across sessions via `localStorage`.
- **Hide**: Removes the job from results for the current session.

### Notes System (Private, User-Scoped)
- **Add Notes**: Attach private text notes to any job. Notes are stored server-side in the database.
- **Recall Notes**: Clicking the Note button on a previously noted job pre-fills the textarea with your saved text.
- **User-Scoped Security**: All notes are scoped to the authenticated user via JWT. No cross-user access is possible at the API or database level.
- **Cross-Search Consistency**: Notes are linked by `indeedJobId` and found across all search profiles, so a note saved on Monday is still recalled by the same job on Friday.

### Authentication & Access Control
- **Google One-Tap SSO + Email/Password**: Dual login methods with 7-day JWT sessions.
- **Session Persistence**: JWT stored in `localStorage`; user name and subscription status restored on load without requiring re-login.
- **Stripe Day Passes**: Gated access behind a 24-hour pass checkout using Stripe Webhooks + `dayPassExpiresAt` timestamp validation.
- **Admin Panel**: Slide-out admin dashboard (bruno.brottes@gmail.com only) with real-time metrics.

### Responsive UI (3 Device Tiers)
| Tier | Breakpoint | Behaviour |
|---|---|---|
| Handheld | `max-width: 767px` | Bottom sheets, FABs, full-screen detail |
| Tablet | `768px – 1199px` | Floating narrow panel, side-by-side search inputs |
| Desktop | `min-width: 1200px` | Permanent left sidebar, inline route, map offset |

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite.js, Vanilla JS (ES Modules), Custom CSS |
| Backend | Node.js, Express.js |
| Database | PostgreSQL + Prisma ORM v7 |
| Auth | JWT (`jsonwebtoken`), Google OAuth (`google-auth-library`) |
| Payments | Stripe API + Webhooks |
| Map | Google Maps JavaScript API (Vector / WebGL) |
| Job Data | Apify — `misceres/indeed-scraper` |
| Proxy | PHP reverse proxy (`api/proxy.php`) → Node :3001 |

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- Node.js `v18+`
- PostgreSQL running locally

### 2. Environment Variables
Create a `.env` file in `public_html/`:
```env
PORT=3001
DATABASE_URL="postgresql://jobradius:yourpassword@localhost:5432/jobradius"
JWT_SECRET="your-secret-key"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"
APIFY_API_TOKEN="your-apify-token"
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
NODE_ENV=development
```

### 3. Database Initialization
```bash
npm install
npx prisma generate
npx prisma migrate deploy   # or: npx prisma db push (dev only)
```

### 4. Running the Development Server
```bash
# Backend (port 3001)
node src/server/index.js

# Frontend (Vite dev server)
npx vite --config vite.config.mjs
```

> **Production note:** The browser serves from `/dist/` (pre-built Vite bundle). After any client-side change run:
> ```bash
> npx vite build --config vite.config.mjs
> ```
> Then restart the Node server.

---

## 📂 Project Structure

```
public_html/
├── api/
│   └── proxy.php           # PHP reverse proxy → Node :3001
├── dist/                   # Vite production build (served by Apache)
├── prisma/
│   └── schema.prisma       # DB schema (User, SearchProfile, JobResult, UserJobNote)
├── src/
│   ├── client/
│   │   ├── css/main.css    # Global styles + media query tiers (handheld/tablet/desktop)
│   │   ├── index.html
│   │   └── js/
│   │       ├── app.js              # Main app orchestrator
│   │       └── map/
│   │           ├── mapController.js    # Google Maps WebGL, routes, pan offsets
│   │           ├── jobInfoOverlay.js   # Custom OverlayView for job pins
│   │           └── radiusManager.js   # Inclusive/exclusive zone geometry
│   └── server/
│       ├── index.js                # Express app entry point
│       ├── config/db.js            # Prisma client singleton
│       ├── middleware/auth.js      # JWT requireAuth middleware
│       └── routes/
│           ├── auth.routes.js      # Login, Google OAuth, /me
│           ├── jobs.routes.js      # /search (NDJSON streaming)
│           ├── notes.routes.js     # CRUD notes (user-scoped)
│           └── payment.routes.js   # Stripe checkout + webhook
└── vite.config.mjs
```

---

## 🛡️ Security

- All API routes require a valid JWT signed with `JWT_SECRET` (server-side only).
- Notes, hidden jobs, and pinned state are scoped to `userId` from the verified token — never from client input.
- `helmet` middleware sets secure HTTP headers.
- Rate limiting applied to auth and search endpoints.
- Stripe webhooks verified with `STRIPE_WEBHOOK_SECRET` before processing.

---

## 📜 License
Private / proprietary. All rights reserved.
