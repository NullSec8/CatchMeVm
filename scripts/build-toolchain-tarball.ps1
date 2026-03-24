# Build toolchain.tar.gz - extract python3, gcc, g++, make from Alpine for post-boot injection
# Output: assets/v86/toolchain.tar.gz

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = Join-Path (Join-Path $projectRoot "assets") "v86"
$outputFile = Join-Path $outputPath "toolchain.tar.gz"
$workDir = Join-Path $projectRoot ".toolchain-build"

Write-Host "Building toolchain tarball for post-boot injection..."

$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) { throw "Docker not running." }

if (Test-Path $workDir) { Remove-Item -Recurse -Force $workDir }
New-Item -ItemType Directory -Path $workDir | Out-Null
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$buildScript = @'
set -euo pipefail
apk --root /work/rootfs --initdb add --no-cache \
  alpine-base build-base python3 py3-pip musl-dev
cd /work/rootfs
tar -czvf /work/toolchain.tar.gz usr lib
'@

# Create rootfs and install
$initScript = @'
set -euo pipefail
apk update
apk add --no-cache alpine-base 2>/dev/null || true
mkdir -p /work/rootfs/etc/apk
cp /etc/apk/repositories /work/rootfs/etc/apk/
mkdir -p /work/rootfs/etc/apk/keys
cp -r /etc/apk/keys/* /work/rootfs/etc/apk/keys/
apk --root /work/rootfs --initdb add --no-cache alpine-base build-base python3 py3-pip musl-dev
rm -rf /work/rootfs/var/cache/apk/*
cd /work/rootfs
tar -czvf /work/toolchain.tar.gz usr lib
'@

Set-Content -Path (Join-Path $workDir "build.sh") -Value $initScript -NoNewline
docker run --rm -v "${workDir}:/work" alpine:3.20 sh /work/build.sh 2>&1 | Out-Host

if (-not (Test-Path (Join-Path $workDir "toolchain.tar.gz"))) {
  throw "Build failed - toolchain.tar.gz not created."
}

Copy-Item (Join-Path $workDir "toolchain.tar.gz") $outputFile -Force
Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
Write-Host "Done: $outputFile"
Write-Host "Size: $([math]::Round((Get-Item $outputFile).Length/1MB, 1)) MB"
