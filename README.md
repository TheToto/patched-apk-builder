# ReVanced & Morphe Magisk Module Builder

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![CI Build](https://github.com/TheToto/revanced-magisk-module/actions/workflows/build.yml/badge.svg)](https://github.com/TheToto/revanced-magisk-module/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A next-generation, automated build pipeline written in **TypeScript** for **ReVanced**, **Morphe**, and **LSPatch** applications.  
It automatically acquires authentic stock APKs, patches them, verifies cryptographic signatures, and generates optimized **Magisk / KernelSU modules** alongside standalone **non-root APKs**.

---

## 🌟 Key Features

* ⚡ **100% Modern TypeScript Engine** — Built from the ground up for high reliability, clean modularity, strict typing, and zero legacy Python/Bash dependencies.
* 🧩 **Multi-Engine Patching Support**:
  * **ReVanced CLI & Patches** (`revanced-cli`, `revanced-patches`)
  * **Morphe CLI & Patches** (`morphe-cli`, `morphe-patches`)
  * **LSPatch Injection** for dynamic Xposed modules (e.g. Gboard, Niagara Launcher)
* 📥 **Multi-Provider Authentic APK Acquisition** (8 Cascading Remotes):
  * **Aptoide** (Official REST API v7, rank `TRUSTED` enforcement)
  * **APKPure** (Direct `/b/APK/` endpoints with fallback)
  * **APKCombo** (Presigned Cloudflare R2 direct stream integration)
  * **Archive.org** (Public versioned repository scraper)
  * **APKMirror** (Automated release scraper & title slug discovery)
  * **GitHub Releases** (Native GitHub REST API for open-source apps)
  * **Uptodown & Direct URLs**
* 🔒 **Cryptographic Signature Verification**:
  * Enforces developer signing certificates from [`sig.txt`](./sig.txt) via `apksigner`.
  * Automatically inspects inner base APKs for split bundles (`.apkm`, `.xapk`, `.apks`) prior to merging.
* 📱 **Magisk / KernelSU Root Modules & Standalone APKs**:
  * Root modules feature automated systemless mounting, Dalvik cache/odex precompilation, and Magisk app update checks.
  * Non-root standalone APKs strip unused native architectures (`arm64-v8a`, `arm-v7a`) for minimum footprint.
* 🌐 **Static Web Portal & Obtainium In-App Updates**:
  * Automatically generates lightweight static HTML pages with [Obtainium](https://github.com/ImranR98/Obtainium) one-click install links.
* 🤖 **Smart CI / CD Change Detection**:
  * Only rebuilds applications whose stock APK version or patch bundle has changed, optimizing GitHub Actions minutes.

---

## 🚀 Quick Start

### Prerequisites

* **Node.js** >= 20.0.0
* **Java JRE/JDK** >= 17 (for `apksigner`, `apkeditor`, and patcher CLI)
* **curl** (recommended for Cloudflare-protected endpoints)

### Installation

```bash
git clone https://github.com/TheToto/revanced-magisk-module.git
cd revanced-magisk-module
npm install
npm run build
```

---

## 💻 CLI Commands

The builder provides an intuitive command-line interface:

### 1. Download Stock APKs (`download` / `dl`)

Download authentic stock APKs using application package names (or slugs), with automatic provider cascading and cryptographic verification:

```bash
# Download by package name (automatic fallback across all providers)
npm run cli -- download com.reddit.frontpage

# Download a specific version
npm run cli -- download com.reddit.frontpage 2026.14.0

# Interactive version selection prompt (queries available versions across stores)
npm run cli -- download com.reddit.frontpage -s

# List all available versions across stores and view patch compatibility
npm run cli -- download com.reddit.frontpage -l

# Download from a specific provider (archive, apkmirror, aptoide, apkpure, apkcombo)
npm run cli -- download com.reddit.frontpage -p aptoide

# Test & download from ALL compatible providers at once
npm run cli -- download com.reddit.frontpage --all

# Download by short app slug configured in config.toml
npm run cli -- download reddit
```

### 2. Check for Updates (`check`)

Scans upstream patch bundles and app stores to determine which applications need a rebuild:

```bash
# Normal update check
npm run cli -- check

# Force check (mark all enabled apps as needing rebuild)
npm run cli -- check -f
```

### 3. Build Patched APKs & Modules (`build`)

Builds patched APKs and Magisk modules according to [`config.toml`](./config.toml):

```bash
# Build all enabled apps
npm run cli -- build

# Build a single app by slug
npm run cli -- build -a reddit

# Build for a specific architecture (arm64-v8a, arm-v7a, etc.)
npm run cli -- build -a music --arch arm64-v8a

# Override target application version
npm run cli -- build -a youtube --app-version 21.16.256
```

### 4. Generate Web Pages & Obtainium Links (`web`)

Generates static download web pages and Obtainium deep links:

```bash
npm run cli -- web --url https://apk.thetoto.fr --out dist/pages
```

### 5. Inspect Signatures (`sig`)

Extract the SHA-256 certificate signature from an APK and optionally append it to [`sig.txt`](./sig.txt):

```bash
# Print certificate SHA-256 digest
npm run cli -- sig path/to/app.apk

# Append to sig.txt
npm run cli -- sig path/to/app.apk -a
```

### 6. Clean Temporary Files (`clean`)

```bash
npm run cli -- clean
```

---

## ⚙️ Configuration (`config.toml`)

Customize your builds by editing [`config.toml`](./config.toml).

```toml
enable-module-update = true # Receive update notifications in Magisk / KernelSU
parallel-jobs = 1

# --- Standard App (e.g. YouTube with Morphe) ---
[YouTube]
enabled = true
app-name = "YouTube"
rv-brand = "Morphe"
build-mode = "both" # "both", "apk", or "module"
patches-source = "MorpheApp/morphe-patches"
cli-source = "MorpheApp/morphe-cli"
apkmirror-dlurl = "https://www.apkmirror.com/apk/google-inc/youtube"
archive-dlurl = "https://archive.org/download/jhc-apks/apks/com.google.android.youtube"
excluded-patches = "'Custom branding'"

# --- Multi-Architecture App (e.g. YouTube Music) ---
[Music]
enabled = true
app-name = "Music"
arch = "both" # builds arm64-v8a and arm-v7a
patches-source = "MorpheApp/morphe-patches"
cli-source = "MorpheApp/morphe-cli"
apkmirror-dlurl = "https://www.apkmirror.com/apk/google-inc/youtube-music"
archive-dlurl = "https://archive.org/download/jhc-apks/apks/com.google.android.apps.youtube.music"

# --- LSPatch Injected App (e.g. Gboard) ---
[Gboard]
enabled = true
app-name = "Gboard"
patch-method = "lspatch"
arch = "arm64-v8a"
patches-source = "jasonwu1994/Gboard-Themes"
xposed-module-asset = "*-release.apk"
apkmirror-dlurl = "https://www.apkmirror.com/apk/google-inc/gboard-the-google-keyboard/"

# --- GitHub Release App (e.g. ProtonVPN) ---
[ProtonVPN]
enabled = true
app-name = "ProtonVPN"
arch = "arm64-v8a"
patch-method = "lspatch"
patches-source = "xerta555/Revanced-Proton-Vpn"
xposed-module-asset = "*.apk"
github-dlurl = "ProtonVPN/android-app"
```

For comprehensive options, refer to [`CONFIG.md`](./CONFIG.md).

---

## 🛡️ Signature Verification (`sig.txt`)

To protect against tampered APKs, [`sig.txt`](./sig.txt) lists official SHA-256 certificate fingerprints for each package:

```text
a2a1ad7ba7f41dfca4514e2afeb90691719af6d0fdbed4b09bbf0ed897701ceb com.google.android.apps.youtube.music
3d7a1223019aa39d9ea0e3436ab7c0896bfb4fb679f4de5fe7c23f326c8f994a com.google.android.youtube
970b91143813b4c9d5f3634f672c9fcaa5621b4efaaedafd6c235cbbb869736f com.reddit.frontpage
```

Any stock APK downloaded (whether `.apk` or inside `.apkm` / `.xapk`) is cryptographically verified prior to patching.

---

## 🧪 Testing & Validation

Run unit tests via Vitest:

```bash
npm test
npm run typecheck
```

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).  
ReVanced, Morphe, and LSPatch are trademarks of their respective projects.
