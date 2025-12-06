import { join } from "path";

const [dir, portStr] = process.argv.slice(2);

if (!dir || !portStr) {
  console.error("Usage: bun static-server.ts <directory> <port>");
  process.exit(1);
}

const port = parseInt(portStr, 10);
const baseDir = dir;

console.log(`Starting static server for ${baseDir} on port ${port}`);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let filePath = url.pathname;

    // Default to index.html for root
    if (filePath === "/" || filePath === "") {
      filePath = "/index.html";
    }

    let fullPath = join(baseDir, filePath);
    let file = Bun.file(fullPath);

    // Try to serve file
    if (await file.exists()) {
      return new Response(file);
    }

    // SPA Fallback: Serve index.html if file not found (and does not look like api/asset)
    // Simple heuristic: if it doesn't have an extension, try index.html?
    // Or simpler: Just Always try index.html if 404?
    // Standard SPA fallback:
    if (!filePath.startsWith("/api") && !filePath.includes(".")) {
      // Try index.html
      const index = Bun.file(join(baseDir, "index.html"));
      if (await index.exists()) {
        return new Response(index);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});
