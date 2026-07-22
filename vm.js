import { state, DISTRO_TINYCORE, DISTRO_ARCH, PREF_DISTRO, PREF_BOOT_MODE, PREF_QUALITY } from "./state.js";
import { restoreIntoVm } from "./files.js";
import { getAutoSnapshot, saveAutoSnapshot, renderSnapshotList } from "./snapshots.js";
import { setStatus, toast, hideBootSkeleton, setBootStep, initBootProgress } from "./ui.js";

const TINYCORE_DEV_ISO = "./assets/v86/TinyCore-11.0-dev.iso";
const TINYCORE_BASE_ISO = "./assets/v86/TinyCore-11.0.iso";
const TINYCORE_DEV_ISO_PROXY = "/api/iso";
const ARCH_LINUX_ISO_PROXY = "/api/arch-iso";
const ARCH_ASSET_PROXY = "/api/arch-asset";
const TINYCORE_DEV_ISO_RELEASE = "https://github.com/NullSec8/CatchMeVm/releases/download/v1.0/TinyCore-11.0-dev.iso";
const ARCH_LINUX_ISO_STABLE = "https://archive.archlinux.org/iso/2025.02.01/archlinux-2025.02.01-x86_64.iso";
const ARCH_LINUX_ISO_LATEST = "https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso";
const ARCH_FS_BASEURL = "https://i.copy.sh/arch/";
const ARCH_FS_INDEX = "https://i.copy.sh/fs.json";
const ARCH_STATE_URL = "https://i.copy.sh/arch_state-v3.bin.zst";
const MIN_ISO_SIZE = 50 * 1024 * 1024;

async function probeIsoUrl(url, minSize = MIN_ISO_SIZE) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    if (!r.ok) return null;
    const size = parseInt(r.headers.get("content-length") || "0", 10);
    if (size >= minSize) return url;
    return null;
  } catch {
    return null;
  }
}

function withArchProxy(path) {
  return `${ARCH_ASSET_PROXY}?path=${encodeURIComponent(path)}`;
}

function archAssetsPreferProxy() {
  if (typeof window === "undefined") return true;
  const p = window.location?.protocol;
  return p === "http:" || p === "https:";
}

function getArchAssetConfig() {
  if (archAssetsPreferProxy()) {
    return {
      baseurl: `${ARCH_ASSET_PROXY}?path=arch/`,
      basefs: withArchProxy("fs.json"),
      state: withArchProxy("arch_state-v3.bin.zst"),
      canUseState: false,
      source: "proxy",
    };
  }
  return {
    baseurl: ARCH_FS_BASEURL,
    basefs: ARCH_FS_INDEX,
    state: ARCH_STATE_URL,
    canUseState: false,
    source: "direct",
  };
}

async function getIsoUrl(distro) {
  if (distro === DISTRO_ARCH) {
    const archProxy = await probeIsoUrl(ARCH_LINUX_ISO_PROXY, MIN_ISO_SIZE);
    if (archProxy) return { distro: DISTRO_ARCH, url: archProxy, source: "arch-proxy" };
    const archStable = await probeIsoUrl(ARCH_LINUX_ISO_STABLE, MIN_ISO_SIZE);
    if (archStable) return { distro: DISTRO_ARCH, url: archStable, source: "arch-stable" };
    const archLatest = await probeIsoUrl(ARCH_LINUX_ISO_LATEST, MIN_ISO_SIZE);
    return { distro: DISTRO_ARCH, url: archLatest || ARCH_LINUX_ISO_LATEST, source: "arch-latest" };
  }

  const localDev = await probeIsoUrl(TINYCORE_DEV_ISO, MIN_ISO_SIZE);
  if (localDev) return { distro: DISTRO_TINYCORE, url: localDev, source: "tinycore-local-dev" };
  const proxyDev = await probeIsoUrl(TINYCORE_DEV_ISO_PROXY, MIN_ISO_SIZE);
  if (proxyDev) return { distro: DISTRO_TINYCORE, url: proxyDev, source: "tinycore-proxy-dev" };
  const releaseDev = await probeIsoUrl(TINYCORE_DEV_ISO_RELEASE, MIN_ISO_SIZE);
  if (releaseDev) return { distro: DISTRO_TINYCORE, url: releaseDev, source: "tinycore-release-dev" };
  return { distro: DISTRO_TINYCORE, url: TINYCORE_BASE_ISO, source: "tinycore-base" };
}

export function getBootPreferences() {
  const distro = localStorage.getItem(PREF_DISTRO) || DISTRO_TINYCORE;
  const mode = localStorage.getItem(PREF_BOOT_MODE) || "gui";
  const quality = Number(localStorage.getItem(PREF_QUALITY) || "1");
  return {
    distro: distro === DISTRO_ARCH ? DISTRO_ARCH : DISTRO_TINYCORE,
    mode: mode === "terminal" ? "terminal" : "gui",
    quality: Number.isFinite(quality) && quality > 0 ? quality : 1,
  };
}

