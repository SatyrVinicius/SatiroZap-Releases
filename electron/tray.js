/**
 * System Tray Integration for Electron
 * Provides minimize-to-tray, context menu, and background operation.
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { scheduler } = require('./scheduler');
const { whatsappClient } = require('./whatsappWebClient');

let tray = null;

/**
 * Create the system tray icon and context menu
 * @param {BrowserWindow} mainWindow - The main application window
 */
function createTray(mainWindow) {
  // Load tray icon
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'pms-satiro.ico');
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Fallback: create a simple 16x16 icon
      trayIcon = nativeImage.createEmpty();
    }
    // Resize for tray (16x16 on Windows)
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch (e) {
    console.warn('[Tray] Could not load tray icon, using empty:', e);
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Agendador WhatsApp — Em execução em segundo plano');

  // Double-click on tray icon → show/focus window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Build and set context menu
  updateTrayMenu(mainWindow);

  return tray;
}

/**
 * Update the tray context menu to reflect current state
 */
function updateTrayMenu(mainWindow) {
  if (!tray) return;

  const schedulerStatus = scheduler.getStatus();
  const waStatus = whatsappClient.getStatus();

  // WhatsApp status label
  let waLabel = '⚠ WhatsApp: desconectado';
  if (waStatus.status === 'connected') {
    const phone = waStatus.user?.phone ? `+${waStatus.user.phone}` : '';
    waLabel = `✓ WhatsApp: conectado ${phone}`;
  } else if (waStatus.status === 'connecting' || waStatus.status === 'reconnecting') {
    waLabel = '↻ WhatsApp: reconectando...';
  } else if (waStatus.status === 'qr_ready') {
    waLabel = '● WhatsApp: escaneie o código QR';
  }

  // Scheduler status label
  let schedulerLabel = schedulerStatus.isPaused
    ? '⏸ Agendador: pausado'
    : '▶ Agendador: ativo';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Agendador WhatsApp',
      type: 'normal',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: schedulerLabel,
      enabled: false
    },
    {
      label: schedulerStatus.isPaused ? 'Retomar agendador' : 'Pausar agendador',
      type: 'normal',
      click: () => {
        if (schedulerStatus.isPaused) {
          scheduler.resume();
        } else {
          scheduler.pause();
        }
        // Refresh the menu after state change
        setTimeout(() => updateTrayMenu(mainWindow), 100);
      }
    },
    { type: 'separator' },
    {
      label: waLabel,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Sair',
      type: 'normal',
      click: () => {
        // Set a flag so the close handler knows to actually quit
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Destroy the tray icon
 */
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Start periodic tray menu refresh (updates WhatsApp status display)
 */
function startTrayUpdater(mainWindow) {
  // Refresh tray menu every 10 seconds to reflect connection changes
  setInterval(() => {
    updateTrayMenu(mainWindow);
  }, 10000);
}

module.exports = {
  createTray,
  updateTrayMenu,
  destroyTray,
  startTrayUpdater
};
