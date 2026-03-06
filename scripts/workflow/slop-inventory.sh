#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

mode="summary"

usage() {
  cat <<'USAGE'
Usage: scripts/workflow/slop-inventory.sh [options]

Deterministic slop inventory for docs/scripts reference hygiene.

Options:
  --list-unreferenced-docs      Print only unreferenced docs
  --list-unreferenced-scripts   Print only unreferenced scripts
  --summary                     Print counts and both lists (default)
  -h, --help                    Show help
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --list-unreferenced-docs)
      mode="docs"
      shift
      ;;
    --list-unreferenced-scripts)
      mode="scripts"
      shift
      ;;
    --summary)
      mode="summary"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

docs_all="$(mktemp /tmp/slop-docs-all.XXXXXX)"
docs_refs="$(mktemp /tmp/slop-docs-refs.XXXXXX)"
docs_unreferenced="$(mktemp /tmp/slop-docs-unref.XXXXXX)"
scripts_all="$(mktemp /tmp/slop-scripts-all.XXXXXX)"
scripts_refs="$(mktemp /tmp/slop-scripts-refs.XXXXXX)"
scripts_unreferenced="$(mktemp /tmp/slop-scripts-unref.XXXXXX)"
trap 'rm -f "$docs_all" "$docs_refs" "$docs_unreferenced" "$scripts_all" "$scripts_refs" "$scripts_unreferenced"' EXIT

has_rg=0
if command -v rg >/dev/null 2>&1; then
  has_rg=1
fi

extract_matches() {
  local pattern="$1"
  local file="$2"
  if [ "$has_rg" -eq 1 ]; then
    rg -o --no-filename "$pattern" "$file" || true
    return
  fi
  grep -Eo "$pattern" "$file" || true
}

extract_matches_from_glob() {
  local pattern="$1"
  shift
  if [ "$has_rg" -eq 1 ]; then
    rg -o --no-filename "$pattern" "$@" || true
    return
  fi
  find "$@" -type f -name '*.sh' -print0 | while IFS= read -r -d '' file; do
    grep -Eo "$pattern" "$file" || true
  done
}

collect_unreferenced_docs() {
  find docs -type f -name '*.md' | sort >"$docs_all"
  : >"$docs_refs"
  for f in CLAUDE.md AGENTS.md DOCS.md docs/README.md $(find docs .claude/rules -type f -name '*.md' | sort); do
    extract_matches 'docs/[A-Za-z0-9._/-]+\.md' "$f" >>"$docs_refs"
  done
  sort -u "$docs_refs" -o "$docs_refs"
  comm -23 "$docs_all" "$docs_refs" >"$docs_unreferenced"
}

collect_unreferenced_scripts() {
  find scripts -type f \( -name '*.sh' -o -name '*.ts' \) | sort >"$scripts_all"
  : >"$scripts_refs"

  for f in CLAUDE.md AGENTS.md DOCS.md package.json $(find docs .claude/rules .github/workflows scripts -type f \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.sh' -o -name '*.ts' \) | sort); do
    extract_matches 'scripts/[A-Za-z0-9._/-]+\.(sh|ts)' "$f" >>"$scripts_refs"
    extract_matches '\./scripts/[A-Za-z0-9._/-]+\.(sh|ts)' "$f" | sed 's#^\./##' >>"$scripts_refs" || true
  done

  # Include scripts routed via local SCRIPT_DIR dispatch (e.g. jarvis-ops command fanout).
  extract_matches_from_glob '\$SCRIPT_DIR/[A-Za-z0-9._/-]+\.(sh|ts)' scripts \
    | sed 's#^\$SCRIPT_DIR/#scripts/#' >>"$scripts_refs" || true

  sort -u "$scripts_refs" -o "$scripts_refs"
  comm -23 "$scripts_all" "$scripts_refs" >"$scripts_unreferenced"
}

collect_unreferenced_docs
collect_unreferenced_scripts

case "$mode" in
  docs)
    cat "$docs_unreferenced"
    ;;
  scripts)
    cat "$scripts_unreferenced"
    ;;
  summary)
    docs_count="$(wc -l <"$docs_unreferenced" | tr -d ' ')"
    scripts_count="$(wc -l <"$scripts_unreferenced" | tr -d ' ')"
    echo "unreferenced_docs=${docs_count}"
    cat "$docs_unreferenced"
    echo "unreferenced_scripts=${scripts_count}"
    cat "$scripts_unreferenced"
    ;;
esac
