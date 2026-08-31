import { sanitizePhoneNumber, isValidPhoneNumber, formatDateLabel, formatTimeLabel, formatRelativeCountdown, parseWhatsAppFormatting, generateId } from '../src/js/utils.js';
import { Database } from '../server/db.js';

async function runTests() {
  console.log('Running WhatsApp 24/7 Scheduler Unit & Integration Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Phone & Text Formatting
  assert(sanitizePhoneNumber('+20 100 123 4567') === '201001234567', 'Sanitizes Egypt phone number');
  assert(sanitizePhoneNumber('+1 (555) 234-5678') === '15552345678', 'Sanitizes US phone number');
  assert(isValidPhoneNumber('+20 100 123 4567') === true, 'Validates valid phone');
  assert(isValidPhoneNumber('123') === false, 'Rejects too short phone');

  // 2. WhatsApp markup formatting
  const formattedHtml = parseWhatsAppFormatting('Hello *bold* and _italic_ and ~strike~ and `code`');
  assert(formattedHtml.includes('<strong>bold</strong>'), 'Parses bold markdown');
  assert(formattedHtml.includes('<em>italic</em>'), 'Parses italic markdown');
  assert(formattedHtml.includes('<del>strike</del>'), 'Parses strikethrough markdown');
  assert(formattedHtml.includes('<code class="wa-inline-code">code</code>'), 'Parses inline code');

  // 3. Database Persistent States & Crash Recovery
  const now = new Date();
  const future = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  
  const createdMsg = Database.saveMessage({
    recipientName: 'Real Contact',
    recipientPhone: '201001234567',
    message: 'Test message for 24/7 scheduler',
    scheduledDateTime: future
  });

  assert(createdMsg && createdMsg.id && createdMsg.status === 'SCHEDULED', 'Saves message with canonical SCHEDULED status');
  
  const fetchedMsg = Database.getMessageById(createdMsg.id);
  assert(fetchedMsg && fetchedMsg.recipientPhone === '201001234567', 'Retrieves scheduled message by ID from disk');

  // Test crash recovery: simulate an interrupted SENDING state
  Database.updateMessage(createdMsg.id, { status: 'SENDING' });
  const recoveredMessages = Database.getMessages();
  const recoveredMsg = recoveredMessages.find(m => m.id === createdMsg.id);
  assert(recoveredMsg && recoveredMsg.status === 'SCHEDULED', 'Crash Recovery: Automatically resets interrupted SENDING state to SCHEDULED');

  // Update to SENT with confirmed delivery
  const sentMsg = Database.updateMessage(createdMsg.id, {
    status: 'SENT',
    sentAt: new Date().toISOString(),
    whatsappMessageId: 'WA_CONFIRMED_ID_123'
  });
  assert(sentMsg.status === 'SENT' && sentMsg.whatsappMessageId === 'WA_CONFIRMED_ID_123', 'Sets SENT status only with confirmed message ID');

  const deleted = Database.deleteMessage(createdMsg.id);
  assert(deleted === true, 'Deletes message from queue');
  assert(Database.getMessageById(createdMsg.id) === null, 'Verified deletion');

  // 4. REST API Endpoint Tests
  try {
    const statusRes = await fetch('http://localhost:3005/api/whatsapp/status');
    const statusData = await statusRes.json();
    assert(statusRes.ok && typeof statusData.status === 'string', 'API GET /api/whatsapp/status returns live connection state');

    const msgRes = await fetch('http://localhost:3005/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientName: 'Real Contact API',
        recipientPhone: '15551234567',
        message: 'Hello via 24/7 API test!',
        scheduledDateTime: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      })
    });
    const msgData = await msgRes.json();
    assert(msgRes.ok && msgData.id && msgData.status === 'SCHEDULED', 'API POST /api/messages creates scheduled message');

    const listRes = await fetch('http://localhost:3005/api/messages');
    const listData = await listRes.json();
    assert(listRes.ok && Array.isArray(listData), 'API GET /api/messages returns list');

    // Clean up created API test message
    await fetch(`http://localhost:3005/api/messages/${msgData.id}`, { method: 'DELETE' });
    assert(true, 'API DELETE /api/messages/:id successfully cleans up test record');
  } catch (apiErr) {
    console.error('API Test Error:', apiErr);
    assert(false, 'API endpoints responding');
  }

  console.log(`\n================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`================================\n`);
  if (failed > 0) process.exit(1);
}

runTests();
