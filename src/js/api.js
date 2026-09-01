/**
 * Client API Service — Electron IPC Version
 * Communicates with the main process through the preload context bridge (window.api)
 * No HTTP fetch calls — everything goes through secure IPC.
 */

export const API = {
  async getWhatsAppStatus() {
    try {
      return await window.api.getWhatsAppStatus();
    } catch (err) {
      console.warn('API Error (getWhatsAppStatus):', err);
      return { status: 'disconnected', qrDataUrl: null, user: null, isConnected: false };
    }
  },

  async connectWhatsApp() {
    try {
      return await window.api.connectWhatsApp();
    } catch (err) {
      console.warn('API Error (connectWhatsApp):', err);
      return { status: 'disconnected' };
    }
  },

  async logoutWhatsApp() {
    try {
      return await window.api.logoutWhatsApp();
    } catch (err) {
      console.warn('API Error (logoutWhatsApp):', err);
      return { success: false };
    }
  },

  async getMessages() {
    try {
      return await window.api.getMessages();
    } catch (err) {
      console.warn('API Error (getMessages):', err);
      return [];
    }
  },

  async createMessage(data) {
    try {
      return await window.api.createMessage(data);
    } catch (err) {
      throw new Error(err.message || 'Failed to schedule message');
    }
  },

  async updateMessage(id, data) {
    try {
      return await window.api.updateMessage(id, data);
    } catch (err) {
      throw new Error(err.message || 'Failed to update message');
    }
  },

  async deleteMessage(id) {
    try {
      return await window.api.deleteMessage(id);
    } catch (err) {
      console.warn('API Error (deleteMessage):', err);
      return { success: false };
    }
  },

  async sendNow(id) {
    try {
      return await window.api.sendNow(id);
    } catch (err) {
      throw new Error(err.message || 'Failed to send message');
    }
  }
};
