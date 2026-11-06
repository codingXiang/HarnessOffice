#!/bin/sh
# Build a source bundle a machine can unpack and run without cloning.
# Excludes .git, node_modules, and operator secrets. Includes the built 3D
# client when vendor/agent-office/dist exists, plus lockfiles and this script.
set -eu
cd "$(dirname "$0")/.."
sha="$(git rev-parse HEAD)"
out="${1:-/tmp/harness-office-runtime.tar.gz}"
stage="$(mktemp -d)"
root="$stage/harness-office"
mkdir -p "$root"
git archive HEAD | tar -x -C "$root"
if [ -d vendor/agent-office/dist ]; then
  mkdir -p "$root/vendor/agent-office"
  cp -a vendor/agent-office/dist "$root/vendor/agent-office/dist"
fi
cat > "$root/RUNTIME.txt" << EOF
commit: $sha
node: $(node --version)
chat: http://127.0.0.1:4173
visual: http://127.0.0.1:4600

unpack, then from this directory:
  npm install
  ./scripts/run-harness-office.sh

If vendor/agent-office/dist/public/index.html is missing:
  npm run spike:office:client

Hermes is not inside this bundle. Set API base in the chat page.
Settings and the Group Chat record stay in ~/harness-office-iac/ and are not in this archive.
Do not copy a hermes.json that contains a real token into a shared place.
EOF
tar -czf "$out" -C "$stage" harness-office
rm -rf "$stage"
echo "$out"
tar -tzf "$out" | awk 'BEGIN{n=0} {n++} END{print n, "entries"}'
ls -lh "$out"