export function setBootPreferences(distro, mode, quality) {
  localStorage.setItem(PREF_DISTRO, distro === DISTRO_ARCH ? DISTRO_ARCH : DISTRO_TINYCORE);
  localStorage.setItem(PREF_BOOT_MODE, mode);
  localStorage.setItem(PREF_QUALITY, String(quality));
}

function applyModeUi(mode) {
  const screen = document.getElementById("screen_container");
  const details = document.getElementById("serialDetails");
  if (!screen || !details) return;
  if (mode === "terminal") {
    screen.style.display = "none";
    details.open = true;
  } else {
    screen.style.display = "block";
  }
}

function appendSerial(text, serialEl, serialBufferRef) {
  if (!serialEl) return;
  serialBufferRef.buffer += text;
  if (!serialBufferRef.scheduled) {
    serialBufferRef.scheduled = true;
    requestAnimationFrame(() => {
      serialBufferRef.scheduled = false;
      if (!serialBufferRef.buffer) return;
      const toAppend = serialBufferRef.buffer;
      serialBufferRef.buffer = "";
      if (serialEl.textContent.startsWith("[serial] waiting")) {
        serialEl.textContent = "";
      }
      serialEl.textContent += toAppend;
      if (serialEl.textContent.length > 120000) {
        serialEl.textContent = serialEl.textContent.slice(-80000);
      }
      serialEl.scrollTop = serialEl.scrollHeight;
    });
  }
}

