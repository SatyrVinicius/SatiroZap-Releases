/**
 * Background Scheduler Service
 * Periodically evaluates scheduled messages and triggers notification dispatch
 */

import { Storage } from './storage.js';
import { NotificationService } from './notifications.js';
import { WhatsAppService } from './whatsapp.js';

export const Scheduler = {
  timerInterval: null,
  listeners: new Set(),

  /**
   * Start active background checking loop
   */
  start() {
    if (this.timerInterval) return;
    
    // Check immediately on startup
    this.checkDueMessages();

    // Check periodically every 3 seconds
    this.timerInterval = setInterval(() => {
      this.checkDueMessages();
    }, 3000);
  },

  /**
   * Stop background checking loop
   */
  stop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  },

  /**
   * Evaluates all messages against current time and user offset settings
   */
  checkDueMessages() {
    const messages = Storage.getMessages();
    const settings = Storage.getSettings();
    
    if (!settings.notificationsEnabled) return;

    const now = Date.now();
    const offsetMs = (settings.reminderOffsetMinutes || 0) * 60 * 1000;

    messages.forEach(msg => {
      if (msg.status === 'scheduled' && !msg.notified) {
        const scheduledTime = new Date(msg.scheduledDateTime).getTime();
        const triggerTime = scheduledTime - offsetMs;

        // If current time has reached or passed the trigger time
        if (now >= triggerTime) {
          // Mark as notified in storage so it only fires once
          Storage.updateMessage(msg.id, {
            notified: true,
            status: 'completed'
          });

          // Dispatch notification & sound
          NotificationService.dispatchScheduledNotification(msg, {
            onActionClick: () => {
              WhatsAppService.openWhatsApp(msg.recipientPhone, msg.message);
            }
          });

          // Notify state listeners
          this.emitChange();
        }
      }
    });
  },

  /**
   * Manually trigger a message immediately for testing / preview
   */
  triggerNow(messageId) {
    const msg = Storage.getMessageById(messageId);
    if (!msg) return;

    NotificationService.dispatchScheduledNotification(msg, {
      onActionClick: () => {
        WhatsAppService.openWhatsApp(msg.recipientPhone, msg.message);
      }
    });
  },

  /**
   * Subscribe to scheduler change events
   */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  emitChange() {
    this.listeners.forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }
};
