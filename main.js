import { state, DISTRO_ARCH, DISTRO_TINYCORE } from "./state.js";
import { startVm, getBootPreferences, setBootPreferences } from "./vm.js";
import { bindFileUi } from "./files.js";
import { bindSnapshotUi, isFastStartEnabled, getAutoSnapshot } from "./snapshots.js";
import {
  setStatus,
  toast,
  showBootSkeleton,
  bindSidebarToggle,
  bindModal,
  bindPaste,
  bindCopySerial,
} from "./ui.js";

async function init() {
  showBootSkeleton();

  const prefs = getBootPreferences();
  let initialState = null;

  if (isFastStartEnabled()) {
    try {
      initialState = await getAutoSnapshot();
    } catch (e) {
      console.warn("Auto-snapshot load failed, booting fresh:", e);
      initialState = null;
    }
  }

  await startVm({ ...prefs, initialState });
  bindAllUi(prefs);
}

function bindAllUi(prefs) {
  if (state.uiBound) return;
  state.uiBound = true;

  bindFileUi(setStatus);
  bindSnapshotUi(setStatus, startVm);
  bindPaste();
  bindCopySerial();
  bindSidebarToggle();
  bindModal("statsModal", "vmStatsBtn", "statsCloseBtn");
  bindModal("shortcutsModal", "shortcutsBtn", "shortcutsCloseBtn");

  const distroSelect = document.getElementById("distroSelect");
  const bootModeSelect = document.getElementById("bootModeSelect");
  const qualitySelect = document.getElementById("qualitySelect");
  const rebootBtn = document.getElementById("rebootBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const focusVmBtn = document.getElementById("focusVmBtn");
  const fastStartToggle = document.getElementById("fastStartToggle");

  if (distroSelect) distroSelect.value = prefs.distro;
  if (bootModeSelect) bootModeSelect.value = prefs.mode;
  if (qualitySelect) qualitySelect.value = String(prefs.quality);

  if (fastStartToggle) {
    fastStartToggle.checked = isFastStartEnabled();
    fastStartToggle.addEventListener("change", () => {
      localStorage.setItem("catchmevm.fastStart", fastStartToggle.checked ? "1" : "0");
      localStorage.removeItem("catchmevm.autoSnapshotSaved");
      setStatus(fastStartToggle.checked ? "Fast start enabled. Reload page to apply." : "Fast start disabled.", "ok");
    });
  }

  if (qualitySelect) {
    qualitySelect.addEventListener("change", () => {
      const scale = Number(qualitySelect.value || "1");
      setBootPreferences(
        distroSelect?.value === DISTRO_ARCH ? DISTRO_ARCH : DISTRO_TINYCORE,
        bootModeSelect?.value || "gui",
        scale
      );
      setStatus("Quality saved. Click Apply & Reboot to apply.", "ok");
    });
  }

  if (rebootBtn) {
    rebootBtn.addEventListener("click", async () => {
      const nextDistro = distroSelect?.value === DISTRO_ARCH ? DISTRO_ARCH : DISTRO_TINYCORE;
      const nextMode = bootModeSelect?.value === "terminal" ? "terminal" : "gui";
      const nextQuality = Number(qualitySelect?.value || "1");
      setBootPreferences(nextDistro, nextMode, nextQuality);
      setStatus("Rebooting VM with new mode...");
      if (state.emulator && typeof state.emulator.destroy === "function") {
        try { await state.emulator.destroy(); } catch (_e) {}
      }
      await startVm({ distro: nextDistro, mode: nextMode, quality: nextQuality });
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      if (state.emulator && typeof state.emulator.screen_go_fullscreen === "function") {
        state.emulator.screen_go_fullscreen();
      } else {
        const el = document.getElementById("screen_container");
        if (el && el.requestFullscreen) el.requestFullscreen();
      }
    });
  }

  if (focusVmBtn) {
    focusVmBtn.addEventListener("click", () => {
      const screen = document.getElementById("screen_container");
      if (screen && typeof screen.focus === "function") screen.focus();
      window.focus();
      setStatus("VM focused. Type directly. Use Paste button or Ctrl+V.", "ok");
    });
  }

  const screen = document.getElementById("screen_container");
  if (screen) {
    screen.addEventListener("click", () => {
      screen.focus();
      setStatus("VM focused. Type directly. Use Paste button or Ctrl+V.", "ok");
    });
  }

  bindSerialControls();
  bindVmStats();
}

function bindSerialControls() {
  const serialInput = document.getElementById("serial_input");
  const sendBtn = document.getElementById("serial_send_btn");
  const ctrlCBtn = document.getElementById("serial_ctrl_c_btn");

  function sendSerial(line) {
    const emu = state.emulator;
    if (!emu || typeof emu.serial0_send !== "function") {
      setStatus("Serial input unavailable in this VM build.", "warn");
      return;
    }
    emu.serial0_send(line);
  }

  if (serialInput && sendBtn) {
    const submitSerial = () => {
      const text = serialInput.value;
      if (!text.trim()) return;
      sendSerial(`${text}\n`);
      serialInput.value = "";
      serialInput.focus();
    };
    sendBtn.addEventListener("click", submitSerial);
    serialInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitSerial();
      }
    });
  }

  if (ctrlCBtn) {
    ctrlCBtn.addEventListener("click", () => sendSerial(String.fromCharCode(3)));
  }

  const showIpBtn = document.getElementById("showIpBtn");
  if (showIpBtn) {
    showIpBtn.addEventListener("click", () => {
      sendSerial("ifconfig -a 2>/dev/null || ip addr show\n");
      setStatus("Sent ifconfig to VM. Check serial output.", "ok");
    });
  }

  const testNetworkBtn = document.getElementById("testNetworkBtn");
  if (testNetworkBtn) {
    testNetworkBtn.addEventListener("click", () => {
      sendSerial("curl -s -o /dev/null -w 'HTTP %{http_code}\\n' https://example.com\n");
      setStatus("Sent network test. Check serial console (expect HTTP 200).", "ok");
    });
  }

  const fixGitCloneBtn = document.getElementById("fixGitCloneBtn");
  if (fixGitCloneBtn) {
    fixGitCloneBtn.addEventListener("click", () => {
      const bootstrapGitClone = [
        "echo '[git-fix] bringing network up...'",
        "udhcpc -n -q -i eth0 || udhcpc -n -q -i ens3 || udhcpc -n -q -i enp0s3 || true",
        "echo 'nameserver 1.1.1.1' > /etc/resolv.conf",
        "echo 'nameserver 8.8.8.8' >> /etc/resolv.conf",
        "echo '[git-fix] syncing time for TLS cert checks...'",
        "ntpd -q -p pool.ntp.org || busybox ntpd -q -p pool.ntp.org || true",
        "echo '[git-fix] installing git + certs if missing...'",
        "which git >/dev/null 2>&1 || tce-load -wi git ca-certificates curl openssl || true",
        "echo '[git-fix] versions:'",
        "git --version || echo 'git not installed'",
        "echo '[git-fix] testing github access...'",
        "git ls-remote https://github.com/git/git.git HEAD || echo 'github test failed'",
        "echo '[git-fix] done. try: git clone https://github.com/<user>/<repo>.git'",
      ].join("\n");
      sendSerial(`${bootstrapGitClone}\n`);
      setStatus("Sent git-clone fixer to VM. Check serial for [git-fix] logs.", "ok");
    });
  }
}

