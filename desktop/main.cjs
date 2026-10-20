// CodeCrafter Free desktop app: runs the local dashboard server in-process and shows it in a window.
// Tests still run from your terminal / VS Code with `ccfree test`; results appear here live.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server;

async function createWindow() {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server.mjs')).href);
  const started = await startServer({ port: Number(process.env.PORT || 4317) });
  server = started.server;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 500,
    title: 'CodeCrafter Free',
    backgroundColor: '#0b1016',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Open external links (docs, vscode:// links) in the system browser / VS Code.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(started.url)) { event.preventDefault(); shell.openExternal(url); }
  });
  await win.loadURL(started.url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  server?.close();
  app.quit();
});
