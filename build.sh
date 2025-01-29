#!/bin/bash
set -ex
cd "$(dirname "$0")"

# Source the environment file if needed
ENV_FILE="../.env"
if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
fi

docker build --no-cache -t client .
