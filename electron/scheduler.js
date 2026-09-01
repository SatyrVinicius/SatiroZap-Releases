/**
 * Background Scheduler for Electron Main Process
 * Runs in the main process, checking SQLite for due messages every 3 seconds.
 * Sends messages via WhatsApp and updates message status.
 * Pushes real-time updates to the renderer via IPC.
 */

const database = require('./database');
const { whatsappClient } = require('./whatsappClient');

class SchedulerService {
  constructor() {
    this.interval = null;
    this.isProcessing = false;
    this.isPaused = false;
    this.mainWindow = null;
  }

  /**
   * Set the BrowserWindow reference for IPC push updates
   */
  setMainWindow(win) {
    this.mainWindow = win;
  }

  /**
   * Push scheduler/message updates to renderer
   */
  pushUpdateToRenderer(eventType, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('scheduler:update', { eventType, data });
      } catch (e) {
        // Window might be closing
      }
    }
  }

  /**
   * Starts the 24/7 continuous scheduler loop
   */
  start() {
    if (this.interval) return;

    console.log('[Scheduler] 24/7 Background Scheduler started');

    // Check immediately on startup
    this.checkDueMessages();

    // Continuous check every 3 seconds
    this.interval = setInterval(() => {
      this.checkDueMessages();
    }, 3000);
  }

  /**
   * Stop the scheduler loop
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[Scheduler] Scheduler stopped');
  }

  /**
   * Pause the scheduler (stop processing but keep timer running)
   */
  pause() {
    this.isPaused = true;
    console.log('[Scheduler] Scheduler paused');
  }

  /**
   * Resume the scheduler
   */
  resume() {
    this.isPaused = false;
    console.log('[Scheduler] Scheduler resumed');
  }

  /**
   * Check for due messages and process them
   */
  async checkDueMessages() {
    if (this.isProcessing || this.isPaused) return;
    this.isProcessing = true;

    try {
      const messages = database.getScheduledMessages();
      const now = Date.now();

      for (const msg of messages) {
        const scheduledTime = new Date(msg.scheduledDateTime).getTime();

        if (now >= scheduledTime) {
          console.log(`[Scheduler] Message ${msg.id} is due for ${msg.recipientName} (${msg.recipientPhone}). Dispatching...`);
          await this.processMessage(msg);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error during scheduled check:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single message: SCHEDULED → SENDING → SENT/FAILED
   */
  async processMessage(msg) {
    // 1. Set status to SENDING
    database.updateMessage(msg.id, { status: 'SENDING' });
    this.pushUpdateToRenderer('message-status', { id: msg.id, status: 'SENDING' });

    try {
      // 2. Send via WhatsApp Baileys socket
      const result = await whatsappClient.sendMessage(msg.recipientPhone, msg.message);

      if (result && result.success) {
        // 3a. Mark as SENT
        const updated = database.updateMessage(msg.id, {
          status: 'SENT',
          sentAt: result.sentAt || new Date().toISOString(),
          whatsappMessageId: result.messageId,
          errorReason: null
        });

        console.log(`[Scheduler] ✓ Message ${msg.id} successfully sent at ${result.sentAt}`);
        this.pushUpdateToRenderer('message-sent', updated);

        // Send native OS notification
        this.sendNativeNotification(
          'Message Sent ✓',
          `Message to ${msg.recipientName} was sent successfully.`
        );
      } else {
        throw new Error('Did not receive positive delivery confirmation from WhatsApp');
      }
    } catch (err) {
      const errorMsg = err.message || 'WhatsApp sending failed';

      // 3b. Mark as FAILED
      const updated = database.updateMessage(msg.id, {
        status: 'FAILED',
        failedAt: new Date().toISOString(),
        errorReason: errorMsg
      });

      console.warn(`[Scheduler] ✗ Delivery failed for message ${msg.id}: ${errorMsg}`);
      this.pushUpdateToRenderer('message-failed', updated);

      // Send native OS notification for failure
      this.sendNativeNotification(
        'Message Failed ⚠',
        `Failed to send message to ${msg.recipientName}: ${errorMsg}`
      );
    }
  }

  /**
   * Send a message immediately (triggered by user action)
   */
  async sendImmediately(messageId) {
    const msg = database.getMessageById(messageId);
    if (!msg) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    await this.processMessage(msg);
    return database.getMessageById(messageId);
  }

  /**
   * Send a native OS notification via Electron
   */
  sendNativeNotification(title, body) {
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
          icon: undefined // Will use app icon
        });
        notification.show();
      }
    } catch (e) {
      console.warn('[Scheduler] Could not show native notification:', e);
    }
  }

  /**
   * Get scheduler status for the tray menu
   */
  getStatus() {
    return {
      isRunning: !!this.interval,
      isPaused: this.isPaused,
      isProcessing: this.isProcessing
    };
  }
}

const scheduler = new SchedulerService();

module.exports = { scheduler };
