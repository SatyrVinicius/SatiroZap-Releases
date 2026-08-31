/**
 * Client API Service
 * Interacts with backend server for WhatsApp connection and message scheduling
 */

const API_BASE = '/api';

export const API = {
  async getWhatsAppStatus() {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/status`);
      if (!res.ok) throw new Error('Status fetch failed');
      return await res.json();
    } catch (err) {
      console.warn('API Error (getWhatsAppStatus):', err);
      return { status: 'disconnected', qrDataUrl: null, user: null, isConnected: false };
    }
  },

  async connectWhatsApp() {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/connect`, { method: 'POST' });
      return await res.json();
    } catch (err) {
      console.warn('API Error (connectWhatsApp):', err);
      return { status: 'disconnected' };
    }
  },

  async logoutWhatsApp() {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/logout`, { method: 'POST' });
      return await res.json();
    } catch (err) {
      console.warn('API Error (logoutWhatsApp):', err);
      return { success: false };
    }
  },

  async getMessages() {
    try {
      const res = await fetch(`${API_BASE}/messages`);
      if (!res.ok) throw new Error('Messages fetch failed');
      return await res.json();
    } catch (err) {
      console.warn('API Error (getMessages):', err);
      return [];
    }
  },

  async createMessage(data) {
    const res = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to schedule message');
    }
    return await res.json();
  },

  async updateMessage(id, data) {
    const res = await fetch(`${API_BASE}/messages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update message');
    }
    return await res.json();
  },

  async deleteMessage(id) {
    const res = await fetch(`${API_BASE}/messages/${id}`, {
      method: 'DELETE'
    });
    return await res.json();
  },

  async sendNow(id) {
    const res = await fetch(`${API_BASE}/messages/${id}/send-now`, {
      method: 'POST'
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to send message');
    }
    return await res.json();
  },

  async loadSampleMessages() {
    const res = await fetch(`${API_BASE}/messages/sample`, {
      method: 'POST'
    });
    return await res.json();
  }
};