function bindVmStats() {
  const statsContent = document.getElementById("statsContent");
  if (!statsContent) return;

  const originalOpen = document.getElementById("vmStatsBtn");
  if (!originalOpen) return;

  originalOpen.removeEventListener("click", originalOpen._handler);
  originalOpen._handler = async () => {
    const emu = state.emulator;
    if (!emu || typeof emu.serial0_send !== "function") {
      setStatus("VM not ready.", "warn");
      return;
    }
    let header = `Emulated RAM: ${state.lastVmMemoryMb} MB\n`;
    if (typeof performance !== "undefined" && performance.memory) {
      const used = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
      const total = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024);
      header += `Browser heap: ${used} MB / ${total} MB\n`;
    }
    header += "--- VM (free, loadavg) ---\n";
    statsContent.textContent = header + "Querying VM...";

    const cmd = "echo '===VMSTATS==='; free -h 2>/dev/null || true; cat /proc/loadavg 2>/dev/null || true; echo '===VMSTATS_END==='\n";
    const vmPromise = new Promise((resolve) => {
      state.serialStatsCapture = { buffer: "", endMarker: "===VMSTATS_END===", resolve };
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
    try {
      emu.serial0_send(cmd);
      const vmOut = await Promise.race([vmPromise, timeout]);
      statsContent.textContent = header + (vmOut || "(no output)");
    } catch (e) {
      statsContent.textContent = header + `(VM did not respond: ${e.message})`;
    } finally {
      state.serialStatsCapture = null;
    }
  };
  originalOpen.addEventListener("click", originalOpen._handler);
}

init().catch((error) => {
  console.error("CatchMeVM startup failed:", error);
  setStatus(`Startup failed: ${error.message}`, "err");
});
