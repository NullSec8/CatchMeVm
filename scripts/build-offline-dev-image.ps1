param(
  [string]$OutputDir = "assets/v86",
  [int]$ImageSizeMb = 4096
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputDir = Join-Path $projectRoot $OutputDir
$workDir = Join-Path $projectRoot ".offline-image-work"
$outputImg = Join-Path $outputDir "catchmevm-dev.img"
$outputInitrd = Join-Path $outputDir "catchmevm-dev-initrd.cpio.gz"

if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

if (Test-Path $workDir) {
  Remove-Item -Recurse -Force $workDir
}
New-Item -ItemType Directory -Path $workDir | Out-Null

$imageSizeBytes = [int64]$ImageSizeMb * 1024 * 1024
$blockCount = [math]::Ceiling($imageSizeBytes / 1024)

Write-Host "Building offline dev rootfs (initrd + img)..."
Write-Host "Output: $outputInitrd (primary), $outputImg (optional)"

$null = docker --version
if ($LASTEXITCODE -ne 0) {
  throw "Docker CLI is not available. Install Docker Desktop first."
}

$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Engine is not running. Start Docker Desktop, wait until it is ready, then run this script again."
}

$buildScript = @'
set -euo pipefail
apk update
apk add --no-cache genext2fs e2fsprogs
mkdir -p /work/rootfs/etc/apk
cp /etc/apk/repositories /work/rootfs/etc/apk/repositories
mkdir -p /work/rootfs/etc/apk/keys
cp /etc/apk/keys/* /work/rootfs/etc/apk/keys/
apk --root /work/rootfs --initdb add --no-cache \
  alpine-base bash coreutils curl wget git \
  build-base linux-headers musl-dev make cmake pkgconf \
  python3 py3-pip
mkdir -p /work/rootfs/dev /work/rootfs/proc /work/rootfs/sys /work/rootfs/tmp /work/rootfs/root
chmod 1777 /work/rootfs/tmp
echo 'ttyS0::respawn:/sbin/getty -L ttyS0 115200 vt100' >> /work/rootfs/etc/inittab
echo "root:root" | chroot /work/rootfs chpasswd || true
rm -rf /work/rootfs/var/cache/apk/*
# Kernel looks for /init - Alpine uses /sbin/init
ln -sf /sbin/init /work/rootfs/init
# Create initrd - merged with buildroot kernel's initramfs, adds python3/gcc/etc
cd /work/rootfs && find . | cpio -o -H newc 2>/dev/null | gzip -9 > /work/catchmevm-dev-initrd.cpio.gz
# Also create ext2 img (optional / future use)
genext2fs -U -b __BLOCKS__ -d /work/rootfs /work/catchmevm-dev.img
e2fsck -fy /work/catchmevm-dev.img || true
'@

$buildScript = $buildScript.Replace("__BLOCKS__", [string]$blockCount)
$tmpBuildScript = Join-Path $workDir "build-image.sh"
Set-Content -Path $tmpBuildScript -Value $buildScript -NoNewline

docker run --rm `
  -v "${workDir}:/work" `
  alpine:3.20 `
  sh /work/build-image.sh

if (-not (Test-Path (Join-Path $workDir "catchmevm-dev-initrd.cpio.gz"))) {
  throw "Initrd build failed: catchmevm-dev-initrd.cpio.gz was not produced."
}

Move-Item -Force (Join-Path $workDir "catchmevm-dev-initrd.cpio.gz") $outputInitrd
if (Test-Path (Join-Path $workDir "catchmevm-dev.img")) {
  Move-Item -Force (Join-Path $workDir "catchmevm-dev.img") $outputImg
}
Remove-Item -Recurse -Force $workDir

Write-Host "Done. Initrd (primary): $outputInitrd"