export async function startVm({ distro, mode, quality, initialState = null }) {
  setStatus(initialState ? "Restoring snapshot..." : "Booting CatchMeVM...");
  const serialEl = document.getElementById("serial_console");
  applyModeUi(mode);
  initBootProgress(!initialState);
  if (!initialState) {
    hideBootSkeleton();
  }

  const serialBufferRef = { buffer: "", scheduled: false };

  const VMConstructor =
    (typeof window !== "undefined" && (window.V86Starter || window.V86)) ||
    (typeof V86Starter !== "undefined" ? V86Starter : undefined) ||
    (typeof V86 !== "undefined" ? V86 : undefined);

  if (!VMConstructor) {
    throw new Error("v86 runtime not loaded. Check libv86.js script include.");
  }

  const config = {
    wasm_path: "./assets/v86/v86.wasm",
    screen_container: document.getElementById("screen_container"),
    memory_size: mode === "gui" ? 256 * 1024 * 1024 : 128 * 1024 * 1024,
    vga_memory_size: mode === "gui" ? 16 * 1024 * 1024 : 8 * 1024 * 1024,
    bios: { url: "./assets/v86/seabios.bin" },
    vga_bios: { url: "./assets/v86/vgabios.bin" },
    autostart: true,
    filesystem: {},
    net_device: { type: "ne2k", relay_url: "fetch" },
  };

  let usingBaseIso = false;
  if (distro === DISTRO_ARCH) {
    const archAssets = getArchAssetConfig();
    config.memory_size = 512 * 1024 * 1024;
    config.vga_memory_size = 8 * 1024 * 1024;
    config.filesystem = {
      baseurl: archAssets.baseurl,
      basefs: { url: archAssets.basefs },
    };
    config.bzimage_initrd_from_filesystem = true;
    config.cmdline = [
      "rw apm=off vga=0x344 video=vesafb:ypan,vremap:8",
      "root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose",
      "mitigations=off audit=0",
      "init_on_free=on",
      "tsc=reliable",
      "random.trust_cpu=on",
      "nowatchdog",
      "init=/usr/bin/init-openrc net.ifnames=0 biosdevname=0",
    ].join(" ");
    config.net_device = { type: "virtio", relay_url: "fetch" };

    if (initialState) {
      config.initial_state = {
        buffer: initialState,
        load: function () {
          const self = this;
          setTimeout(() => {
            if (self.onload) self.onload();
          }, 0);
        },
      };
    } else if (archAssets.canUseState) {
      config.initial_state = { url: archAssets.state };
    }
  } else {
    const isoInfo = await getIsoUrl(distro);
    usingBaseIso = isoInfo.source === "tinycore-base";
    if (usingBaseIso) {
      setStatus("Using base TinyCore (dev ISO not found). Create GitHub Release v1.0 with TinyCore-11.0-dev.iso.", "warn");
    }
    if (!initialState) {
      config.cdrom = { url: isoInfo.url };
      config.boot_order = 0x132;
    }
    if (initialState) {
      config.initial_state = {
        buffer: initialState,
        load: function () {
          const self = this;
          setTimeout(() => {
            if (self.onload) self.onload();
          }, 0);
        },
      };
    }
    if (mode === "terminal") {
      config.cmdline = "console=ttyS0 tsc=reliable mitigations=off random.trust_cpu=on text superuser";
      config.memory_size = 512 * 1024 * 1024;
    } else {
      config.cmdline = "console=ttyS0 tsc=reliable mitigations=off random.trust_cpu=on";
    }
  }

  const emulator = new VMConstructor(config);
  state.emulator = emulator;
  state.mode = mode;
  state.distro = distro;
  state.lastVmMemoryMb = Math.round(config.memory_size / (1024 * 1024));

  const distroLabel = distro === DISTRO_ARCH ? "Arch Linux" : "TinyCore";
  setStatus(mode === "terminal" ? `VM created. Booting ${distroLabel} terminal mode...` : `VM created. Booting ${distroLabel} GUI mode...`);

  let bootStep2Set = false;

  const addListener = (eventName, handler) => {
    if (typeof emulator.add_listener === "function") {
      emulator.add_listener(eventName, handler);
    }
  };

  addListener("serial0-output-byte", (byte) => {
    if (!bootStep2Set) {
      setBootStep(1, "done");
      setBootStep(2, "active");
      bootStep2Set = true;
    }
    const ch = String.fromCharCode(byte);
    if (serialEl && serialEl.textContent.startsWith("[serial] waiting")) {
      serialEl.textContent = "";
    }
    appendSerial(ch === "\r" ? "" : ch, serialEl, serialBufferRef);

    if (state.serialStatsCapture) {
      state.serialStatsCapture.buffer += ch;
      if (state.serialStatsCapture.buffer.includes(state.serialStatsCapture.endMarker)) {
        const raw = state.serialStatsCapture.buffer;
        const match = raw.match(/===VMSTATS===\s*([\s\S]*?)===VMSTATS_END===/);
        const result = match ? match[1].trim() : raw;
        state.serialStatsCapture.resolve(result);
        state.serialStatsCapture = null;
      }
    }
  });

  addListener("download-progress", (e) => {
    if (e && typeof e.loaded === "number" && typeof e.total === "number" && e.total > 0) {
      const pct = Math.round((e.loaded / e.total) * 100);
      setStatus(`Downloading VM assets... ${pct}%`);
      setBootStep(1, "active");
    }
  });

  addListener("download-error", (e) => {
    let http = "";
    if (e && e.request && typeof e.request.status === "number" && e.request.status) {
      http = ` HTTP ${e.request.status}`;
    }
    const msg =
      (e && e.message) || (e && e.statusText) || (typeof e === "string" ? e : JSON.stringify(e || {})) || "Unknown download failure.";
    setStatus(`Asset download failed:${http} ${msg}. Deploy must include /api (e.g. Vercel). Or switch to TinyCore.`, "err");
  });

  addListener("emulator-ready", async () => {
    setBootStep(1, "done");
    setBootStep(2, "done");
    setBootStep(3, "active");
    try {
      if (typeof emulator.create_file !== "function") throw new Error("v86 file APIs missing.");
      const restoringFromSnapshot = !!initialState;

      if (!restoringFromSnapshot && distro !== DISTRO_ARCH) {
        const restored = await restoreIntoVm(emulator);
        if (restored > 0) toast(`Restored ${restored} saved file(s).`, "ok");
      }
      if (typeof emulator.screen_set_scale === "function") {
        emulator.screen_set_scale(quality, quality);
      }
      if (typeof emulator.serial0_send === "function") {
        if (distro === DISTRO_ARCH) {
          emulator.serial0_send("dhcpcd -w4 eth0 2>/dev/null || dhcpcd -w4 enp0s5 2>/dev/null || true\n");
        } else {
          emulator.serial0_send("udhcpc -n -q -i eth0 || udhcpc -n -q -i ens3 || udhcpc -n -q -i enp0s3\n");
        }
      }
      appendSerial("\n[serial] VM is ready.\n", serialEl, serialBufferRef);
      setBootStep(3, "done");
      const devNote = usingBaseIso ? " (base ISO)" : "";
      const osNote = distro === DISTRO_ARCH ? " First Arch boot can take 1-5 minutes." : "";
      setStatus(
        mode === "terminal" ? `Terminal ready${devNote}${osNote}. Files in /tmp.` : `GUI ready${devNote}${osNote}. Files in /tmp.`,
        "ok"
      );
      renderSnapshotList();

      if (!restoringFromSnapshot) {
        await saveAutoSnapshot(emulator, distro);
      }
    } catch (error) {
      setStatus(`VM ready, but file bridge failed: ${error.message}`, "err");
    }
  });

  setTimeout(() => {
    if (serialEl && serialEl.textContent.includes("waiting for boot output")) {
      setStatus("Still loading OS image. First boot may take up to a minute.", "warn");
    }
  }, 12000);

  setTimeout(() => {
    if (document.getElementById("status")?.textContent.includes("Booting")) {
      setStatus("Boot is taking longer than expected. Hard refresh once (Ctrl+F5).", "warn");
    }
  }, 25000);

  return emulator;
}
