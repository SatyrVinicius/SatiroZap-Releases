import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocketPkg, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';

// Handle CommonJS / ESM default export differences
const makeWASocket = makeWASocketPkg.default || makeWASocketPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_DIR = path.join(__dirname, '..', 'data', 'auth');

// Ensure auth dir exists
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

class WhatsAppManager {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrDataUrl = null;
    this.user = null;
    this.logger = pino({ level: 'silent' });
    this.connectionAttempts = 0;
    this.initPromise = null;
  }

  /**
   * Initializes the WhatsApp Multi-Device connection
   */
  async init() {
    if (this.status === 'connected' && this.sock) {
      return;
    }

    try {
      this.status = 'connecting';
      this.qrDataUrl = null;

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version, isLatest } = await fetchLatestBaileysVersion();

      console.log(`[WhatsApp] Starting connection with Baileys v${version.join('.')}`);

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: this.logger,
        printQRInTerminal: false,
        browser: ['WhatsApp Scheduler', 'Chrome', '1.0.0'],
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

          if (shouldReconnect) {
            this.connectionAttempts++;
            const delay = Math.min(10000, this.connectionAttempts * 2000);
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
        }
      });
    } catch (err) {
      console.error('[WhatsApp] Initialization error:', err);
      this.status = 'disconnected';
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
   * Sends a WhatsApp message automatically
   */
  async sendMessage(phone, messageText) {
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
    } catch (e) {}

    this.clearAuth();
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.user = null;

    // Restart connection to generate a fresh QR code
    setTimeout(() => this.init(), 1000);
    return true;
  }

  clearAuth() {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        const files = fs.readdirSync(AUTH_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(AUTH_DIR, file));
        }
      }
    } catch (err) {
      console.error('[WhatsApp] Error clearing auth keys:', err);
    }
  }
}

export const WhatsAppClient = new WhatsAppManager();
