const fs = require('fs');
const path = require('path');
const { WebContentsView, session } = require('electron');
const { getWhatsAppPhoneCandidates } = require('./whatsappLink');

const WHATSAPP_URL = 'https://web.whatsapp.com/';
const BACKGROUND_WARMUP_TIMEOUT_MS = 90000;
const MAX_MEDIA_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024 * 1024;

function getMaxAttachmentSize() {
  return MAX_ATTACHMENT_SIZE;
}

function getAttachmentSizeLimitMessage() {
  return 'O anexo excede o limite de 2 GB.';
}

function getAttachmentKind(kind, size) {
  return kind !== 'document' && size > MAX_MEDIA_ATTACHMENT_SIZE ? 'document' : kind;
}

function createAttachmentPayload(attachment, filePath) {
  const payload = {
    kind: attachment.attachmentKind,
    filename: attachment.attachmentName,
    mimetype: attachment.attachmentMimeType || 'application/octet-stream'
  };
  if (attachment.attachmentKind === 'document' && fs.statSync(filePath).size > MAX_MEDIA_ATTACHMENT_SIZE) {
    payload.sourceUrl = `https://web.whatsapp.com/__wppautom_attachment/${attachment.attachmentId}/${encodeURIComponent(attachment.attachmentName || 'documento')}`;
  } else {
    // Inline small documents too, avoiding the local protocol fetch path that can fail before WhatsApp receives the file.
    payload.dataUrl = `data:${payload.mimetype};base64,${fs.readFileSync(filePath).toString('base64')}`;
  }
  return payload;
}

class WhatsAppWebClient {
  constructor() {
    this.view = null;
    this.webContents = null;
    this.mainWindow = null;
    this.status = 'disconnected';
    this.userDataPath = null;
    this.isQuitting = false;
    this.isVisible = false;
    this.isWarmingUp = false;
    this.warmupTimer = null;
    this.injectionPromise = null;
    this.loadRetryTimer = null;
    this.loadRetryCount = 0;
    this.pageLoaded = false;
  }

  setMainWindow(window) {
    if (this.view && this.webContents && !this.webContents.isDestroyed()
      && this.mainWindow && this.mainWindow !== window && !this.mainWindow.isDestroyed()) {
      this.mainWindow.contentView.removeChildView(this.view);
    }
    this.mainWindow = window;
    if (this.view && this.webContents && !this.webContents.isDestroyed()
      && window && !window.isDestroyed()) window.contentView.addChildView(this.view);
  }

  async init(userDataPath) {
    this.userDataPath = userDataPath || this.userDataPath;
    if (!this.view || !this.webContents || this.webContents.isDestroyed()) this.createView();
  }

