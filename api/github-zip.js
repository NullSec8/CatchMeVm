/**
 * Proxies GitHub branch zip downloads for the VM importer.
 * This avoids browser CORS/network restrictions on direct codeload fetches.
 */
export default async function handler(req, res) {
  const owner = String(req.query.owner || "").trim();
  const repo = String(req.query.repo || "").trim().replace(/\.git$/i, "");
  const branch = String(req.query.branch || "main").trim();

  if (!owner || !repo) {
    res.status(400).json({ error: "Missing owner/repo query params" });
    return;
  }

  const zipUrl =
    `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/heads/${encodeURIComponent(branch)}`;

  try {
    const upstream = await fetch(zipUrl, {
      method: "GET",
      headers: {
        "Cache-Control": "no-cache",
        "X-Accept-Encoding": "identity",
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "Upstream GitHub fetch failed" });
      return;
    }

    const ct = upstream.headers.get("content-type") || "application/zip";
    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=300");

    res.status(200);
    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("GitHub zip proxy error:", err);
    res.status(502).json({ error: "GitHub zip fetch failed" });
  }
}
