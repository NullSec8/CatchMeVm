/**
 * Proxies Arch Linux ISO downloads.
 * Helps when direct browser fetch to mirror is blocked by CORS/network policy.
 * Supports Range requests for v86 chunked loading.
 */
const DEFAULT_ARCH_ISO_URL =
  "https://archive.archlinux.org/iso/2025.02.01/archlinux-2025.02.01-x86_64.iso";

export default async function handler(req, res) {
  const isoUrl = process.env.CATCHMEVM_ARCH_ISO_URL || DEFAULT_ARCH_ISO_URL;

  const headers = { "Cache-Control": "public, max-age=3600" };
  if (req.headers.range) headers["Range"] = req.headers.range;

  try {
    const upstream = await fetch(isoUrl, {
      method: req.method,
      headers: { ...headers, "X-Accept-Encoding": "identity" },
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
    console.error("Arch ISO proxy error:", err);
    res.status(502).json({ error: "Arch ISO fetch failed" });
  }
}
