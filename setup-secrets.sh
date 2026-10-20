#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Kideos — one-time secret setup
# Run this ONCE after firebase login + project creation.
# Secrets are stored in Firebase Secret Manager — never in source.
#
# Usage:
#   chmod +x setup-secrets.sh
#   ./setup-secrets.sh
# ─────────────────────────────────────────────────────────────────

set -e

echo "Setting up Kideos Firebase secrets..."
echo "You will be prompted to paste each key."
echo ""

echo "→ YouTube Data API v3 key"
firebase functions:secrets:set YOUTUBE_API_KEY

echo ""
echo "→ Supadata API key"
firebase functions:secrets:set SUPADATA_API_KEY

echo ""
echo "→ OpenAI API key (for GPT-4o-mini)"
firebase functions:secrets:set OPENAI_API_KEY

echo ""
echo "→ Gemini API key (channel check — aistudio.google.com)"
firebase functions:secrets:set GEMINI_API_KEY

echo ""
echo "✅ All secrets set. Verify with: firebase functions:secrets:access SECRET_NAME"
echo ""
echo "Next: see docs/self-hosting.md step 4 (build functions, then deploy firestore, hosting, functions)"
