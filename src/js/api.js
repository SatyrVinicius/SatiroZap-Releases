/**
 * Client API Service — Electron IPC Version
 * Communicates with the main process through the preload context bridge (window.api)
 * No HTTP fetch calls — everything goes through secure IPC.
 */

export const API = {
  async selectAttachment() {
    try {
      return await window.api.selectAttachment();
    } catch (err) {
      throw new Error(err.message || 'Não foi possível selecionar o arquivo.');
    }
  },

  async discardAttachment(attachmentId) {
    try {
      return await window.api.discardAttachment(attachmentId);
    } catch (err) {
      console.warn('API Error (discardAttachment):', err);
      return { success: false };
    }
  },

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
      throw new Error(err.message || 'Falha ao agendar a mensagem.');
    }
  },

  async updateMessage(id, data) {
    try {
      return await window.api.updateMessage(id, data);
    } catch (err) {
      throw new Error(err.message || 'Falha ao atualizar a mensagem.');
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
      throw new Error(err.message || 'Falha ao enviar a mensagem.');
    }
  },

  async importWhatsAppContacts() {
    try {
      return await window.api.importWhatsAppContacts();
    } catch (err) {
      throw new Error(err.message || 'Falha ao importar contatos do WhatsApp.');
    }
  },

  async getAutoReplyRules() {
    return window.api.getAutoReplyRules();
  },

  async saveAutoReplyRule(data) {
    try {
      return await window.api.saveAutoReplyRule(data);
    } catch (err) {
      throw new Error(err.message || 'Não foi possível salvar a resposta automática.');
    }
  },

  async setAutoReplyRuleEnabled(id, enabled) {
    try {
      return await window.api.setAutoReplyRuleEnabled(id, enabled);
    } catch (err) {
      throw new Error(err.message || 'Não foi possível alterar a resposta automática.');
    }
  },

  async deleteAutoReplyRule(id) {
    try {
      return await window.api.deleteAutoReplyRule(id);
    } catch (err) {
      throw new Error(err.message || 'Não foi possível excluir a resposta automática.');
    }
  },

  async automationRendererReady() {
    return window.api.automationRendererReady();
  },

  onAutomationContact(callback) {
    return window.api.onAutomationContact(callback);
  },

  onAutoReplySettingsRequested(callback) {
    return window.api.onAutoReplySettingsRequested(callback);
  }
};
