#!/bin/bash
# bootstrap-env.sh — compose optional OneCLI startup hooks
#
# Source every known bootstrap helper if it is present in this image. This keeps
# branch-specific runtime fixes stack-safe when multiple PRs touch container
# startup in parallel and land in either order.

for hook in /app/bootstrap-ssl.sh /app/onecli-secrets-manifest.sh; do
  if [ -f "$hook" ]; then
    # shellcheck disable=SC1090
    . "$hook"
  fi
done
