# Deploy with full dev environment (Python, GCC, etc.)

If the VM hangs at "Booting from DVD/CD..." on Vercel, the dev ISO isn't loading. Use **GitHub Releases** (most reliable):

## 1. Build the dev ISO locally

```bash
python scripts/remaster_tinycore_dev_iso.py
```

Requires: Docker, `assets/v86/TinyCore-11.0.iso`

## 2. Create a GitHub Release and upload the ISO

1. Go to https://github.com/NullSec8/CatchMeVm/releases
2. Click **Draft a new release**
3. Tag: `v1.0` (or update `TINYCORE_DEV_ISO_RELEASE` in main.js if you use a different tag)
4. Title: e.g. `v1.0`
5. Click **Attach binaries** and upload `assets/v86/TinyCore-11.0-dev.iso`
6. Click **Publish release**

The app will automatically use this URL when the bundled asset is too small (LFS pointer).

## Alternative: Git LFS + Vercel

1. Enable **Include Git LFS files** in Vercel → Settings → Git
2. Ensure the ISO is pushed via LFS
3. Redeploy

If the VM still won't boot, use the GitHub Releases method above.
