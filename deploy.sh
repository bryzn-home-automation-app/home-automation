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

# 4. Quick health check
echo "── 4. Health check ──"
sleep 5
STATUS=$(curl -s http://localhost/api/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','DOWN'))" 2>/dev/null || echo "DOWN")
echo "   Backend: $STATUS"
echo "   URL:     http://localhost"
echo ""

echo "✅  Deploy complete."
