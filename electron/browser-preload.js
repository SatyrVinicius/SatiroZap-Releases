const { ipcRenderer } = require('electron');

const getWhatsAppSendUrl = (input) => {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase();
    const isWhatsAppHost = host === 'whatsapp.com' || host.endsWith('.whatsapp.com');
    const isShortLink = host === 'wa.me';
    if (!isWhatsAppHost && !isShortLink) return null;
    if (isWhatsAppHost && !/^\/send\/?$/i.test(url.pathname)) return null;

    const phone = url.searchParams.get('phone') || (isShortLink ? url.pathname.slice(1) : '');
    const text = url.searchParams.get('text') || '';
    return /^\d{7,15}$/.test(phone.replace(/\D/g, '')) ? url.toString() : null;
  } catch {
    return null;
  }
};

document.addEventListener('click', (event) => {
  if (!event.isTrusted) return;

  const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
  const sendUrl = anchor && getWhatsAppSendUrl(anchor.href);
  if (!sendUrl) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send('browser:whatsapp-send-link', sendUrl);
}, true);
