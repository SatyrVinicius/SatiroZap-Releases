const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const database = require('../electron/database');

async function run() {
  const initSqlJs = (await import('sql.js')).default;
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'satirozap-auto-reply-migration-'));
  const SQL = await initSqlJs();
  const legacyDatabase = new SQL.Database();
  legacyDatabase.run(`
    CREATE TABLE auto_reply_rules (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      reply TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'keyword',
      cooldownHours INTEGER NOT NULL DEFAULT 24,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);
  legacyDatabase.run(`
    INSERT INTO auto_reply_rules (id, keyword, reply, mode, cooldownHours, enabled, createdAt, updatedAt)
    VALUES ('legacy-single', '', 'Resposta antiga', 'single', 24, 1, '2026-01-01', '2026-01-01')
  `);
  fs.writeFileSync(path.join(tempDirectory, 'scheduler.db'), Buffer.from(legacyDatabase.export()));

  try {
    await database.init(tempDirectory);
    const [rule] = database.getAutoReplyRules();
    if (!rule || rule.id !== 'legacy-single' || Number(rule.isFallback) !== 1 || rule.startTime !== null || rule.endTime !== null) {
      throw new Error('A resposta única antiga não foi migrada como resposta geral.');
    }
    console.log('Migração de resposta única antiga para fallback geral passou.');
  } finally {
    database.close();
    legacyDatabase.close();
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
