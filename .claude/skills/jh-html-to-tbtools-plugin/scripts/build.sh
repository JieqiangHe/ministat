#!/bin/bash
# usage: build.sh <tbtools_jar> <staging_dir> <name> [menu_path]
set -e
tb=$1; app=$(cd "$2" && pwd); n=$3; out="$PWD/$n.plugin"
here=$(cd "$(dirname "$0")" && pwd); w=$(mktemp -d); p="$w/p/$n"
[ -f "$app/index.html" ] || { echo "index.html not found in $app" >&2; exit 1; }
mkdir -p "$w/c" "$p"
cp -R "$app"/. "$p"/
find "$p" -mindepth 1 -name '.*' -prune -exec rm -rf {} +
! ls "$p"/*.jar >/dev/null 2>&1 || { echo "remove top-level .jar files from $app" >&2; exit 1; }
javac --release 11 -cp "$tb" -d "$w/c" "$here/PluginInject.java"
jar --create --no-manifest --file "$p/$n.jar" -C "$w/c" .
[ -z "$4" ] || printf '%s' "$4" > "$p/MenuConfig.ini"
rm -f "$out"; (cd "$w/p" && zip -qrX "$out" "$n")
rm -rf "$w"; echo "$out"
