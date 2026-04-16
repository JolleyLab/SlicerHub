#!/bin/bash
# VM startup script - run this after booting the Paperspace VM
set -e

cd "$(dirname "$0")"

echo "=== SlicerWeb VM Startup ==="

# 1. Create trame-net if it doesn't exist (required by docker-compose external: true)
if ! docker network inspect trame-net &>/dev/null; then
    echo "Creating trame-net network..."
    docker network create trame-net
else
    echo "trame-net network already exists"
fi

# 2. Clean up any orphaned trame-session containers from previous runs
ORPHANS=$(docker ps -a --filter "label=trame-service=true" -q)
if [ -n "$ORPHANS" ]; then
    echo "Removing orphaned trame-session containers..."
    docker rm -f $ORPHANS
fi

# 3. Start all services
echo "Starting services..."
docker compose up -d

echo ""
echo "=== Startup complete ==="
echo "App available at: http://$(curl -s ifconfig.me):8000"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f          # follow all logs"
echo "  docker logs trame-service -f    # watch session manager"
echo "  docker ps                       # check running containers"
