# Deploy with full dev environment (Python, GCC, etc.)

To get the full VM with dev tools on Vercel, include the dev ISO using Git LFS:

## 1. Build the dev ISO locally

```bash
python scripts/remaster_tinycore_dev_iso.py
```

Requires: Docker, `assets/v86/TinyCore-11.0.iso`

## 2. Install Git LFS

**Windows (scoop):**
```powershell
scoop install git-lfs
```

**Windows (installer):** Download from https://git-lfs.github.com/

**Or via Git:**
```bash
git lfs install
```

## 3. Add and push the dev ISO

```bash
cd catchmevm-app
git lfs track "assets/v86/TinyCore-11.0-dev.iso"
git add .gitattributes assets/v86/TinyCore-11.0-dev.iso
git commit -m "Add dev ISO via LFS for full VM on Vercel"
git push
```

## 4. Redeploy on Vercel

Vercel will automatically redeploy when you push. The dev ISO (~130MB) will be fetched via LFS during the build.
