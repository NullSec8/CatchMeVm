# Offline Dev Image Setup

To provide Python, GCC, G++, and common build libraries **without internet**, ship a prebuilt disk image:

- Path expected by the app: `./assets/v86/catchmevm-dev.img`
- Boot mode: terminal mode automatically prefers this image when present.

## What to include in the image

At minimum, install:

- `python3`, `pip`
- `gcc`, `g++`
- `make`, `cmake`, `pkg-config`
- libc/dev headers and standard build tooling

## Example build flow (outside this repo)

1. Create a Linux disk image for v86 (raw `.img`).
2. Boot that image once in QEMU/v86 with internet.
3. Install your full toolchain and libraries.
4. Clean package caches/logs to reduce size.
5. Shut down cleanly.
6. Copy the final image into:
   - `catchmevm-app/assets/v86/catchmevm-dev.img`

## Runtime behavior

- If `catchmevm-dev.img` exists: VM boots fully offline with preinstalled tools.
- If it does not exist: app falls back to current kernel boot and optional online bootstrap.
