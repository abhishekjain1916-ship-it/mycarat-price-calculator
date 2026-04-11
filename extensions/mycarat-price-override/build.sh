#!/usr/bin/env bash
# MyCarat Price Override — Function Build Script
# Runs from extension directory (CWD = extensions/mycarat-price-override)
set -e

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI_BIN="$APPDATA/npm/node_modules/@shopify/cli/bin"
ESBUILD="$APP_ROOT/node_modules/.bin/esbuild"
JAVY="$CLI_BIN/javy-7.0.1.exe"
PLUGIN="$CLI_BIN/shopify_functions_javy_v3.wasm"

mkdir -p dist

echo "[build] Bundling src/run.js..."
"$ESBUILD" node_modules/@shopify/shopify_function/index.ts \
  --bundle \
  --outfile=dist/bundle.js \
  --format=esm \
  --target=es2020 \
  --loader:.ts=ts \
  --alias:user-function=./src/run.js

echo "[build] Compiling to WASM (dynamic linking)..."
"$JAVY" build -C dynamic -C "plugin=$PLUGIN" dist/bundle.js -o dist/index.wasm

echo "[build] Done → dist/index.wasm ($(du -sh dist/index.wasm | cut -f1))"
