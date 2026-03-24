# Build Alpine dev rootfs in v86 9p format (fs.json + flat files).
# Requires: Docker, Python 3
# Output: assets/v86/catchmevm-dev-fs.json, assets/v86/catchmevm-dev-flat/

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$v86Root = (Resolve-Path (Join-Path (Join-Path $projectRoot "..") "v86")).Path
$outDir = Join-Path (Join-Path $projectRoot "assets") "v86"
$workDirBase = Join-Path $projectRoot ".9p-build-work"
$flatDir = Join-Path $outDir "catchmevm-dev-flat"
$fsJsonPath = Join-Path $outDir "catchmevm-dev-fs.json"

Write-Host "Building Alpine dev rootfs (9p format) for v86..."
Write-Host "  v86 tools: $v86Root"
Write-Host "  output: $flatDir, $fsJsonPath"

if (-not (Test-Path $v86Root)) {
  throw "v86 repo not found at $v86Root. Ensure webvm contains both catchmevm-app and v86."
}

$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Engine not running. Start Docker Desktop first."
}

$workDir = $workDirBase
if (Test-Path $workDir) {
  try {
    Remove-Item -Recurse -Force $workDir -ErrorAction Stop
  } catch {
    Write-Host "Previous work dir locked, using timestamped dir..."
    $workDir = "${workDirBase}-$(Get-Date -Format 'yyyyMMddHHmmss')"
  }
}
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$tarPath = Join-Path $workDir "alpine-dev.tar"

# Ensure QEMU/binfmt is available for linux/386 builds (needed on amd64 hosts)
Write-Host "Checking multi-platform support (linux/386)..."
& docker run --privileged --rm tonistiigi/binfmt --install all 2>$null | Out-Null

# Build Docker image (run via cmd to avoid PowerShell treating Docker stderr as script errors)
$dockerfile = Join-Path $PSScriptRoot "Dockerfile.dev"
Write-Host "Building Docker image..."
$buildResult = & cmd /c "docker build --platform linux/386 -f `"$dockerfile`" -t catchmevm-alpine-dev `"$projectRoot`" 2>&1"
$buildResult | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Docker build failed." }

$cid = "catchmevm-export-$(Get-Random)"
docker create --platform linux/386 --name $cid catchmevm-alpine-dev 2>&1 | Out-Null
try {
  docker export $cid -o $tarPath 2>&1 | Out-Null
  if (-not (Test-Path $tarPath) -or (Get-Item $tarPath).Length -eq 0) {
    throw "Docker export failed."
  }
} finally {
  docker rm -f $cid 2>&1 | Out-Null
}

# Remove .dockerenv from tar (can cause issues)
$tarDir = Join-Path $workDir "tar"
New-Item -ItemType Directory -Path $tarDir | Out-Null
tar -xf $tarPath -C $tarDir 2>$null
if (Test-Path (Join-Path $tarDir ".dockerenv")) {
  Remove-Item (Join-Path $tarDir ".dockerenv") -Force
}
Remove-Item $tarPath -Force
tar -cf $tarPath -C $tarDir . 2>$null

# Run fs2json and copy-to-sha256 (no zstd for simplicity)
$fs2json = Join-Path (Join-Path $v86Root "tools") "fs2json.py"
$copyToSha = Join-Path (Join-Path $v86Root "tools") "copy-to-sha256.py"
if (-not (Test-Path $fs2json)) { throw "fs2json.py not found: $fs2json" }
if (-not (Test-Path $copyToSha)) { throw "copy-to-sha256.py not found: $copyToSha" }

python "$fs2json" --out "$fsJsonPath" "$tarPath" 2>&1 | Out-Host
if (-not (Test-Path $fsJsonPath)) { throw "fs2json failed." }

if (Test-Path $flatDir) { Remove-Item -Recurse -Force $flatDir }
New-Item -ItemType Directory -Path $flatDir | Out-Null
python "$copyToSha" "$tarPath" "$flatDir" 2>&1 | Out-Host

Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
Write-Host "Done. Files: $fsJsonPath, $flatDir"
Write-Host "Restart the app and use Terminal mode - gcc, python3, etc. will be available."
