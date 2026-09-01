/**
 * Electron Preload Script — Secure Context Bridge
 * Exposes a safe IPC API to the renderer process via window.api
 * No Node.js APIs are directly exposed to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ============================
  // WhatsApp Connection
  // ============================
  getWhatsAppStatus: () => ipcRenderer.invoke('whatsapp:get-status'),
  connectWhatsApp: () => ipcRenderer.invoke('whatsapp:connect'),
  logoutWhatsApp: () => ipcRenderer.invoke('whatsapp:logout'),

  // ============================
  // Scheduled Messages
  // ============================
  getMessages: () => ipcRenderer.invoke('messages:get-all'),
  getMessageById: (id) => ipcRenderer.invoke('messages:get-by-id', id),
  createMessage: (data) => ipcRenderer.invoke('messages:create', data),
  updateMessage: (id, data) => ipcRenderer.invoke('messages:update', id, data),
  deleteMessage: (id) => ipcRenderer.invoke('messages:delete', id),
  sendNow: (id) => ipcRenderer.invoke('messages:send-now', id),

  // ============================
  // Contacts
  // ============================
  getContacts: () => ipcRenderer.invoke('contacts:get-all'),
  addContact: (contact) => ipcRenderer.invoke('contacts:add', contact),

  // ============================
  // Settings
  // ============================
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (data) => ipcRenderer.invoke('settings:update', data),

  // ============================
  // Real-time Event Listeners (Main → Renderer push)
  // ============================
  onWhatsAppUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('whatsapp:status-update', handler);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('whatsapp:status-update', handler);
  },

  onSchedulerUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('scheduler:update', handler);
    return () => ipcRenderer.removeListener('scheduler:update', handler);
  },

  // ============================
  // App Info
  // ============================
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  // Flag: signals to the renderer that it's running inside Electron
  isElectron: true
});
