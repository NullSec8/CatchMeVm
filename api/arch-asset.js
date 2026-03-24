/**
 * Proxies upstream v86 Arch profile assets from i.copy.sh.
 * Supports Range requests for chunked loading.
 */
const BASE = "https://i.copy.sh/";

function sanitizePath(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.includes("..")) return "";
  if (value.startsWith("/")) return "";
  if (!/^[-_./a-zA-Z0-9]+$/.test(value)) return "";
  return value;
}

export default async function handler(req, res) {
  const path = sanitizePath(req.query.path);
  if (!path) {
    res.status(400).json({ error: "Missing or invalid path" });
    return;
  }

  const url = `${BASE}${path}`;
  const headers = { "Cache-Control": "public, max-age=3600" };
  if (req.headers.range) headers.Range = req.headers.range;

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        ...headers,
        "X-Accept-Encoding": "identity",
        Accept: "*/*",
        "User-Agent": "CatchMeVM-arch-asset-proxy/1",
      },
    });

    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("Accept-Ranges", "bytes");

    if (req.method === "HEAD") {
      res.status(upstream.status).end();
      return;
    }

    res.status(upstream.status);
    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("Arch asset proxy error:", err);
    res.status(502).json({ error: "Arch asset fetch failed" });
  }
}