  createView() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) throw new Error('A janela principal ainda não está pronta.');
    if (this.view) {
      try { this.mainWindow.contentView.removeChildView(this.view); } catch {}
    }
    const whatsappSession = session.fromPartition('persist:whatsapp-web', { cache: false });
    this.view = new WebContentsView({
      webPreferences: {
        session: whatsappSession,
        preload: path.join(__dirname, 'whatsapp-web-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        devTools: !require('electron').app.isPackaged
      }
    });

    this.mainWindow.contentView.addChildView(this.view);
    this.isWarmingUp = !this.isVisible;
    this.view.setVisible(this.isVisible || this.isWarmingUp);
    this.webContents = this.view.webContents;
    const webContents = this.webContents;
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const preventExternalNavigation = (event, url) => {
      try {
        if (new URL(url).origin !== 'https://web.whatsapp.com') event.preventDefault();
      } catch {
        event.preventDefault();
      }
    };
    webContents.on('will-navigate', preventExternalNavigation);
    webContents.on('will-redirect', preventExternalNavigation);
    webContents.on('did-finish-load', () => {
      if (webContents.getURL().startsWith(WHATSAPP_URL)) {
        this.pageLoaded = true;
        this.loadRetryCount = 0;
        if (this.loadRetryTimer) clearTimeout(this.loadRetryTimer);
        this.loadRetryTimer = null;
        this.injectAutomation().then(() => {
          if (this.status === 'connected' || this.status === 'qr_ready') this.finishBackgroundWarmup();
        });
      }
    });
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && validatedURL.startsWith(WHATSAPP_URL)) {
        if (errorCode === -3) return; // ERR_ABORTED during WhatsApp's own navigation.
        this.pageLoaded = false;
        console.error(`[WhatsApp Web] Load failed (${errorCode}): ${errorDescription}`);
        this.setStatus('reconnecting');
        this.scheduleLoadRetry();
      }
    });
    webContents.on('render-process-gone', (_event, details) => {
      console.error(`[WhatsApp Web] Renderer stopped (${details.reason}${details.exitCode ? `, exit ${details.exitCode}` : ''}).`);
      this.setStatus('reconnecting');
      this.scheduleLoadRetry();
    });

    const chromiumVersion = webContents.getUserAgent().match(/Chrome\/([\d.]+)/)?.[1];
    const platform = process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
    const userAgent = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVersion || '120.0.0.0'} Safari/537.36`;
    webContents.setUserAgent(userAgent);
    this.setStatus('connecting');
    const [width, height] = this.mainWindow.getContentSize();
    const viewWidth = Math.max(1, width - 64);
    this.view.setBounds({
      x: this.isWarmingUp ? -viewWidth - 64 : 64,
      y: 0,
      width: viewWidth,
      height: Math.max(1, height)
    });
    if (this.isWarmingUp) {
      this.warmupTimer = setTimeout(() => this.finishBackgroundWarmup(), BACKGROUND_WARMUP_TIMEOUT_MS);
    }
    this.loadWhatsAppPage(webContents);
  }

  finishBackgroundWarmup() {
    if (!this.isWarmingUp) return;
    this.isWarmingUp = false;
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = null;
    if (!this.view || !this.webContents || this.webContents.isDestroyed()) return;
    const [width, height] = this.mainWindow && !this.mainWindow.isDestroyed()
      ? this.mainWindow.getContentSize()
      : [1, 1];
    this.view.setBounds({ x: 64, y: 0, width: Math.max(1, width - 64), height: Math.max(1, height) });
    this.view.setVisible(this.isVisible);
  }

  loadWhatsAppPage(webContents = this.webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    this.pageLoaded = false;
    console.log('[WhatsApp Web] Loading embedded page…');
    webContents.loadURL(WHATSAPP_URL).catch((error) => {
      console.error('[WhatsApp Web] Could not open WhatsApp Web:', error);
      this.setStatus('reconnecting');
      this.scheduleLoadRetry();
    });
  }

  scheduleLoadRetry() {
    if (this.loadRetryTimer || this.isQuitting) return;
    const webContents = this.webContents;
    if (!webContents || typeof webContents.isDestroyed !== 'function' || webContents.isDestroyed()) {
      try {
        this.createView();
      } catch (error) {
        console.error('[WhatsApp Web] Could not recreate embedded view:', error);
      }
      return;
    }
    this.loadRetryCount += 1;
    const delay = Math.min(30000, 2000 * (2 ** Math.min(this.loadRetryCount - 1, 4)));
    console.warn(`[WhatsApp Web] Retrying page load in ${Math.round(delay / 1000)}s (attempt ${this.loadRetryCount}).`);
    this.loadRetryTimer = setTimeout(() => {
      this.loadRetryTimer = null;
      const currentWebContents = this.webContents;
      if (!currentWebContents || currentWebContents.isDestroyed()) {
        try {
          this.createView();
        } catch (error) {
          console.error('[WhatsApp Web] Could not recreate embedded view:', error);
        }
        return;
      }
      this.loadWhatsAppPage(currentWebContents);
    }, delay);
  }

  async injectAutomation() {
    if (!this.webContents || this.webContents.isDestroyed() || this.injectionPromise) return this.injectionPromise;

    const webContents = this.webContents;
    this.injectionPromise = (async () => {
      try {
        const bundlePath = require.resolve('@wppconnect/wa-js');
        const bundle = fs.readFileSync(bundlePath, 'utf8');
        const bootstrap = fs.readFileSync(path.join(__dirname, 'whatsapp-web-bootstrap.js'), 'utf8');
        await webContents.executeJavaScript(bundle, true);
        await webContents.executeJavaScript(bootstrap, true);
        console.log('[WhatsApp Web] WA-JS bundle and contextual bridge injected.');
      } catch (error) {
        console.error('[WhatsApp Web] Automation integration could not be injected:', error);
        this.setStatus('disconnected');
      } finally {
        this.injectionPromise = null;
      }
    })();

    return this.injectionPromise;
  }

  showWindow() {
    if (!this.view || !this.webContents || this.webContents.isDestroyed()) this.createView();
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.warmupTimer = null;
    this.isWarmingUp = false;
    this.isVisible = true;
    this.view.setVisible(true);
    if (!this.pageLoaded && !this.webContents.isLoadingMainFrame()) this.loadWhatsAppPage();
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.show();
      this.mainWindow.focus();
    }
    return this.getStatus();
  }

  async openChatUrl(url) {
    const target = new URL(url);
    if (target.origin !== 'https://web.whatsapp.com' || target.pathname !== '/send') {
      throw new Error('Endereço de conversa do WhatsApp inválido.');
    }

    this.showWindow();
    this.pageLoaded = false;
    await this.webContents.loadURL(target.toString());
    return true;
  }

  isPageLoaded() {
    return this.pageLoaded;
  }

  setViewVisible(visible) {
    this.isVisible = Boolean(visible);
    if (this.isVisible) {
      if (this.warmupTimer) clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
      this.isWarmingUp = false;
    }
    if (this.view && this.webContents && !this.webContents.isDestroyed()) {
      this.view.setVisible(this.isVisible || this.isWarmingUp);
    }
  }

  setViewBounds(bounds) {
    if (!this.view || !this.webContents || this.webContents.isDestroyed()) return;
    this.view.setBounds(this.isWarmingUp && !this.isVisible
      ? { ...bounds, x: bounds.x - bounds.width - 1 }
      : bounds);
  }

  isWebContents(webContents) {
    return Boolean(this.view && this.webContents && !this.webContents.isDestroyed() && this.webContents === webContents);
  }

  setStatus(status, user = null) {
    const allowedStatuses = new Set(['disconnected', 'connecting', 'reconnecting', 'qr_ready', 'connected']);
    if (!allowedStatuses.has(status)) return;

    if (this.status !== status) console.log(`[WhatsApp Web] Connection status: ${status}`);
    this.status = status;
    this.user = user && typeof user === 'object' ? {
      name: typeof user.name === 'string' ? user.name.slice(0, 120) : null,
      phone: typeof user.phone === 'string' ? user.phone.replace(/\D/g, '').slice(0, 15) : null
    } : null;
    this.pushStatusToRenderer();
    if (status === 'connected' || status === 'qr_ready') this.finishBackgroundWarmup();
  }

  getStatus() {
    return {
      status: this.status,
      qrDataUrl: null,
      user: this.user,
      isConnected: this.status === 'connected'
    };
  }

  pushStatusToRenderer() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('whatsapp:status-update', this.getStatus());
    }
  }

  async connect() {
    const status = this.showWindow();
    if (status.status === 'disconnected') this.setStatus('connecting');
    return this.getStatus();
  }

  async logout() {
    if (this.webContents && !this.webContents.isDestroyed()) {
      try {
        await this.webContents.executeJavaScript(`window.WPP?.conn?.logout?.()`);
      } catch (error) {
        console.warn('[WhatsApp Web] Logout request failed:', error);
      }
    }
    this.setStatus('disconnected');
    return true;
  }

  async executeInWhatsAppPage(source) {
    if (!this.view || !this.webContents || this.webContents.isDestroyed() || this.status !== 'connected') {
      throw new Error('O WhatsApp Web não está conectado. Abra o WhatsApp e conecte sua conta.');
    }
    return this.webContents.executeJavaScript(source, true);
  }

  async openChat(phone) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(cleanPhone)) throw new Error('Número de telefone inválido.');

    const jids = getWhatsAppPhoneCandidates(cleanPhone).map((candidate) => `${candidate}@s.whatsapp.net`);
    const activeChatId = await this.executeInWhatsAppPage(`(async () => {
      const jids = ${JSON.stringify(jids)};
      if (!window.WPP?.contact?.queryWidExists) throw new Error('A resolução de contatos do WhatsApp ainda está carregando.');
      if (!window.WPP?.chat?.openChatBottom || !window.WPP.chat.getActiveChat) {
        throw new Error('O WhatsApp ainda não disponibilizou a abertura de conversas.');
      }
      let contact = null;
      let jid = jids[0];
      for (const candidate of jids) {
        try {
          contact = await window.WPP.contact.queryWidExists(candidate);
        } catch (error) {
          throw new Error('A consulta do número no WhatsApp falhou: ' + (error.message || error));
        }
        if (contact) {
          jid = candidate;
          break;
        }
      }
      if (!contact) throw new Error('Este número não tem WhatsApp ou não foi encontrado. Confira o número e tente novamente.');
      const targetJid = contact.lid?._serialized || contact.wid?._serialized || contact.wid?.toString?.() || jid;
      let opened;
      try {
        opened = await window.WPP.chat.openChatBottom(targetJid);
      } catch (error) {
        throw new Error('Não foi possível abrir a conversa pelo fluxo do WhatsApp: ' + (error.message || error));
      }
      if (opened !== true) throw new Error('O WhatsApp não conseguiu abrir uma conversa para este número.');
      const activeChat = await window.WPP.chat.getActiveChat();
      const activeChatId = activeChat?.id?._serialized || activeChat?.id?.toString?.() || '';
      if (!activeChatId) throw new Error('O WhatsApp abriu uma conversa sem identificador de destinatário.');

      let composer = null;
      for (let attempt = 0; attempt < 30 && !composer; attempt++) {
        composer = document.querySelector('[data-testid="conversation-compose-box-input"]');
        if (!composer) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (composer) {
        composer.focus();
        composer.click();
      }
      return activeChatId;
    })()`);
    if (this.webContents && !this.webContents.isDestroyed()) this.webContents.focus();
    return activeChatId;
  }

  async syncContacts() {
    const contacts = await this.executeInWhatsAppPage(`(async () => {
      if (!window.WPP?.contact?.list) throw new Error('A integração com o WhatsApp ainda está carregando.');
      const models = await window.WPP.contact.list({ onlyMyContacts: true });
      return Promise.all(models.map(async (contact) => {
        let id = contact.id?._serialized || contact.id?.toString?.() || '';
        let phoneId = id;
        if (id.endsWith('@lid')) {
          try {
            const entry = await window.WPP.contact.getPnLidEntry(id);
            phoneId = entry?.phoneNumber?._serialized || '';
          } catch {}
        }
        const phone = phoneId.split('@')[0].split(':')[0].replace(/\\D/g, '');
        return {
          name: contact.name || contact.shortName || contact.pushname || phone,
          phone
        };
      }));
    })()`);

    return (contacts || []).filter(contact => /^\d{7,15}$/.test(contact.phone) && contact.name);
  }

  async sendToActiveChat(quickMessage) {
    if (!quickMessage || (!quickMessage.message && !quickMessage.attachmentId)) {
      throw new Error('A mensagem rápida não contém texto nem arquivo.');
    }

    let attachment = null;
    if (quickMessage.attachmentId) {
      if (!/^[0-9a-f-]{36}$/i.test(quickMessage.attachmentId)) throw new Error('Identificador do arquivo inválido.');
      const extension = path.extname(quickMessage.attachmentName || '').toLowerCase();
      const attachmentPath = path.join(this.userDataPath, 'attachments', `${quickMessage.attachmentId}${extension}`);
      const stats = fs.existsSync(attachmentPath) ? fs.statSync(attachmentPath) : null;
      if (!stats?.isFile()) throw new Error('O arquivo salvo nesta mensagem rápida não foi encontrado.');
      if (stats.size > getMaxAttachmentSize()) {
        throw new Error(getAttachmentSizeLimitMessage());
      }
      if (!['image', 'video', 'audio', 'document'].includes(quickMessage.attachmentKind)) {
        throw new Error('Tipo de arquivo salvo não compatível.');
      }
      const attachmentKind = getAttachmentKind(quickMessage.attachmentKind, stats.size);
      attachment = createAttachmentPayload({ ...quickMessage, attachmentKind }, attachmentPath);
    }

    const payload = JSON.stringify({ text: quickMessage.message || '', attachment });
    const result = await this.executeInWhatsAppPage(`(async () => {
      const saved = ${payload};
      const chat = await window.WPP.chat.getActiveChat();
      const chatId = chat?.id?._serialized || chat?.id?.toString?.() || '';
      if (!chatId || /@(broadcast|newsletter)$/.test(chatId)) throw new Error('Abra uma conversa válida antes de enviar.');
      if (saved.attachment) {
        const options = {
          type: saved.attachment.kind,
          filename: saved.attachment.filename,
          mimetype: saved.attachment.mimetype
        };
        if (saved.attachment.kind !== 'audio' && saved.text) options.caption = saved.text;
        let content = saved.attachment.dataUrl;
        if (saved.attachment.sourceUrl) {
          const response = await fetch(saved.attachment.sourceUrl);
          if (!response.ok) throw new Error('Não foi possível carregar o documento anexado.');
          content = await response.blob();
        }
        await window.WPP.chat.sendFileMessage(chatId, content, options);
        if (saved.attachment.kind === 'audio' && saved.text) await window.WPP.chat.sendTextMessage(chatId, saved.text);
        return true;
      }
      await window.WPP.chat.sendTextMessage(chatId, saved.text);
      return true;
    })()`);

    return { success: result === true };
  }

  async sendAutoReply(chatId, reply, attachment = null) {
    if (typeof chatId !== 'string' || !/^[\w.-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(chatId)) {
      throw new Error('Conversa inválida para resposta automática.');
    }
    const text = typeof reply === 'string' ? reply.trim().slice(0, 5000) : '';
    if (!text && !attachment?.attachmentId) throw new Error('A resposta automática está vazia.');

    let media = null;
    if (attachment?.attachmentId) {
      if (!/^[0-9a-f-]{36}$/i.test(attachment.attachmentId)) throw new Error('Identificador de mídia inválido.');
      if (!['audio', 'image', 'video', 'document'].includes(attachment.attachmentKind)) {
        throw new Error('Tipo de mídia da resposta automática inválido.');
      }
      const extension = path.extname(attachment.attachmentName || '').toLowerCase();
      const filePath = path.join(this.userDataPath, 'attachments', `${attachment.attachmentId}${extension}`);
      const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      if (!stats?.isFile()) throw new Error('O arquivo da resposta automática não foi encontrado.');
      if (stats.size > getMaxAttachmentSize()) {
        throw new Error(getAttachmentSizeLimitMessage());
      }
      const attachmentKind = getAttachmentKind(attachment.attachmentKind, stats.size);
      media = createAttachmentPayload({ ...attachment, attachmentKind }, filePath);
    }

    const payload = JSON.stringify({ chatId, text, media });
    const sent = await this.executeInWhatsAppPage(`(async () => {
      const reply = ${payload};
      if (reply.media) {
        if (!window.WPP?.chat?.sendFileMessage) throw new Error('O envio de arquivos pelo WhatsApp ainda está carregando.');
        const options = {
          type: reply.media.kind,
          filename: reply.media.filename,
          mimetype: reply.media.mimetype
        };
        if (reply.media.kind !== 'audio' && reply.text) options.caption = reply.text;
        let content = reply.media.dataUrl;
        if (reply.media.sourceUrl) {
          const response = await fetch(reply.media.sourceUrl);
          if (!response.ok) throw new Error('Não foi possível carregar o documento da resposta automática.');
          content = await response.blob();
        }
        await window.WPP.chat.sendFileMessage(reply.chatId, content, options);
        if (reply.media.kind === 'audio' && reply.text) {
          if (!window.WPP?.chat?.sendTextMessage) throw new Error('O envio de texto pelo WhatsApp ainda está carregando.');
          await window.WPP.chat.sendTextMessage(reply.chatId, reply.text);
        }
        return true;
      }
      if (!window.WPP?.chat?.sendTextMessage) throw new Error('A integração do WhatsApp ainda está carregando.');
      await window.WPP.chat.sendTextMessage(reply.chatId, reply.text);
      return true;
    })()`);
    return sent === true;
  }

  async sendMessage(phone, messageText, attachment = null, options = {}) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!/^\d{7,15}$/.test(cleanPhone)) throw new Error(`Número de telefone inválido: ${phone}`);
    const jids = getWhatsAppPhoneCandidates(cleanPhone).map((candidate) => `${candidate}@c.us`);

    try {
      let result;
      if (attachment?.attachmentId) {
        if (!/^[0-9a-f-]{36}$/i.test(attachment.attachmentId)) throw new Error('Identificador de anexo inválido.');
        const extension = path.extname(attachment.attachmentName || '').toLowerCase();
        const attachmentPath = path.join(this.userDataPath, 'attachments', `${attachment.attachmentId}${extension}`);
        const fileStats = fs.existsSync(attachmentPath) ? fs.statSync(attachmentPath) : null;
        if (!fileStats?.isFile()) throw new Error('O arquivo anexado não foi encontrado.');
        if (fileStats.size > getMaxAttachmentSize()) {
          throw new Error(getAttachmentSizeLimitMessage());
        }

        const kind = getAttachmentKind(attachment.attachmentKind, fileStats.size);
        if (!['image', 'video', 'audio', 'document'].includes(kind)) throw new Error('Tipo de arquivo não compatível.');
        const attachmentPayload = createAttachmentPayload({ ...attachment, attachmentKind: kind }, attachmentPath);
        const payload = JSON.stringify({ jids, attachment: attachmentPayload, messageText: messageText || '' });
        result = await this.executeInWhatsAppPage(`(async () => {
          const a = ${payload};
          if (!window.WPP?.contact?.queryWidExists) throw new Error('A resolução de contatos do WhatsApp ainda está carregando.');
          let contact = null;
          let targetJid = a.jids[0];
          for (const candidate of a.jids) {
            try {
              contact = await window.WPP.contact.queryWidExists(candidate);
            } catch (error) {
              throw new Error('A consulta do número no WhatsApp falhou: ' + (error.message || error));
            }
            if (contact) {
              targetJid = contact.wid?._serialized || contact.wid?.toString?.() || contact.lid?._serialized || candidate;
              break;
            }
          }
          if (!contact) throw new Error('Este número não tem WhatsApp ou não foi encontrado. Confira o número e tente novamente.');
          if (contact) targetJid = contact.wid?._serialized || contact.wid?.toString?.() || contact.lid?._serialized || targetJid;
          if (!window.WPP?.chat?.sendFileMessage) throw new Error('A integração com o WhatsApp ainda está carregando.');
          const options = { type: a.attachment.kind, filename: a.attachment.filename, mimetype: a.attachment.mimetype };
          if (a.attachment.kind !== 'audio' && a.messageText) options.caption = a.messageText;
          let content = a.attachment.dataUrl;
          if (a.attachment.sourceUrl) {
            const response = await fetch(a.attachment.sourceUrl);
            if (!response.ok) throw new Error('Não foi possível carregar o documento anexado.');
            content = await response.blob();
          }
          const sent = await window.WPP.chat.sendFileMessage(targetJid, content, options);
          if (a.attachment.kind === 'audio' && a.messageText) await window.WPP.chat.sendTextMessage(targetJid, a.messageText);
          const messageId = sent?.id?._serialized || sent?.id;
          return typeof messageId === 'string' ? messageId : '';
        })()`);
      } else {
        const payload = JSON.stringify({ jids, text: messageText || '', openChatFirst: options.openChatFirst === true });
        result = await this.executeInWhatsAppPage(`(async () => {
          const a = ${payload};
          if (!window.WPP?.chat?.sendTextMessage) throw new Error('A integração com o WhatsApp ainda está carregando.');
          if (!window.WPP?.contact?.queryWidExists) throw new Error('A resolução de contatos do WhatsApp ainda está carregando.');
          let contact = null;
          let targetJid = a.jids[0];
          for (const candidate of a.jids) {
            try {
              contact = await window.WPP.contact.queryWidExists(candidate);
            } catch (error) {
              throw new Error('A consulta do número no WhatsApp falhou: ' + (error.message || error));
            }
            if (contact) {
              targetJid = candidate;
              break;
            }
          }
          if (!contact) throw new Error('Este número não tem WhatsApp ou não foi encontrado. Confira o número e tente novamente.');
          targetJid = contact.wid?._serialized || contact.wid?.toString?.() || contact.lid?._serialized || targetJid;
          if (a.openChatFirst) {
            if (!window.WPP.chat.openChatBottom || !window.WPP.chat.getActiveChat) {
              throw new Error('O WhatsApp ainda não disponibilizou a abertura de conversas.');
            }
            let opened;
            try {
              opened = await window.WPP.chat.openChatBottom(targetJid);
            } catch (error) {
              throw new Error('Não foi possível abrir a conversa pelo fluxo do WhatsApp: ' + (error.message || error));
            }
            if (opened !== true) throw new Error('O WhatsApp não conseguiu abrir uma conversa para este número.');
            const activeChat = await window.WPP.chat.getActiveChat();
            const activeChatId = activeChat?.id?._serialized || activeChat?.id?.toString?.() || '';
            if (!activeChatId) throw new Error('O WhatsApp abriu uma conversa sem identificador de destinatário.');
            // Keep the canonical phone JID returned by queryWidExists. WhatsApp Web
            // may expose the active chat as a LID, which breaks WA-JS sending on
            // current WhatsApp builds (UserPrefs.getMeLidUserOrThrow is missing).
          }
          let sent;
          try {
            sent = await window.WPP.chat.sendTextMessage(targetJid, a.text);
          } catch (error) {
            throw new Error('O WhatsApp encontrou o destinatário (' + targetJid + '), mas recusou o envio: ' + (error.message || error));
          }
          const messageId = sent?.id?._serialized || sent?.id;
          return typeof messageId === 'string' ? messageId : '';
        })()`);
      }

      return {
        success: true,
        messageId: (typeof result === 'string' && result) || `wa_${Date.now()}`,
        sentAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('[WhatsApp Web] Message sending failed:', error);
      throw new Error(error.message || 'Falha ao enviar mensagem pelo WhatsApp Web.');
    }
  }

  async destroy() {
    this.isQuitting = true;
    if (this.loadRetryTimer) clearTimeout(this.loadRetryTimer);
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
    this.loadRetryTimer = null;
    this.warmupTimer = null;
    this.isWarmingUp = false;
    if (this.view && this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.contentView.removeChildView(this.view);
    }
    if (this.webContents && !this.webContents.isDestroyed()) this.webContents.close();
    this.view = null;
    this.webContents = null;
    this.pageLoaded = false;
    this.status = 'disconnected';
  }
}

const whatsappClient = new WhatsAppWebClient();

module.exports = { whatsappClient };
