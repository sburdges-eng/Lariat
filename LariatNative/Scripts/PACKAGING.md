# Packaging LariatApp into a macOS `.app` / `.pkg`

SwiftPM only emits a bare executable (`.build/release/LariatApp`). This is the
endgame **H8** groundwork — the distributable bundle the roadmap flagged as
"gated on `.app` bundle + signing identity decision." `Scripts/package-app.sh`
assembles the bundle; notarized distribution still needs a Developer ID cert
(see below).

## Build a bundle

```sh
cd LariatNative
Scripts/package-app.sh              # → build/Lariat.app  (ad-hoc signed)
Scripts/package-app.sh --pkg        # → build/Lariat.app + build/Lariat-0.1.0.pkg
Scripts/package-app.sh --version 0.2.0 --build 7 --pkg
Scripts/package-app.sh --sign "Developer ID Application: … (TEAMID)" --pkg
Scripts/package-app.sh --icon path/to/icon.png
```

Output goes to `LariatNative/build/` (git-ignored). Flags: `--sign` (codesign
identity, default `-` ad-hoc), `--icon` (default `Packaging/AppIcon.png`, then
`../public/logo.png`), `--version` / `--build`, `--pkg`, `--out`.

## What the script does

1. `swift build -c release --product LariatApp`.
2. Assembles `Lariat.app/Contents/{MacOS,Resources}` and copies the executable.
3. **Folds in the SwiftPM resource bundles** (`LariatNative_LariatDB.bundle`,
   `GRDB_GRDB.bundle`) into `Contents/Resources/` so `Bundle.module` resolves at
   runtime — this is what carries **C2's `frozen_schema.sql`**. Without this the
   SchemaMigrator resource would be missing in a bundled launch.
4. Pads the icon source to square on the brand background and builds
   `AppIcon.icns` (`sips` + `iconutil`).
5. Writes `Info.plist` (`com.lariat.native`, min macOS 14, hi-res, business
   category) and lints it with `plutil`.
6. Signs (nested bundles inside-out, then the app) and `codesign --verify`s.
7. `--pkg`: `pkgbuild --component` → a component installer to `/Applications`.

## Verified

`codesign --verify --strict` passes; `otool -L` shows only system frameworks
(no broken rpaths); `frozen_schema.sql` is present inside the bundled resource;
the `.pkg` expands to a valid `Bom`/`PackageInfo`/`Payload` installing to
`/Applications`. A full GUI launch must be confirmed on a desktop login session
(headless CI can't open a window).

## Running the app

The data directory resolves from `LARIAT_DATA_DIR` (else `<cwd>/data`;
`DataDirectory.swift`). Launched from Finder there is no useful cwd, so point it
at the data dir — e.g.:

```sh
LARIAT_DATA_DIR="$PWD/data" LARIAT_ROOT="$PWD" LARIAT_PIN=1234 \
  build/Lariat.app/Contents/MacOS/LariatApp
```

A future refinement (Phase C/D) is to default the data dir to
`~/Library/Application Support/Lariat/` and seed a fresh DB via the C2
`SchemaMigrator` on first run, so a double-clicked app is self-sufficient.

## Notarization — the remaining gate

Ad-hoc / Apple Development signing runs locally but Gatekeeper quarantines it on
another Mac. A notarized build needs a **Developer ID Application** certificate
(only Apple Development certs are installed today) plus a notary profile:

```sh
Scripts/package-app.sh --sign "Developer ID Application: <Name> (<TEAMID>)" --pkg
xcrun notarytool submit build/Lariat-0.1.0.pkg --keychain-profile <profile> --wait
xcrun stapler staple build/Lariat.app          # and re-pkg, or staple the pkg
spctl -a -vv -t install build/Lariat-0.1.0.pkg # should report "accepted / Notarized"
```

Decisions still needed from the owner: the Developer ID identity + team, the
notary keychain profile, and whether distribution is `.pkg` or a stapled
`.app` in a `.dmg`.
