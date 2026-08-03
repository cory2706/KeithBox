#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Installing dependencies..."
pip install -r backend/requirements.txt -q

echo "Starting Meal Planner server..."
echo "Open http://localhost:8000 in your browser"
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
