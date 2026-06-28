<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&height=200&color=0:0B1021,50:00BFFF,100:0B1021&text=CatchMeVM&reversal=false&fontColor=FFFFFF&fontSize=50&animation=fadeIn" width="100%" />
  <br><br>
  <img src="https://img.shields.io/badge/status-active-00BFFF?style=for-the-badge&logo=checkmarx&logoColor=white" />
  <img src="https://img.shields.io/badge/platform-browser-00BFFF?style=for-the-badge&logo=googlechrome&logoColor=white" />
  <img src="https://img.shields.io/badge/license-MIT-00BFFF?style=for-the-badge&logo=opensourceinitiative&logoColor=white" />
  <img src="https://img.shields.io/badge/powered_by-v86-00BFFF?style=for-the-badge&logo=webassembly&logoColor=white" />
  <br><br>
  <p><strong>A full x86 virtual machine running in your browser.</strong><br>
  Boot TinyCore Linux · Code in Python · Compile with GCC · Upload files<br>
  <em>No server. No install. No hassle.</em></p>
  <br>
  <a href="https://catch-me-vm.vercel.app"><img src="https://img.shields.io/badge/Try%20it%20live-00BFFF?style=for-the-badge&logo=vercel&logoColor=white" /></a>
  <a href="https://github.com/NullSec8/CatchMeVm"><img src="https://img.shields.io/badge/View%20on%20GitHub-0B1021?style=for-the-badge&logo=github&logoColor=00BFFF" /></a>
</div>

---

## About

CatchMeVM is a browser-based development environment powered by [v86](https://copy.sh/v86), an x86 emulator compiled to WebAssembly. It runs a real Linux distro (TinyCore) inside your browser and lets you write, run, and debug code as if you were on a real machine.

Created by [NullSec8](https://github.com/NullSec8).

---

## Features

| Feature | Description |
|---------|-------------|
| Terminal & GUI | Toggle between serial console and graphical TinyCore desktop |
| Dev tools | Python 3.6, GCC, make, cmake, git, nano, openssh preinstalled |
| File upload | Drag & drop files into /tmp; persisted in IndexedDB |
| Copy/paste | Paste button + Ctrl+V (UTF-8 support for special chars) |
| State snapshots | Save and restore VM state |
| VM stats | View RAM, CPU, and browser heap usage |
| Networking | HTTP/HTTPS via fetch relay (curl, wget) |

---

## Tech Stack

<div align="center">
  <img src="https://img.shields.io/badge/v86-WebAssembly-00BFFF?style=for-the-badge&logo=webassembly&logoColor=white" />
  <img src="https://img.shields.io/badge/TinyCore_Linux-Minimal-00BFFF?style=for-the-badge&logo=linux&logoColor=white" />
  <img src="https://img.shields.io/badge/9p_Filesystem-Shared-00BFFF?style=for-the-badge&logo=files&logoColor=white" />
  <img src="https://img.shields.io/badge/Vercel-Serverless-00BFFF?style=for-the-badge&logo=vercel&logoColor=white" />
</div>

---

## Requirements

Build the dev ISO:

```bash
python scripts/remaster_tinycore_dev_iso.py
```

Requires Docker and `assets/v86/TinyCore-11.0.iso`.

---

## Deployment

### Vercel

Connect the repo to [Vercel](https://vercel.com). For full dev tools, create GitHub Release v1.0 with TinyCore-11.0-dev.iso attached. See [DEPLOY_WITH_DEV_ISO.md](DEPLOY_WITH_DEV_ISO.md).

### GitHub Pages

Settings > Pages > Deploy from branch, select branch and `/` root.

---

## Limitations

- **Network:** HTTP/HTTPS only via fetch relay. No SSH, no raw TCP.
- **VM IP (192.168.86.100)** is virtual; not reachable from your LAN.

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

<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=soft&height=100&color=0B1021&text=Made%20by%20NullSec8&fontColor=00BFFF&fontSize=24" width="100%" />
</div>
