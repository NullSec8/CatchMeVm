# Creates GitHub Release v1.0 with TinyCore-11.0-dev.iso
# Run: gh auth login   (one-time, then run this script)
# Or:  .\scripts\create-release.ps1

$ErrorActionPreference = "Stop"
$isoPath = "assets\v86\TinyCore-11.0-dev.iso"

if (-not (Test-Path $isoPath)) {
    Write-Error "Missing $isoPath - run: python scripts/remaster_tinycore_dev_iso.py"
}

# Refresh PATH for gh (if just installed)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Run 'gh auth login' first, then re-run this script."
    exit 1
}

# Delete existing v1.0 release if present (to replace asset)
gh release delete v1.0 --yes 2>$null

# Create release with the ISO
gh release create v1.0 $isoPath --title "v1.0" --notes "TinyCore 11.0 dev ISO for CatchMeVM (Python, GCC, etc.)"

Write-Host "Done. Redeploy on Vercel to use the dev ISO."
