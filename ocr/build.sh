#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin
swiftc -O main.swift -o bin/ocr -framework Vision -framework AppKit
echo "built: $(pwd)/bin/ocr"
