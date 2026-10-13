#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node test-local-studio.js
for test_file in test-v70-*.js; do
  node "$test_file"
done
printf '\nALL PASS: local studio static checks + %s V70 regression suites\n' "$(find . -maxdepth 1 -name 'test-v70-*.js' | wc -l | tr -d ' ')"
