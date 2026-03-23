---
description: How to deploy code changes for JobRadius (must run after every code change)
---

After ANY code change (server or client), always run these steps:

// turbo-all

1. If **server-side** files changed (`src/server/**`), restart the Node.js backend:
```bash
pkill -f "node.*src/server" 2>/dev/null || true; sleep 2; bash /home/agent-swarm/domains/jobradius.agent-swarm.net/heartbeat.sh; sleep 3; curl -s http://localhost:3001/health
```

2. If **client-side** files changed (`src/client/**`), rebuild the Vite bundle (browser serves from `dist/`):
```bash
cd /home/agent-swarm/domains/jobradius.agent-swarm.net/public_html && npx --yes vite build 2>&1
```

3. Verify backend is healthy:
```bash
curl -s http://localhost:3001/health
```

4. Tell the user to **Ctrl+Shift+R** hard refresh their browser.

**IMPORTANT**: The browser serves from `/dist/` (pre-built Vite bundle), NOT from `src/client/`. Client changes are invisible until `vite build` runs. The Node.js backend runs on port 3001 behind a PHP reverse proxy (`api/proxy.php`).
