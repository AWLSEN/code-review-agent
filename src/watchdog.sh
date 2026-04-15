#!/bin/bash
# Watchdog for the code review agent.
# Each cycle: call claim API for repos, run OpenHands, report back.
# Restarts with --resume so the agent keeps memory across cycles.
set -uo pipefail

DATA_DIR="/root/data"
LOGS_DIR="$DATA_DIR/logs"
SESSION_FILE="$DATA_DIR/last_session.txt"
PROMPT_FILE="/root/src/agent-prompt.md"
CLAIM_API="https://review.orbcloud.dev/api"
AGENT_ID="${ORB_COMPUTER_ID:-unknown}"

mkdir -p "$LOGS_DIR" "$DATA_DIR/reviews" "$DATA_DIR/repos"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*" | tee -a "$LOGS_DIR/watchdog.log"; }

log "Watchdog starting. Agent ID: $AGENT_ID"

build_task() {
    local session_id=$(cat "$SESSION_FILE" 2>/dev/null || echo "")

    # Get repos from claim API
    local claim=$(curl -s "$CLAIM_API/claim?agent=$AGENT_ID" 2>/dev/null)
    local repos=$(echo "$claim" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(d.get('repos',[])))" 2>/dev/null)
    local new_repo=$(echo "$claim" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('new_repo',''))" 2>/dev/null)

    if [ -z "$repos" ]; then
        log "No repos assigned yet"
        repos="waiting"
    fi

    if [ -n "$new_repo" ]; then
        log "New repo claimed: $new_repo"
    fi

    log "Assigned repos: $repos"

    if [ -n "$session_id" ]; then
        echo "Continue reviewing. Your assigned repos: $repos. Check each for new PRs, review any unreviewed ones, report back via the done API. If all repos have no new PRs, exit cleanly."
    else
        # First run - use full prompt
        cat "$PROMPT_FILE"
    fi
}

run_cycle() {
    local session_id=$(cat "$SESSION_FILE" 2>/dev/null || echo "")
    local task=$(build_task)
    local logfile="$LOGS_DIR/run-$(date -u '+%Y%m%d-%H%M%S').log"

    log "Starting review cycle (session: ${session_id:-new})"

    local args=(--headless --override-with-envs)
    if [ -n "$session_id" ]; then
        args+=(--resume "$session_id")
    fi
    args+=(-t "$task")

    timeout 1800 openhands "${args[@]}" > "$logfile" 2>&1
    local exit_code=$?

    # Extract session ID for resume
    local new_session=$(grep -oP 'Conversation ID: \K[a-f0-9]+' "$logfile" | tail -1)
    if [ -n "$new_session" ]; then
        local formatted="${new_session:0:8}-${new_session:8:4}-${new_session:12:4}-${new_session:16:4}-${new_session:20}"
        echo "$formatted" > "$SESSION_FILE"
        log "Session saved: $formatted"
    fi

    log "Cycle finished (exit=$exit_code)"
    return $exit_code
}

# Main loop
while true; do
    run_cycle

    log "Starting next cycle immediately..."
done
