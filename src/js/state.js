/**
 * Application State Store with Server Synchronization
 */

import { API } from './api.js';
import { Storage } from './storage.js';

class AppState {
  constructor() {
    this.messages = [];
    this.settings = Storage.getSettings();
    this.whatsapp = {
      status: 'disconnected', // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
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
  }

  async init() {
    this.applyTheme(this.settings.theme);
    await this.refreshAll();
    this.startPolling();
  }

  startPolling() {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(async () => {
      await this.refreshAll(false);
    }, 3000);
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
