#!/usr/bin/env bash
# Package LariatApp (SwiftPM executable) into a distributable macOS .app bundle,
# and optionally a .pkg installer. SwiftPM only emits a bare Mach-O executable;
# this assembles the Contents/ layout Finder + Gatekeeper expect, folds in the
# SwiftPM resource bundles (so Bundle.module — e.g. C2's frozen_schema.sql —
# resolves at runtime), generates the icon, signs, and verifies.
#
# Usage:
#   Scripts/package-app.sh [--sign IDENTITY] [--icon PATH] [--version X.Y.Z]
#                          [--build N] [--pkg] [--out DIR]
#
#   --sign   codesign identity. Default "-" (ad-hoc): runs locally, NOT
#            distributable/notarizable. Pass a "Developer ID Application: …"
#            identity for a notarizable build (none is installed today — see
#            the notarization note at the bottom of this file / the packaging doc).
#   --icon   source image for the app icon (any square-ish PNG). Default:
#            <repo>/public/logo.png. Non-square sources are padded to square.
#   --pkg    also produce a component .pkg installer wrapping the .app.
#   --out    output dir. Default: LariatNative/build.
#
# Exit 0 only when the bundle is assembled AND codesign --verify passes.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$(cd "$HERE/.." && pwd)"          # LariatNative/
REPO_ROOT="$(cd "$NATIVE_DIR/.." && pwd)"     # repo root

APP_NAME="Lariat"
EXECUTABLE="LariatApp"
BUNDLE_ID="com.lariat.native"
MIN_MACOS="14.0"
BRAND_BG="1A1711"   # brand ember-dark, used to pad a non-square icon source

SIGN_IDENTITY="-"
# Committed packaging asset first; fall back to the web public/ logo if present.
ICON_SRC="$NATIVE_DIR/Packaging/AppIcon.png"
[[ -f "$ICON_SRC" ]] || ICON_SRC="$REPO_ROOT/public/logo.png"
VERSION="0.1.0"
BUILD_NUM="1"
MAKE_PKG=0
OUT_DIR="$NATIVE_DIR/build"

die() { echo "package-app: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sign) SIGN_IDENTITY="$2"; shift 2 ;;
    --icon) ICON_SRC="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --build) BUILD_NUM="$2"; shift 2 ;;
    --pkg) MAKE_PKG=1; shift ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

for t in swift sips iconutil codesign plutil; do
  command -v "$t" >/dev/null 2>&1 || die "required tool not found: $t"
done

# ── 1. release build ─────────────────────────────────────────────────
echo "package-app: building $EXECUTABLE (release)…"
( cd "$NATIVE_DIR" && swift build -c release --product "$EXECUTABLE" >/dev/null )
BIN_DIR="$(cd "$NATIVE_DIR" && swift build -c release --show-bin-path)"
EXE_PATH="$BIN_DIR/$EXECUTABLE"
[[ -x "$EXE_PATH" ]] || die "release executable missing: $EXE_PATH"

# ── 2. assemble the .app skeleton ────────────────────────────────────
APP="$OUT_DIR/$APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$EXE_PATH" "$APP/Contents/MacOS/$EXECUTABLE"

