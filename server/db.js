import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

export const Database = {
  /**
   * Reads all messages from local disk, recovering any orphaned in-flight states
   */
  getMessages() {
    const rawMessages = readJsonFile(MESSAGES_FILE, []);
    let modified = false;

    // Normalize and auto-recover any orphaned SENDING states (e.g. from crash or sudden reboot)
    const messages = rawMessages.map(msg => {
      let status = (msg.status || 'SCHEDULED').toUpperCase();
      
      // Map legacy lowercase states if any
      if (status === 'COMPLETED') status = 'SENT';
      
      // Crash recovery: if a message was interrupted while SENDING, restore to SCHEDULED
      if (status === 'SENDING') {
        status = 'SCHEDULED';
        modified = true;
      }

      return {
        ...msg,
        status
      };
    });

    if (modified) {
      writeJsonFile(MESSAGES_FILE, messages);
    }

    return messages.sort((a, b) => new Date(a.scheduledDateTime) - new Date(b.scheduledDateTime));
  },

  getMessageById(id) {
    const messages = this.getMessages();
    return messages.find(m => m.id === id) || null;
  },

  saveMessage(message) {
    const messages = this.getMessages();
    const now = new Date().toISOString();

    const newRecord = {
      id: message.id || 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      recipientName: (message.recipientName || 'Contact').trim(),
      recipientPhone: (message.recipientPhone || '').trim(),
      message: (message.message || '').trim(),
      scheduledDateTime: message.scheduledDateTime,
      status: (message.status || 'SCHEDULED').toUpperCase(), // SCHEDULED | SENDING | SENT | FAILED | CANCELLED
      sentAt: null,
      failedAt: null,
      errorReason: null,
      whatsappMessageId: null,
      createdAt: message.createdAt || now,
      updatedAt: now
    };

    messages.push(newRecord);
    writeJsonFile(MESSAGES_FILE, messages);
    return newRecord;
  },

  updateMessage(id, updates) {
    const messages = this.getMessages();
    const index = messages.findIndex(m => m.id === id);
    if (index === -1) return null;

    if (updates.status) {
      updates.status = updates.status.toUpperCase();
    }

    messages[index] = {
      ...messages[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    writeJsonFile(MESSAGES_FILE, messages);
    return messages[index];
  },

  deleteMessage(id) {
    const messages = this.getMessages();
    const filtered = messages.filter(m => m.id !== id);
    writeJsonFile(MESSAGES_FILE, filtered);
    return true;
  },

  getSettings() {
    const defaultSettings = {
      theme: 'system'
    };
    return readJsonFile(SETTINGS_FILE, defaultSettings);
  },

  updateSettings(updates) {
    const current = this.getSettings();
    const updated = { ...current, ...updates };
    writeJsonFile(SETTINGS_FILE, updated);
    return updated;
  }
};
