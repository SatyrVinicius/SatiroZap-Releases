function timeToMinutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isValidTimeRange(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return start !== null && end !== null && start !== end;
}

function rangesOverlap(first, second) {
  const firstStart = timeToMinutes(first.startTime);
  const firstEnd = timeToMinutes(first.endTime);
  const secondStart = timeToMinutes(second.startTime);
  const secondEnd = timeToMinutes(second.endTime);
  if ([firstStart, firstEnd, secondStart, secondEnd].some(value => value === null)) return false;

  const toSegments = (start, end) => start < end
    ? [[start, end]]
    : [[start, 1440], [0, end]];
  return toSegments(firstStart, firstEnd).some(([startA, endA]) =>
    toSegments(secondStart, secondEnd).some(([startB, endB]) => startA < endB && startB < endA)
  );
}

function isTimeRangeActive(rule, date = new Date()) {
  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);
  if (start === null || end === null || start === end) return false;
  const current = date.getHours() * 60 + date.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function selectSingleAutoReplyRule(rules, date = new Date()) {
  const scheduledRule = rules.find(rule =>
    rule.mode === 'single' && Number(rule.isFallback) !== 1 && isTimeRangeActive(rule, date)
  );
  if (scheduledRule) return scheduledRule;
  return rules.find(rule => rule.mode === 'single' && Number(rule.isFallback) === 1) || null;
}

module.exports = { isValidTimeRange, rangesOverlap, selectSingleAutoReplyRule };
