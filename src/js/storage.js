/**
 * Local-First Storage Management
 * Handles persistent storage via localStorage with zero placeholders
 */

const STORAGE_KEYS = {
  SETTINGS: 'wa_scheduler_settings_v2',
  CONTACTS: 'wa_scheduler_recent_contacts_v2'
};

const DEFAULT_SETTINGS = {
  theme: 'system' // 'system' | 'light' | 'dark'
};

export const Storage = {
  /**
   * Get Settings
   */
  getSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!data) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  },

  /**
   * Update Settings
   */
  updateSettings(updates) {
    const current = this.getSettings();
    const updated = { ...current, ...updates };
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to update settings:', e);
    }
    return updated;
  },

  /**
   * Get Recent Contacts (Real contacts only, no placeholders)
   */
  getRecentContacts() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CONTACTS);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },

  /**
   * Add a real contact to recent contacts list
   */
  addRecentContact(contact) {
    if (!contact || !contact.name || !contact.phone) return;
    const current = this.getRecentContacts();
    const filtered = current.filter(c => c.phone !== contact.phone);
    const updated = [{ name: contact.name.trim(), phone: contact.phone.trim() }, ...filtered].slice(0, 20);
    try {
      localStorage.setItem(STORAGE_KEYS.CONTACTS, JSON.stringify(updated));
    } catch (e) {}
  }
};