# Fold in every SwiftPM resource bundle next to the exe (Bundle.module resolves
# via Bundle.main.resourceURL = Contents/Resources in an .app). This is what
# carries C2's frozen_schema.sql (LariatNative_LariatDB.bundle) + GRDB's.
shopt -s nullglob
for b in "$BIN_DIR"/*.bundle; do
  cp -R "$b" "$APP/Contents/Resources/"
done
shopt -u nullglob

# ── 3. icon: pad to square on the brand bg, build the .icns ──────────
if [[ -f "$ICON_SRC" ]]; then
  echo "package-app: generating AppIcon.icns from $(basename "$ICON_SRC")…"
  ICON_TMP="$(mktemp -d)"
  W="$(sips -g pixelWidth "$ICON_SRC" | awk '/pixelWidth/{print $2}')"
  H="$(sips -g pixelHeight "$ICON_SRC" | awk '/pixelHeight/{print $2}')"
  SIDE=$(( W > H ? W : H ))
  # center the source on a square canvas so the icon isn't stretched
  sips -p "$SIDE" "$SIDE" --padColor "$BRAND_BG" "$ICON_SRC" --out "$ICON_TMP/square.png" >/dev/null
  ICONSET="$ICON_TMP/AppIcon.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s"           "$ICON_TMP/square.png" --out "$ICONSET/icon_${s}x${s}.png"    >/dev/null
    sips -z $((s*2)) $((s*2))   "$ICON_TMP/square.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  rm -rf "$ICON_TMP"
  ICON_PLIST_KEY="AppIcon"
else
  echo "package-app: WARNING — icon source not found ($ICON_SRC); shipping without an icon"
  ICON_PLIST_KEY=""
fi

# ── 4. Info.plist ────────────────────────────────────────────────────
PLIST="$APP/Contents/Info.plist"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>$EXECUTABLE</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUM</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.business</string>
  <key>NSHumanReadableCopyright</key><string>Lariat — internal build. All rights reserved.</string>
  $( [[ -n "$ICON_PLIST_KEY" ]] && echo "<key>CFBundleIconFile</key><string>$ICON_PLIST_KEY</string>" )
</dict>
</plist>
PLIST_EOF
plutil -lint "$PLIST" >/dev/null || die "generated Info.plist failed plutil -lint"

# ── 5. sign ──────────────────────────────────────────────────────────
echo "package-app: signing (identity: $SIGN_IDENTITY)…"
# Sign nested bundles first (inside-out), then the app.
find "$APP/Contents/Resources" -name "*.bundle" -maxdepth 1 -print0 | while IFS= read -r -d '' b; do
  codesign --force --sign "$SIGN_IDENTITY" --timestamp=none "$b" >/dev/null 2>&1 || true
done
codesign --force --deep --sign "$SIGN_IDENTITY" --timestamp=none \
  --options runtime "$APP" 2>/dev/null \
  || codesign --force --deep --sign "$SIGN_IDENTITY" --timestamp=none "$APP"

# ── 6. verify ────────────────────────────────────────────────────────
echo "package-app: verifying…"
codesign --verify --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /' || die "codesign --verify failed"
SIZE="$(du -sh "$APP" | cut -f1)"
echo "package-app: built $APP ($SIZE)"

# ── 7. optional .pkg ─────────────────────────────────────────────────
if [[ "$MAKE_PKG" -eq 1 ]]; then
  command -v pkgbuild >/dev/null 2>&1 || die "pkgbuild not found (needed for --pkg)"
  PKG="$OUT_DIR/$APP_NAME-$VERSION.pkg"
  # --component takes the .app directly. stderr is dropped: pkgbuild emits
  # benign "write: Permission denied" from its analysis phase under a sandboxed
  # HOME; the pkg is still valid. We assert the artifact exists instead.
  pkgbuild --component "$APP" --install-location /Applications \
    --identifier "$BUNDLE_ID" --version "$VERSION" "$PKG" >/dev/null 2>&1 || true
  [[ -f "$PKG" ]] || die "pkgbuild did not produce $PKG"
  echo "package-app: built $PKG"
fi

echo "package-app: done."
# NOTARIZATION (gated): a notarized, Gatekeeper-clean build additionally needs a
# "Developer ID Application" cert (none installed — only Apple Development certs
# exist today) and:
#   codesign --force --deep --options runtime --timestamp \
#            --sign "Developer ID Application: <Team>" build/Lariat.app
#   xcrun notarytool submit build/Lariat-<v>.pkg --keychain-profile <profile> --wait
#   xcrun stapler staple build/Lariat.app
# See Scripts/PACKAGING.md.
