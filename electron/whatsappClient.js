/**
 * WhatsApp Multi-Device Client for Electron Main Process
 * Uses Baileys for direct WhatsApp Web protocol communication.
 * Adapted from server/whatsappClient.js for the Electron environment.
 */

const path = require('path');
const fs = require('fs');
const MAX_MEDIA_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024 * 1024;

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
    this.userDataPath = null;
    this.mainWindow = null; // Reference to BrowserWindow for IPC push
    this.dependenciesLoaded = false;
    this.syncedContacts = new Map();
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
    if (userDataPath) this.userDataPath = userDataPath;

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

      // Keep only contact data delivered by WhatsApp's history/contact sync events.
      this.sock.ev.on('messaging-history.set', ({ contacts = [] } = {}) => {
        this.cacheSyncedContacts(contacts);
      });
      this.sock.ev.on('contacts.upsert', (contacts = []) => {
        this.cacheSyncedContacts(contacts);
      });
      this.sock.ev.on('contacts.update', (contacts = []) => {
        this.cacheSyncedContacts(contacts);
      });
      this.sock.ev.on('chats.upsert', (chats = []) => {
        this.cacheSyncedContacts(chats);
      });
      this.sock.ev.on('chats.update', (chats = []) => {
        this.cacheSyncedContacts(chats);
      });
      this.sock.ev.on('chats.phoneNumberShare', ({ lid, jid } = {}) => {
        if (!lid || !jid) return;
        this.cacheSyncedContacts([{ id: lid, jid }]);
      });

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
          const name = this.sock.user?.name || 'Conta do WhatsApp';

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

  cacheSyncedContacts(contacts) {
    for (const contact of contacts) {
      if (!contact || typeof contact !== 'object') continue;
      const key = contact.id || contact.jid || contact.lid;
      if (!key) continue;

      const merged = { ...(this.syncedContacts.get(key) || {}) };
      for (const [field, value] of Object.entries(contact)) {
        if (value !== undefined && value !== null && value !== '') merged[field] = value;
      }
      this.syncedContacts.set(key, merged);
    }
  }

  getSyncedContacts() {
    const contactsByPhone = new Map();

    for (const contact of this.syncedContacts.values()) {
      const jid = [contact.jid, contact.id].find(value =>
        typeof value === 'string' && /@s\.whatsapp\.net$/.test(value)
      );
      if (!jid) continue;

      const localPart = jid.slice(0, jid.indexOf('@')).split(':')[0];
      if (!/^\d{7,15}$/.test(localPart)) continue;

      const name = [contact.name, contact.notify, contact.verifiedName, contact.pushName]
        .find(value => typeof value === 'string' && value.trim());
      const normalized = { name: (name || localPart).trim(), phone: localPart };
      const existing = contactsByPhone.get(localPart);
      if (!existing || (existing.name === localPart && normalized.name !== localPart)) {
        contactsByPhone.set(localPart, normalized);
      }
    }

    return [...contactsByPhone.values()];
  }

  async syncContacts() {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('Conecte o WhatsApp antes de sincronizar os contatos.');
    }

    await this.sock.resyncAppState(
      ['critical_block', 'critical_unblock_low', 'regular_high', 'regular_low', 'regular'],
      false
    );
    return this.getSyncedContacts();
  }

  /**
   * Sends a WhatsApp message automatically via the Baileys socket
   */
  async sendMessage(phone, messageText, attachment = null) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('O WhatsApp não está conectado. Escaneie o código QR para vincular sua conta.');
    }

    const cleanPhone = phone.replace(/[^\d]/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error(`Número de telefone inválido: ${phone}`);
    }

    const jid = `${cleanPhone}@s.whatsapp.net`;

    try {
      console.log(`[WhatsApp] Sending message to ${cleanPhone}...`);

      let sent;
      if (attachment?.attachmentId) {
        if (!/^[0-9a-f-]{36}$/i.test(attachment.attachmentId)) {
          throw new Error('Identificador de anexo inválido.');
        }

        const extension = path.extname(attachment.attachmentName || '').toLowerCase();
        const attachmentPath = path.join(this.userDataPath, 'attachments', `${attachment.attachmentId}${extension}`);
        const fileStats = fs.existsSync(attachmentPath) ? fs.statSync(attachmentPath) : null;
        if (!fileStats?.isFile()) throw new Error('O arquivo anexado não foi encontrado.');
        if (fileStats.size > MAX_ATTACHMENT_SIZE) throw new Error('O anexo excede o limite de 2 GB.');

        const attachmentKind = fileStats.size > MAX_MEDIA_ATTACHMENT_SIZE
          ? 'document'
          : attachment.attachmentKind;
        if (attachmentKind === 'image') {
          sent = await this.sock.sendMessage(jid, {
            image: { url: attachmentPath },
            mimetype: attachment.attachmentMimeType,
            ...(messageText ? { caption: messageText } : {})
          });
        } else if (attachmentKind === 'video') {
          sent = await this.sock.sendMessage(jid, {
            video: { url: attachmentPath },
            mimetype: attachment.attachmentMimeType,
            ...(messageText ? { caption: messageText } : {})
          });
        } else if (attachmentKind === 'audio') {
          sent = await this.sock.sendMessage(jid, {
            audio: { url: attachmentPath },
            mimetype: attachment.attachmentMimeType,
            ptt: false
          });
          if (messageText) await this.sock.sendMessage(jid, { text: messageText });
        } else if (attachmentKind === 'document') {
          sent = await this.sock.sendMessage(jid, {
            document: { url: attachmentPath },
            mimetype: attachment.attachmentMimeType,
            fileName: attachment.attachmentName,
            ...(messageText ? { caption: messageText } : {})
          });
        } else {
          throw new Error('Tipo de mídia não compatível.');
        }
      } else {
        sent = await this.sock.sendMessage(jid, { text: messageText });
      }

      const messageId = sent?.key?.id || `msg_${Date.now()}`;
      console.log(`[WhatsApp] Message successfully sent to ${cleanPhone}! ID: ${messageId}`);

      return {
        success: true,
        messageId: messageId,
        sentAt: new Date().toISOString()
      };
    } catch (err) {
      console.error(`[WhatsApp] Failed to send message to ${cleanPhone}:`, err);
      throw new Error(err.message || 'Falha ao enviar mensagem pelo WhatsApp.');
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
      this.syncedContacts.clear();
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
