#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo "========================================"
echo "  Home Automation Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo ""

# 1. Git pull
echo "── 1. Pulling latest ──"
git pull origin master 2>&1 | sed 's/^/   /'
echo ""

# 2. Rebuild images (backend + nginx — postgres/redis don't change)
echo "── 2. Rebuilding Docker images ──"
docker compose build --no-cache backend nginx 2>&1 | tail -10
echo ""

# 3. Start everything
echo "── 3. Starting stack ──"
docker compose up -d 2>&1
echo ""

# 4. Wait for backend to be healthy (up to 60s)
echo "── 4. Waiting for backend ──"
for i in $(seq 1 12); do
  STATUS=$(curl -s http://localhost/api/health 2>/dev/null | grep -o '"UP"' || true)
  if [ "$STATUS" = '"UP"' ]; then
    echo "   Backend: UP (after ${i}0s)"
    break
  fi
  sleep 10
done
if [ "$STATUS" != '"UP"' ]; then
  echo "   Backend: still starting — check logs: docker compose logs backend"
fi
echo "   URL:     http://localhost"
echo ""

echo "✅  Deploy complete."
