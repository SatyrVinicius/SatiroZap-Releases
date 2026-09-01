/**
 * Application State Store — Electron IPC Version
 * Uses IPC event listeners for real-time push updates from the main process,
 * plus a fallback polling interval for UI refresh.
 */

import { API } from './api.js';
import { Storage } from './storage.js';

class AppState {
  constructor() {
    this.messages = [];
    this.settings = Storage.getSettings();
    this.whatsapp = {
      status: 'disconnected', // 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'reconnecting'
      qrDataUrl: null,
      user: null,
      isConnected: false
    };
    this.selectedMessage = null;
    this.editingMessage = null;
    this.deletingMessageId = null;
    this.currentSheet = null; // 'create' | 'details' | 'edit' | 'contacts' | 'settings' | 'delete' | 'qr'
    this.listeners = new Set();
    this.pollInterval = null;
    this.ipcCleanup = [];
  }

  async init() {
    // Load settings from SQLite via IPC
    await Storage.init();
    this.settings = Storage.getSettings();
    this.applyTheme(this.settings.theme);

    // Initial data fetch
    await this.refreshAll();

    // Set up IPC event listeners for real-time push from main process
    this.setupIpcListeners();

    // Start fallback polling (every 5 seconds for UI refresh)
    this.startPolling();
  }

  /**
   * Listen for real-time push events from the Electron main process
   */
  setupIpcListeners() {
    if (!window.api) return;

    // WhatsApp status changes (QR ready, connected, disconnected, etc.)
    if (window.api.onWhatsAppUpdate) {
      const unsub = window.api.onWhatsAppUpdate((data) => {
        this.whatsapp = data;
        this.notify();
      });
      this.ipcCleanup.push(unsub);
    }

    // Scheduler updates (message sent, failed, status changes)
    if (window.api.onSchedulerUpdate) {
      const unsub = window.api.onSchedulerUpdate(async (data) => {
        // Refresh all messages from database when scheduler processes something
        await this.refreshAll(true);
      });
      this.ipcCleanup.push(unsub);
    }
  }

  startPolling() {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(async () => {
      await this.refreshAll(false);
    }, 5000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async refreshAll(notifyNow = true) {
    try {
      const [messages, waStatus] = await Promise.all([
        API.getMessages(),
        API.getWhatsAppStatus()
      ]);

      this.messages = messages;
      this.whatsapp = waStatus;

      // Update selected message if details sheet is open
      if (this.selectedMessage && this.currentSheet === 'details') {
        const updated = this.messages.find(m => m.id === this.selectedMessage.id);
        if (updated) this.selectedMessage = updated;
      }

      if (notifyNow) this.notify();
    } catch (err) {
      console.warn('State refresh error:', err);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach(cb => {
      try {
        cb(this);
      } catch (err) {
        console.error('State subscriber error:', err);
      }
    });
  }

  setTheme(theme) {
    this.settings = Storage.updateSettings({ theme });
    this.applyTheme(theme);
    this.notify();
  }

  applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.setAttribute('data-theme', 'light');
      }
    }
  }

  openSheet(sheetName, data = null) {
    this.currentSheet = sheetName;
    if (sheetName === 'details') this.selectedMessage = data;
    if (sheetName === 'edit') this.editingMessage = data;
    if (sheetName === 'delete') this.deletingMessageId = data;
    this.notify();
  }

  closeSheet() {
    this.currentSheet = null;
    this.notify();
  }
}

export const State = new AppState();
