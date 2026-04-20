#!/usr/bin/env bash
# Build script: create a single self-contained index.html + ZIP
# Inlines all JS, CSS, and fonts as base64 data URIs
# Usage: ./build.sh
# Works on macOS, Linux, and WSL

set -e

SRCDIR="$(cd "$(dirname "$0")" && pwd)"
SRCFILE="$SRCDIR/index.html"
DISTDIR="$SRCDIR/dist"
OUTFILE="$DISTDIR/index.html"

mkdir -p "$DISTDIR"

# Detect base64 flags (macOS vs Linux)
if base64 --wrap=0 /dev/null 2>/dev/null; then
  B64="base64 --wrap=0"
else
  B64="base64"
fi

# Helper: convert file to base64 data URI
file_to_data_uri() {
  local file="$1" mime="$2"
  local b64=$($B64 < "$file")
  echo "data:$mime;base64,$b64"
}

# Helper: get MIME type for font file
font_mime() {
  case "$1" in
    *.woff2) echo "font/woff2" ;;
    *.ttf)   echo "font/ttf" ;;
    *.woff)  echo "font/woff" ;;
    *)       echo "application/octet-stream" ;;
  esac
}

# Read version from cbm-editor.js
VERSION=$(grep -oP 'major:\s*\K\d+' "$SRCDIR/assets/js/cbm-editor.js" 2>/dev/null || echo "0")
MINOR=$(grep -oP 'minor:\s*\K\d+' "$SRCDIR/assets/js/cbm-editor.js" 2>/dev/null || echo "0")
BUILD=$(grep -oP 'build:\s*\K\d+' "$SRCDIR/assets/js/cbm-editor.js" 2>/dev/null || echo "0")
# Fallback for macOS (no -P flag in grep)
if [ "$VERSION" = "0" ] && [ "$MINOR" = "0" ]; then
  VERSION=$(sed -n 's/.*major:\s*\([0-9]*\).*/\1/p' "$SRCDIR/assets/js/cbm-editor.js" | head -1)
  MINOR=$(sed -n 's/.*minor:\s*\([0-9]*\).*/\1/p' "$SRCDIR/assets/js/cbm-editor.js" | head -1)
  BUILD=$(sed -n 's/.*build:\s*\([0-9]*\).*/\1/p' "$SRCDIR/assets/js/cbm-editor.js" | head -1)
fi
FULLVERSION="$VERSION.$MINOR.$BUILD"
echo -e "\033[36mBuilding CBM Disk Editor v$FULLVERSION...\033[0m"

html=$(cat "$SRCFILE")

# 0. Strip SEO-only blocks (meta tags, JSON-LD, noscript content) — those
#    are for search engines on the hosted site, not for the standalone.
html=$(echo "$html" | perl -0777 -pe 's/<!-- SEO:BEGIN[^>]*-->.*?<!-- SEO:END -->\s*//gs')
echo -e "  \033[90mStripped SEO blocks\033[0m"

# 1. Inline FontAwesome CSS with embedded font files
FA_CSS="$SRCDIR/assets/fontawesome/all.min.css"
if [ -f "$FA_CSS" ]; then
  fa_content=$(cat "$FA_CSS")
  # Replace font URLs with base64 data URIs
  while IFS= read -r fontref; do
    fontfile=$(echo "$fontref" | sed 's/.*url(\.\.\///' | sed 's/).*//')
    fontpath="$SRCDIR/assets/$fontfile"
    if [ -f "$fontpath" ]; then
      mime=$(font_mime "$fontpath")
      uri=$(file_to_data_uri "$fontpath" "$mime")
      fa_content=$(echo "$fa_content" | sed "s|url(\.\./webfonts/$(basename "$fontpath"))|url($uri)|g")
    fi
  done < <(grep -o 'url(\.\./webfonts/[^)]*)' "$FA_CSS")
  html=$(echo "$html" | sed '/<link rel="stylesheet" href="assets\/fontawesome\/all\.min\.css">/c\<style>\n'"$(echo "$fa_content" | sed 's/[&/\]/\\&/g')"'\n</style>')
  echo -e "  \033[90mInlined FontAwesome CSS + fonts\033[0m"
fi

# 2. Inline app CSS files
for csslink in $(echo "$html" | grep -o 'href="assets/css/[^"]*"' | sed 's/href="//;s/"//'); do
  csspath="$SRCDIR/$csslink"
  if [ -f "$csspath" ]; then
    css_content=$(cat "$csspath")
    # Escape for sed replacement
    css_escaped=$(echo "$css_content" | sed ':a;N;$!ba;s/\n/\\n/g;s/[&/\]/\\&/g')
    html=$(echo "$html" | sed "s|<link rel=\"stylesheet\" href=\"$csslink\">|<style>\n$css_escaped\n</style>|")
    echo -e "  \033[90mInlined $csslink\033[0m"
  fi
done

# 3. Inline C64 Pro Mono fonts in @font-face declarations
for fontref in $(echo "$html" | grep -o "url('assets/webfonts/[^']*')" | sed "s/url('//;s/')//"); do
  fontpath="$SRCDIR/$fontref"
  if [ -f "$fontpath" ]; then
    mime=$(font_mime "$fontpath")
    uri=$(file_to_data_uri "$fontpath" "$mime")
    html=$(echo "$html" | sed "s|url('$fontref')|url('$uri')|g")
  fi
done
echo -e "  \033[90mInlined C64 Pro Mono fonts\033[0m"

# 4. Inline JS files (skip matomo.js)
while IFS= read -r scriptline; do
  jsfile=$(echo "$scriptline" | sed 's/.*src="//;s/".*//')
  if echo "$jsfile" | grep -q "matomo"; then
    html=$(echo "$html" | sed "s|$scriptline|<!-- Matomo excluded from dist build -->|")
    echo -e "  \033[33mSkipped $jsfile (analytics)\033[0m"
    continue
  fi
  jspath="$SRCDIR/$jsfile"
  if [ -f "$jspath" ]; then
    js_content=$(cat "$jspath")
    js_escaped=$(echo "$js_content" | sed ':a;N;$!ba;s/\n/\\n/g;s/[&/\]/\\&/g')
    escaped_line=$(echo "$scriptline" | sed 's/[[\.*^$()+?{|]/\\&/g')
    html=$(echo "$html" | sed "s|$escaped_line|<script>\n$js_escaped\n</script>|")
    echo -e "  \033[90mInlined $jsfile\033[0m"
  fi
done < <(echo "$html" | grep -o '<script src="[^"]*"></script>')

# Write output
echo "$html" > "$OUTFILE"

SIZE=$(wc -c < "$OUTFILE" | tr -d ' ')
SIZE_KB=$((SIZE / 1024))
SIZE_MB=$(echo "scale=1; $SIZE / 1048576" | bc)
echo -e "  \033[32mBuilt dist/index.html ($SIZE_KB KB / $SIZE_MB MB)\033[0m"

# 5. Create ZIP
ZIPNAME="CBM Disk Editor $FULLVERSION.zip"
ZIPFILE="$DISTDIR/$ZIPNAME"
rm -f "$ZIPFILE"
(cd "$DISTDIR" && zip -q -9 "$ZIPNAME" index.html)
ZIPSIZE=$(( $(wc -c < "$ZIPFILE" | tr -d ' ') / 1024 ))
echo -e "  \033[32mBuilt dist/$ZIPNAME ($ZIPSIZE KB)\033[0m"

echo -e "\033[36mDone! Single file, no dependencies.\033[0m"
