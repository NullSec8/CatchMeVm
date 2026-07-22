import { state, AUTO_SNAPSHOT_ID, DISTRO_TINYCORE, PREF_FAST_START } from "./state.js";
import { idbSnapshotPut, idbSnapshotGetAll, idbSnapshotGet, idbSnapshotDelete } from "./idb.js";

export function isFastStartEnabled() {
  try {
    const v = localStorage.getItem(PREF_FAST_START);
    return v === null ? true : String(v) !== "0";
  } catch {
    return true;
  }
}

export async function saveAutoSnapshot(emulator, distro) {
  if (!isFastStartEnabled()) return;
  if (localStorage.getItem("catchmevm.autoSnapshotSaved") === "1") return;
  try {
    const stateBuf = await emulator.save_state();
    if (stateBuf && stateBuf instanceof ArrayBuffer) {
      await idbSnapshotPut({
        id: AUTO_SNAPSHOT_ID,
        name: "Auto fast-start",
        state: stateBuf,
        distro,
        mode: state.mode,
        createdAt: Date.now(),
      });
      localStorage.setItem("catchmevm.autoSnapshotSaved", "1");
    }
  } catch (e) {
    console.warn("Auto snapshot save failed:", e);
  }
}

export async function getAutoSnapshot() {
  try {
    if (!isFastStartEnabled()) return null;
    const snap = await idbSnapshotGet(AUTO_SNAPSHOT_ID);
    if (!snap || !snap.state) return null;
    if (snap.state instanceof ArrayBuffer) return snap.state;
    if (ArrayBuffer.isView(snap.state)) return snap.state.buffer;
    return null;
  } catch (e) {
    console.warn("getAutoSnapshot failed:", e);
    return null;
  }
}

function normalizeStateBuffer(state) {
  if (!state) return null;
  if (state instanceof ArrayBuffer) return state;
  if (ArrayBuffer.isView(state)) return state.buffer;
  try {
    return new Uint8Array(state).buffer;
  } catch {
    return null;
  }
}

export async function saveSnapshot(name) {
  const emu = state.emulator;
  if (!emu) throw new Error("VM is not running.");
  const stateBuf = await emu.save_state();
  if (!stateBuf || !(stateBuf instanceof ArrayBuffer)) {
    throw new Error("save_state did not return ArrayBuffer");
  }
  const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await idbSnapshotPut({
    id,
    name,
    state: stateBuf,
    distro: state.distro,
    mode: state.mode,
    createdAt: Date.now(),
  });
  return id;
}

export async function deleteSnapshot(id) {
  await idbSnapshotDelete(id);
}

export async function restoreSnapshot(id) {
  const snap = await idbSnapshotGet(id);
  if (!snap || !snap.state) throw new Error("Snapshot not found or invalid.");
  const stateBuffer = normalizeStateBuffer(snap.state);
  if (!stateBuffer) throw new Error("Snapshot state is invalid.");
  return {
    state: stateBuffer,
    distro: snap.distro || DISTRO_TINYCORE,
    mode: snap.mode || "gui",
  };
}

export async function renderSnapshotList() {
  const ul = document.getElementById("snapshotList");
  if (!ul) return;
  try {
    const snapshots = await idbSnapshotGetAll();
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
  } catch (err) {
    console.warn("Snapshot list failed:", err);
  }
}

export function bindSnapshotUi(setStatus, startVmFn) {
  const saveSnapshotBtn = document.getElementById("saveSnapshotBtn");
  const snapshotNameInput = document.getElementById("snapshotName");

  if (saveSnapshotBtn) {
    saveSnapshotBtn.addEventListener("click", async () => {
      if (!state.emulator) {
        setStatus("VM is not running.", "warn");
        return;
      }
      const name = (snapshotNameInput?.value || "").trim() || `Snapshot ${new Date().toLocaleString()}`;
      try {
        setStatus("Saving snapshot...");
        await saveSnapshot(name);
        if (snapshotNameInput) snapshotNameInput.value = "";
        await renderSnapshotList();
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
        try {
          setStatus("Restoring snapshot...");
          const snap = await restoreSnapshot(id);
          if (state.emulator && typeof state.emulator.destroy === "function") {
            try { await state.emulator.destroy(); } catch (_e) {}
          }
          await startVmFn({
            distro: snap.distro,
            mode: snap.mode,
            quality: Number(document.getElementById("qualitySelect")?.value || "1"),
            initialState: snap.state,
          });
        } catch (err) {
          setStatus(`Restore failed: ${err.message}`, "err");
        }
      }

      if (deleteBtn) {
        const id = deleteBtn.getAttribute("data-snapshot-delete");
        try {
          await deleteSnapshot(id);
          await renderSnapshotList();
          setStatus("Snapshot deleted.", "ok");
        } catch (err) {
          setStatus(`Delete failed: ${err.message}`, "err");
        }
      }
    });
  }

  renderSnapshotList();
}
