# CatchMeVM
**Try it here:** https://catchmevm.vercel.app

**A full x86 virtual machine running in your browser.** Boot TinyCore Linux, code in Python, compile with GCC, and upload files—all without leaving the tab. No server, no install, no hassle.

---

## About

CatchMeVM is a browser-based development environment powered by [v86](https://copy.sh/v86), an x86 emulator compiled to WebAssembly. It runs a real Linux distro (TinyCore) inside your browser and lets you write, run, and debug code as if you were on a real machine.

**Created by [NullSec8](https://github.com/NullSec8)** — solo developer, 17 years old.

---

## Quick Start

```bash
npm start
```

Open http://localhost:8000 and the VM boots automatically.

---

## Features

| Feature | Description |
|---------|-------------|
| **Terminal & GUI** | Toggle between serial console and graphical TinyCore desktop |
| **Dev tools** | Python 3.6, GCC, make, cmake, git, nano, openssh preinstalled |
| **File upload** | Drag & drop files into `/tmp`; persisted in IndexedDB |
| **Copy/paste** | Paste button + Ctrl+V (UTF-8 support for special chars) |
| **State snapshots** | Save and restore VM state |
| **VM stats** | View RAM, CPU, and browser heap usage |
| **Networking** | HTTP/HTTPS via fetch relay (curl, wget) |

---

## Tech Stack

- **v86** – x86 emulator (WebAssembly)
- **TinyCore Linux** – minimal, fast-booting distro
- **9p filesystem** – host ↔ VM file sharing
- **Vercel** – deployment with serverless ISO proxy

---

## Requirements

- **TinyCore-11.0-dev.iso** in `assets/v86/`. Build it with:

```bash
python scripts/remaster_tinycore_dev_iso.py
```

Requires: Docker, `assets/v86/TinyCore-11.0.iso` (source ISO)

---

## Deployment

### Vercel

Connect the repo to [Vercel](https://vercel.com). For full dev tools, create GitHub Release **v1.0** with `TinyCore-11.0-dev.iso` attached. The built-in `/api/iso` proxy fetches it (bypasses 100MB limit + CORS). See [DEPLOY_WITH_DEV_ISO.md](DEPLOY_WITH_DEV_ISO.md).

### GitHub Pages

Settings → Pages → Deploy from branch, select branch and `/` root.

---

## Limitations

- **Network**: HTTP/HTTPS only via fetch relay. No SSH, no raw TCP.
- **VM IP** (192.168.86.100) is virtual; not reachable from your LAN.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `remaster_tinycore_dev_iso.py` | Build TinyCore-11.0-dev.iso with dev packages |
| `create-release.ps1` | Create GitHub Release v1.0 with dev ISO |
| `build-9p-dev.ps1` | Build Alpine 9p rootfs (optional) |
| `build-toolchain-tarball.ps1` | Build toolchain tarball (optional) |
| `build-offline-dev-image.ps1` | Build offline initrd (optional) |

---

## License

See repository for license details.

---

**CatchMeVM** — made with ❤️ by [NullSec8](https://github.com/NullSec8), solo dev, 17y.
