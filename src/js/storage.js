/**
 * Storage Management — Electron IPC Version
 * Replaced localStorage with IPC calls to SQLite via main process.
 * Settings and contacts are now persisted in the SQLite database.
 */

const DEFAULT_SETTINGS = {
  theme: 'system' // 'system' | 'light' | 'dark'
};

// Local cache to avoid async calls on every access
let settingsCache = { ...DEFAULT_SETTINGS };
let contactsCache = [];

export const Storage = {
  /**
   * Initialize storage by loading from SQLite
   */
  async init() {
    try {
      if (window.api) {
        settingsCache = { ...DEFAULT_SETTINGS, ...(await window.api.getSettings()) };
        contactsCache = await window.api.getContacts();
      }
    } catch (e) {
      console.warn('Failed to initialize storage from IPC:', e);
    }
  },

  /**
   * Get Settings (synchronous from cache)
   */
  getSettings() {
    return { ...settingsCache };
  },

  /**
   * Update Settings (async to SQLite, updates cache immediately)
   */
  updateSettings(updates) {
    settingsCache = { ...settingsCache, ...updates };

    // Async persist to SQLite — fire and forget
    if (window.api) {
      window.api.updateSettings(updates).catch(e => {
        console.error('Failed to persist settings:', e);
      });
    }

    return { ...settingsCache };
  },

  /**
   * Get Recent Contacts (synchronous from cache)
   */
  getRecentContacts() {
    return [...contactsCache];
  },

  /**
   * Add a real contact to recent contacts list
   */
  addRecentContact(contact) {
    if (!contact || !contact.name || !contact.phone) return;

    // Update local cache immediately
    contactsCache = contactsCache.filter(c => c.phone !== contact.phone);
    contactsCache.unshift({ name: contact.name.trim(), phone: contact.phone.trim() });
    if (contactsCache.length > 20) contactsCache = contactsCache.slice(0, 20);

    // Async persist to SQLite
    if (window.api) {
      window.api.addContact(contact).catch(e => {
        console.error('Failed to persist contact:', e);
      });
    }
  }
};
