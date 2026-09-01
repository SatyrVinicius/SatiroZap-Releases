/**
 * SQLite Database Module for Electron Main Process
 * Uses sql.js (pure WASM SQLite — zero native compilation required).
 * Database is persisted to disk manually after each write operation.
 */

const path = require('path');
const fs = require('fs');

let db = null;
let dbFilePath = null;

/**
 * Initialize the database. Must be called once at app startup.
 * @param {string} userDataPath - app.getPath('userData')
 */
async function init(userDataPath) {
  const initSqlJs = (await import('sql.js')).default;
  
  dbFilePath = path.join(userDataPath, 'scheduler.db');

  const SQL = await initSqlJs();

  // Load existing database file if it exists
  if (fs.existsSync(dbFilePath)) {
    const fileBuffer = fs.readFileSync(dbFilePath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable WAL mode (ignored by sql.js but good practice)
  try { db.run('PRAGMA journal_mode = WAL'); } catch (e) {}

  createTables();
  recoverOrphanedMessages();
  persist();
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      recipientName TEXT NOT NULL DEFAULT 'Contact',
      recipientPhone TEXT NOT NULL,
      message TEXT NOT NULL,
      scheduledDateTime TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      sentAt TEXT,
      failedAt TEXT,
      errorReason TEXT,
      whatsappMessageId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      lastUsedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

/**
 * Persist the in-memory database to disk
 */
function persist() {
  if (!db || !dbFilePath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbFilePath, buffer);
  } catch (err) {
    console.error('[Database] Failed to persist to disk:', err);
  }
}

/**
 * Crash recovery: reset any orphaned SENDING messages back to SCHEDULED.
 */
function recoverOrphanedMessages() {
  const stmt = db.prepare('UPDATE messages SET status = ?, updatedAt = ? WHERE status = ?');
  stmt.run(['SCHEDULED', new Date().toISOString(), 'SENDING']);
  stmt.free();

  // Check how many were recovered
  const result = db.exec("SELECT changes()");
  const changes = result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : 0;
  if (changes > 0) {
    console.log(`[Database] Recovered ${changes} orphaned SENDING message(s) back to SCHEDULED`);
  }
}

/**
 * Helper: run a query and return all rows as plain objects
 */
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Helper: run a query and return the first row as a plain object
 */
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Helper: run a statement (INSERT/UPDATE/DELETE) and persist
 */
function runAndPersist(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  persist();
}

// ============================================================
// Messages CRUD
// ============================================================

function getMessages() {
  return queryAll(`SELECT * FROM messages ORDER BY 
    CASE status 
      WHEN 'SCHEDULED' THEN 0 
      WHEN 'SENDING' THEN 1 
      WHEN 'FAILED' THEN 2 
      WHEN 'SENT' THEN 3 
      ELSE 4 
    END, 
    scheduledDateTime ASC`);
}

function getMessageById(id) {
  return queryOne('SELECT * FROM messages WHERE id = ?', [id]);
}

function getScheduledMessages() {
  return queryAll(`SELECT * FROM messages WHERE status = 'SCHEDULED' ORDER BY scheduledDateTime ASC`);
}

function saveMessage(message) {
  const now = new Date().toISOString();
  const id = message.id || 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

  const record = {
    id,
    recipientName: (message.recipientName || 'Contact').trim(),
    recipientPhone: (message.recipientPhone || '').trim(),
    message: (message.message || '').trim(),
    scheduledDateTime: message.scheduledDateTime,
    status: (message.status || 'SCHEDULED').toUpperCase(),
    sentAt: null,
    failedAt: null,
    errorReason: null,
    whatsappMessageId: null,
    createdAt: message.createdAt || now,
    updatedAt: now
  };

  runAndPersist(
    `INSERT INTO messages (id, recipientName, recipientPhone, message, scheduledDateTime, status, sentAt, failedAt, errorReason, whatsappMessageId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.recipientName, record.recipientPhone,
     record.message, record.scheduledDateTime, record.status,
     record.sentAt, record.failedAt, record.errorReason,
     record.whatsappMessageId, record.createdAt, record.updatedAt]
  );

  return record;
}

function updateMessage(id, updates) {
  const existing = getMessageById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updatedAt: now };

  if (merged.status) {
    merged.status = merged.status.toUpperCase();
  }

  runAndPersist(
    `UPDATE messages SET
      recipientName = ?, recipientPhone = ?, message = ?,
      scheduledDateTime = ?, status = ?, sentAt = ?,
      failedAt = ?, errorReason = ?, whatsappMessageId = ?,
      updatedAt = ?
    WHERE id = ?`,
    [merged.recipientName, merged.recipientPhone, merged.message,
     merged.scheduledDateTime, merged.status, merged.sentAt,
     merged.failedAt, merged.errorReason, merged.whatsappMessageId,
     merged.updatedAt, id]
  );

  return getMessageById(id);
}

function deleteMessage(id) {
  runAndPersist('DELETE FROM messages WHERE id = ?', [id]);
  return true;
}

// ============================================================
// Contacts CRUD
// ============================================================

function getContacts() {
  return queryAll('SELECT * FROM contacts ORDER BY lastUsedAt DESC LIMIT 30');
}

function addContact(contact) {
  if (!contact || !contact.name || !contact.phone) return null;

  const now = new Date().toISOString();

  // Try update first, then insert
  const existing = queryOne('SELECT * FROM contacts WHERE phone = ?', [contact.phone.trim()]);
  if (existing) {
    runAndPersist('UPDATE contacts SET name = ?, lastUsedAt = ? WHERE phone = ?',
      [contact.name.trim(), now, contact.phone.trim()]);
  } else {
    runAndPersist('INSERT INTO contacts (name, phone, lastUsedAt) VALUES (?, ?, ?)',
      [contact.name.trim(), contact.phone.trim(), now]);
  }

  return { name: contact.name.trim(), phone: contact.phone.trim(), lastUsedAt: now };
}

// ============================================================
// Settings Key-Value Store
// ============================================================

function getSettings() {
  const rows = queryAll('SELECT key, value FROM settings');
  const settings = { theme: 'system' }; // defaults
  rows.forEach(row => {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  });
  return settings;
}

function updateSettings(updates) {
  for (const [key, value] of Object.entries(updates)) {
    const existing = queryOne('SELECT * FROM settings WHERE key = ?', [key]);
    if (existing) {
      runAndPersist('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(value), key]);
    } else {
      runAndPersist('INSERT INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
    }
  }
  return getSettings();
}

/**
 * Close the database gracefully
 */
function close() {
  if (db) {
    persist();
    db.close();
    db = null;
  }
}

module.exports = {
  init,
  close,
  getMessages,
  getMessageById,
  getScheduledMessages,
  saveMessage,
  updateMessage,
  deleteMessage,
  getContacts,
  addContact,
  getSettings,
  updateSettings
};
