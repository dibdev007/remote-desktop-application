// This is the final main.js file with secure logging and permission restrictions.
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const robot = require('robotjs');
const fs = require('fs');

let screen;
const logFilePath = path.join(app.getPath('userData'), 'session_log.txt');

function logAction(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFilePath, logEntry);
}

function createWindow() {
  const { screen: electronScreen } = require('electron');
  screen = electronScreen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
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

ipcMain.on('log-action', (event, message) => {
    logAction(message);
});

// --- UPDATED: The Gatekeeper Logic is here ---
ipcMain.on('remote-control', (event, data) => {
  if (!screen) return;

  const { type, x, y, key, modifiers } = data;

  // --- GATEKEEPER CHECK FOR KEYBOARD EVENTS ---
  if (type === 'keydown' || type === 'keyup') {
    // Normalize modifiers for consistent checking (e.g., handle both 'meta' and 'command')
    const mods = new Set(modifiers.map(m => m === 'meta' ? 'command' : m));
    
    // Block Ctrl+Alt+Delete
    if (mods.has('control') && mods.has('alt') && key === 'delete') {
      logAction(`BLOCKED dangerous key combination: control+alt+delete`);
      return; // Stop processing this event
    }

    // Block Windows Key + L (for locking screen)
    // Note: robotjs uses 'command' for the Windows key
    if (mods.has('command') && key === 'l') {
      logAction(`BLOCKED dangerous key combination: win+l`);
      return;
    }
    
    // Block Alt+F4 (for closing applications)
    if (mods.has('alt') && key === 'f4') {
        logAction(`BLOCKED dangerous key combination: alt+f4`);
        return;
    }
  }
  // --- END OF GATEKEEPER CHECK ---


  // If the command was not blocked, execute it.
  switch (type) {
    case 'mousemove':
      robot.moveMouse(Math.round(x * screen.width), Math.round(y * screen.height));
      break;
    case 'mousedown':
      logAction(`Mouse down at (${x.toFixed(2)}, ${y.toFixed(2)})`);
      robot.mouseToggle('down');
      break;
    case 'mouseup':
      logAction(`Mouse up at (${x.toFixed(2)}, ${y.toFixed(2)})`);
      robot.mouseToggle('up');
      break;
    case 'keydown':
      logAction(`Key down: ${key} with modifiers: [${modifiers.join(', ')}]`);
      robot.keyToggle(key, 'down', modifiers);
      break;
    case 'keyup':
      logAction(`Key up: ${key} with modifiers: [${modifiers.join(', ')}]`);
      robot.keyToggle(key, 'up', modifiers);
      break;
  }
});

app.whenReady().then(() => {
    logAction('--- Application Started ---');
    createWindow();
});

app.on('window-all-closed', () => {
  logAction('--- Application Closed ---');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
