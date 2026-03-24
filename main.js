const MAX_FILE_SIZE = 50 * 1024 * 1024;
const DB_NAME = "catchmevm-db";
const DB_VERSION = 2;
const STORE = "files";
const STORE_SNAPSHOTS = "snapshots";
const PREF_DISTRO = "catchmevm.distro";
const PREF_BOOT_MODE = "catchmevm.bootMode";
const PREF_QUALITY = "catchmevm.quality";
const DISTRO_TINYCORE = "tinycore";
const DISTRO_ARCH = "arch";
const TINYCORE_DEV_ISO = "./assets/v86/TinyCore-11.0-dev.iso";
const TINYCORE_BASE_ISO = "./assets/v86/TinyCore-11.0.iso";
// Proxy bypasses Vercel 100MB limit + CORS. Requires GitHub Release v1.0 with dev ISO.
const TINYCORE_DEV_ISO_PROXY = "/api/iso";
const ARCH_LINUX_ISO_PROXY = "/api/arch-iso";
const GITHUB_ZIP_PROXY = "/api/github-zip";
const TINYCORE_DEV_ISO_RELEASE = "https://github.com/NullSec8/CatchMeVm/releases/download/v1.0/TinyCore-11.0-dev.iso";
const ARCH_LINUX_ISO_STABLE = "https://archive.archlinux.org/iso/2025.02.01/archlinux-2025.02.01-x86_64.iso";
const ARCH_LINUX_ISO_LATEST = "https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso";
const MIN_ISO_SIZE = 50 * 1024 * 1024; // 50 MB - real ISO is ~132 MB, LFS pointer is ~130 bytes

async function probeIsoUrl(url, minSize = MIN_ISO_SIZE) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    if (!r.ok) return null;
    const size = parseInt(r.headers.get("content-length") || "0", 10);
    if (size >= minSize) return url;
    return null;
  } catch (_e) {
    return null;
  }
}

async function getIsoUrl(distro) {
  if (distro === DISTRO_ARCH) {
    const archProxy = await probeIsoUrl(ARCH_LINUX_ISO_PROXY, MIN_ISO_SIZE);
    if (archProxy) {
      return {
        distro: DISTRO_ARCH,
        url: archProxy,
        source: "arch-proxy",
      };
    }
    const archStable = await probeIsoUrl(ARCH_LINUX_ISO_STABLE, MIN_ISO_SIZE);
    if (archStable) {
      return {
        distro: DISTRO_ARCH,
        url: archStable,
        source: "arch-stable",
      };
    }
    const archLatest = await probeIsoUrl(ARCH_LINUX_ISO_LATEST, MIN_ISO_SIZE);
    return {
      distro: DISTRO_ARCH,
      url: archLatest || ARCH_LINUX_ISO_LATEST,
      source: "arch-latest",
    };
  }

  const localDev = await probeIsoUrl(TINYCORE_DEV_ISO, MIN_ISO_SIZE);
  if (localDev) {
    return { distro: DISTRO_TINYCORE, url: localDev, source: "tinycore-local-dev" };
  }
  const proxyDev = await probeIsoUrl(TINYCORE_DEV_ISO_PROXY, MIN_ISO_SIZE);
  if (proxyDev) {
    return { distro: DISTRO_TINYCORE, url: proxyDev, source: "tinycore-proxy-dev" };
  }
  const releaseDev = await probeIsoUrl(TINYCORE_DEV_ISO_RELEASE, MIN_ISO_SIZE);
  if (releaseDev) {
    return { distro: DISTRO_TINYCORE, url: releaseDev, source: "tinycore-release-dev" };
  }
  return { distro: DISTRO_TINYCORE, url: TINYCORE_BASE_ISO, source: "tinycore-base" };
}

let currentEmulator = null;
let currentMode = "gui";
let currentDistro = DISTRO_TINYCORE;
let uiBound = false;
let lastVmMemoryMb = 0;
let serialStatsCapture = null;

function setStatus(message, level = "info") {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = `status ${level === "info" ? "" : level}`.trim();
}

function humanSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "vmPath" });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(vmPath) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(vmPath);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbSnapshotPut(record) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, "readwrite");
    tx.objectStore(STORE_SNAPSHOTS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbSnapshotGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, "readonly");
    const req = tx.objectStore(STORE_SNAPSHOTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbSnapshotGet(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, "readonly");
    const req = tx.objectStore(STORE_SNAPSHOTS).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSnapshotDelete(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SNAPSHOTS, "readwrite");
    tx.objectStore(STORE_SNAPSHOTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function renderSnapshotList() {
  const ul = document.getElementById("snapshotList");
  if (!ul) return;
  idbSnapshotGetAll().then(snapshots => {
    ul.innerHTML = "";
    const sorted = snapshots.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const s of sorted) {
      const li = document.createElement("li");
      const date = s.createdAt ? new Date(s.createdAt).toLocaleString() : "";
      li.innerHTML = `
        <span title="${s.name || s.id}">${s.name || "Unnamed"} <small>(${date})</small></span>
        <span class="snapshot-actions">
          <button data-snapshot-restore="${s.id}">Restore</button>
          <button data-snapshot-delete="${s.id}">Delete</button>
        </span>
      `;
      ul.appendChild(li);
    }
  }).catch(err => console.warn("Snapshot list failed:", err));
}

const filesManifest = new Map();
let selectedUploads = [];

function safeName(name) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

function getUploadDir(mode) {
  return "/tmp";
}

function vmPathFromName(name, mode = "terminal") {
  const dir = getUploadDir(mode);
  const base = safeName(name);
  return dir === "/" ? `/${base}` : `${dir}/${base}`;
}

function parseGitHubRepoInput(input) {
  const raw = (input || "").trim();
  if (!raw) throw new Error("Enter a GitHub repo URL first.");
  const normalized = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  const u = new URL(normalized);
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") {
    throw new Error("Only github.com URLs are supported.");
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Expected URL format: github.com/owner/repo");
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  let branch = "main";
  const treeIdx = parts.indexOf("tree");
  if (treeIdx >= 0 && parts[treeIdx + 1]) {
    branch = decodeURIComponent(parts[treeIdx + 1]);
  }
  return { owner, repo, branch };
}

async function importGitHubRepoIntoVm(emulator, repoInput, mode) {
  assertFsApi(emulator);
  const { owner, repo, branch } = parseGitHubRepoInput(repoInput);
  const zipUrl = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/heads/${encodeURIComponent(branch)}`;
  let response;
  try {
    response = await fetch(zipUrl);
  } catch (_err) {
    response = null;
  }
  if (!response || !response.ok) {
    const proxyUrl = `${GITHUB_ZIP_PROXY}?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}`;
    response = await fetch(proxyUrl);
  }
  if (!response.ok) throw new Error(`GitHub download failed (${response.status}).`);
  const zipBuffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);
  const rootDir = `${safeName(repo)}-${safeName(branch)}`;
  const vmRoot = `${getUploadDir(mode)}/${safeName(repo)}`;
  let imported = 0;

  const entries = Object.keys(zip.files).sort();
  for (const name of entries) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const rel = name.startsWith(`${rootDir}/`) ? name.slice(rootDir.length + 1) : name;
    if (!rel) continue;
    const vmPath = `${vmRoot}/${rel}`.replace(/\\/g, "/");
    const bytes = new Uint8Array(await entry.async("uint8array"));
    await emulator.create_file(vmPath, bytes);
    const record = {
      vmPath,
      name: rel.split("/").pop() || rel,
      size: bytes.byteLength,
      type: "application/octet-stream",
      updatedAt: Date.now(),
      bytes
    };
    await idbPut(record);
    filesManifest.set(vmPath, record);
    imported++;
  }
  renderRows();
  return { imported, vmRoot, owner, repo, branch };
}

function renderRows() {
  const tbody = document.getElementById("rows");
  tbody.innerHTML = "";
  const all = Array.from(filesManifest.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const file of all) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" data-vmpath="${file.vmPath}"></td>
      <td>${file.vmPath}</td>
      <td>${humanSize(file.size)}</td>
      <td>
        <button data-action="export" data-vmpath="${file.vmPath}">Export</button>
        <button data-action="remove" data-vmpath="${file.vmPath}">Remove</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function getSelectedVmPaths() {
  return Array.from(document.querySelectorAll('#rows input[type="checkbox"][data-vmpath]:checked'))
    .map(cb => cb.getAttribute("data-vmpath"))
    .filter(Boolean);
}

function assertFsApi(emulator) {
  if (typeof emulator.create_file !== "function" || typeof emulator.read_file !== "function") {
    throw new Error("v86 file APIs missing. Ensure filesystem:{} is enabled in VM constructor.");
  }
}

function migrateVmPath(vmPath, mode) {
  if (vmPath.startsWith("/upload/") && mode === "terminal") {
    return "/tmp/" + vmPath.slice(8);
  }
  if (vmPath.startsWith("/upload/") && mode === "gui") {
    return "/" + vmPath.slice(8);
  }
  return vmPath;
}

async function restoreIntoVm(emulator) {
  const saved = await idbGetAll();
  if (!saved.length) {
    return;
  }
  let restored = 0;
  for (const rec of saved) {
    const bytes = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes);
    let vmPath = migrateVmPath(rec.vmPath, currentMode);
    try {
      await emulator.create_file(vmPath, bytes);
      const updated = { ...rec, vmPath };
      filesManifest.set(vmPath, updated);
      if (vmPath !== rec.vmPath) {
        await idbDelete(rec.vmPath);
        await idbPut(updated);
      }
      restored++;
    } catch (err) {
      console.warn("Restore failed for", rec.vmPath, err);
    }
  }
  renderRows();
  if (restored > 0) {
    setStatus(`VM ready. Restored ${restored} saved file(s).`, "ok");
  }
}

function getBootPreferences() {
  const distro = localStorage.getItem(PREF_DISTRO) || DISTRO_TINYCORE;
  const mode = localStorage.getItem(PREF_BOOT_MODE) || "gui";
  const quality = Number(localStorage.getItem(PREF_QUALITY) || "1");
  return {
    distro: distro === DISTRO_ARCH ? DISTRO_ARCH : DISTRO_TINYCORE,
    mode: mode === "terminal" ? "terminal" : "gui",
    quality: Number.isFinite(quality) && quality > 0 ? quality : 1
  };
}

function setBootPreferences(distro, mode, quality) {
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

async function startVm({ distro, mode, quality, initialState = null }) {
  setStatus(initialState ? "Restoring snapshot..." : "Booting CatchMeVM...");
  const serialEl = document.getElementById("serial_console");
  applyModeUi(mode);

  let serialBuffer = "";
  let serialFlushScheduled = false;
  const MAX_SERIAL_LEN = 80000;

  function flushSerial() {
    if (!serialEl || !serialBuffer) return;
    serialFlushScheduled = false;
    const toAppend = serialBuffer;
    serialBuffer = "";
    if (serialEl.textContent.startsWith("[serial] waiting")) {
      serialEl.textContent = "";
    }
    serialEl.textContent += toAppend;
    if (serialEl.textContent.length > 120000) {
      serialEl.textContent = serialEl.textContent.slice(-MAX_SERIAL_LEN);
    }
    serialEl.scrollTop = serialEl.scrollHeight;
  }

  function appendSerial(text) {
    if (!serialEl) return;
    serialBuffer += text;
    if (!serialFlushScheduled) {
      serialFlushScheduled = true;
      requestAnimationFrame(flushSerial);
    }
  }
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
    memory_size: distro === DISTRO_ARCH ? 1024 * 1024 * 1024 : (mode === "gui" ? 256 * 1024 * 1024 : 128 * 1024 * 1024),
    vga_memory_size: mode === "gui" ? 16 * 1024 * 1024 : 8 * 1024 * 1024,
    bios: { url: "./assets/v86/seabios.bin" },
    vga_bios: { url: "./assets/v86/vgabios.bin" },
    autostart: true,
    filesystem: {},
    net_device: {
      // Use a broadly supported NIC so TinyCore can get a link reliably.
      type: "ne2k",
      relay_url: "fetch"
    }
  };

  const isoInfo = await getIsoUrl(distro);
  const usingBaseIso = isoInfo.source === "tinycore-base";
  if (usingBaseIso && distro !== DISTRO_ARCH) {
    setStatus("Using base TinyCore (dev ISO not found). Create GitHub Release v1.0 with TinyCore-11.0-dev.iso.", "warn");
  }
  config.cdrom = { url: isoInfo.url };
  config.boot_order = 0x132;
  if (initialState) {
    config.initial_state = {
      buffer: initialState,
      load: function() {
        const self = this;
        setTimeout(() => { if (self.onload) self.onload(); }, 0);
      }
    };
  }
  if (mode === "terminal") {
    config.cmdline = "console=ttyS0 tsc=reliable mitigations=off random.trust_cpu=on text superuser";
    config.memory_size = distro === DISTRO_ARCH ? 1024 * 1024 * 1024 : 512 * 1024 * 1024;
  } else {
    config.cmdline = "console=ttyS0 tsc=reliable mitigations=off random.trust_cpu=on";
  }

  const emulator = new VMConstructor(config);
  currentEmulator = emulator;
  currentMode = mode;
  currentDistro = distro;
  lastVmMemoryMb = Math.round(config.memory_size / (1024 * 1024));
  const distroLabel = distro === DISTRO_ARCH ? "Arch Linux" : "TinyCore";
  setStatus(mode === "terminal" ? `VM created. Booting ${distroLabel} terminal mode...` : `VM created. Booting ${distroLabel} GUI mode...`);

  const bootProgressEl = document.getElementById("bootProgress");
  function setBootStep(step, state) {
    const el = document.getElementById(`bootStep${step}`);
    if (el) {
      el.classList.remove("active", "done");
      if (state === "active") el.classList.add("active");
      if (state === "done") el.classList.add("done");
    }
  }
  if (bootProgressEl) {
    bootProgressEl.style.display = initialState ? "none" : "flex";
    if (!initialState) setBootStep(1, "active");
  }

  const addListener = (eventName, handler) => {
    if (typeof emulator.add_listener === "function") {
      emulator.add_listener(eventName, handler);
    }
  };

  let bootStep2Set = false;
  addListener("serial0-output-byte", byte => {
    if (!bootStep2Set) {
      setBootStep(1, "done");
      setBootStep(2, "active");
      bootStep2Set = true;
    }
    const ch = String.fromCharCode(byte);
    if (serialEl && serialEl.textContent.startsWith("[serial] waiting")) {
      serialEl.textContent = "";
    }
    appendSerial(ch === "\r" ? "" : ch);
    if (serialStatsCapture) {
      serialStatsCapture.buffer += ch;
      if (serialStatsCapture.buffer.includes(serialStatsCapture.endMarker)) {
        const raw = serialStatsCapture.buffer;
        const match = raw.match(/===VMSTATS===\s*([\s\S]*?)===VMSTATS_END===/);
        const result = match ? match[1].trim() : raw;
        serialStatsCapture.resolve(result);
        serialStatsCapture = null;
      }
    }
  });
  addListener("download-progress", e => {
    if (e && typeof e.loaded === "number" && typeof e.total === "number" && e.total > 0) {
      const pct = Math.round((e.loaded / e.total) * 100);
      setStatus(`Downloading VM assets... ${pct}%`);
      setBootStep(1, "active");
    }
  });
  addListener("download-error", e => {
    const msg = e && e.message ? e.message : "Unknown download failure.";
    setStatus(`Asset download failed: ${msg}`, "err");
  });

  addListener("emulator-ready", async () => {
    setBootStep(1, "done");
    setBootStep(2, "done");
    setBootStep(3, "active");
    try {
      assertFsApi(emulator);
      await restoreIntoVm(emulator);
      if (typeof emulator.screen_set_scale === "function") {
        emulator.screen_set_scale(quality, quality);
      }
      // Bring up networking automatically when the guest boots.
      if (typeof emulator.serial0_send === "function") {
        emulator.serial0_send("udhcpc -n -q -i eth0 || udhcpc -n -q -i ens3 || udhcpc -n -q -i enp0s3\n");
      }
      appendSerial("\n[serial] VM is ready.\n");
      setBootStep(3, "done");
      const devNote = usingBaseIso ? " (base ISO—run remaster script locally for Python, GCC)" : "";
      const osNote = distro === DISTRO_ARCH ? " Arch image is experimental and may boot slower." : "";
      setStatus(
        mode === "terminal"
          ? `Terminal ready${devNote}${osNote}. Files in /tmp.`
          : `GUI ready${devNote}${osNote}. Files in /tmp.`,
        "ok"
      );
      renderSnapshotList();
    } catch (error) {
      setStatus(`VM ready, but file bridge failed: ${error.message}`, "err");
    }
  });

  // Helpful diagnostic when network/resources prevent boot output
  setTimeout(() => {
    if (serialEl && serialEl.textContent.includes("waiting for boot output")) {
      setStatus("Still loading OS image. First boot may take up to a minute.", "warn");
    }
  }, 12000);

  // Guardrail for cases where boot stalls before ready event
  setTimeout(() => {
    if (document.getElementById("status").textContent.includes("Booting")) {
      setStatus("Boot is taking longer than expected. Hard refresh once (Ctrl+F5).", "warn");
    }
  }, 25000);

  bindUi(emulator, { distro, mode, quality });
}

function bindUi(emulator, prefs) {
  const dropzone = document.getElementById("dropzone");
  const input = document.getElementById("fileInput");
  const serialInput = document.getElementById("serial_input");
  const sendBtn = document.getElementById("serial_send_btn");
  const ctrlCBtn = document.getElementById("serial_ctrl_c_btn");
  const githubRepoInput = document.getElementById("githubRepoInput");
  const importGithubBtn = document.getElementById("importGithubBtn");
  const focusVmBtn = document.getElementById("focusVmBtn");
  const distroSelect = document.getElementById("distroSelect");
  const bootModeSelect = document.getElementById("bootModeSelect");
  const qualitySelect = document.getElementById("qualitySelect");
  const rebootBtn = document.getElementById("rebootBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const screen = document.getElementById("screen_container");

  if (distroSelect) distroSelect.value = prefs.distro;
  if (bootModeSelect) bootModeSelect.value = prefs.mode;
  if (qualitySelect) qualitySelect.value = String(prefs.quality);

  if (uiBound) {
    return;
  }
  uiBound = true;

  const activeEmulator = () => currentEmulator;

  function sendSerial(line) {
    const emu = activeEmulator();
    if (!emu || typeof emu.serial0_send !== "function") {
      setStatus("Serial input unavailable in this VM build.", "warn");
      return;
    }
    emu.serial0_send(line);
  }

  input.addEventListener("change", () => {
    selectedUploads = Array.from(input.files || []);
    setStatus(`${selectedUploads.length} file(s) queued for import.`);
  });

  ["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.add("active");
    });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.remove("active");
    });
  });
  dropzone.addEventListener("drop", e => {
    selectedUploads = Array.from(e.dataTransfer?.files || []);
    setStatus(`${selectedUploads.length} file(s) queued from drag/drop.`);
  });
  dropzone.addEventListener("click", () => {
    if (input) input.click();
  });

  document.getElementById("importBtn").addEventListener("click", async () => {
    if (!selectedUploads.length) {
      setStatus("No files selected.", "warn");
      return;
    }
    try {
      const emu = activeEmulator();
      if (!emu) throw new Error("VM is not running.");
      assertFsApi(emu);
      let imported = 0;
      for (const file of selectedUploads) {
        if (file.size > MAX_FILE_SIZE) {
          setStatus(`Skipped ${file.name}: file too large.`, "warn");
          continue;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const vmPath = vmPathFromName(file.name, currentMode);
        await emu.create_file(vmPath, bytes);
        const record = {
          vmPath,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          updatedAt: Date.now(),
          bytes
        };
        await idbPut(record);
        filesManifest.set(vmPath, record);
        imported++;
      }
      selectedUploads = [];
      input.value = "";
      renderRows();
      setStatus(`Imported ${imported} file(s) to VM.`, "ok");
    } catch (error) {
      setStatus(`Import failed: ${error.message}`, "err");
    }
  });

  if (importGithubBtn) {
    importGithubBtn.addEventListener("click", async () => {
      try {
        const emu = activeEmulator();
        if (!emu) throw new Error("VM is not running.");
        const input = githubRepoInput ? githubRepoInput.value : "";
        setStatus("Importing repo from GitHub via host browser...");
        const result = await importGitHubRepoIntoVm(emu, input, currentMode);
        setStatus(
          `Imported ${result.imported} files from ${result.owner}/${result.repo}@${result.branch} to ${result.vmRoot}.`,
          "ok"
        );
      } catch (error) {
        setStatus(`GitHub import failed: ${error.message}`, "err");
      }
    });
  }

  document.getElementById("restoreBtn").addEventListener("click", async () => {
    try {
      const emu = activeEmulator();
      if (!emu) throw new Error("VM is not running.");
      await restoreIntoVm(emu);
      setStatus("Restored saved files into current VM session.", "ok");
    } catch (error) {
      setStatus(`Restore failed: ${error.message}`, "err");
    }
  });

  document.getElementById("exportSelectedBtn").addEventListener("click", async () => {
    const selected = getSelectedVmPaths();
    if (!selected.length) {
      setStatus("Select at least one file.", "warn");
      return;
    }
    try {
      if (selected.length === 1) {
        const vmPath = selected[0];
        const rec = filesManifest.get(vmPath);
        const emu = activeEmulator();
        if (!emu) throw new Error("VM is not running.");
        const data = emu.read_file(vmPath);
        downloadBlob(new Blob([data], { type: rec?.type || "application/octet-stream" }), rec?.name || "file.bin");
        setStatus("Exported 1 file.", "ok");
        return;
      }
      const zip = new JSZip();
      for (const vmPath of selected) {
        const rec = filesManifest.get(vmPath);
        const emu = activeEmulator();
        if (!emu) throw new Error("VM is not running.");
        const data = emu.read_file(vmPath);
        zip.file(rec?.name || vmPath.split("/").pop(), data);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      downloadBlob(blob, "catchmevm-export.zip");
      setStatus(`Exported ${selected.length} files as zip.`, "ok");
    } catch (error) {
      setStatus(`Export failed: ${error.message}`, "err");
    }
  });

  document.getElementById("exportAllBtn").addEventListener("click", async () => {
    const all = Array.from(filesManifest.keys());
    if (!all.length) {
      setStatus("No files to export.", "warn");
      return;
    }
    document.querySelectorAll('#rows input[type="checkbox"][data-vmpath]').forEach(cb => {
      cb.checked = true;
    });
    document.getElementById("exportSelectedBtn").click();
  });

  document.getElementById("clearBtn").addEventListener("click", async () => {
    await idbClear();
    filesManifest.clear();
    renderRows();
    setStatus("Saved session files cleared.", "ok");
  });

  document.getElementById("checkAll").addEventListener("change", e => {
    const on = e.target.checked;
    document.querySelectorAll('#rows input[type="checkbox"][data-vmpath]').forEach(cb => {
      cb.checked = on;
    });
  });

  document.getElementById("rows").addEventListener("click", async e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const vmPath = btn.getAttribute("data-vmpath");
    const action = btn.getAttribute("data-action");
    if (!vmPath || !action) return;

    if (action === "export") {
      try {
        const rec = filesManifest.get(vmPath);
        const emu = activeEmulator();
        if (!emu) throw new Error("VM is not running.");
        const data = emu.read_file(vmPath);
        downloadBlob(new Blob([data], { type: rec?.type || "application/octet-stream" }), rec?.name || "file.bin");
        setStatus(`Exported ${rec?.name || vmPath}.`, "ok");
      } catch (error) {
        setStatus(`Export failed: ${error.message}`, "err");
      }
      return;
    }

    if (action === "remove") {
      await idbDelete(vmPath);
      filesManifest.delete(vmPath);
      renderRows();
      setStatus(`Removed ${vmPath} from saved list.`, "ok");
    }
  });

  // Interactive VM controls
  if (serialInput && sendBtn) {
    const submitSerial = () => {
      const text = serialInput.value;
      if (!text.trim()) return;
      sendSerial(`${text}\n`);
      serialInput.value = "";
      serialInput.focus();
    };
    sendBtn.addEventListener("click", submitSerial);
    serialInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitSerial();
      }
    });
  }

  if (ctrlCBtn) {
    ctrlCBtn.addEventListener("click", () => {
      sendSerial(String.fromCharCode(3));
    });
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
        "echo '[git-fix] done. try: git clone https://github.com/<user>/<repo>.git'"
      ].join("\n");
      sendSerial(`${bootstrapGitClone}\n`);
      setStatus("Sent git-clone fixer to VM. Check serial for [git-fix] logs.", "ok");
    });
  }

  const vmStatsBtn = document.getElementById("vmStatsBtn");
  const statsModal = document.getElementById("statsModal");
  const statsContent = document.getElementById("statsContent");
  const statsCloseBtn = document.getElementById("statsCloseBtn");
  if (vmStatsBtn && statsModal && statsContent) {
    vmStatsBtn.addEventListener("click", async () => {
      const emu = activeEmulator();
      if (!emu || typeof emu.serial0_send !== "function") {
        setStatus("VM not ready.", "warn");
        return;
      }
      let header = `Emulated RAM: ${lastVmMemoryMb} MB\n`;
      if (typeof performance !== "undefined" && performance.memory) {
        const used = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
        const total = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024);
        header += `Browser heap: ${used} MB / ${total} MB\n`;
      }
      header += "--- VM (free, loadavg) ---\n";
      statsContent.textContent = header + "Querying VM...";
      statsModal.classList.add("open");
      const cmd = "echo '===VMSTATS==='; free -h 2>/dev/null || true; cat /proc/loadavg 2>/dev/null || true; echo '===VMSTATS_END==='\n";
      const vmPromise = new Promise((resolve) => {
        serialStatsCapture = { buffer: "", endMarker: "===VMSTATS_END===", resolve };
      });
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000)
      );
      try {
        sendSerial(cmd);
        const vmOut = await Promise.race([vmPromise, timeout]);
        statsContent.textContent = header + (vmOut || "(no output)");
      } catch (e) {
        statsContent.textContent = header + `(VM did not respond: ${e.message})`;
      } finally {
        serialStatsCapture = null;
      }
    });
  }
  if (statsCloseBtn && statsModal) {
    statsCloseBtn.addEventListener("click", () => statsModal.classList.remove("open"));
  }
  if (statsModal) {
    statsModal.addEventListener("click", (e) => {
      if (e.target === statsModal) statsModal.classList.remove("open");
    });
  }

  const shortcutsBtn = document.getElementById("shortcutsBtn");
  const shortcutsModal = document.getElementById("shortcutsModal");
  const shortcutsCloseBtn = document.getElementById("shortcutsCloseBtn");
  if (shortcutsBtn && shortcutsModal) {
    shortcutsBtn.addEventListener("click", () => shortcutsModal.classList.add("open"));
  }
  if (shortcutsCloseBtn && shortcutsModal) {
    shortcutsCloseBtn.addEventListener("click", () => shortcutsModal.classList.remove("open"));
  }
  if (shortcutsModal) {
    shortcutsModal.addEventListener("click", (e) => {
      if (e.target === shortcutsModal) shortcutsModal.classList.remove("open");
    });
  }

  if (focusVmBtn) {
    focusVmBtn.addEventListener("click", () => {
      if (screen && typeof screen.focus === "function") screen.focus();
      window.focus();
      setStatus("VM focused. Type directly. Use Paste button or Ctrl+V.", "ok");
    });
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      const emu = activeEmulator();
      if (emu && typeof emu.screen_go_fullscreen === "function") {
        emu.screen_go_fullscreen();
      } else {
        const el = document.getElementById("screen_container");
        if (el && el.requestFullscreen) el.requestFullscreen();
      }
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
      if (currentEmulator && typeof currentEmulator.destroy === "function") {
        try {
          await currentEmulator.destroy();
        } catch (_err) {
          // ignore destroy errors and continue boot
        }
      }
      await startVm({ distro: nextDistro, mode: nextMode, quality: nextQuality });
    });
  }

  const saveSnapshotBtn = document.getElementById("saveSnapshotBtn");
  const snapshotNameInput = document.getElementById("snapshotName");
  if (saveSnapshotBtn) {
    saveSnapshotBtn.addEventListener("click", async () => {
      const emu = activeEmulator();
      if (!emu) {
        setStatus("VM is not running.", "warn");
        return;
      }
      const name = (snapshotNameInput?.value || "").trim() || `Snapshot ${new Date().toLocaleString()}`;
      try {
        setStatus("Saving snapshot...");
        const state = await emu.save_state();
        if (!state || !(state instanceof ArrayBuffer)) {
          throw new Error("save_state did not return ArrayBuffer");
        }
        const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await idbSnapshotPut({
          id,
          name,
          state,
          distro: currentDistro,
          mode: currentMode,
          createdAt: Date.now()
        });
        if (snapshotNameInput) snapshotNameInput.value = "";
        renderSnapshotList();
        setStatus(`Snapshot "${name}" saved.`, "ok");
      } catch (err) {
        setStatus(`Save failed: ${err.message}`, "err");
      }
    });
  }

  const snapshotList = document.getElementById("snapshotList");
  if (snapshotList) {
    snapshotList.addEventListener("click", async (e) => {
      const restoreBtn = e.target.closest("[data-snapshot-restore]");
      const deleteBtn = e.target.closest("[data-snapshot-delete]");
      if (restoreBtn) {
        const id = restoreBtn.getAttribute("data-snapshot-restore");
        const snap = await idbSnapshotGet(id);
        if (!snap || !snap.state) {
          setStatus("Snapshot not found or invalid.", "err");
          return;
        }
        const state = snap.state instanceof ArrayBuffer ? snap.state : new ArrayBuffer(snap.state);
        const distro = snap.distro === DISTRO_ARCH ? DISTRO_ARCH : (distroSelect?.value || DISTRO_TINYCORE);
        const mode = snap.mode || bootModeSelect?.value || "gui";
        const quality = Number(qualitySelect?.value || "1");
        setBootPreferences(distro, mode, quality);
        if (distroSelect) distroSelect.value = distro;
        if (bootModeSelect) bootModeSelect.value = mode;
        setStatus("Restoring snapshot...");
        if (currentEmulator && typeof currentEmulator.destroy === "function") {
          try {
            await currentEmulator.destroy();
          } catch (_err) {}
        }
        await startVm({ distro, mode, quality, initialState: state });
      }
      if (deleteBtn) {
        const id = deleteBtn.getAttribute("data-snapshot-delete");
        try {
          await idbSnapshotDelete(id);
          renderSnapshotList();
          setStatus("Snapshot deleted.", "ok");
        } catch (err) {
          setStatus(`Delete failed: ${err.message}`, "err");
        }
      }
    });
  }

  renderSnapshotList();

  function syncFullscreenCentering() {
    if (!screen) return;
    const isFullscreen =
      document.fullscreenElement === screen ||
      document.webkitFullscreenElement === screen;
    const canvas = screen.querySelector("canvas");
    const textLayer = screen.querySelector("div");

    if (isFullscreen) {
      screen.style.display = "flex";
      screen.style.alignItems = "center";
      screen.style.justifyContent = "center";
      screen.style.background = "#000";

      if (canvas) {
        canvas.style.width = "auto";
        canvas.style.height = "100%";
        canvas.style.maxWidth = "100%";
        canvas.style.maxHeight = "100%";
        canvas.style.margin = "auto";
      }
      if (textLayer) {
        textLayer.style.margin = "auto";
      }
    } else {
      screen.style.display = "block";
      screen.style.alignItems = "";
      screen.style.justifyContent = "";
      screen.style.background = "";

      if (canvas) {
        canvas.style.width = "";
        canvas.style.height = "";
        canvas.style.maxWidth = "";
        canvas.style.maxHeight = "";
        canvas.style.margin = "";
      }
      if (textLayer) {
        textLayer.style.margin = "";
      }
    }
  }

  document.addEventListener("fullscreenchange", syncFullscreenCentering);
  document.addEventListener("webkitfullscreenchange", syncFullscreenCentering);

  // Click-to-focus: screen_container has tabindex so it receives keyboard events
  if (screen) {
    screen.addEventListener("click", () => {
      screen.focus();
      setStatus("VM focused. Type directly. Use Paste button or Ctrl+V.", "ok");
    });
  }

  // Paste into VM when VM display has focus, or into serial when serial console focused (terminal mode)
  const serialConsole = document.getElementById("serial_console");

  function isVmDisplayFocused() {
    if (!screen) return false;
    const el = document.activeElement;
    return el && (el === screen || screen.contains(el));
  }

  function isSerialConsoleFocused() {
    return serialConsole && document.activeElement === serialConsole;
  }

  function isInEditableField() {
    const el = document.activeElement;
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  const PASTE_DELAY_MS = 3;
  const PASTE_LINE_DELAY_MS = 25;

  function toUtf8Bytes(str) {
    return new Uint8Array(new TextEncoder().encode(str));
  }

  function sendUtf8ToSerial(bytes) {
    const emu = activeEmulator();
    if (!emu || typeof emu.serial0_send !== "function") return;
    for (let i = 0; i < bytes.length; i++) {
      emu.serial0_send(String.fromCharCode(bytes[i]));
    }
  }

  function sendPasteToVm(text) {
    const emu = activeEmulator();
    if (!emu) return false;
    if (typeof emu.keyboard_send_text === "function") {
      emu.keyboard_send_text(text, PASTE_DELAY_MS);
      return true;
    }
    if (typeof emu.serial0_send === "function") {
      sendSerialPaste(text);
      return true;
    }
    return false;
  }

  function sendSerialPaste(text) {
    const emu = activeEmulator();
    if (!emu || typeof emu.serial0_send !== "function") return;
    const lines = text.split(/\r?\n/);
    let idx = 0;
    function sendNextLine() {
      if (idx >= lines.length) return;
      const line = lines[idx];
      const addNewline = idx < lines.length - 1 || (idx === lines.length - 1 && line === "" && text.endsWith("\n"));
      const chunk = addNewline ? line + "\n" : line;
      if (chunk) {
        sendUtf8ToSerial(toUtf8Bytes(chunk));
      }
      idx++;
      if (idx < lines.length) setTimeout(sendNextLine, PASTE_LINE_DELAY_MS);
    }
    sendNextLine();
  }

  function handlePaste(text) {
    if (currentMode === "terminal" || isSerialConsoleFocused()) {
      sendSerialPaste(text);
      return true;
    }
    return sendPasteToVm(text);
  }

  function doPaste() {
    if (!activeEmulator()) {
      setStatus("VM not running.", "warn");
      return;
    }
    navigator.clipboard.readText().then(
      text => {
        if (text && handlePaste(text)) setStatus("Pasted to VM.", "ok");
        else setStatus("Nothing to paste.", "warn");
      },
      () => setStatus("Paste failed. Allow clipboard access.", "warn")
    );
  }

  const pasteBtn = document.getElementById("pasteBtn");
  if (pasteBtn) pasteBtn.addEventListener("click", doPaste);

  const copySerialBtn = document.getElementById("copySerialBtn");
  if (copySerialBtn) {
    copySerialBtn.addEventListener("click", () => {
      const sel = window.getSelection();
      const selected = sel && sel.toString();
      let text = selected && selected.length > 0 ? selected : (serialConsole?.textContent || "").replace(/\s*\[serial\]\s*waiting[^\n]*/i, "").trim();
      if (!text) {
        setStatus("Nothing to copy.", "warn");
        return;
      }
      navigator.clipboard.writeText(text).then(
        () => setStatus("Copied to clipboard.", "ok"),
        () => setStatus("Copy failed.", "warn")
      );
    });
  }

  document.addEventListener(
    "keydown",
    e => {
      const isPaste = (e.ctrlKey || e.metaKey) && e.key === "v";
      if (!isPaste || isInEditableField()) return;
      if (!activeEmulator()) return;
      e.preventDefault();
      doPaste();
    },
    true
  );

  document.addEventListener(
    "paste",
    e => {
      if (document.activeElement === serialInput) return;
      if (isInEditableField()) return;
      if (!activeEmulator()) return;
      const text = e.clipboardData?.getData?.("text/plain");
      if (text && handlePaste(text)) {
        e.preventDefault();
        setStatus("Pasted to VM.", "ok");
      }
    },
    true
  );

  if (serialConsole) {
    serialConsole.setAttribute("tabindex", "0");
  }
}

startVm(getBootPreferences()).catch(error => {
  setStatus(`Startup failed: ${error.message}`, "err");
});
