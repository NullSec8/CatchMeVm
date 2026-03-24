import os
import time
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPOS = [
    "http://distro.ibiblio.org/tinycorelinux/11.x/x86/tcz/",
    "http://tinycorelinux.net/11.x/x86/tcz/",
]
REQUESTED_PACKAGES = [
    "bash.tcz",
    "coreutils.tcz",
    "curl.tcz",
    "wget.tcz",
    "git.tcz",
    "cmake.tcz",
    "compiletc.tcz",
    "python3.6.tcz",
    "python3.6-setuptools.tcz",
    "python3.6-dev.tcz",
    "nano.tcz",
    "openssh.tcz",
    "iptables.tcz",  # firewall (ufw not in TinyCore; iptables is the equivalent)
]


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return resp.read().decode("utf-8", "ignore")


def maybe_fetch_text(url: str) -> str:
    try:
        return fetch_text(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return ""
        raise


def fetch_with_retries(url: str, path: Path | None = None, text: bool = False):
    last_exc = None
    for _repo_try in range(3):
        try:
            if text:
                return fetch_text(url)
            download_file(url, path)
            return None
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise
            last_exc = exc
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
        time.sleep(2)
    raise last_exc


def resolve_packages(packages):
    seen = set()
    ordered = []

    def visit(pkg: str):
        if pkg in seen:
            return
        seen.add(pkg)
        deps = ""
        for repo in REPOS:
            try:
                deps = maybe_fetch_text(repo + pkg + ".dep")
                break
            except Exception:  # noqa: BLE001
                continue
        for dep in [line.strip() for line in deps.splitlines() if line.strip().endswith(".tcz")]:
            # Skip kernel-extension placeholders (KERNEL resolved at boot, not at ISO build)
            if "KERNEL" in dep.upper():
                continue
            visit(dep)
        ordered.append(pkg)

    for pkg in packages:
        visit(pkg)
    return ordered


def download_file(url: str, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as resp, open(path, "wb") as out:
        shutil.copyfileobj(resp, out)


def download_packages(packages, optional_dir: Path):
    for pkg in packages:
        for suffix in ["", ".dep", ".md5.txt"]:
            dest = optional_dir / (pkg + suffix)
            downloaded = False
            for repo in REPOS:
                try:
                    fetch_with_retries(repo + pkg + suffix, dest)
                    downloaded = True
                    break
                except urllib.error.HTTPError as exc:
                    if exc.code != 404:
                        raise
            if not downloaded and suffix == "":
                raise FileNotFoundError(f"Package not found on mirrors: {pkg}")


def run(cmd, **kwargs):
    print(">", " ".join(cmd))
    subprocess.run(cmd, check=True, **kwargs)


def remove_readonly(func, path, _exc_info):
    os.chmod(path, 0o777)
    func(path)


def main():
    project_root = Path(__file__).resolve().parent.parent
    assets_dir = project_root / "assets" / "v86"
    source_iso = assets_dir / "TinyCore-11.0.iso"
    output_iso = assets_dir / "TinyCore-11.0-dev.iso"
    work_dir = project_root / ".tinycore-remaster"
    iso_dir = work_dir / "iso"
    optional_dir = work_dir / "downloaded-optional"

    if not source_iso.exists():
        raise FileNotFoundError(f"Missing source ISO: {source_iso}")

    if work_dir.exists():
        shutil.rmtree(work_dir, onerror=remove_readonly)
    optional_dir.mkdir(parents=True)
    iso_dir.mkdir(parents=True)

    packages = resolve_packages(REQUESTED_PACKAGES)
    print("Resolved packages:", len(packages))
    download_packages(packages, optional_dir)

    mount_arg = f"{project_root}:/work"
    run([
        "docker", "run", "--rm",
        "-v", mount_arg,
        "alpine:3.20",
        "sh", "-lc",
        "apk add --no-cache xorriso >/dev/null && "
        "rm -rf /work/.tinycore-remaster/iso/* && "
        "xorriso -osirrox on -indev /work/assets/v86/TinyCore-11.0.iso -extract / /work/.tinycore-remaster/iso >/dev/null 2>&1"
    ])

    iso_optional = iso_dir / "cde" / "optional"
    iso_optional.mkdir(parents=True, exist_ok=True)
    for item in optional_dir.iterdir():
        dest = iso_optional / item.name
        if dest.exists():
            os.chmod(dest, 0o666)
            dest.unlink()
        shutil.copy2(item, dest)

    onboot_path = iso_dir / "cde" / "onboot.lst"
    existing = []
    if onboot_path.exists():
        os.chmod(onboot_path, 0o666)
        existing = [line.strip() for line in onboot_path.read_text().splitlines() if line.strip()]
    merged = existing[:]
    for pkg in packages:
        if pkg not in merged:
            merged.append(pkg)
    onboot_path.write_text("\n".join(merged) + "\n")

    run([
        "docker", "run", "--rm",
        "-v", mount_arg,
        "alpine:3.20",
        "sh", "-lc",
        "apk add --no-cache xorriso >/dev/null && "
        "xorriso -as mkisofs -R -J "
        "-V TinyCoreDev "
        "-c /boot/isolinux/boot.cat "
        "-b /boot/isolinux/isolinux.bin "
        "-no-emul-boot -boot-load-size 4 -boot-info-table "
        "-o /work/assets/v86/TinyCore-11.0-dev.iso "
        "/work/.tinycore-remaster/iso >/dev/null"
    ])

    print(f"Created {output_iso}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
