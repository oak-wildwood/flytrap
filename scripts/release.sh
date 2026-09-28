#!/usr/bin/env bash
# Cuts a Flytrap release: an immutable vX.Y.Z tag, plus the vX major tag moved to it, so adopters
# can pin either. The action, the Rubric skill and the findings schema all live in this one repo,
# so one tag versions them together.
#
#   scripts/release.sh 1.0.0
#
# Run from an up-to-date main whose package.json already says the version being released.
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/release.sh X.Y.Z" >&2
  exit 2
fi
tag="v$version"
major="v${version%%.*}"

cd "$(git rev-parse --show-toplevel)"

[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || { echo "release from main" >&2; exit 1; }
# --force: the major tag moves on every release, and fetch won't overwrite a stale local copy
# of it otherwise ("would clobber existing tag").
git fetch --quiet --tags --force origin
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "commit or stash your changes first" >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "main isn't at origin/main; pull first" >&2; exit 1; }
if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then
  echo "$tag already exists; releases are immutable, cut a new version" >&2
  exit 1
fi
pkg_version="$(node -p "require('./package.json').version")"
[[ "$pkg_version" == "$version" ]] || { echo "package.json says $pkg_version, not $version" >&2; exit 1; }

# Before any tag exists: once they're pushed, a failed release can't be re-run from here.
gh auth status >/dev/null 2>&1 || { echo "gh isn't authenticated; run gh auth login first" >&2; exit 1; }

npm test --silent

git tag --annotate "$tag" --message "Flytrap $tag"
# The major tag moves forward with every release in its line; that's what makes `@v1` useful.
git tag --force --annotate "$major" --message "Flytrap $major (currently $tag)"
git push origin "refs/tags/$tag"
git push --force origin "refs/tags/$major"

release=(gh release create "$tag" --title "Flytrap $tag" --generate-notes --verify-tag)
if ! "${release[@]}"; then
  echo "The tags are pushed but the release wasn't created. Finish it with:" >&2
  echo "  ${release[*]}" >&2
  exit 1
fi
echo "Released $tag and moved $major to it."
