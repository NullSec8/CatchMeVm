export function safeName(name) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

export function humanSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getUploadDir() {
  return "/tmp";
}

export function vmPathFromName(name, mode = "terminal") {
  const dir = getUploadDir();
  const base = safeName(name);
  return dir === "/" ? `/${base}` : `${dir}/${base}`;
}

export function parseGitHubRepoInput(input) {
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
