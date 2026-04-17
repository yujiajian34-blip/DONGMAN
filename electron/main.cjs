const { app, BrowserWindow, dialog } = require("electron");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

let mainWindow = null;
let nextServerProcess = null;
let isQuitting = false;

const DEFAULT_PORT = 3000;
const HOST = "127.0.0.1";

function isDev() {
  return !app.isPackaged;
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        resolve(findAvailablePort(startPort + 1));
        return;
      }
      reject(error);
    });

    server.listen(startPort, HOST, () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolve(address.port);
        } else {
          resolve(startPort);
        }
      });
    });
  });
}

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out while waiting for ${url}`));
          return;
        }

        setTimeout(attempt, 500);
      });
    };

    attempt();
  });
}

async function startStandaloneServer() {
  const port = await findAvailablePort(DEFAULT_PORT);
  const standaloneDir = path.join(app.getAppPath(), ".next", "standalone");
  const serverEntry = path.join(standaloneDir, "server.js");

  nextServerProcess = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: HOST,
      PORT: String(port),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  nextServerProcess.stdout.on("data", (chunk) => {
    process.stdout.write(`[next] ${chunk}`);
  });

  nextServerProcess.stderr.on("data", (chunk) => {
    process.stderr.write(`[next] ${chunk}`);
  });

  nextServerProcess.once("exit", (code) => {
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox(
        "MangaReplacer 启动失败",
        `内置服务提前退出，退出码：${code ?? "unknown"}。`,
      );
      app.quit();
    }
  });

  const url = `http://${HOST}:${port}`;
  await waitForServer(url);
  return url;
}

async function resolveAppUrl() {
  if (isDev()) {
    return process.env.ELECTRON_START_URL || `http://${HOST}:${DEFAULT_PORT}`;
  }

  return startStandaloneServer();
}

async function createWindow() {
  const appUrl = await resolveAppUrl();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#09090b",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(appUrl);
}

function stopStandaloneServer() {
  if (!nextServerProcess || nextServerProcess.killed) {
    return;
  }

  nextServerProcess.kill("SIGTERM");
  nextServerProcess = null;
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "MangaReplacer 启动失败",
      error instanceof Error ? error.message : "Unknown error",
    );
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopStandaloneServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
