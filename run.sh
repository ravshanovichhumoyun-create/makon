#!/usr/bin/env bash
# Run Makon locally (macOS / Linux): ./run.sh   → http://localhost:8080
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements-dev.txt
fi
exec .venv/bin/uvicorn --app-dir backend app.main:app --host 0.0.0.0 --port "${PORT:-8080}" --reload --reload-dir backend
