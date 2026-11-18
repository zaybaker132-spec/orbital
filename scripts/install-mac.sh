#!/bin/bash
# Install Orbital on a Mac from the zip you downloaded, in one step.
#
#   bash ~/Downloads/install-mac.sh
#
# It picks the right zip for your Mac (Apple chip or Intel) from Downloads, replaces any older
# copies of Orbital (Orbital 2, Orbital 3…), installs it in Applications, marks it as trusted on
# this Mac (the app isn't signed with a paid Apple certificate) and opens it. Your Orbital data
# lives elsewhere (~/Library/Application Support/Orbital) and is never touched.
set -euo pipefail

say() { printf '\033[1m%s\033[0m\n' "$*"; }

if [ "$(uname -m)" = "arm64" ]; then pattern='Orbital*arm64*mac*.zip'; chip="Apple chip"; else pattern='Orbital*mac*.zip'; chip="Intel"; fi
zip=""
while IFS= read -r f; do
  # On Intel Macs, skip the Apple-chip build.
  if [ "$chip" = "Intel" ] && [[ "$f" == *arm64* ]]; then continue; fi
  zip="$f"; break
done < <(ls -t ~/Downloads/$pattern 2>/dev/null || true)

if [ -z "$zip" ]; then
  say "Couldn't find the Orbital download for your Mac ($chip) in Downloads."
  echo "Download $( [ "$chip" = "Intel" ] && echo "Orbital-…-mac.zip" || echo "Orbital-…-arm64-mac.zip" ) into your Downloads folder, then run this again."
  exit 1
fi
say "Installing from $(basename "$zip") ($chip)…"

# Close Orbital if it's running, so it can be replaced.
osascript -e 'tell application "Orbital" to quit' >/dev/null 2>&1 || true
pkill -x Orbital >/dev/null 2>&1 || true
sleep 1

# Remove older copies (only Orbital apps; nothing else).
for d in /Applications ~/Applications ~/Downloads ~/Desktop; do
  for app in "$d/Orbital.app" "$d"/Orbital\ [0-9]*.app; do
    [ -d "$app" ] && rm -rf "$app" && echo "Removed old copy: $app"
  done
done

tmp="$(mktemp -d)"
ditto -x -k "$zip" "$tmp"
app="$(find "$tmp" -maxdepth 2 -name '*.app' -type d | head -1)"
[ -n "$app" ] || { say "The download doesn't contain the app. Download it again and retry."; exit 1; }
mv "$app" /Applications/Orbital.app
rm -rf "$tmp"

# Trust this copy on this Mac: clear the "downloaded from the internet" flag and sign it locally.
xattr -cr /Applications/Orbital.app
codesign --force --deep --sign - /Applications/Orbital.app >/dev/null 2>&1

say "Orbital is installed in Applications. Opening it…"
open /Applications/Orbital.app
