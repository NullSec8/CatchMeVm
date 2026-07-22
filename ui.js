import { state } from "./state.js";

let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
}

export function toast(message, level = "info") {
  ensureToastContainer();
  const el = document.createElement("div");
  el.className = `toast ${level}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function setStatus(message, level = "info") {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = message;
  el.className = `status ${level === "info" ? "" : level}`.trim();
}

export function showBootSkeleton() {
  const skeleton = document.getElementById("bootSkeleton");
  const screen = document.getElementById("screen_container");
  if (skeleton) skeleton.classList.remove("hidden");
  if (screen) screen.style.opacity = "0";
}

export function hideBootSkeleton() {
  const skeleton = document.getElementById("bootSkeleton");
  const screen = document.getElementById("screen_container");
  if (skeleton) skeleton.classList.add("hidden");
  if (screen) screen.style.opacity = "1";
}

export function setBootStep(step, stepState) {
  const el = document.getElementById(`bootStep${step}`);
  if (!el) return;
  el.classList.remove("active", "done");
  if (stepState === "active") el.classList.add("active");
  if (stepState === "done") el.classList.add("done");
}

export function initBootProgress(show) {
  const bootProgressEl = document.getElementById("bootProgress");
  if (bootProgressEl) {
    bootProgressEl.style.display = show ? "flex" : "none";
    if (show) setBootStep(1, "active");
  }
}

export function bindSidebarToggle() {
  const sidebar = document.querySelector(".sidebar");
  const toggle = document.getElementById("sidebarToggle");
  if (!sidebar || !toggle) return;
  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    toggle.textContent = sidebar.classList.contains("collapsed") ? "\u25C0" : "\u25B6";
  });
}

export function bindModal(modalId, openBtnId, closeBtnId) {
  const modal = document.getElementById(modalId);
  const openBtn = document.getElementById(openBtnId);
  const closeBtn = document.getElementById(closeBtnId);
  if (!modal) return;
  if (openBtn) openBtn.addEventListener("click", () => modal.classList.add("open"));
  if (closeBtn) closeBtn.addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });
}

function isInEditableField() {
  const el = document.activeElement;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function sendUtf8ToSerial(bytes) {
  const emu = state.emulator;
  if (!emu || typeof emu.serial0_send !== "function") return;
  for (let i = 0; i < bytes.length; i++) {
    emu.serial0_send(String.fromCharCode(bytes[i]));
  }
}

function sendSerialPaste(text) {
  const emu = state.emulator;
  if (!emu || typeof emu.serial0_send !== "function") return;
  const lines = text.split(/\r?\n/);
  let idx = 0;
  function sendNextLine() {
    if (idx >= lines.length) return;
    const line = lines[idx];
    const addNewline = idx < lines.length - 1 || (idx === lines.length - 1 && line === "" && text.endsWith("\n"));
    const chunk = addNewline ? line + "\n" : line;
    if (chunk) {
      sendUtf8ToSerial(new TextEncoder().encode(chunk));
    }
    idx++;
    if (idx < lines.length) setTimeout(sendNextLine, 25);
  }
  sendNextLine();
}

function sendPasteToVm(text) {
  const emu = state.emulator;
  if (!emu) return false;
  if (typeof emu.keyboard_send_text === "function") {
    emu.keyboard_send_text(text, 3);
    return true;
  }
  if (typeof emu.serial0_send === "function") {
    sendSerialPaste(text);
    return true;
  }
  return false;
}

function handlePaste(text) {
  const serialConsole = document.getElementById("serial_console");
  const isSerialFocused = serialConsole && document.activeElement === serialConsole;
  if (isSerialFocused) {
    sendSerialPaste(text);
    return true;
  }
  return sendPasteToVm(text);
}

function doPaste() {
  if (!state.emulator) {
    setStatus("VM not running.", "warn");
    return;
  }
  navigator.clipboard.readText().then(
    (text) => {
      if (text && handlePaste(text)) setStatus("Pasted to VM.", "ok");
      else setStatus("Nothing to paste.", "warn");
    },
    () => setStatus("Paste failed. Allow clipboard access.", "warn")
  );
}

export function bindPaste() {
  const pasteBtn = document.getElementById("pasteBtn");
  if (pasteBtn) pasteBtn.addEventListener("click", doPaste);

  document.addEventListener(
    "keydown",
    (e) => {
      const isPaste = (e.ctrlKey || e.metaKey) && e.key === "v";
      if (!isPaste || isInEditableField()) return;
      if (!state.emulator) return;
      e.preventDefault();
      doPaste();
    },
    true
  );

  document.addEventListener(
    "paste",
    (e) => {
      const serialInput = document.getElementById("serial_input");
      if (document.activeElement === serialInput) return;
      if (isInEditableField()) return;
      if (!state.emulator) return;
      const text = e.clipboardData?.getData?.("text/plain");
      if (text && handlePaste(text)) {
        e.preventDefault();
        setStatus("Pasted to VM.", "ok");
      }
    },
    true
  );
}

export function bindCopySerial() {
  const copySerialBtn = document.getElementById("copySerialBtn");
  if (!copySerialBtn) return;
  copySerialBtn.addEventListener("click", () => {
    const serialConsole = document.getElementById("serial_console");
    const sel = window.getSelection();
    const selected = sel && sel.toString();
    let text =
      selected && selected.length > 0
        ? selected
        : (serialConsole?.textContent || "").replace(/\s*\[serial\]\s*waiting[^\n]*/i, "").trim();
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
