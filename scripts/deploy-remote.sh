#!/usr/bin/env bash
# Runs ON the droplet, from the repo root, after the workflow has
# fast-forwarded the checkout to origin/main.
#
# It lives here rather than inline in deploy.yml because the workflow now
# makes several connection attempts (see the note there), and three inline
# copies of the real deploy would drift apart. Each attempt's inline script
# is now short enough to repeat safely.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> at $(git rev-parse --short HEAD)"

cd server
echo "==> npm ci"
npm ci --omit=dev --no-audit --no-fund

echo "==> pm2 restart"
pm2 restart iqmobile --update-env
pm2 save

echo "==> health check"
# pm2 restart returns before Node finishes booting (Sentry init + DB open +
# user load takes ~5s), so poll rather than sleep once and race it.
for i in $(seq 1 30); do
  if curl -sSf -m 3 http://127.0.0.1:4001/health >/dev/null; then
    echo "  healthy after ${i}s"
    echo "==> deploy ok"
    exit 0
  fi
  sleep 1
done
echo "==> health check failed after 30s"
pm2 logs iqmobile --lines 30 --nostream || true
exit 1
