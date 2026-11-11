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
  // In-app Navigation
  // ============================
  getActiveEmbeddedPage: () => ipcRenderer.invoke('navigation:get-active'),
  selectEmbeddedPage: (page) => ipcRenderer.invoke('navigation:select', page),
  onEmbeddedPageChanged: (callback) => {
    const handler = (_event, page) => callback(page);
    ipcRenderer.on('navigation:page-changed', handler);
    return () => ipcRenderer.removeListener('navigation:page-changed', handler);
  },
  onWhatsAppLinkSendStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('whatsapp:link-send-status', handler);
    return () => ipcRenderer.removeListener('whatsapp:link-send-status', handler);
  },
  onWhatsAppLinkSendSound: (callback) => {
    const handler = (_event, dataUrl) => callback(dataUrl);
    ipcRenderer.on('whatsapp:link-send-sound', handler);
    return () => ipcRenderer.removeListener('whatsapp:link-send-sound', handler);
  },
  reportWhatsAppLinkSendSoundFailed: () => ipcRenderer.send('whatsapp:link-send-sound-failed'),
  getBrowserState: () => ipcRenderer.invoke('browser:get-state'),
  toggleBrowserChrome: () => ipcRenderer.invoke('browser:toggle-chrome'),
  newBrowserTab: () => ipcRenderer.invoke('browser:new-tab'),
  selectBrowserTab: (id) => ipcRenderer.invoke('browser:select-tab', id),
  closeBrowserTab: (id) => ipcRenderer.invoke('browser:close-tab', id),
  navigateBrowser: (url) => ipcRenderer.invoke('browser:navigate', url),
  browserHistory: (direction) => ipcRenderer.invoke('browser:history', direction),
  onBrowserState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('browser:state', handler);
    return () => ipcRenderer.removeListener('browser:state', handler);
  },

  // ============================
  // Media Attachments
  // ============================
  selectAttachment: () => ipcRenderer.invoke('attachments:select'),
  discardAttachment: (attachmentId) => ipcRenderer.invoke('attachments:discard', attachmentId),

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
  importWhatsAppContacts: () => ipcRenderer.invoke('contacts:import-whatsapp'),
  onAutomationContact: (callback) => {
    const handler = (_event, contact) => callback(contact);
    ipcRenderer.on('automation:contact-selected', handler);
    return () => ipcRenderer.removeListener('automation:contact-selected', handler);
  },
  onAutoReplySettingsRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('auto-replies:open-settings', handler);
    return () => ipcRenderer.removeListener('auto-replies:open-settings', handler);
  },
  automationRendererReady: () => ipcRenderer.invoke('automation:renderer-ready'),

  // ============================
  // Settings
  // ============================
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (data) => ipcRenderer.invoke('settings:update', data),

  // ============================
  // Automatic Replies
  // ============================
  getAutoReplyRules: () => ipcRenderer.invoke('auto-replies:list'),
  saveAutoReplyRule: (data) => ipcRenderer.invoke('auto-replies:save', data),
  setAutoReplyRuleEnabled: (id, enabled) => ipcRenderer.invoke('auto-replies:set-enabled', id, enabled),
  deleteAutoReplyRule: (id) => ipcRenderer.invoke('auto-replies:delete', id),

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
