#!/bin/bash
# =============================================================================
# JobRadius — Clean Server Restart
# =============================================================================
# Kills ALL stale Node processes for this app, clears the port, and starts
# fresh. Use this after code deploys or env changes.
#
# Usage:  ./restart.sh
# =============================================================================

set -euo pipefail

DOMAIN_DIR="/home/agent-swarm/domains/jobradius.agent-swarm.net"
APP_DIR="$DOMAIN_DIR/public_html"
ENV_FILE="$DOMAIN_DIR/.env"
LOG_FILE="$DOMAIN_DIR/logs/node-backend.log"
PID_FILE="$DOMAIN_DIR/tmp/jobradius-node.pid"
PORT=3001

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}[JobRadius] Restarting Node.js server...${NC}"

# ── Step 1: Kill ALL node processes for this app ──────────────────────────────
echo -e "  ${RED}→ Killing all stale processes...${NC}"

# Kill by PID file
if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
        kill -9 "$old_pid" 2>/dev/null || true
        echo "    Killed PID $old_pid (from PID file)"
    fi
    rm -f "$PID_FILE"
fi

# Kill any remaining node processes for this specific app
pkill -9 -f "node.*${APP_DIR}/src/server/index.js" 2>/dev/null || true

# Loop: keep killing anything on our port until it's truly free
# (the heartbeat cron may respawn a process between kills)
for attempt in 1 2 3 4 5; do
    stale_pid=$(ss -tlnp 2>/dev/null | grep ":${PORT}" | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    if [ -z "$stale_pid" ]; then
        break
    fi
    echo "    Attempt $attempt: killing PID $stale_pid on port $PORT"
    kill -9 "$stale_pid" 2>/dev/null || true
    sleep 1
done

# Final check
if ss -tlnp 2>/dev/null | grep -q ":${PORT}"; then
    echo -e "  ${RED}✗ Port $PORT still in use after 5 attempts! Cannot start.${NC}"
    ss -tlnp | grep ":${PORT}"
    exit 1
fi

echo "    Port $PORT is free."

# ── Step 2: Start fresh ──────────────────────────────────────────────────────
echo -e "  ${GREEN}→ Starting Node.js backend...${NC}"

# Ensure log/tmp dirs exist
mkdir -p "$DOMAIN_DIR/logs" "$DOMAIN_DIR/tmp"

# Node's dotenv handles .env loading internally — we just set PORT and NODE_ENV
export PORT=$PORT
export NODE_ENV=production

# Start Node detached
nohup node "$APP_DIR/src/server/index.js" >> "$LOG_FILE" 2>&1 &
new_pid=$!
echo "$new_pid" > "$PID_FILE"

# ── Step 3: Verify ───────────────────────────────────────────────────────────
echo -e "  ${YELLOW}→ Waiting for server to bind...${NC}"
sleep 3

if ss -tlnp 2>/dev/null | grep -q ":${PORT}"; then
    echo -e "  ${GREEN}✓ Server running on port $PORT (PID $new_pid)${NC}"
    
    # Quick health check
    http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/health" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
        echo -e "  ${GREEN}✓ Health check passed (HTTP $http_code)${NC}"
    else
        echo -e "  ${YELLOW}⚠ Health check returned HTTP $http_code (server may still be warming up)${NC}"
    fi
else
    echo -e "  ${RED}✗ Server failed to start! Check logs:${NC}"
    echo "    tail -20 $LOG_FILE"
    tail -5 "$LOG_FILE" 2>/dev/null || true
    exit 1
fi

echo -e "${GREEN}[JobRadius] Restart complete.${NC}"
