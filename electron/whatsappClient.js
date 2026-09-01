/**
 * WhatsApp Multi-Device Client for Electron Main Process
 * Uses Baileys for direct WhatsApp Web protocol communication.
 * Adapted from server/whatsappClient.js for the Electron environment.
 */

const path = require('path');
const fs = require('fs');

let makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion;
let QRCode;
let pino;

// Dynamic imports for ESM modules
async function loadDependencies() {
  const baileysPkg = await import('@whiskeysockets/baileys');
  makeWASocket = baileysPkg.default?.default || baileysPkg.default || baileysPkg.makeWASocket;
  DisconnectReason = baileysPkg.DisconnectReason;
  useMultiFileAuthState = baileysPkg.useMultiFileAuthState;
  fetchLatestBaileysVersion = baileysPkg.fetchLatestBaileysVersion;

  QRCode = (await import('qrcode')).default || (await import('qrcode'));
  pino = (await import('pino')).default || (await import('pino'));
}

class WhatsAppManager {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrDataUrl = null;
    this.user = null;
    this.logger = null;
    this.connectionAttempts = 0;
    this.authDir = null;
    this.mainWindow = null; // Reference to BrowserWindow for IPC push
    this.dependenciesLoaded = false;
  }

  /**
   * Set the BrowserWindow reference for pushing IPC events to the renderer
   */
  setMainWindow(win) {
    this.mainWindow = win;
  }

  /**
   * Push status update to renderer via IPC
   */
  pushStatusToRenderer() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('whatsapp:status-update', this.getStatus());
      } catch (e) {
        // Window might be closing
      }
    }
  }

  /**
   * Initializes the WhatsApp Multi-Device connection
   * @param {string} userDataPath - app.getPath('userData')
   */
  async init(userDataPath) {
    if (this.status === 'connected' && this.sock) {
      return;
    }

    // Load ESM dependencies on first call
    if (!this.dependenciesLoaded) {
      await loadDependencies();
      this.logger = pino({ level: 'silent' });
      this.dependenciesLoaded = true;
    }

    // Set up auth directory
    if (userDataPath && !this.authDir) {
      this.authDir = path.join(userDataPath, 'whatsapp-auth');
      if (!fs.existsSync(this.authDir)) {
        fs.mkdirSync(this.authDir, { recursive: true });
      }
    }

    if (!this.authDir) {
      console.error('[WhatsApp] No auth directory configured');
      return;
    }

    try {
      this.status = 'connecting';
      this.qrDataUrl = null;
      this.pushStatusToRenderer();

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      console.log(`[WhatsApp] Starting connection with Baileys v${version.join('.')}`);

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: this.logger,
        printQRInTerminal: false,
        browser: ['WhatsApp Scheduler Desktop', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: false,
        generateHighQualityLinkPreview: true
      });

      // Save credentials whenever updated
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 300,
              color: {
                dark: '#111B21',
                light: '#FFFFFF'
              }
            });
            this.status = 'qr_ready';
            console.log('[WhatsApp] QR code generated and ready for scanning');
            this.pushStatusToRenderer();
          } catch (qrErr) {
            console.error('[WhatsApp] Failed to generate QR data URL:', qrErr);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[WhatsApp] Connection closed. Reason: ${statusCode}, reconnecting: ${shouldReconnect}`);

          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.user = null;
          this.pushStatusToRenderer();

          if (shouldReconnect) {
            this.connectionAttempts++;
            const delay = Math.min(30000, this.connectionAttempts * 3000);
            console.log(`[WhatsApp] Reconnecting in ${delay / 1000}s (attempt ${this.connectionAttempts})...`);
            this.status = 'reconnecting';
            this.pushStatusToRenderer();
            setTimeout(() => this.init(), delay);
          } else {
            console.log('[WhatsApp] Logged out from WhatsApp on phone. Clearing auth keys.');
            this.clearAuth();
          }
        } else if (connection === 'open') {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.connectionAttempts = 0;

          const rawId = this.sock.user?.id || '';
          const phone = rawId.split(':')[0] || rawId.split('@')[0];
          const name = this.sock.user?.name || 'WhatsApp Account';

          this.user = { phone, name };
          console.log(`[WhatsApp] Successfully connected as ${name} (+${phone})`);
          this.pushStatusToRenderer();
        }
      });
    } catch (err) {
      console.error('[WhatsApp] Initialization error:', err);
      this.status = 'disconnected';
      this.pushStatusToRenderer();
    }
  }

  /**
   * Returns current connection status and QR code
   */
  getStatus() {
    return {
      status: this.status,
      qrDataUrl: this.qrDataUrl,
      user: this.user,
      isConnected: this.status === 'connected'
    };
  }

  /**
   * Sends a WhatsApp message automatically via the Baileys socket
   */
  async sendMessage(phone, messageText) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp is not connected. Please scan the QR code to link your account.');
    }

    const cleanPhone = phone.replace(/[^\d]/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error(`Invalid phone number: ${phone}`);
    }

    const jid = `${cleanPhone}@s.whatsapp.net`;

    try {
      console.log(`[WhatsApp] Sending message to ${cleanPhone}...`);

      const sent = await this.sock.sendMessage(jid, {
        text: messageText
      });

      const messageId = sent?.key?.id || `msg_${Date.now()}`;
      console.log(`[WhatsApp] Message successfully sent to ${cleanPhone}! ID: ${messageId}`);

      return {
        success: true,
        messageId: messageId,
        sentAt: new Date().toISOString()
      };
    } catch (err) {
      console.error(`[WhatsApp] Failed to send message to ${cleanPhone}:`, err);
      throw new Error(err.message || 'Failed to send WhatsApp message');
    }
  }

  /**
   * Unlinks account and removes stored keys
   */
  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {
      // Ignore logout errors
    }

    this.clearAuth();
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.user = null;
    this.pushStatusToRenderer();

    // Restart connection to generate a fresh QR code
    setTimeout(() => this.init(), 1000);
    return true;
  }

  /**
   * Clear stored authentication keys
   */
  clearAuth() {
    try {
      if (this.authDir && fs.existsSync(this.authDir)) {
        const files = fs.readdirSync(this.authDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.authDir, file));
        }
      }
    } catch (err) {
      console.error('[WhatsApp] Error clearing auth keys:', err);
    }
  }

  /**
   * Graceful shutdown
   */
  async destroy() {
    try {
      if (this.sock) {
        this.sock.ev.removeAllListeners();
        await this.sock.end();
      }
    } catch (e) {
      // Ignore cleanup errors
    }
    this.sock = null;
    this.status = 'disconnected';
  }
}

const whatsappClient = new WhatsAppManager();

module.exports = { whatsappClient };
