/**
 * Electron Main Process Entry Point
 * Creates the native desktop window, registers IPC handlers,
 * starts WhatsApp client, scheduler, and system tray.
 */

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const database = require('./database');
const { whatsappClient } = require('./whatsappClient');
const { scheduler } = require('./scheduler');
const { createTray, startTrayUpdater, destroyTray } = require('./tray');

let mainWindow = null;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to open a second instance — focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'icon.png');
  let appIcon;
  try {
    appIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    appIcon = undefined;
  }

  mainWindow = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 400,
    minHeight: 600,
    icon: appIcon,
    title: 'WhatsApp Scheduler',
    show: false, // Show after ready-to-show to avoid flicker
    backgroundColor: '#0C1317',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for better-sqlite3 native addon
      devTools: !app.isPackaged
    }
  });

  // Load the application HTML
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // Show window when ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Remove the menu bar for a cleaner look
  mainWindow.setMenuBarVisibility(false);

  // ================================================================
  // Close → Minimize to Tray (don't quit)
  // ================================================================
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Pass window reference to WhatsApp client and scheduler for IPC push
  whatsappClient.setMainWindow(mainWindow);
  scheduler.setMainWindow(mainWindow);

  // Open DevTools in development
  if (!app.isPackaged) {
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

// ================================================================
// Register all IPC Handlers
// ================================================================
function registerIpcHandlers() {
  // --- WhatsApp ---
  ipcMain.handle('whatsapp:get-status', () => {
    return whatsappClient.getStatus();
  });

  ipcMain.handle('whatsapp:connect', async () => {
    await whatsappClient.init(app.getPath('userData'));
    return whatsappClient.getStatus();
  });

  ipcMain.handle('whatsapp:logout', async () => {
    await whatsappClient.logout();
    return { success: true, message: 'Logged out successfully' };
  });

  // --- Messages ---
  ipcMain.handle('messages:get-all', () => {
    return database.getMessages();
  });

  ipcMain.handle('messages:get-by-id', (_event, id) => {
    return database.getMessageById(id);
  });

  ipcMain.handle('messages:create', (_event, data) => {
    const { recipientName, recipientPhone, message, scheduledDateTime } = data;

    if (!recipientPhone) {
      throw new Error('Recipient phone number is required');
    }
    if (!message || !message.trim()) {
      throw new Error('Message content is required');
    }
    if (!scheduledDateTime) {
      throw new Error('Scheduled date and time is required');
    }

    return database.saveMessage({
      recipientName: recipientName || 'WhatsApp Contact',
      recipientPhone,
      message,
      scheduledDateTime,
      status: 'SCHEDULED'
    });
  });

  ipcMain.handle('messages:update', (_event, id, data) => {
    const updated = database.updateMessage(id, data);
    if (!updated) {
      throw new Error('Message not found');
    }
    return updated;
  });

  ipcMain.handle('messages:delete', (_event, id) => {
    return { success: database.deleteMessage(id) };
  });

  ipcMain.handle('messages:send-now', async (_event, id) => {
    const result = await scheduler.sendImmediately(id);
    return { success: true, message: result };
  });

  // --- Contacts ---
  ipcMain.handle('contacts:get-all', () => {
    return database.getContacts();
  });

  ipcMain.handle('contacts:add', (_event, contact) => {
    return database.addContact(contact);
  });

  // --- Settings ---
  ipcMain.handle('settings:get', () => {
    return database.getSettings();
  });

  ipcMain.handle('settings:update', (_event, data) => {
    return database.updateSettings(data);
  });

  // --- App Info ---
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });
}

// ================================================================
// Application Lifecycle
// ================================================================
app.whenReady().then(async () => {
  // 1. Initialize SQLite database
  await database.init(app.getPath('userData'));
  console.log(`[App] Database initialized at ${app.getPath('userData')}`);

  // 2. Register IPC handlers
  registerIpcHandlers();

  // 3. Create the main window
  createWindow();

  // 4. Create system tray
  createTray(mainWindow);
  startTrayUpdater(mainWindow);

  // 5. Start WhatsApp client (auto-connect if session exists)
  whatsappClient.init(app.getPath('userData'));

  // 6. Start the background scheduler
  scheduler.start();

  console.log('[App] WhatsApp Scheduler Desktop is running');
});

app.on('window-all-closed', () => {
  // On Windows, don't quit when all windows are closed (tray keeps running)
  // Only quit if app.isQuitting is true (set by tray Quit menu)
  if (app.isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window if dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;

  // Graceful shutdown
  scheduler.stop();
  await whatsappClient.destroy();
  database.close();
  destroyTray();

  console.log('[App] Graceful shutdown complete');
});
