const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { exec } = require("node:child_process");

const root = path.dirname(process.execPath);
const host = "127.0.0.1";
const requestedPort = Number(process.env.PORT || 8787);
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

startServer(requestedPort);

function startServer(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/status" && req.method === "GET") {
      sendJson(res, 200, sharedStatus);
      return;
    }

    if (url.pathname === "/api/status" && req.method === "POST") {
      readBody(req, maxBodyBytes)
        .then(body => {
          let next;
          try {
            next = JSON.parse(body || "{}");
          } catch {
            sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
            return;
          }
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
        urls: [`http://${host}:${port}/`]
      });
      return;
    }

    serveStatic(url.pathname, res);
  });

  server.on("error", error => {
    if (error.code === "EADDRINUSE" && port === requestedPort) {
      openBrowser(`http://${host}:${port}/`);
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}/`;
    console.log(`Cassette Optimizer is running at ${url}`);
    console.log("Close this window to stop the app.");
    openBrowser(url);
  });
}

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
      const indexPath = path.resolve(filePath, "index.html");
      if (indexPath.startsWith(root) && indexPath !== filePath) {
        fs.readFile(indexPath, (err2, data2) => {
          if (err2) {
            sendText(res, 404, "Not found");
            return;
          }
          sendStatic(res, ".html", data2);
        });
        return;
      }
      sendText(res, 404, "Not found");
      return;
    }
    sendStatic(res, path.extname(filePath).toLowerCase(), data);
  });
}

function sendStatic(res, ext, data) {
  res.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  res.end(data);
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
    "currentTrack",
    "progress",
    "dryRun",
    "rateLimit",
    "flip",
    "log"
  ];
  const output = {};
  for (const key of allowed) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) output[key] = input[key];
  }
  output.updatedAt = new Date().toISOString();
  return output;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function openBrowser(url) {
  const escaped = url.replace(/"/g, "");
  if (process.platform === "win32") {
    exec(`start "" "${escaped}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${escaped}"`);
  } else {
    exec(`xdg-open "${escaped}"`);
  }
}
