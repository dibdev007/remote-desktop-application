// This is the complete main.js file with the fullscreen toggle logic.
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const robot = require('robotjs');
const fs = require('fs');

let screen;
const logFilePath = path.join(app.getPath('userData'), 'session_log.txt');

// --- NEW: A global variable to hold our main window instance ---
let win;

function logAction(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFilePath, logEntry);
}

function createWindow() {
  const { screen: electronScreen } = require('electron');
  screen = electronScreen.getPrimaryDisplay().workAreaSize;
  
  // Assign the created window to our global 'win' variable
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
  win.webContents.openDevTools();
}

ipcMain.handle('get-screen-sources', async () => {
  return await desktopCapturer.getSources({ types: ['screen'] });
});

ipcMain.on('log-action', (event, message) => { logAction(message); });

// --- NEW: IPC handler for toggling fullscreen ---
ipcMain.on('toggle-fullscreen', () => {
  if (win) { // Make sure the window exists
    // setFullScreen is a built-in Electron function.
    // It takes a boolean: true for fullscreen, false to exit.
    win.setFullScreen(!win.isFullScreen());
  }
});

// The remote control handler is unchanged.
ipcMain.on('remote-control', (event, data) => {
  if (!screen) return;
  const { type, x, y, key, modifiers } = data;
  if (type === 'keydown' || type === 'keyup') {
    const mods = new Set(modifiers.map(m => m === 'meta' ? 'command' : m));
    if ((mods.has('control') && mods.has('alt') && key === 'delete') || (mods.has('command') && key === 'l') || (mods.has('alt') && key === 'f4')) {
      logAction(`BLOCKED dangerous key combination: ${[...mods].join('+')}+${key}`);
      return;
    }
  }
  switch (type) {
    case 'mousemove': robot.moveMouse(Math.round(x * screen.width), Math.round(y * screen.height)); break;
    case 'mousedown': if (x !== undefined && y !== undefined) logAction(`Mouse down at (${x.toFixed(2)}, ${y.toFixed(2)})`); robot.mouseToggle('down'); break;
    case 'mouseup': if (x !== undefined && y !== undefined) logAction(`Mouse up at (${x.toFixed(2)}, ${y.toFixed(2)})`); robot.mouseToggle('up'); break;
    case 'keydown': logAction(`Key down: ${key} with modifiers: [${modifiers.join(', ')}]`); robot.keyToggle(key, 'down', modifiers); break;
    case 'keyup': logAction(`Key up: ${key} with modifiers: [${modifiers.join(', ')}]`); robot.keyToggle(key, 'up', modifiers); break;
  }
});

app.whenReady().then(() => { logAction('--- Application Started ---'); createWindow(); });
app.on('window-all-closed', () => { logAction('--- Application Closed ---'); if (process.platform !== 'darwin') { app.quit(); } });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); } });

