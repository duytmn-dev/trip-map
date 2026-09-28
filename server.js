const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { databaseURL: defaultFirebaseDatabaseUrl } = require("./firebase-config.json");

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "key.md");

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
});

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": MIME_TYPES[".json"],
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function resolvePublicFile(urlPath) {
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const decodedPath = decodeURIComponent(requestedPath);
  const absolutePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  const relativePath = path.relative(PUBLIC_DIR, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? HOST}`);

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (url.pathname === "/runtime-config.js") {
    let googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
    if (!googleMapsApiKey) {
      try {
        googleMapsApiKey = (await fs.readFile(KEY_FILE, "utf8")).trim();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const config = {
      googleMapsApiKey,
      googleMapsMapId: process.env.GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID",
      firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL?.trim().replace(/\/$/, "") || defaultFirebaseDatabaseUrl,
    };
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[".js"],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(`window.ROAMLY_CONFIG = ${JSON.stringify(config)};`);
    return;
  }

  const filePath = resolvePublicFile(url.pathname);
  if (!filePath) {
    sendJson(response, 403, { error: "FORBIDDEN" });
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    response.end(file);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendJson(response, 404, { error: "NOT_FOUND" });
      return;
    }

    console.error({ error: error.message }, "Không thể phục vụ tệp tĩnh");
    sendJson(response, 500, { error: "INTERNAL_SERVER_ERROR" });
  }
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error({ port: process.env.PORT }, "Cổng máy chủ không hợp lệ");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error({ error: error.message }, "Lỗi xử lý yêu cầu");
    if (!response.headersSent) {
      sendJson(response, 500, { error: "INTERNAL_SERVER_ERROR" });
    } else {
      response.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.info({ host: HOST, port: PORT }, "Trip Map đã sẵn sàng");
  console.info({ url: `http://${HOST}:${PORT}` }, "Mở Trip Map trong trình duyệt");
});

function shutdown(signal) {
  console.info({ signal }, "Đang dừng Trip Map");
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
