const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whatsappBridge', Object.freeze({
  ready: (authenticated) => ipcRenderer.send('whatsapp-web:ready', Boolean(authenticated)),
  status: (status, user) => ipcRenderer.send('whatsapp-web:status', { status, user }),
  activeContact: (contact) => ipcRenderer.send('whatsapp-web:active-contact', contact),
  incomingMessage: (message) => ipcRenderer.send('whatsapp-web:incoming-message', message),
  autoReplies: Object.freeze({
    chatStatus: (chatId) => ipcRenderer.invoke('whatsapp-web:auto-reply-chat-status', chatId),
    setChatPaused: (chatId, paused) => ipcRenderer.invoke('whatsapp-web:auto-reply-chat-pause', chatId, paused),
    openSettings: () => ipcRenderer.invoke('whatsapp-web:auto-reply-open-settings')
  }),
  quickMessages: Object.freeze({
    list: () => ipcRenderer.invoke('whatsapp-web:quick-messages:list'),
    save: (data) => ipcRenderer.invoke('whatsapp-web:quick-messages:save', data),
    delete: (id) => ipcRenderer.invoke('whatsapp-web:quick-messages:delete', id),
    selectAttachment: () => ipcRenderer.invoke('whatsapp-web:quick-messages:select-attachment'),
    discardAttachment: (id) => ipcRenderer.invoke('whatsapp-web:quick-messages:discard-attachment', id),
    send: (id) => ipcRenderer.invoke('whatsapp-web:quick-messages:send', id)
  })
}));
