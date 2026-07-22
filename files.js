import { state, filesManifest, selectedUploads, setSelectedUploads, MAX_FILE_SIZE, GITHUB_ZIP_PROXY } from "./state.js";
import { idbPut, idbGetAll, idbDelete, idbClear } from "./idb.js";
import { safeName, getUploadDir, vmPathFromName, parseGitHubRepoInput, downloadBlob, humanSize } from "./utils.js";

function assertFsApi(emulator) {
  if (typeof emulator.create_file !== "function" || typeof emulator.read_file !== "function") {
    throw new Error("v86 file APIs missing. Ensure filesystem:{} is enabled in VM constructor.");
  }
}

function migrateVmPath(vmPath, mode) {
  if (vmPath.startsWith("/upload/") && mode === "terminal") return "/tmp/" + vmPath.slice(8);
  if (vmPath.startsWith("/upload/") && mode === "gui") return "/" + vmPath.slice(8);
  return vmPath;
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return new Uint8Array(data);
  return null;
}

export async function restoreIntoVm(emulator) {
  const saved = await idbGetAll();
  if (!saved.length) return 0;
  let restored = 0;
  for (const rec of saved) {
    const bytes = toUint8Array(rec.bytes);
    if (!bytes) {
      console.warn("Skipping file with invalid data:", rec.vmPath);
      continue;
    }
    const vmPath = migrateVmPath(rec.vmPath, state.mode);
    try {
      await emulator.create_file(vmPath, bytes);
      const updated = { ...rec, vmPath, bytes };
      filesManifest.set(vmPath, updated);
      if (vmPath !== rec.vmPath) {
        idbDelete(rec.vmPath).catch(() => {});
        idbPut(updated).catch(() => {});
      }
      restored++;
    } catch (err) {
      console.warn("Restore failed for", rec.vmPath, err);
    }
  }
  renderRows();
  return restored;
}

export async function importGitHubRepoIntoVm(emulator, repoInput, mode) {
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
      bytes,
    };
    await idbPut(record);
    filesManifest.set(vmPath, record);
    imported++;
  }
  renderRows();
  return { imported, vmRoot, owner, repo, branch };
}

export function renderRows() {
  const tbody = document.getElementById("rows");
  if (!tbody) return;
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

export function getSelectedVmPaths() {
  return Array.from(document.querySelectorAll('#rows input[type="checkbox"][data-vmpath]:checked'))
    .map((cb) => cb.getAttribute("data-vmpath"))
    .filter(Boolean);
}

export function bindFileUi(setStatus) {
  const dropzone = document.getElementById("dropzone");
  const input = document.getElementById("fileInput");

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("active");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("active");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    setSelectedUploads(Array.from(e.dataTransfer?.files || []));
    setStatus(`${selectedUploads.length} file(s) queued from drag/drop.`);
  });
  dropzone.addEventListener("click", () => {
    if (input) input.click();
  });

  input.addEventListener("change", () => {
    setSelectedUploads(Array.from(input.files || []));
    setStatus(`${selectedUploads.length} file(s) queued for import.`);
  });

  document.getElementById("importBtn").addEventListener("click", async () => {
    if (!selectedUploads.length) {
      setStatus("No files selected.", "warn");
      return;
    }
    try {
      const emu = state.emulator;
      if (!emu) throw new Error("VM is not running.");
      assertFsApi(emu);
      let imported = 0;
      for (const file of selectedUploads) {
        if (file.size > MAX_FILE_SIZE) {
          setStatus(`Skipped ${file.name}: file too large.`, "warn");
          continue;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const vmPath = vmPathFromName(file.name, state.mode);
        await emu.create_file(vmPath, bytes);
        const record = {
          vmPath,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          updatedAt: Date.now(),
          bytes,
        };
        await idbPut(record);
        filesManifest.set(vmPath, record);
        imported++;
      }
      setSelectedUploads([]);
      input.value = "";
      renderRows();
      setStatus(`Imported ${imported} file(s) to VM.`, "ok");
    } catch (error) {
      setStatus(`Import failed: ${error.message}`, "err");
    }
  });

  const importGithubBtn = document.getElementById("importGithubBtn");
  if (importGithubBtn) {
    importGithubBtn.addEventListener("click", async () => {
      try {
        const emu = state.emulator;
        if (!emu) throw new Error("VM is not running.");
        const githubRepoInput = document.getElementById("githubRepoInput");
        const val = githubRepoInput ? githubRepoInput.value : "";
        setStatus("Importing repo from GitHub via host browser...");
        const result = await importGitHubRepoIntoVm(emu, val, state.mode);
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
      const emu = state.emulator;
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
      const emu = state.emulator;
      if (!emu) throw new Error("VM is not running.");
      if (selected.length === 1) {
        const vmPath = selected[0];
        const rec = filesManifest.get(vmPath);
        const data = emu.read_file(vmPath);
        downloadBlob(new Blob([data], { type: rec?.type || "application/octet-stream" }), rec?.name || "file.bin");
        setStatus("Exported 1 file.", "ok");
        return;
      }
      const zip = new JSZip();
      for (const vmPath of selected) {
        const rec = filesManifest.get(vmPath);
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

  document.getElementById("exportAllBtn").addEventListener("click", () => {
    if (!filesManifest.size) {
      setStatus("No files to export.", "warn");
      return;
    }
    document.querySelectorAll('#rows input[type="checkbox"][data-vmpath]').forEach((cb) => {
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

  document.getElementById("checkAll").addEventListener("change", (e) => {
    const on = e.target.checked;
    document.querySelectorAll('#rows input[type="checkbox"][data-vmpath]').forEach((cb) => {
      cb.checked = on;
    });
  });

  document.getElementById("rows").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const vmPath = btn.getAttribute("data-vmpath");
    const action = btn.getAttribute("data-action");
    if (!vmPath || !action) return;

    if (action === "export") {
      try {
        const rec = filesManifest.get(vmPath);
        const emu = state.emulator;
        if (!emu) throw new Error("VM is not running.");
        const data = emu.read_file(vmPath);
        downloadBlob(new Blob([data], { type: rec?.type || "application/octet-stream" }), rec?.name || "file.bin");
        setStatus(`Exported ${rec?.name || vmPath}.`, "ok");
      } catch (error) {
        setStatus(`Export failed: ${error.message}`, "err");
      }
    }

    if (action === "remove") {
      await idbDelete(vmPath);
      filesManifest.delete(vmPath);
      renderRows();
      setStatus(`Removed ${vmPath} from saved list.`, "ok");
    }
  });
}
