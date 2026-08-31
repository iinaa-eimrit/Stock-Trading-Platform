#!/bin/bash
set -e

echo "Starting environment..."
docker-compose up -d --build

echo "Waiting for Exchange API to be ready..."
until curl -s -f http://localhost:3001/health; do
  echo "Still waiting..."
  sleep 2
done

echo "Running short k6 load test..."
docker run --rm -i --net host -v "$(pwd)/backend/load-test:/load-test" grafana/k6 run /load-test/load.js -d 10s -u 10

echo "Crashing Exchange container..."
docker-compose kill exchange

echo "Restarting Exchange container..."
docker-compose start exchange

echo "Waiting for Exchange API to recover..."
until curl -s -f http://localhost:3001/health; do
  echo "Still waiting..."
  sleep 2
done

echo "Verifying reconciliation (expecting 0 discrepancies)..."
docker-compose exec -T exchange npx tsx src/recovery/reconciliation.ts

echo "Crash/Restart test passed successfully!"
docker-compose down -v
