#!/bin/bash
# Safety net. Restarts OpenHands if it crashes.
# The agent prompt tells OpenHands to loop forever internally.
# This script only triggers if OpenHands exits unexpectedly.
set -uo pipefail

DATA_DIR="/root/data"
LOGS_DIR="$DATA_DIR/logs"
SESSION_FILE="$DATA_DIR/last_session.txt"
PROMPT_FILE="/root/src/agent-prompt.md"
AGENT_ID="${ORB_COMPUTER_ID:-unknown}"

mkdir -p "$LOGS_DIR" "$DATA_DIR/reviews" "$DATA_DIR/repos"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*" | tee -a "$LOGS_DIR/watchdog.log"; }

log "Watchdog starting. Agent ID: $AGENT_ID"

while true; do
    session_id=$(cat "$SESSION_FILE" 2>/dev/null || echo "")
    logfile="$LOGS_DIR/run-$(date -u '+%Y%m%d-%H%M%S').log"

    if [ -n "$session_id" ]; then
        log "Resuming session: $session_id"
        task="Continue your infinite review loop. Check all your assigned repos for new PRs, review any unreviewed ones, claim new repos when idle. Sleep 30 seconds between cycles. Never exit."
        timeout 7200 openhands --headless --override-with-envs --resume "$session_id" -t "$task" > "$logfile" 2>&1
    else
        log "Starting fresh session"
        task=$(cat "$PROMPT_FILE")
        timeout 7200 openhands --headless --override-with-envs -t "$task" > "$logfile" 2>&1
    fi

    exit_code=$?

    # Save session for resume
    new_session=$(grep -oP 'Conversation ID: \K[a-f0-9]+' "$logfile" | tail -1)
    if [ -n "$new_session" ]; then
        formatted="${new_session:0:8}-${new_session:8:4}-${new_session:12:4}-${new_session:16:4}-${new_session:20}"
        echo "$formatted" > "$SESSION_FILE"
        log "Session saved: $formatted"
    fi

    log "OpenHands exited (code=$exit_code). Restarting in 5s..."
    sleep 5
done
