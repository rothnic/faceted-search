#!/bin/sh
# Stage the official PG15 extension package for COPY into a Docker image.
# This extracts files only; it never installs host packages or starts PostgreSQL.
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 STAGING_DIRECTORY" >&2
  exit 2
fi
destination=$1
version=0.26.1
architecture=${TARGETARCH:-$(dpkg --print-architecture)}
case "$architecture" in
  amd64) checksum=922272988a92599bb9bbf619b8895f5280f8dc399f46cbdb68073582bc3bc132 ;;
  arm64) checksum=3126796dcc2891374f9f5724cac4dd65afb91dc4f65af6a4b8da6459cf92ba39 ;;
  *) echo "pg_search demo supports amd64 or arm64, not $architecture" >&2; exit 2 ;;
esac

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
package=$temporary/pg_search.deb
if [ -n "${PG_SEARCH_DEB:-}" ]; then
  # An offline package still has to match the official release checksum.
  cp "$PG_SEARCH_DEB" "$package"
else
  curl -fLsS --retry 2 \
    "https://github.com/paradedb/paradedb/releases/download/v${version}/postgresql-15-pg-search_${version}-1PARADEDB-bookworm_${architecture}.deb" \
    -o "$package"
fi
printf '%s  %s\n' "$checksum" "$package" | sha256sum -c -
test "$(dpkg-deb --field "$package" Package)" = postgresql-15-pg-search
test "$(dpkg-deb --field "$package" Version)" = "$version"
test "$(dpkg-deb --field "$package" Architecture)" = "$architecture"
mkdir -p "$destination"
dpkg-deb --extract "$package" "$destination"
grep -q "^default_version = '$version'$" "$destination/usr/share/postgresql/15/extension/pg_search.control"
printf 'Staged pg_search %s (%s); runtime needs libopenblas0 and pgvector.\n' "$version" "$architecture"
