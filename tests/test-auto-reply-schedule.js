const assert = require('node:assert/strict');
const { isValidTimeRange, rangesOverlap, selectSingleAutoReplyRule } = require('../electron/autoReplySchedule');

const morning = { id: 'morning', mode: 'single', isFallback: 0, startTime: '09:00', endTime: '10:00' };
const afternoon = { id: 'afternoon', mode: 'single', isFallback: 0, startTime: '14:00', endTime: '15:00' };
const overnight = { id: 'overnight', mode: 'single', isFallback: 0, startTime: '22:00', endTime: '02:00' };
const fallback = { id: 'general', mode: 'single', isFallback: 1 };
const dateAt = (hours, minutes = 0) => new Date(2026, 10, 12, hours, minutes);

assert.equal(isValidTimeRange('09:00', '10:00'), true);
assert.equal(isValidTimeRange('09:00', '09:00'), false);
assert.equal(isValidTimeRange('24:00', '10:00'), false);
assert.equal(rangesOverlap(morning, { startTime: '09:59', endTime: '11:00' }), true);
assert.equal(rangesOverlap(morning, { startTime: '10:00', endTime: '11:00' }), false);
assert.equal(rangesOverlap(overnight, { startTime: '01:00', endTime: '03:00' }), true);
assert.equal(rangesOverlap(overnight, afternoon), false);
assert.equal(selectSingleAutoReplyRule([morning, fallback], dateAt(9, 0)), morning);
assert.equal(selectSingleAutoReplyRule([morning, fallback], dateAt(9, 59)), morning);
assert.equal(selectSingleAutoReplyRule([morning, fallback], dateAt(10, 0)), fallback);
assert.equal(selectSingleAutoReplyRule([morning], dateAt(10, 0)), null);
assert.equal(selectSingleAutoReplyRule([overnight, fallback], dateAt(23, 30)), overnight);
assert.equal(selectSingleAutoReplyRule([overnight, fallback], dateAt(1, 30)), overnight);
assert.equal(selectSingleAutoReplyRule([overnight, fallback], dateAt(2, 0)), fallback);

console.log('Regras de horário diário, sobreposição e fallback passaram.');
