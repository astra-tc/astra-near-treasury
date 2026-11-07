#!/usr/bin/env bash
# Build contracts/spend_guard to wasm for the local near-workspaces sandbox.
# target-cpu=mvp keeps the output to the wasm features the NEAR runtime accepts.
set -euo pipefail
cd "$(dirname "$0")/.."
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
RUSTFLAGS="-C link-arg=-s -C target-cpu=mvp" \
  cargo build -p spend_guard --target wasm32-unknown-unknown --release
ls -la target/wasm32-unknown-unknown/release/spend_guard.wasm
