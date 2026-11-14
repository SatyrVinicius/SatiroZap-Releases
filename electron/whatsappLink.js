function getWhatsAppSendRequest(input) {
  try {
    const candidate = String(input || '').trim().replace(/&amp;/gi, '&');
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase();
    const isWhatsAppHost = host === 'whatsapp.com' || host.endsWith('.whatsapp.com');
    const isShortLink = host === 'wa.me';
    if (!isWhatsAppHost && !isShortLink) return null;
    if (isWhatsAppHost && !/^\/send\/?$/i.test(url.pathname)) return null;

    const params = new URLSearchParams(url.search);
    const phone = params.get('phone') || (isShortLink ? url.pathname.slice(1) : '');
    const message = params.get('text') || '';
    const cleanPhone = phone.replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(cleanPhone)) return null;
    return { phone: cleanPhone, message, openOnly: !message.trim() };
  } catch {
    return null;
  }
}

function normalizeWhatsAppPhone(input) {
  return String(input || '').replace(/\D/g, '');
}

function getWhatsAppPhoneCandidates(input) {
  const phone = normalizeWhatsAppPhone(input);
  const candidates = [phone];

  if (phone.startsWith('55') && phone.length === 13 && phone[4] === '9') {
    candidates.push(phone.slice(0, 4) + phone.slice(5));
  } else if (phone.length === 11 && phone[2] === '9') {
    candidates.push(phone.slice(0, 2) + phone.slice(3));
  }

  return candidates;
}

module.exports = { getWhatsAppSendRequest, normalizeWhatsAppPhone, getWhatsAppPhoneCandidates };