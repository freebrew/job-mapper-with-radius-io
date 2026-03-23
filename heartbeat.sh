#!/bin/bash
# =============================================================================
# JobRadius Heartbeat / Watchdog
# =============================================================================
# Monitors and auto-restarts the Node.js backend on port 3001.
# Designed to be run as a Virtualmin cron job every minute.
#
# Setup (Virtualmin Pro):
#   Webmin → System → Scheduled Cron Jobs → Add Cron Job
#   Command: /home/agent-swarm/domains/jobradius.agent-swarm.net/heartbeat.sh
#   Schedule: * * * * *  (every minute)
#
# Also symlink for manual run:
#   chmod +x /home/agent-swarm/domains/jobradius.agent-swarm.net/heartbeat.sh
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DOMAIN_DIR="/home/agent-swarm/domains/jobradius.agent-swarm.net"
APP_DIR="$DOMAIN_DIR/public_html"
ENV_FILE="$DOMAIN_DIR/.env"
LOG_FILE="$DOMAIN_DIR/logs/heartbeat.log"
PID_FILE="$DOMAIN_DIR/tmp/jobradius-node.pid"
PORT=3001
MAX_LOG_LINES=1000   # Rotate log when it exceeds this many lines

# ── Helpers ───────────────────────────────────────────────────────────────────
log() {
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] $*" >> "$LOG_FILE"

    # Rotate log by keeping only the last MAX_LOG_LINES
    local lines
    lines=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$lines" -gt "$MAX_LOG_LINES" ]; then
        tail -n $((MAX_LOG_LINES / 2)) "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
}

is_node_running() {
    # Check if a Node process is listening on PORT
    ss -tlnp 2>/dev/null | grep -q ":${PORT}" && return 0
    return 1
}

get_node_pid() {
    # Get the PID of the node process bound to our port
    ss -tlnp 2>/dev/null | grep ":${PORT}" | grep -oP 'pid=\K[0-9]+' | head -1
}

start_node() {
    log "INFO  Starting Node.js backend (PORT=$PORT)..."

    # Kill any stale process on our port first
    local stale_pid
    stale_pid=$(get_node_pid 2>/dev/null || true)
    if [ -n "$stale_pid" ]; then
        log "WARN  Killing stale process on port $PORT (PID $stale_pid)"
        kill -9 "$stale_pid" 2>/dev/null || true
        sleep 1
    fi

    # Also kill any zombie nodemon processes for this app
    pkill -f "nodemon.*${APP_DIR}/src/server/index.js" 2>/dev/null || true
    sleep 0.5

    # Save desired port before loading .env (which may set PORT=3000)
    local desired_port=$PORT

    # Node's dotenv handles .env loading internally — we just set PORT and NODE_ENV
    export PORT=$desired_port
    export NODE_ENV=production
    # Start Node detached and save PID
    nohup node "$APP_DIR/src/server/index.js" \
        >> "$DOMAIN_DIR/logs/node-backend.log" 2>&1 &

    local pid=$!
    echo "$pid" > "$PID_FILE"
    log "INFO  Node.js started with PID $pid"

    # Wait briefly and confirm it bound to the port
    sleep 3
    if is_node_running; then
        log "OK    Node.js is healthy on port $PORT"
    else
        log "ERROR Node.js failed to bind to port $PORT after start!"
    fi
}

# ── Ensure log/tmp dirs exist ─────────────────────────────────────────────────
mkdir -p "$DOMAIN_DIR/logs" "$DOMAIN_DIR/tmp"

# ── Main check ────────────────────────────────────────────────────────────────
if is_node_running; then
    # Running and healthy — silent success (no log spam on every minute)
    # Only log if we have a PID mismatch (process replaced externally)
    current_pid=$(get_node_pid 2>/dev/null || echo "")
    saved_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
    if [ -n "$current_pid" ] && [ -n "$saved_pid" ] && [ "$current_pid" != "$saved_pid" ]; then
        log "INFO  Node PID changed: $saved_pid → $current_pid (external restart detected)"
        echo "$current_pid" > "$PID_FILE"
    fi
else
    log "WARN  Node.js NOT running on port $PORT — initiating restart"
    start_node
fi
