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
      recipientName TEXT NOT NULL DEFAULT 'Contato',
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

  db.run(`
    CREATE TABLE IF NOT EXISTS quick_messages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      attachmentId TEXT,
      attachmentName TEXT,
      attachmentMimeType TEXT,
      attachmentKind TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auto_reply_rules (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      reply TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'keyword',
      cooldownHours INTEGER NOT NULL DEFAULT 24,
      isFallback INTEGER NOT NULL DEFAULT 0,
      startTime TEXT,
      endTime TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auto_reply_processed (
      messageId TEXT PRIMARY KEY,
      processedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auto_reply_paused_chats (
      chatId TEXT PRIMARY KEY,
      pausedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auto_reply_cooldowns (
      ruleId TEXT NOT NULL,
      chatId TEXT NOT NULL,
      lastSentAt TEXT NOT NULL,
      PRIMARY KEY (ruleId, chatId)
    )
  `);

  const quickMessageColumns = new Set(
    (db.exec('PRAGMA table_info(quick_messages)')[0]?.values || []).map(column => column[1])
  );
  ['attachmentId', 'attachmentName', 'attachmentMimeType', 'attachmentKind'].forEach(column => {
    if (!quickMessageColumns.has(column)) db.run(`ALTER TABLE quick_messages ADD COLUMN ${column} TEXT`);
  });

  const messageColumns = new Set(
    (db.exec('PRAGMA table_info(messages)')[0]?.values || []).map(column => column[1])
  );
  ['attachmentId', 'attachmentName', 'attachmentMimeType', 'attachmentKind'].forEach(column => {
    if (!messageColumns.has(column)) {
      db.run(`ALTER TABLE messages ADD COLUMN ${column} TEXT`);
    }
  });

  const autoReplyColumns = new Set(
    (db.exec('PRAGMA table_info(auto_reply_rules)')[0]?.values || []).map(column => column[1])
  );
  ['attachmentId', 'attachmentName', 'attachmentMimeType', 'attachmentKind'].forEach(column => {
    if (!autoReplyColumns.has(column)) db.run(`ALTER TABLE auto_reply_rules ADD COLUMN ${column} TEXT`);
  });
  if (!autoReplyColumns.has('mode')) db.run("ALTER TABLE auto_reply_rules ADD COLUMN mode TEXT NOT NULL DEFAULT 'keyword'");
  if (!autoReplyColumns.has('cooldownHours')) db.run('ALTER TABLE auto_reply_rules ADD COLUMN cooldownHours INTEGER NOT NULL DEFAULT 24');
  if (!autoReplyColumns.has('isFallback')) {
    db.run('ALTER TABLE auto_reply_rules ADD COLUMN isFallback INTEGER NOT NULL DEFAULT 0');
    db.run("UPDATE auto_reply_rules SET isFallback = 1 WHERE mode = 'single'");
  }
  if (!autoReplyColumns.has('startTime')) db.run('ALTER TABLE auto_reply_rules ADD COLUMN startTime TEXT');
  if (!autoReplyColumns.has('endTime')) db.run('ALTER TABLE auto_reply_rules ADD COLUMN endTime TEXT');
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
    recipientName: (message.recipientName || 'Contato').trim(),
    recipientPhone: (message.recipientPhone || '').trim(),
    message: (message.message || '').trim(),
    scheduledDateTime: message.scheduledDateTime,
    status: (message.status || 'SCHEDULED').toUpperCase(),
    sentAt: null,
    failedAt: null,
    errorReason: null,
    whatsappMessageId: null,
    attachmentId: message.attachmentId || null,
    attachmentName: message.attachmentName || null,
    attachmentMimeType: message.attachmentMimeType || null,
    attachmentKind: message.attachmentKind || null,
    createdAt: message.createdAt || now,
    updatedAt: now
  };

  runAndPersist(
    `INSERT INTO messages (id, recipientName, recipientPhone, message, scheduledDateTime, status, sentAt, failedAt, errorReason, whatsappMessageId, attachmentId, attachmentName, attachmentMimeType, attachmentKind, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.recipientName, record.recipientPhone,
     record.message, record.scheduledDateTime, record.status,
     record.sentAt, record.failedAt, record.errorReason,
     record.whatsappMessageId, record.attachmentId, record.attachmentName,
     record.attachmentMimeType, record.attachmentKind, record.createdAt, record.updatedAt]
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
      attachmentId = ?, attachmentName = ?, attachmentMimeType = ?, attachmentKind = ?,
      updatedAt = ?
    WHERE id = ?`,
    [merged.recipientName, merged.recipientPhone, merged.message,
     merged.scheduledDateTime, merged.status, merged.sentAt,
     merged.failedAt, merged.errorReason, merged.whatsappMessageId,
    merged.attachmentId, merged.attachmentName, merged.attachmentMimeType, merged.attachmentKind,
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
  return queryAll('SELECT * FROM contacts ORDER BY lastUsedAt DESC');
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

function importContacts(contacts) {
  if (!Array.isArray(contacts)) return { imported: 0, updated: 0, skipped: 0 };

  const existingContacts = queryAll('SELECT id, name, phone FROM contacts');
  const contactsByPhone = new Map(
    existingContacts.map(contact => [String(contact.phone).replace(/\D/g, ''), contact])
  );
  const seenPhones = new Set();
  const now = new Date().toISOString();
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  db.run('BEGIN TRANSACTION');
  try {
    for (const contact of contacts) {
      const name = typeof contact?.name === 'string' ? contact.name.trim() : '';
      const phone = typeof contact?.phone === 'string' ? contact.phone.replace(/\D/g, '') : '';
      if (!name || !/^\d{7,15}$/.test(phone) || seenPhones.has(phone)) {
        skipped++;
        continue;
      }
      seenPhones.add(phone);

      const existing = contactsByPhone.get(phone);
      if (existing) {
        if (existing.name !== name) {
          db.run('UPDATE contacts SET name = ? WHERE id = ?', [name, existing.id]);
          existing.name = name;
          updated++;
        } else {
          skipped++;
        }
      } else {
        db.run('INSERT INTO contacts (name, phone, lastUsedAt) VALUES (?, ?, ?)', [name, phone, now]);
        contactsByPhone.set(phone, { name, phone, lastUsedAt: now });
        imported++;
      }
    }
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }

  if (imported || updated) persist();
  return { imported, updated, skipped };
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

function getQuickMessages() {
  return queryAll('SELECT id, title, message, attachmentId, attachmentName, attachmentMimeType, attachmentKind, createdAt, updatedAt FROM quick_messages ORDER BY updatedAt DESC');
}

function getQuickMessageById(id) {
  return queryOne('SELECT id, title, message, attachmentId, attachmentName, attachmentMimeType, attachmentKind, createdAt, updatedAt FROM quick_messages WHERE id = ?', [id]);
}

function saveQuickMessage({ id, title, message, attachmentId = null, attachmentName = null, attachmentMimeType = null, attachmentKind = null }) {
  const now = new Date().toISOString();
  const quickMessageId = id || `quick_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = queryOne('SELECT id FROM quick_messages WHERE id = ?', [quickMessageId]);

  if (existing) {
    runAndPersist('UPDATE quick_messages SET title = ?, message = ?, attachmentId = ?, attachmentName = ?, attachmentMimeType = ?, attachmentKind = ?, updatedAt = ? WHERE id = ?',
      [title, message, attachmentId, attachmentName, attachmentMimeType, attachmentKind, now, quickMessageId]);
  } else {
    runAndPersist('INSERT INTO quick_messages (id, title, message, attachmentId, attachmentName, attachmentMimeType, attachmentKind, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [quickMessageId, title, message, attachmentId, attachmentName, attachmentMimeType, attachmentKind, now, now]);
  }

  return getQuickMessageById(quickMessageId);
}

function deleteQuickMessage(id) {
  runAndPersist('DELETE FROM quick_messages WHERE id = ?', [id]);
  return true;
}

function getAutoReplyRules() {
  return queryAll('SELECT id, keyword, reply, mode, cooldownHours, isFallback, startTime, endTime, attachmentId, attachmentName, attachmentMimeType, attachmentKind, enabled, createdAt, updatedAt FROM auto_reply_rules ORDER BY updatedAt DESC');
}

function saveAutoReplyRule({ id, keyword, reply, mode = 'keyword', cooldownHours = 24, isFallback = false, startTime = null, endTime = null, attachmentId = null, attachmentName = null, attachmentMimeType = null, attachmentKind = null, enabled = true }) {
  const now = new Date().toISOString();
  const ruleId = id || `reply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = queryOne('SELECT id FROM auto_reply_rules WHERE id = ?', [ruleId]);
  if (existing) {
    runAndPersist('UPDATE auto_reply_rules SET keyword = ?, reply = ?, mode = ?, cooldownHours = ?, isFallback = ?, startTime = ?, endTime = ?, attachmentId = ?, attachmentName = ?, attachmentMimeType = ?, attachmentKind = ?, enabled = ?, updatedAt = ? WHERE id = ?',
      [keyword, reply, mode, cooldownHours, isFallback ? 1 : 0, startTime, endTime, attachmentId, attachmentName, attachmentMimeType, attachmentKind, enabled ? 1 : 0, now, ruleId]);
  } else {
    runAndPersist('INSERT INTO auto_reply_rules (id, keyword, reply, mode, cooldownHours, isFallback, startTime, endTime, attachmentId, attachmentName, attachmentMimeType, attachmentKind, enabled, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [ruleId, keyword, reply, mode, cooldownHours, isFallback ? 1 : 0, startTime, endTime, attachmentId, attachmentName, attachmentMimeType, attachmentKind, enabled ? 1 : 0, now, now]);
  }
  return queryOne('SELECT id, keyword, reply, mode, cooldownHours, isFallback, startTime, endTime, attachmentId, attachmentName, attachmentMimeType, attachmentKind, enabled, createdAt, updatedAt FROM auto_reply_rules WHERE id = ?', [ruleId]);
}

function setAutoReplyRuleEnabled(id, enabled) {
  runAndPersist('UPDATE auto_reply_rules SET enabled = ?, updatedAt = ? WHERE id = ?',
    [enabled ? 1 : 0, new Date().toISOString(), id]);
  return queryOne('SELECT id, keyword, reply, enabled, createdAt, updatedAt FROM auto_reply_rules WHERE id = ?', [id]);
}

function deleteAutoReplyRule(id) {
  runAndPersist('DELETE FROM auto_reply_rules WHERE id = ?', [id]);
  runAndPersist('DELETE FROM auto_reply_cooldowns WHERE ruleId = ?', [id]);
  return true;
}

function claimAutoReplyCooldown(ruleId, chatId, cooldownMs) {
  const now = new Date();
  const existing = queryOne('SELECT lastSentAt FROM auto_reply_cooldowns WHERE ruleId = ? AND chatId = ?', [ruleId, chatId]);
  const lastSentAt = existing ? Date.parse(existing.lastSentAt) : NaN;
  if (Number.isFinite(lastSentAt) && now.getTime() - lastSentAt < cooldownMs) return null;

  const claimedAt = now.toISOString();
  runAndPersist('INSERT OR REPLACE INTO auto_reply_cooldowns (ruleId, chatId, lastSentAt) VALUES (?, ?, ?)',
    [ruleId, chatId, claimedAt]);
  db.run('DELETE FROM auto_reply_cooldowns WHERE lastSentAt < ?',
    [new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()]);
  persist();
  return claimedAt;
}

function releaseAutoReplyCooldown(ruleId, chatId, claimedAt) {
  runAndPersist('DELETE FROM auto_reply_cooldowns WHERE ruleId = ? AND chatId = ? AND lastSentAt = ?',
    [ruleId, chatId, claimedAt]);
}

function resetSingleAutoReplyCooldown(chatId) {
  runAndPersist(`DELETE FROM auto_reply_cooldowns
    WHERE chatId = ? AND ruleId IN (SELECT id FROM auto_reply_rules WHERE mode = 'single')`, [chatId]);
  return true;
}

function isAutoReplyPausedForChat(chatId) {
  return Boolean(queryOne('SELECT chatId FROM auto_reply_paused_chats WHERE chatId = ?', [chatId]));
}

function setAutoReplyPausedForChat(chatId, paused) {
  if (paused) {
    runAndPersist('INSERT OR REPLACE INTO auto_reply_paused_chats (chatId, pausedAt) VALUES (?, ?) ',
      [chatId, new Date().toISOString()]);
  } else {
    runAndPersist('DELETE FROM auto_reply_paused_chats WHERE chatId = ?', [chatId]);
  }
  return isAutoReplyPausedForChat(chatId);
}

function claimAutoReplyMessage(messageId) {
  const stmt = db.prepare('INSERT OR IGNORE INTO auto_reply_processed (messageId, processedAt) VALUES (?, ?)');
  stmt.run([messageId, new Date().toISOString()]);
  stmt.free();
  const changes = db.exec('SELECT changes()')[0]?.values?.[0]?.[0] || 0;
  if (changes) {
    db.run(`DELETE FROM auto_reply_processed WHERE messageId IN (
      SELECT messageId FROM auto_reply_processed ORDER BY processedAt DESC LIMIT -1 OFFSET 1000
    )`);
    persist();
  }
  return changes > 0;
}

function releaseAutoReplyMessage(messageId) {
  runAndPersist('DELETE FROM auto_reply_processed WHERE messageId = ?', [messageId]);
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
  importContacts,
  getSettings,
  updateSettings,
  getQuickMessages,
  getQuickMessageById,
  saveQuickMessage,
  deleteQuickMessage,
  getAutoReplyRules,
  saveAutoReplyRule,
  setAutoReplyRuleEnabled,
  deleteAutoReplyRule,
  claimAutoReplyCooldown,
  releaseAutoReplyCooldown,
  resetSingleAutoReplyCooldown,
  isAutoReplyPausedForChat,
  setAutoReplyPausedForChat,
  claimAutoReplyMessage,
  releaseAutoReplyMessage
};
