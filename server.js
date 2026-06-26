const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = __dirname;
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const maxBodyBytes = 64 * 1024;

let sharedStatus = {
  updatedAt: null,
  recordMode: "Idle",
  monitor: "Waiting",
  countdown: "00:00",
  currentTrack: "Waiting for status."
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/status" && req.method === "GET") {
    sendJson(res, 200, sharedStatus);
    return;
  }

  if (url.pathname === "/api/status" && req.method === "POST") {
    readBody(req, maxBodyBytes)
      .then(body => {
        const next = JSON.parse(body || "{}");
        sharedStatus = sanitizeStatus(next);
        sendJson(res, 200, { ok: true });
      })
      .catch(error => sendJson(res, error.statusCode || 400, { ok: false, error: error.message }));
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      statusApi: true,
      updatedAt: sharedStatus.updatedAt,
      urls: getLanUrls()
    });
    return;
  }

  serveStatic(url.pathname, res);
});

server.listen(port, host, () => {
  console.log(`Cassette Optimizer server listening on http://127.0.0.1:${port}/`);
  for (const url of getLanUrls()) console.log(`LAN: ${url}`);
});

function serveStatic(requestPath, res) {
  const decoded = decodeURIComponent(requestPath);
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.resolve(root, `.${normalized}`);
  if (!filePath.startsWith(root)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      // Fall back to <path>/index.html for directory-style routes (e.g. /callback)
      const indexPath = path.resolve(filePath, "index.html");
      if (indexPath.startsWith(root) && indexPath !== filePath) {
        fs.readFile(indexPath, (err2, data2) => {
          if (err2) {
            sendText(res, 404, "Not found");
            return;
          }
          res.writeHead(200, {
            "Content-Type": mimeTypes[".html"],
            "Cache-Control": "no-store"
          });
          res.end(data2);
        });
        return;
      }
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      size += Buffer.byteLength(chunk);
      if (size > limit) {
        const error = new Error("Status payload too large");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sanitizeStatus(input) {
  const allowed = [
    "updatedAt",
    "playlistName",
    "playlistId",
    "tapeMinutes",
    "totalTime",
    "trackCount",
    "splitPoint",
    "recordMode",
    "activeSide",
    "monitor",
    "countdown",
    "countdownLabel",
    "finishTime",
    "currentTrack",
    "playProgress",
    "tapeProgress",
    "sideATime",
    "sideBTime",
    "sideAFill",
    "sideBFill",
    "flip",
    "cue",
    "lastLog"
  ];
  const output = {};
  for (const key of allowed) {
    if (!(key in input)) continue;
    if (key === "lastLog" && Array.isArray(input[key])) {
      output[key] = input[key].slice(0, 12).map(value => String(value).slice(0, 300));
    } else if (typeof input[key] === "boolean" || typeof input[key] === "number") {
      output[key] = input[key];
    } else {
      output[key] = String(input[key] ?? "").slice(0, 500);
    }
  }
  output.updatedAt = new Date().toISOString();
  return output;
}

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value));
}

function sendText(res, statusCode, value) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(value);
}

function getLanUrls() {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/`);
      }
    }
  }
  return urls;
}
