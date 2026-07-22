import { describe, it } from "node:test";
import assert from "node:assert/strict";

function safeName(name) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

function humanSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
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

describe("safeName", () => {
  it("replaces special characters with underscores", () => {
    assert.equal(safeName("hello world"), "hello world");
    assert.equal(safeName("file@name!"), "file_name_");
    assert.equal(safeName("path/to/file"), "path_to_file");
  });

  it("preserves dots, dashes, parens, spaces", () => {
    assert.equal(safeName("file-name (1).js"), "file-name (1).js");
  });

  it("handles empty string", () => {
    assert.equal(safeName(""), "");
  });
});

describe("humanSize", () => {
  it("formats bytes", () => {
    assert.equal(humanSize(0), "0 B");
    assert.equal(humanSize(512), "512 B");
    assert.equal(humanSize(1023), "1023 B");
  });

  it("formats kilobytes", () => {
    assert.equal(humanSize(1024), "1.0 KB");
    assert.equal(humanSize(1536), "1.5 KB");
  });

  it("formats megabytes", () => {
    assert.equal(humanSize(1048576), "1.00 MB");
    assert.equal(humanSize(5242880), "5.00 MB");
  });
});

describe("parseGitHubRepoInput", () => {
  it("parses full URL", () => {
    const r = parseGitHubRepoInput("https://github.com/owner/repo");
    assert.equal(r.owner, "owner");
    assert.equal(r.repo, "repo");
    assert.equal(r.branch, "main");
  });

  it("parses URL with branch", () => {
    const r = parseGitHubRepoInput("https://github.com/owner/repo/tree/dev");
    assert.equal(r.branch, "dev");
  });

  it("strips .git suffix", () => {
    const r = parseGitHubRepoInput("https://github.com/owner/repo.git");
    assert.equal(r.repo, "repo");
  });

  it("normalizes bare input", () => {
    const r = parseGitHubRepoInput("github.com/owner/repo");
    assert.equal(r.owner, "owner");
    assert.equal(r.repo, "repo");
  });

  it("throws on empty input", () => {
    assert.throws(() => parseGitHubRepoInput(""), /Enter a GitHub repo URL/);
  });

  it("throws on non-github URL", () => {
    assert.throws(() => parseGitHubRepoInput("https://gitlab.com/owner/repo"), /Only github.com/);
  });

  it("throws on missing repo", () => {
    assert.throws(() => parseGitHubRepoInput("https://github.com/owner"), /Expected URL format/);
  });
});
