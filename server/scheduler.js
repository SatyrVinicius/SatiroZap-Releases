import { Database } from './db.js';
import { WhatsAppClient } from './whatsappClient.js';

class ServerScheduler {
  constructor() {
    this.interval = null;
    this.isProcessing = false;
  }

  /**
   * Starts the 24/7 continuous scheduler loop
   */
  start() {
    if (this.interval) return;

    console.log('[Scheduler] 24/7 Continuous Scheduler running...');
    
    // Check immediately upon server startup
    this.checkDueMessages();

    // Active continuous ticker every 3 seconds
    this.interval = setInterval(() => {
      this.checkDueMessages();
    }, 3000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async checkDueMessages() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Always read fresh from persistent local disk
      const messages = Database.getMessages();
      const now = Date.now();

      for (const msg of messages) {
        if (msg.status === 'SCHEDULED') {
          const scheduledTime = new Date(msg.scheduledDateTime).getTime();

          // Check if scheduled time is due
          if (now >= scheduledTime) {
            console.log(`[Scheduler] Message ${msg.id} is due for ${msg.recipientName} (${msg.recipientPhone}). Dispatching...`);
            await this.processMessage(msg);
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error during scheduled check:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  async processMessage(msg) {
    // 1. Set status to SENDING
    Database.updateMessage(msg.id, {
      status: 'SENDING'
    });

    try {
      // 2. Dispatch via WhatsApp Multi-Device socket
      const result = await WhatsAppClient.sendMessage(msg.recipientPhone, msg.message);

      // Only mark as SENT if confirmed by WhatsApp socket
      if (result && result.success) {
        Database.updateMessage(msg.id, {
          status: 'SENT',
          sentAt: result.sentAt || new Date().toISOString(),
          whatsappMessageId: result.messageId,
          errorReason: null
        });
        console.log(`[Scheduler] Confirmed: Message ${msg.id} successfully sent at ${result.sentAt}`);
      } else {
        throw new Error('Did not receive positive delivery confirmation from WhatsApp');
      }
    } catch (err) {
      const errorMsg = err.message || 'WhatsApp sending failed';
      
      Database.updateMessage(msg.id, {
        status: 'FAILED',
        failedAt: new Date().toISOString(),
        errorReason: errorMsg
      });

      console.warn(`[Scheduler] Delivery failed for message ${msg.id}: ${errorMsg}`);
    }
  }

  async sendImmediately(messageId) {
    const msg = Database.getMessageById(messageId);
    if (!msg) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    await this.processMessage(msg);
    return Database.getMessageById(messageId);
  }
}

export const Scheduler = new ServerScheduler();
