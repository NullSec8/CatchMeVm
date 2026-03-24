# CatchMeVM

Browser-based x86 VM (v86) with TinyCore Linux, file upload, and dev tools (Python, GCC, nano, openssh, etc.).

## Quick Start

```bash
npm start
```

Open http://localhost:8000

## Requirements

- **TinyCore-11.0-dev.iso** must exist in `assets/v86/`. Build it with:

```bash
python scripts/remaster_tinycore_dev_iso.py
```

Requires: Docker, `assets/v86/TinyCore-11.0.iso` (source ISO)

## Features

- **Terminal & GUI modes** – Same dev environment in both
- **File upload** – Drop files into `/tmp`, persisted in IndexedDB
- **Copy/paste** – Ctrl+V to paste into VM, Ctrl+C from serial console
- **Networking** – HTTP/HTTPS (curl, wget) via fetch relay. SSH outbound and inbound from other PCs are not supported.
- **Dev tools** – Python 3.6, GCC, make, cmake, git, nano, openssh

## Limitations

- **Network**: Fetch relay supports HTTP/HTTPS only. No SSH, no raw TCP to other machines.
- **VM IP (192.168.86.100)**: Virtual only; not reachable from your LAN.

## Scripts

| Script | Purpose |
|--------|---------|
| `remaster_tinycore_dev_iso.py` | Build TinyCore-11.0-dev.iso with dev packages |
| `build-9p-dev.ps1` | Build Alpine 9p rootfs (optional) |
| `build-toolchain-tarball.ps1` | Build toolchain tarball (optional) |
| `build-offline-dev-image.ps1` | Build offline initrd (optional) |

## License

See repository for license details.
