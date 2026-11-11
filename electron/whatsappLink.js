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
    if (!phone || !message.trim()) return null;
    return { phone: phone.replace(/\D/g, ''), message };
  } catch {
    return null;
  }
}

function normalizeWhatsAppPhone(input) {
  const phone = String(input || '').replace(/\D/g, '');
  return phone.length === 13 ? phone.slice(0, 4) + phone.slice(5) : phone;
}

module.exports = { getWhatsAppSendRequest, normalizeWhatsAppPhone };