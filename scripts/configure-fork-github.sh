#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

repo=get-aix/aix-code
dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

fork_owned=(
  fork-ci.yml
  fork-release.yml
  fork-release-desktop.yml
  fork-nix-flake-update.yml
  mobile-android-fork.yml
  upstream-stable-sync.yml
)

already_disabled=""
if [[ $dry_run == false ]]; then
  already_disabled=$(gh workflow list --repo "$repo" --all --json path,state --jq '.[] | select(.state != "active") | .path' 2>/dev/null || true)
fi

for workflow in .github/workflows/*.yml; do
  filename=${workflow##*/}
  if [[ " ${fork_owned[*]} " == *" $filename "* ]]; then
    continue
  fi
  if [[ $dry_run == true ]]; then
    printf 'DRY RUN: gh workflow disable %s --repo %s\n' "$filename" "$repo"
  elif grep -qxF "$workflow" <<< "$already_disabled"; then
    printf 'SKIP (already disabled): %s\n' "$filename"
  else
    gh workflow disable "$filename" --repo "$repo"
  fi
done

checks=$(node -e 'process.stdout.write(require("./.github/scripts/fork-ci-checks.cjs").REQUIRED_FORK_CHECKS.join("\n"))')
printf '\nRequired Fork CI status checks (configure branch protection on %s):\n%s\n' "$repo" "$checks"
