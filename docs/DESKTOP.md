---
title: Desktop app (macOS, Windows, Linux)
date: 2026-11-18
tags: [desktop, electron, distribution]
---

# Desktop app (macOS, Windows, Linux)

Orbital ships as a native desktop app built with **Electron**. The app runs the real Orbital server inside a Node utility process — with its own embedded PostgreSQL (PGlite + pgvector) in the user's app-data folder — and shows it in a hardened window. Nothing to install besides the app; it works offline except for AI and research.

Why Electron rather than Tauri: Orbital's server is Node. Electron ships Node, so the same server runs unchanged on every platform. Tauri would require compiling and shipping a separate Node binary per platform as a sidecar — more moving parts for no gain here.

## Run it locally

```bash
npm run desktop
```

Builds the web app and server bundle, then opens the Electron window.

## Build installers

```bash
npm run desktop:dist
```

Builds for the current OS into `release/`:

| OS | Output |
|---|---|
| macOS | `Orbital-<version>-arm64.dmg`, `Orbital-<version>.dmg` (Intel), plus `.zip` for auto-update |
| Windows | `Orbital Setup <version>.exe` (x64 and arm64) |
| Linux | `Orbital-<version>.AppImage`, `orbital_<version>_amd64.deb` |

macOS installers must be built on a Mac and Windows installers are best built on Windows. The included workflow does that for you:

**GitHub Actions** — `.github/workflows/desktop.yml` runs the type check and full test suite, then builds on real `macos-latest`, `windows-latest` and `ubuntu-latest` runners.

- **Publish a release:** on GitHub, open *Releases → Draft a new release*, create a tag such as `v0.2.0`, and click *Publish release*. The workflow builds every installer and attaches them to that release.
- **Test build:** run *Desktop builds* from the Actions tab to get installers as downloadable artifacts without publishing.

Point people at the Releases page — and set `ORBITAL_DOWNLOAD_URL` on your web server so Settings shows a **Download Orbital for desktop** button.

## Signing (needed before public distribution)

Unsigned apps work, but macOS Gatekeeper and Windows SmartScreen warn users. Add these repository secrets and the workflow signs automatically:

| Secret | Platform | What it is |
|---|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS | "Developer ID Application" certificate (.p12, base64) from an Apple Developer account |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS | Notarization (also set `mac.notarize: true` in `electron-builder.yml`) |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Windows | Code-signing certificate (or switch to Azure Trusted Signing) |

## Auto-update

`electron-updater` is wired in and checks for updates on launch in packaged builds. It activates once you set `publish` in `electron-builder.yml` to your GitHub repository (owner/repo); releases built by the workflow then become the update feed (`latest*.yml` files are included). Set `ORBITAL_DISABLE_UPDATES=1` to turn it off.

## How the desktop app is secured

- The server binds to `127.0.0.1` on a random free port; it isn't reachable from the network.
- The window is sandboxed with context isolation and no Node integration. Only the local Orbital origin loads in it; links open in the system browser; permission requests are denied.
- The Anthropic API key is entered in **Settings → Desktop**, encrypted with the OS keychain (`safeStorage`: Keychain on macOS, DPAPI on Windows, libsecret on Linux), and passed only to the local server process — it never travels over HTTP and never reaches web content. On Linux systems without a keyring the key can't be saved and the UI says so.
- Single-instance lock, window-state persistence, server log at *File → Show Server Log*, data at *File → Open Data Folder*.

## Install from the browser

The web app also has a web manifest and icons, so Chrome and Edge offer **Install Orbital** in the address bar for a dock or taskbar app connected to your server.

## What was verified

The Linux package was built in CI-like conditions and launched end to end: the embedded server started from the packaged app, migrations ran in the app-data folder, sign-up and the main workspace loaded, the desktop bridge worked, web content had no Node access, and the app shut down cleanly. macOS and Windows installers are produced by the workflow on those platforms; they have not been run by hand here.

Related: [Architecture](ARCHITECTURE.md) describes the server the app embeds · [Orbital for business](BUSINESS.md) compares desktop with self-hosted and hosted deployment · Up: [README](../README.md)
