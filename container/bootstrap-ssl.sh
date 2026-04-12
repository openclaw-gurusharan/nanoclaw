#!/bin/bash
# bootstrap-ssl.sh — OneCLI CA cert auto-configuration
#
# Detects the OneCLI combined CA bundle at the well-known mount path and
# exports SSL env vars so that git, Node.js, npm, and curl all trust the
# OneCLI HTTPS intercept proxy.  Must be sourced (`. /app/bootstrap-ssl.sh`)
# before any network operation.
#
# Architecture: credentials are never stored here.  The CA cert only enables
# TLS trust for the proxy; the proxy injects real secrets at intercept time.

ONECLI_CA="/tmp/nanoclaw-onecli/onecli-combined-ca.pem"

if [ -f "$ONECLI_CA" ]; then
  export GIT_SSL_CAINFO="$ONECLI_CA"
  export NODE_EXTRA_CA_CERTS="$ONECLI_CA"
  export SSL_CERT_FILE="$ONECLI_CA"
  echo "[bootstrap-ssl] OneCLI CA detected — SSL env vars configured." >&2
else
  echo "[bootstrap-ssl] OneCLI CA not present at $ONECLI_CA — using system defaults." >&2
fi
