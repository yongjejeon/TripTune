#!/bin/bash
# Wrapper script to ensure Node is in PATH for Gradle builds

export PATH="/usr/local/bin:$PATH"
export NODE_BINARY="/usr/local/bin/node"

echo "Node path: $(which node)"
echo "Node version: $(node --version)"

cd "$(dirname "$0")"
npx expo run:android "$@"

