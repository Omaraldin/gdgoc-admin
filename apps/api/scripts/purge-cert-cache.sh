#!/usr/bin/env bash
# purge-cert-cache.sh — build and run the cert cache purge job.
#
# First run: registers itself in crontab to run every Sunday at 2am,
# then immediately performs the first purge.
# Subsequent runs (triggered by cron): just build and purge.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY="$API_DIR/bin/purge-cert-cache"
LOG_FILE="$API_DIR/purge-cert-cache.log"
CRON_ENTRY="0 2 * * 0 $SCRIPT_DIR/purge-cert-cache.sh >> $LOG_FILE 2>&1"

# ── Register in crontab if not already there ──────────────────────────────────
if ! crontab -l 2>/dev/null | grep -qF "purge-cert-cache.sh"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] registering weekly cron job..."
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] cron job registered: $CRON_ENTRY"
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "[$(date '+%Y-%m-%d %H:%M:%S')] building purge-cert-cache..."
cd "$API_DIR"
mkdir -p "$API_DIR/bin"
go build -o "$BINARY" ./cmd/purge-cert-cache

# ── Run ───────────────────────────────────────────────────────────────────────
echo "[$(date '+%Y-%m-%d %H:%M:%S')] running purge-cert-cache..."
"$BINARY"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] done."
