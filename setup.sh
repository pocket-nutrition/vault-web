#!/usr/bin/env bash
set -euo pipefail

# Pocket Nutrition Vault Web — First-time setup
# Usage: ./setup.sh

echo "=== Pocket Nutrition Vault Web Setup ==="

# Work from the repository root, wherever the script is called from.
cd "$(dirname "${BASH_SOURCE[0]}")"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js 22 or newer is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required (it comes with Node.js)."; exit 1; }
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${node_major}" -lt 22 ]; then
  echo "Error: Node.js 22 or newer is required (found $(node --version))."
  exit 1
fi

# Dependencies, exactly as package-lock.json pins them. There is no .env: the page has no runtime settings.
echo "Installing dependencies..."
npm ci

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Run the tests: npm test"
echo "  2. Build the page: npm run build   (writes dist/)"
echo "  3. Try it against a local vault: see CONTRIBUTING.md"
echo "  4. Using Claude Code? CLAUDE.md has all the context."
