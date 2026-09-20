#!/usr/bin/env bash
# Build script: create a single self-contained index.html + ZIP
# Inlines all JS, CSS, and fonts as base64 data URIs
# Usage: ./build.sh
# Works on macOS, Linux, and WSL
#
# All text substitution is done by the embedded Perl program below. Passing the
# inlined content (FontAwesome CSS + ~1 MB of base64 fonts) as a sed/awk command
# line argument blows past ARG_MAX on macOS: "Argument list too long".

set -e

SRCDIR="$(cd "$(dirname "$0")" && pwd)"
SRCFILE="$SRCDIR/index.html"
DISTDIR="$SRCDIR/dist"
OUTFILE="$DISTDIR/index.html"

mkdir -p "$DISTDIR"

# Read version from cbm-editor.js (perl: BSD grep has no -P, BSD sed no \s)
FULLVERSION=$(perl -ne 'if (/major:\s*(\d+)\s*,\s*minor:\s*(\d+)\s*,\s*build:\s*(\d+)/) { print "$1.$2.$3"; exit }' "$SRCDIR/assets/js/format/cbm-editor.js")
[ -n "$FULLVERSION" ] || FULLVERSION="0.0.0"
printf '\033[36mBuilding CBM Disk Editor v%s...\033[0m\n' "$FULLVERSION"

perl - "$SRCDIR" "$SRCFILE" "$OUTFILE" <<'PERL_BUILD'
use strict;
use warnings;
use MIME::Base64 qw(encode_base64);

my ($srcdir, $srcfile, $outfile) = @ARGV;

sub slurp {
    my ($path) = @_;
    open(my $fh, '<:raw', $path) or die "Cannot read $path: $!\n";
    local $/;
    my $data = <$fh>;
    close $fh;
    return defined $data ? $data : '';
}

sub note { printf "  \033[90m%s\033[0m\n", $_[0]; }
sub warn_note { printf "  \033[33m%s\033[0m\n", $_[0]; }

sub data_uri {
    my ($path) = @_;
    my $mime = $path =~ /\.woff2$/i ? 'font/woff2'
             : $path =~ /\.woff$/i  ? 'font/woff'
             : $path =~ /\.ttf$/i   ? 'font/ttf'
             :                        'application/octet-stream';
    return "data:$mime;base64," . encode_base64(slurp($path), '');
}

# Replace url(../webfonts/x) / url('assets/webfonts/x') with base64 data URIs.
# Both spellings occur: FontAwesome and base.css use ../webfonts/, index.html
# uses assets/webfonts/.
sub inline_fonts {
    my ($css) = @_;
    $css =~ s{url\((['"]?)(?:\.\./|assets/)webfonts/([^'")]+)\1\)}{
        my ($q, $name) = ($1, $2);
        my $font = "$srcdir/assets/webfonts/$name";
        -f $font ? "url($q" . data_uri($font) . "$q)" : $&;
    }ge;
    return $css;
}

my $html = slurp($srcfile);

# 0. Strip SEO-only blocks (meta tags, JSON-LD, noscript content) - those
#    are for search engines on the hosted site, not for the standalone.
$html =~ s/<!-- SEO:BEGIN[^>]*-->.*?<!-- SEO:END -->\s*//gs;
note('Stripped SEO blocks');

# 1. Inline FontAwesome CSS with embedded font files
my $fa_css = "$srcdir/assets/fontawesome/all.min.css";
if (-f $fa_css) {
    my $fa = inline_fonts(slurp($fa_css));
    $html =~ s{<link rel="stylesheet" href="assets/fontawesome/all\.min\.css">}{"<style>\n$fa\n</style>"}e;
    note('Inlined FontAwesome CSS + fonts');
}

# 2. Inline app CSS files (assets/css/*.css)
$html =~ s{<link rel="stylesheet" href="(assets/css/[^"]+)">}{
    my $rel = $1;
    my $path = "$srcdir/$rel";
    if (-f $path) {
        note("Inlined $rel");
        "<style>\n" . slurp($path) . "\n</style>";
    } else {
        warn_note("CSS file not found: $path");
        $&;
    }
}ge;

# 3. Inline the C64 Pro Mono @font-face sources (now that base.css is inlined)
$html = inline_fonts($html);
note('Inlined C64 Pro Mono fonts');

# 4. Inline JS files (skip matomo.js)
$html =~ s{(?:<!-- Matomo[^>]*-->\s*)?<script src="([^"]+)"></script>}{
    my $rel = $1;
    my $path = "$srcdir/$rel";
    if ($rel =~ /matomo/) {
        warn_note("Skipped $rel (analytics)");
        '<!-- Matomo excluded from dist build -->';
    } elsif (-f $path) {
        note("Inlined $rel");
        "<script>\n" . slurp($path) . "\n</script>";
    } else {
        warn_note("File not found: $path");
        $&;
    }
}ge;

open(my $out, '>:raw', $outfile) or die "Cannot write $outfile: $!\n";
print $out $html;
close $out;
PERL_BUILD

SIZE=$(wc -c < "$OUTFILE" | tr -d ' ')
printf '  \033[32mBuilt dist/index.html (%s KB / %s MB)\033[0m\n' \
  "$((SIZE / 1024))" "$(awk -v s="$SIZE" 'BEGIN { printf "%.1f", s / 1048576 }')"

# 5. Create ZIP
ZIPNAME="CBM Disk Editor $FULLVERSION.zip"
ZIPFILE="$DISTDIR/$ZIPNAME"
rm -f "$ZIPFILE"
(cd "$DISTDIR" && zip -q -9 "$ZIPNAME" index.html)
ZIPSIZE=$(( $(wc -c < "$ZIPFILE" | tr -d ' ') / 1024 ))
printf '  \033[32mBuilt dist/%s (%s KB)\033[0m\n' "$ZIPNAME" "$ZIPSIZE"

printf '\033[36mDone! Single file, no dependencies.\033[0m\n'
