# Deploy with full dev environment (Python, GCC, etc.)

For Python, GCC, nano, openssh, etc. on a live deployment, the dev ISO (~132 MB) must be available.

---

## Option 1: GitHub Releases + API proxy (recommended for Vercel)

Works on all Vercel plans. The app includes an `/api/iso` serverless function that proxies the ISO from GitHub Releases, bypassing:
- **Vercel 100MB static limit** (Hobby plan excludes files >100MB)
- **CORS** (browsers block direct fetch from GitHub)

### Steps

1. **Build the dev ISO** (if not already built):

   ```bash
   python scripts/remaster_tinycore_dev_iso.py
   ```

   Requires: Docker, `assets/v86/TinyCore-11.0.iso`

2. **Create a GitHub Release**:
   - Go to https://github.com/NullSec8/CatchMeVm/releases
   - **Draft a new release** → Tag: `v1.0` (or set env `CATCHMEVM_ISO_URL` to your URL)
   - **Attach binaries** → upload `assets/v86/TinyCore-11.0-dev.iso`
   - **Publish release**

3. Deploy to Vercel. The app will use `/api/iso` when the bundled asset is too small.

---

## Option 2: Git LFS + Vercel (Pro only)

On **Vercel Pro** (1GB static limit), Git LFS can work. On Hobby (100MB limit), the dev ISO will be excluded even with LFS.

1. Build the dev ISO, push via LFS, enable LFS in Vercel (Settings → Git).
2. Redeploy. Only viable if you're on Pro.

---

## Option 3: Custom ISO URL

Set the env var `CATCHMEVM_ISO_URL` in Vercel to a public URL (e.g. Cloudflare R2, S3 with CORS). The proxy will fetch from that URL instead of GitHub.

---

## Troubleshooting

- **VM boots but no Python/GCC** – base ISO in use; dev ISO not available. Create the GitHub Release v1.0 with the ISO attached.
- **VM hangs at "Booting from DVD/CD..."** – ISO fetch failing; check Vercel function logs for `/api/iso` errors.
