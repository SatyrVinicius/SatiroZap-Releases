/**
 * Electron Main Process Entry Point
 * Creates the native desktop window, registers IPC handlers,
 * starts WhatsApp client, scheduler, and system tray.
 */

const { app, BrowserWindow, WebContentsView, session, ipcMain, nativeImage, dialog, shell, safeStorage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const database = require('./database');
const { getWhatsAppSendRequest, normalizeWhatsAppPhone } = require('./whatsappLink');
const { isValidTimeRange, rangesOverlap, selectSingleAutoReplyRule } = require('./autoReplySchedule');
const { whatsappClient } = require('./whatsappWebClient');
const { scheduler } = require('./scheduler');
const { createTray, startTrayUpdater, destroyTray } = require('./tray');

let mainWindow = null;
let accessWindow = null;
let startupAccessGranted = false;
const browserTabs = [];
let activeBrowserTabId = null;
let activeEmbeddedPage = 'google';
let browserChromeCollapsed = true;
let browserSession = null;
const pendingWhatsAppLinkSends = new Set();
let attachmentsDirectory = null;
const pendingAttachments = new Map();
let pendingAutomationContact = null;
let mainRendererReady = false;
const MAX_MEDIA_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024 * 1024;
protocol.registerSchemesAsPrivileged([{
  scheme: 'wpp-attachment',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);
const SUPABASE_ACCESS_URL = 'https://xugflpfnsmecxglzervw.supabase.co/rest/v1/SATIROZAP';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z2ZscGZuc21lY3hnbHplcnZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU2NTg1NzgsImV4cCI6MjA4MTIzNDU3OH0.Ax_yRhkE5-OKATqoxier57GGI2WHjmHWobKAQygdivc';
const ACCESS_CREDENTIAL_FILE = 'satirozap-access.bin';
const SIDEBAR_WIDTH = 64;
const BROWSER_CHROME_HEIGHT = 112;
const BROWSER_CHROME_COLLAPSED_HEIGHT = 40;
const MEDIA_TYPES = {
  '.jpg': { mimeType: 'image/jpeg', kind: 'image' },
  '.jpeg': { mimeType: 'image/jpeg', kind: 'image' },
  '.png': { mimeType: 'image/png', kind: 'image' },
  '.gif': { mimeType: 'image/gif', kind: 'image' },
  '.bmp': { mimeType: 'image/bmp', kind: 'image' },
  '.webp': { mimeType: 'image/webp', kind: 'image' },
  '.heic': { mimeType: 'image/heic', kind: 'image' },
  '.heif': { mimeType: 'image/heif', kind: 'image' },
  '.mp4': { mimeType: 'video/mp4', kind: 'video' },
  '.mov': { mimeType: 'video/quicktime', kind: 'video' },
  '.mkv': { mimeType: 'video/x-matroska', kind: 'video' },
  '.webm': { mimeType: 'video/webm', kind: 'video' },
  '.avi': { mimeType: 'video/x-msvideo', kind: 'video' },
  '.3gp': { mimeType: 'video/3gpp', kind: 'video' },
  '.mp3': { mimeType: 'audio/mpeg', kind: 'audio' },
  '.m4a': { mimeType: 'audio/mp4', kind: 'audio' },
  '.aac': { mimeType: 'audio/aac', kind: 'audio' },
  '.ogg': { mimeType: 'audio/ogg', kind: 'audio' },
  '.opus': { mimeType: 'audio/ogg', kind: 'audio' },
  '.wav': { mimeType: 'audio/wav', kind: 'audio' },
  '.flac': { mimeType: 'audio/flac', kind: 'audio' },
  '.pdf': { mimeType: 'application/pdf', kind: 'document' },
  '.txt': { mimeType: 'text/plain', kind: 'document' },
  '.csv': { mimeType: 'text/csv', kind: 'document' },
  '.rtf': { mimeType: 'application/rtf', kind: 'document' },
  '.doc': { mimeType: 'application/msword', kind: 'document' },
  '.docx': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  '.xls': { mimeType: 'application/vnd.ms-excel', kind: 'document' },
  '.xlsx': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' },
  '.ppt': { mimeType: 'application/vnd.ms-powerpoint', kind: 'document' },
  '.pptx': { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'document' },
  '.zip': { mimeType: 'application/zip', kind: 'document' },
  '.rar': { mimeType: 'application/vnd.rar', kind: 'document' },
  '.7z': { mimeType: 'application/x-7z-compressed', kind: 'document' }
};

function getAttachmentType(extension) {
  return MEDIA_TYPES[extension] || { mimeType: 'application/octet-stream', kind: 'document' };
}

function getAttachmentKind(mediaType, size) {
  return mediaType.kind !== 'document' && size > MAX_MEDIA_ATTACHMENT_SIZE
    ? 'document'
    : mediaType.kind;
}

function isWhatsAppWebEvent(event) {
  if (!whatsappClient.isWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return false;
  try {
    return new URL(event.senderFrame.url).origin === 'https://web.whatsapp.com';
  } catch {
    return false;
  }
}

function isMainRendererEvent(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed()
    && event.sender === mainWindow.webContents
    && event.senderFrame === event.sender.mainFrame);
}

function getSavedAccessPassword() {
  const credentialPath = path.join(app.getPath('userData'), ACCESS_CREDENTIAL_FILE);
  if (!fs.existsSync(credentialPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O armazenamento seguro do Windows não está disponível.');
  const encryptedPassword = fs.readFileSync(credentialPath);
  const password = safeStorage.decryptString(encryptedPassword);
  if (!password) throw new Error('A senha de acesso salva está vazia.');
  return password;
}

function saveAccessPassword(password) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O armazenamento seguro do Windows não está disponível.');
  const credentialPath = path.join(app.getPath('userData'), ACCESS_CREDENTIAL_FILE);
  const temporaryPath = `${credentialPath}.${process.pid}.tmp`;
  const encryptedPassword = safeStorage.encryptString(password);
  fs.writeFileSync(temporaryPath, encryptedPassword, { mode: 0o600 });
  fs.renameSync(temporaryPath, credentialPath);
}

async function showAccessBlockedMessage(message, type = 'error') {
  await dialog.showMessageBox({
    type,
    title: 'SátiroPMS | Sátiro Sistemas',
    buttons: ['OK'],
    defaultId: 0,
    message
  });
  app.isQuitting = true;
  app.quit();
}

async function querySupabaseAccess(password) {
  const endpoint = new URL(SUPABASE_ACCESS_URL);
  endpoint.searchParams.set('select', 'ativo');
  endpoint.searchParams.set('senha', `eq.${password}`);
  endpoint.searchParams.set('limit', '2');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Supabase respondeu com HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.ativo !== 'boolean') return 'invalid';
    return rows[0].ativo ? 'active' : 'suspended';
  } finally {
    clearTimeout(timeout);
  }
}

async function querySupabasePasswordUsage(password) {
  const endpoint = new URL(SUPABASE_ACCESS_URL);
  endpoint.searchParams.set('select', 'usado');
  endpoint.searchParams.set('senha', `eq.${password}`);
  endpoint.searchParams.set('limit', '2');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Supabase respondeu com HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.usado !== 'boolean') return null;
    return rows[0].usado;
  } finally {
    clearTimeout(timeout);
  }
}

function showStartupAccessGate() {
  return new Promise((resolve) => {
    let finished = false;
    let verificationAttempted = false;
    const finish = (granted) => {
      if (finished) return;
      finished = true;
      startupAccessGranted = granted;
      resolve(granted);
    };

    accessWindow = new BrowserWindow({
      width: 440,
      height: 390,
      minWidth: 380,
      minHeight: 360,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      alwaysOnTop: true,
      title: 'Acesso ao SátiroZap',
      backgroundColor: '#0C1317',
      webPreferences: {
        preload: path.join(__dirname, 'access-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false
      }
    });

    const isGateEvent = (event) => Boolean(accessWindow && !accessWindow.isDestroyed()
      && event.sender === accessWindow.webContents
      && event.senderFrame === event.sender.mainFrame);

    ipcMain.handle('access:verify', async (event, password) => {
      if (!isGateEvent(event)) throw new Error('Origem inválida para verificação de acesso.');
      if (verificationAttempted) {
        return { status: 'denied', message: 'A consulta de acesso desta abertura já foi realizada. Feche e abra o aplicativo novamente.' };
      }
      if (typeof password !== 'string' || password.length < 1 || password.length > 256) {
        verificationAttempted = true;
        return { status: 'denied', message: 'Senha inválida. Feche e abra o aplicativo para tentar novamente.' };
      }

      verificationAttempted = true;
      try {
        const result = await querySupabaseAccess(password);
        if (result === 'active') {
          const passwordInUse = await querySupabasePasswordUsage(password);
          if (passwordInUse === true) {
            return {
              status: 'denied',
              message: 'Esta senha já está sendo usada por outro usuário, por isso não é possível prosseguir.'
            };
          }
          if (passwordInUse !== false) {
            return {
              status: 'error',
              message: 'Não foi possível verificar se esta senha está em uso. Feche o aplicativo e tente novamente.'
            };
          }
          saveAccessPassword(password);
          finish(true);
          accessWindow.close();
          return { status: 'active' };
        }
        if (result === 'suspended') {
          await dialog.showMessageBox(accessWindow, {
            type: 'warning',
            title: 'SátiroZap',
            buttons: ['OK'],
            defaultId: 0,
            message: 'Aplicativo suspenso. Fale com o suporte da Sátiro Sistemas | (84) 9 3300-4200'
          });
          finish(false);
          app.isQuitting = true;
          app.quit();
          return { status: 'suspended' };
        }
        return { status: 'denied', message: 'Senha não encontrada. Feche o aplicativo e abra novamente para tentar outra vez.' };
      } catch (error) {
        console.error('[Access] Supabase access check failed:', error.message);
        return { status: 'error', message: 'Não foi possível consultar o acesso. Verifique a internet e abra o aplicativo novamente.' };
      }
    });

    ipcMain.handle('access:exit', (event) => {
      if (!isGateEvent(event)) throw new Error('Origem inválida para fechar o aplicativo.');
      finish(false);
      app.isQuitting = true;
      app.quit();
      return true;
    });

    accessWindow.on('closed', () => {
      accessWindow = null;
      if (!finished) {
        finish(false);
        app.isQuitting = true;
        app.quit();
      }
    });

    accessWindow.once('ready-to-show', () => accessWindow?.show());
    accessWindow.loadFile(path.join(__dirname, '..', 'access.html')).catch(async (error) => {
      console.error('[Access] Could not load access window:', error);
      await dialog.showMessageBox({
        type: 'error',
        title: 'SátiroZap',
        buttons: ['OK'],
        message: 'Não foi possível abrir a tela de acesso. Feche e tente iniciar o aplicativo novamente.'
      });
      finish(false);
      app.isQuitting = true;
      app.quit();
    });
  });
}

function updateEmbeddedViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const browserChromeHeight = browserChromeCollapsed ? BROWSER_CHROME_COLLAPSED_HEIGHT : BROWSER_CHROME_HEIGHT;
  const whatsappBounds = {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(1, width - SIDEBAR_WIDTH),
    height: Math.max(1, height)
  };
  const browserBounds = {
    x: SIDEBAR_WIDTH,
    y: browserChromeHeight,
    width: Math.max(1, width - SIDEBAR_WIDTH),
    height: Math.max(1, height - browserChromeHeight)
  };
  whatsappClient.setViewBounds(whatsappBounds);
  for (const tab of browserTabs) tab.view.setBounds(browserBounds);
}

function getBrowserTab(tabId = activeBrowserTabId) {
  return browserTabs.find(tab => tab.id === tabId) || null;
}

function getBrowserState() {
  return {
    activeTabId: activeBrowserTabId,
    chromeCollapsed: browserChromeCollapsed,
    tabs: browserTabs.map(tab => {
      const contents = tab.view.webContents;
      const destroyed = contents.isDestroyed();
      return {
        id: tab.id,
        title: tab.title,
        url: (destroyed ? tab.url : (contents.getURL() || tab.url)).startsWith('data:application/pdf')
          ? 'PDF gerado'
          : (destroyed ? tab.url : (contents.getURL() || tab.url)),
        canGoBack: !destroyed && contents.navigationHistory.canGoBack(),
        canGoForward: !destroyed && contents.navigationHistory.canGoForward(),
        isLoading: !destroyed && contents.isLoadingMainFrame()
      };
    })
  };
}

function pushBrowserState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('browser:state', getBrowserState());
}

function normalizeBrowserUrl(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Digite um endereço ou termo para pesquisar.');
  let candidate = value;
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    candidate = /^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:[/?#].*)?$/i.test(candidate)
      ? `https://${candidate}`
      : `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
  }
  const url = new URL(candidate);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Por segurança, o navegador aceita apenas endereços HTTP ou HTTPS.');
  return url.toString();
}

function normalizeBrowserPopupUrl(input) {
  const value = String(input || '').trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('O site abriu um endereço que o navegador não consegue carregar.');
  }

  if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
  if (url.protocol === 'blob:' && ['https:', 'http:'].includes(url.origin.split(':')[0] + ':')) return value;
  if (/^data:application\/pdf(?:;[^,]*)?,/i.test(value)) return value;
  throw new Error('O site tentou abrir um tipo de endereço não permitido.');
}

function sendWhatsAppMessageFromLink(request) {
  const phone = normalizeWhatsAppPhone(request.phone);
  const requestKey = `${phone}\u0000${request.message}`;
  if (pendingWhatsAppLinkSends.has(requestKey)) return;
  pendingWhatsAppLinkSends.add(requestKey);
  const notify = (status, details = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp:link-send-status', { status, phone, ...details });
    }
  };

  notify('sending');
  console.info(`[WhatsApp] Link send requested for +${phone}.`);
  whatsappClient.sendMessage(phone, request.message, null, { openChatFirst: true })
    .then(() => {
      notify('success');
      const soundPath = path.join(app.getPath('downloads'), 'enviado.mp3');
      fs.readFile(soundPath, (error, sound) => {
        if (error) {
          console.warn(`[WhatsApp] Custom send sound unavailable (${soundPath}):`, error.message);
          try { shell.beep(); } catch {}
          return;
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('whatsapp:link-send-sound', `data:audio/mpeg;base64,${sound.toString('base64')}`);
        }
      });
    })
    .catch(async (error) => {
      console.error('[WhatsApp] Could not send message from website link:', error);
      if (await showWhatsAppNumberUnavailableDialog(error)) return;
      notify('error', { message: error.message || 'Não foi possível enviar a mensagem pelo WhatsApp.' });
    })
    .finally(() => pendingWhatsAppLinkSends.delete(requestKey));
}

async function showWhatsAppNumberUnavailableDialog(error) {
  if (!/não tem WhatsApp|não está registrado no WhatsApp|não foi encontrado/i.test(String(error?.message || error || ''))) {
    return false;
  }

  const options = {
    type: 'warning',
    title: 'Número sem WhatsApp',
    buttons: ['OK'],
    defaultId: 0,
    message: 'Este número não tem WhatsApp ou não foi encontrado.',
    detail: 'Confira o número e tente novamente.'
  };
  if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
  else await dialog.showMessageBox(options);
  return true;
}

function openWhatsAppChatFromLink(request) {
  const phone = normalizeWhatsAppPhone(request.phone);
  const notify = (status, details = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp:link-send-status', { status, phone, ...details });
    }
  };

  notify('opening');
  whatsappClient.openChat(phone)
    .then(() => {
      setEmbeddedPage('whatsapp');
      notify('opened');
    })
    .catch(async (error) => {
      console.error('[WhatsApp] Could not open chat from link:', error);
      if (await showWhatsAppNumberUnavailableDialog(error)) return;
      notify('error', { message: error.message || 'Não foi possível abrir a conversa pelo WhatsApp.' });
    });
}

function handleWhatsAppLinkRequest(request) {
  if (request.openOnly) openWhatsAppChatFromLink(request);
  else sendWhatsAppMessageFromLink(request);
}

function isAllowedBrowserNavigation(input) {
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' || url.protocol === 'http:') return true;
    if (url.protocol === 'blob:') return ['https:', 'http:'].includes(`${url.origin.split(':')[0]}:`);
    return url.protocol === 'data:' && /^data:application\/pdf(?:;[^,]*)?,/i.test(input);
  } catch {
    return false;
  }
}

function installPdfPopupBridge(webContents) {
  const source = `(() => {
    if (window.__schedulerPdfPopupBridgeInstalled) return;
    window.__schedulerPdfPopupBridgeInstalled = true;
    const nativeOpen = window.open.bind(window);
    const openPdfBlob = async (blobUrl, target, features) => {
      try {
        const response = await fetch(blobUrl);
        if (!response.ok) throw new Error('Não foi possível ler o PDF gerado pelo site.');
        const contentType = response.headers.get('content-type') || '';
        const bytes = new Uint8Array(await response.arrayBuffer());
        const signature = String.fromCharCode(...bytes.subarray(0, 5));
        if (!/application\\/pdf/i.test(contentType) && signature !== '%PDF-') {
          return nativeOpen(blobUrl, target || '_blank', features);
        }
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return nativeOpen('data:application/pdf;base64,' + btoa(binary), target || '_blank', features);
      } catch (error) {
        console.error('[Browser] Não foi possível abrir PDF gerado:', error);
        return null;
      }
    };
    window.open = function(url, target, features) {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        void openPdfBlob(url, target, features);
        return null;
      }
      return nativeOpen(url, target, features);
    };
    document.addEventListener('click', (event) => {
      const link = event.target.closest && event.target.closest('a[target="_blank"]');
      if (!link || !link.href.startsWith('blob:') || link.hasAttribute('download')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void openPdfBlob(link.href, '_blank');
    }, true);
  })();`;

  if (webContents.isDestroyed()) return;
  webContents.executeJavaScript(source, true).catch((error) => {
    console.warn('[Browser] Could not install PDF popup bridge:', error.message);
  });
}

function createUniqueDownloadPath(filename) {
  const downloadsPath = app.getPath('downloads');
  fs.mkdirSync(downloadsPath, { recursive: true });
  const parsed = path.parse(path.basename(filename || 'download'));
  const safeName = (parsed.name || 'download').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'download';
  const extension = parsed.ext.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '');
  let candidate = path.join(downloadsPath, `${safeName}${extension}`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadsPath, `${safeName} (${suffix})${extension}`);
    suffix += 1;
  }
  return candidate;
}

function getBrowserSession() {
  if (browserSession) return browserSession;
  browserSession = session.fromPartition('persist:google-web', { cache: false });
  browserSession.on('will-download', (event, item, contents) => {
    const isBrowserTab = browserTabs.some(tab => tab.view.webContents === contents);
    if (!isBrowserTab) return;

    const savePath = createUniqueDownloadPath(item.getFilename());
    item.setSavePath(savePath);
    console.log(`[Browser] Downloading ${item.getFilename()} to ${savePath}`);
    item.once('done', (_downloadEvent, state) => {
      if (state === 'completed') {
        console.log(`[Browser] Download completed: ${savePath}`);
        shell.showItemInFolder(savePath);
      } else {
        console.warn(`[Browser] Download ${state}: ${item.getFilename()}`);
      }
    });
  });
  browserSession.webRequest.onBeforeRequest({
    urls: [
      'https://api.whatsapp.com/*',
      'https://*.whatsapp.com/*',
      'https://whatsapp.com/*',
      'https://wa.me/*'
    ],
    types: ['mainFrame']
  }, (details, callback) => {
    const request = getWhatsAppSendRequest(details.url);
    if (request) {
      console.info(`[Browser] Intercepted WhatsApp send navigation from ${details.url.split('?')[0]}.`);
      handleWhatsAppLinkRequest(request);
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  return browserSession;
}

function createBrowserTab(initialUrl = 'https://pms.satirosistemas.com.br/') {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('A janela principal ainda não está pronta.');
  if (browserTabs.length >= 12) throw new Error('Limite de 12 abas abertas atingido.');
  const id = crypto.randomUUID();
  const view = new WebContentsView({
    webPreferences: {
      session: getBrowserSession(),
      preload: path.join(__dirname, 'browser-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true
    }
  });
  const tab = { id, title: 'Nova guia', url: initialUrl, view };
  browserTabs.push(tab);
  mainWindow.contentView.addChildView(view);
  view.setVisible(false);
  view.webContents.setWindowOpenHandler(({ url }) => {
    const whatsappRequest = getWhatsAppSendRequest(url);
    if (whatsappRequest) {
      handleWhatsAppLinkRequest(whatsappRequest);
      return { action: 'deny' };
    }
    try {
      const newTab = createBrowserTab(normalizeBrowserPopupUrl(url));
      selectBrowserTab(newTab.id);
    } catch (error) {
      console.warn('[Browser] Popup blocked:', error.message);
    }
    return { action: 'deny' };
  });
  const allowSecureNavigation = (event, url) => {
    const whatsappRequest = getWhatsAppSendRequest(url);
    if (whatsappRequest) {
      event.preventDefault();
      handleWhatsAppLinkRequest(whatsappRequest);
      return;
    }
    if (!isAllowedBrowserNavigation(url)) event.preventDefault();
  };
  view.webContents.on('will-navigate', allowSecureNavigation);
  view.webContents.on('will-redirect', allowSecureNavigation);
  view.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    tab.title = String(title || '').trim().slice(0, 80) || new URL(view.webContents.getURL()).hostname;
    pushBrowserState();
  });
  view.webContents.on('did-finish-load', () => {
    if (/^https?:/i.test(view.webContents.getURL())) installPdfPopupBridge(view.webContents);
  });
  for (const eventName of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) {
    view.webContents.on(eventName, () => {
      tab.url = view.webContents.getURL() || tab.url;
      pushBrowserState();
    });
  }
  view.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Browser] Renderer stopped (${details.reason}).`);
  });
  view.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) console.warn(`[Browser] Page load failed (${code}): ${description} — ${url}`);
  });
  updateEmbeddedViewBounds();
  view.webContents.loadURL(initialUrl).catch((error) => {
    console.error('[Browser] Could not open page:', error);
  });
  activeBrowserTabId = id;
  pushBrowserState();
  return tab;
}

function setEmbeddedPage(page, toggle = false) {
  const canToggleHome = page !== 'whatsapp' || whatsappClient.isPageLoaded();
  const target = toggle && activeEmbeddedPage === page && canToggleHome ? 'app' : page;
  if (!['app', 'whatsapp', 'google'].includes(target)) throw new Error('Aba inválida.');

  if (target === 'whatsapp') {
    for (const tab of browserTabs) tab.view.setVisible(false);
    whatsappClient.showWindow();
  } else {
    whatsappClient.setViewVisible(false);
    if (target === 'google') {
      let tab = getBrowserTab();
      if (!tab) tab = createBrowserTab();
      for (const browserTab of browserTabs) browserTab.view.setVisible(browserTab.id === tab.id);
    } else {
      for (const tab of browserTabs) tab.view.setVisible(false);
    }
  }

  activeEmbeddedPage = target;
  updateEmbeddedViewBounds();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('navigation:page-changed', activeEmbeddedPage);
  }
  pushBrowserState();
  return activeEmbeddedPage;
}

function selectBrowserTab(tabId) {
  const tab = getBrowserTab(tabId);
  if (!tab) throw new Error('A aba selecionada não existe mais.');
  activeBrowserTabId = tab.id;
  whatsappClient.setViewVisible(false);
  for (const browserTab of browserTabs) browserTab.view.setVisible(browserTab.id === tab.id);
  activeEmbeddedPage = 'google';
  updateEmbeddedViewBounds();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('navigation:page-changed', activeEmbeddedPage);
  pushBrowserState();
  return getBrowserState();
}

function closeBrowserTab(tabId) {
  const index = browserTabs.findIndex(tab => tab.id === tabId);
  if (index < 0) return getBrowserState();
  const [tab] = browserTabs.splice(index, 1);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(tab.view);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (activeBrowserTabId === tabId) {
    activeBrowserTabId = browserTabs[Math.min(index, browserTabs.length - 1)]?.id || null;
    if (!activeBrowserTabId) {
      const replacement = createBrowserTab();
      if (activeEmbeddedPage === 'google') replacement.view.setVisible(true);
    } else {
      const active = getBrowserTab();
      if (activeEmbeddedPage === 'google') active.view.setVisible(true);
    }
  }
  pushBrowserState();
  return getBrowserState();
}

function getAttachmentPath(attachmentId, attachmentName) {
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId || '')) {
    throw new Error('Identificador de anexo inválido.');
  }

  const extension = path.extname(attachmentName || '').toLowerCase();
  if (extension && !/^\.[a-z0-9]{1,12}$/.test(extension)) throw new Error('Extensão de arquivo inválida.');

  return path.join(attachmentsDirectory, `${attachmentId}${extension}`);
}

function getMaxAttachmentSize() {
  return MAX_ATTACHMENT_SIZE;
}

function getAttachmentSizeLimitMessage() {
  return 'Os anexos podem ter no máximo 2 GB.';
}

function registerAttachmentProtocol() {
  const whatsappSession = session.fromPartition('persist:whatsapp-web', { cache: false });
  whatsappSession.protocol.handle('wpp-attachment', (request) => {
    const origin = request.headers.get('origin') || '';
    const corsHeaders = new Headers({
      'Access-Control-Allow-Origin': 'https://web.whatsapp.com',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'no-store'
    });

    if (origin && origin !== 'https://web.whatsapp.com') return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

    let attachmentId;
    try {
      attachmentId = new URL(request.url).hostname;
    } catch {
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
    if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return new Response('Not Found', { status: 404, headers: corsHeaders });

    const metadata = [
      ...pendingAttachments.values(),
      ...database.getMessages(),
      ...database.getQuickMessages(),
      ...database.getAutoReplyRules()
    ].find(item => item.attachmentId === attachmentId);
    if (!metadata || metadata.attachmentKind !== 'document') {
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }

    try {
      const filePath = getAttachmentPath(attachmentId, metadata.attachmentName);
      const stats = fs.statSync(filePath);
      if (!stats.isFile() || stats.size > MAX_ATTACHMENT_SIZE) {
        return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
      corsHeaders.set('Content-Type', metadata.attachmentMimeType || 'application/octet-stream');
      corsHeaders.set('Content-Length', String(stats.size));
      corsHeaders.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(metadata.attachmentName || 'documento')}`);
      return new Response(Readable.toWeb(fs.createReadStream(filePath)), { status: 200, headers: corsHeaders });
    } catch (error) {
      console.error('[Attachments] Could not stream document to WhatsApp Web:', error.message);
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
  });
  whatsappSession.webRequest.onBeforeRequest({
    urls: ['https://web.whatsapp.com/__wppautom_attachment/*']
  }, (details, callback) => {
    let attachmentId = '';
    try {
      attachmentId = new URL(details.url).pathname.split('/')[2] || '';
    } catch {}
    callback(/^[0-9a-f-]{36}$/i.test(attachmentId)
      ? { redirectURL: `wpp-attachment://${attachmentId}` }
      : { cancel: true });
  });
}

function removeAttachmentFile(attachmentId, attachmentName) {
  if (!attachmentId || !attachmentsDirectory) return;

  try {
    const filePath = getAttachmentPath(attachmentId, attachmentName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.warn('[Attachments] Não foi possível remover um anexo:', error);
  }
}

function removeAttachmentIfUnused(attachmentId, attachmentName) {
  if (!attachmentId || pendingAttachments.has(attachmentId)) return;
  const isReferenced = [
    ...database.getMessages(),
    ...database.getQuickMessages(),
    ...database.getAutoReplyRules()
  ].some(item => item.attachmentId === attachmentId);
  if (!isReferenced) removeAttachmentFile(attachmentId, attachmentName);
}

function getAttachmentMetadata(attachmentId, existingMessage = null) {
  if (!attachmentId) {
    return { attachmentId: null, attachmentName: null, attachmentMimeType: null, attachmentKind: null };
  }

  const pending = pendingAttachments.get(attachmentId);
  const metadata = pending || (existingMessage?.attachmentId === attachmentId ? existingMessage : null);
  if (!metadata) throw new Error('Selecione novamente o arquivo que deseja anexar.');

  const filePath = getAttachmentPath(attachmentId, metadata.attachmentName);
  if (!fs.existsSync(filePath)) throw new Error('O arquivo anexado não foi encontrado. Selecione-o novamente.');
  const fileStats = fs.statSync(filePath);
  const mediaType = getAttachmentType(path.extname(metadata.attachmentName).toLowerCase());
  const attachmentKind = getAttachmentKind(mediaType, fileStats.size);
  if (attachmentKind !== metadata.attachmentKind || mediaType.mimeType !== metadata.attachmentMimeType) {
    throw new Error('Os dados do arquivo anexado são inválidos. Selecione-o novamente.');
  }
  if (fileStats.size > getMaxAttachmentSize()) {
    throw new Error(getAttachmentSizeLimitMessage());
  }

  return {
    attachmentId,
    attachmentName: metadata.attachmentName,
    attachmentMimeType: metadata.attachmentMimeType,
    attachmentKind: metadata.attachmentKind
  };
}

function normalizeReplyMatchText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

function findAutoReplyRule(messageText) {
  const normalizedMessage = normalizeReplyMatchText(messageText);
  if (!normalizedMessage) return null;
  const rules = database.getAutoReplyRules()
    .filter(rule => Number(rule.enabled) === 1)
    .sort((left, right) => normalizeReplyMatchText(right.keyword).length - normalizeReplyMatchText(left.keyword).length);

  return rules.find((rule) => {
    const keyword = normalizeReplyMatchText(rule.keyword);
    if (!keyword) return false;
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escapedKeyword}($|[^a-z0-9])`, 'i').test(normalizedMessage);
  }) || null;
}

async function handleIncomingWhatsAppMessage(event, payload) {
  if (!isWhatsAppWebEvent(event) || !payload || typeof payload !== 'object') return;
  if (payload.fromMe !== false || typeof payload.messageId !== 'string' || typeof payload.chatId !== 'string') return;
  const messageId = payload.messageId.trim().slice(0, 200);
  const chatId = payload.chatId.trim().slice(0, 120);
  const messageText = typeof payload.text === 'string' ? payload.text.trim().slice(0, 5000) : '';
  if (!messageId || !/^[\w.-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(chatId)) return;
  if (database.isAutoReplyPausedForChat(chatId)) return;
  const enabledRules = database.getAutoReplyRules().filter(rule => Number(rule.enabled) === 1);
  if (enabledRules.length === 0) return;

  const singleRule = selectSingleAutoReplyRule(enabledRules, new Date());
  const keywordRule = findAutoReplyRule(messageText);
  if (!singleRule && !keywordRule) return;
  if (!database.claimAutoReplyMessage(messageId)) return;

  const rulesToSend = [];
  let cooldownClaim = null;
  if (singleRule) {
    try {
      cooldownClaim = database.claimAutoReplyCooldown(
        singleRule.id,
        chatId,
        Number(singleRule.cooldownHours || 24) * 60 * 60 * 1000
      );
      if (cooldownClaim) rulesToSend.push(singleRule);
    } catch (error) {
      console.error('[AutoReply] Could not claim single-response cooldown:', error.message);
    }
  }
  if (keywordRule) rulesToSend.push(keywordRule);
  if (rulesToSend.length === 0) return;

  let sentAny = false;
  for (const rule of rulesToSend) {
    const isSingleRule = rule.mode === 'single';
    const attachment = rule.attachmentId ? {
      attachmentId: rule.attachmentId,
      attachmentName: rule.attachmentName,
      attachmentMimeType: rule.attachmentMimeType,
      attachmentKind: rule.attachmentKind
    } : null;
    try {
      const sent = await whatsappClient.sendAutoReply(chatId, rule.reply, attachment);
      if (!sent) throw new Error('O WhatsApp não confirmou o envio da resposta automática.');
      sentAny = true;
      console.log(`[AutoReply] Replied to ${chatId} using ${isSingleRule ? 'single-response rule' : `keyword "${rule.keyword}"`}.`);
    } catch (error) {
      if (isSingleRule && cooldownClaim) {
        database.releaseAutoReplyCooldown(singleRule.id, chatId, cooldownClaim);
        cooldownClaim = null;
      }
      console.error(`[AutoReply] Could not send ${isSingleRule ? 'single-response' : `keyword "${rule.keyword}"`} reply:`, error.message);
    }
  }
  if (!sentAny) database.releaseAutoReplyMessage(messageId);
}

function removeOrphanedAttachments() {
  if (!attachmentsDirectory || !fs.existsSync(attachmentsDirectory)) return;
  const savedIds = new Set([
    ...database.getMessages().map(message => message.attachmentId),
    ...database.getQuickMessages().map(message => message.attachmentId),
    ...database.getAutoReplyRules().map(rule => rule.attachmentId)
  ].filter(Boolean));

  for (const fileName of fs.readdirSync(attachmentsDirectory)) {
    const attachmentId = path.parse(fileName).name;
    if (!savedIds.has(attachmentId)) {
      fs.rmSync(path.join(attachmentsDirectory, fileName), { force: true });
    }
  }
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to open a second instance — focus existing window
    if (accessWindow && !accessWindow.isDestroyed()) {
      if (accessWindow.isMinimized()) accessWindow.restore();
      accessWindow.show();
      accessWindow.focus();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  mainRendererReady = false;
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'satiropms-app.ico');
  let appIcon;
  try {
    appIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    appIcon = undefined;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    icon: appIcon,
    title: 'SátiroZap',
    frame: false,
    show: false, // Show after ready-to-show to avoid flicker
    backgroundColor: '#0C1317',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for better-sqlite3 native addon
      devTools: !app.isPackaged
    }
  });

  // Load the application HTML
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  // Show window when ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Remove the menu bar for a cleaner look
  mainWindow.setMenuBarVisibility(false);

  // ================================================================
  // Close → Minimize to Tray (don't quit)
  // ================================================================
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    mainRendererReady = false;
  });

  mainWindow.on('resize', updateEmbeddedViewBounds);

  // Pass window reference to WhatsApp client and scheduler for IPC push
  whatsappClient.setMainWindow(mainWindow);
  scheduler.setMainWindow(mainWindow);

  // Open DevTools in development
  if (!app.isPackaged) {
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

// ================================================================
// Register all IPC Handlers
// ================================================================
function registerIpcHandlers() {
  ipcMain.handle('window:control', (event, action) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para os controles da janela.');
    if (!mainWindow || mainWindow.isDestroyed()) return false;

    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === 'close') mainWindow.close();
    else throw new Error('Controle de janela inválido.');
    return true;
  });

  ipcMain.on('whatsapp:link-send-sound-failed', (event) => {
    if (!isMainRendererEvent(event)) return;
    try { shell.beep(); } catch (error) {
      console.warn('[WhatsApp] Could not play fallback send sound:', error.message);
    }
  });

  ipcMain.on('browser:whatsapp-send-link', (event, input) => {
    const isBrowserTab = browserTabs.some(tab => tab.view.webContents === event.sender);
    if (!isBrowserTab || event.senderFrame !== event.sender.mainFrame) return;

    const request = getWhatsAppSendRequest(input);
    if (!request) return;
    console.info(request.openOnly
      ? '[Browser] WhatsApp chat link clicked by the user.'
      : '[Browser] WhatsApp message link clicked by the user.');
    handleWhatsAppLinkRequest(request);
  });

  // --- In-app navigation ---
  ipcMain.handle('navigation:get-active', (event) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para navegação.');
    return activeEmbeddedPage;
  });

  ipcMain.handle('navigation:select', (event, page) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para navegação.');
    if (!['whatsapp', 'google'].includes(page)) throw new Error('Aba inválida.');
    return setEmbeddedPage(page, true);
  });

  ipcMain.handle('browser:get-state', (event) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para o navegador.');
    return getBrowserState();
  });

  ipcMain.handle('browser:toggle-chrome', (event) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para o navegador.');
    browserChromeCollapsed = !browserChromeCollapsed;
    updateEmbeddedViewBounds();
    pushBrowserState();
    return getBrowserState();
  });

  ipcMain.handle('browser:new-tab', (event) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para o navegador.');
    const tab = createBrowserTab();
    return selectBrowserTab(tab.id);
  });

  ipcMain.handle('browser:select-tab', (event, tabId) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para o navegador.');
    return selectBrowserTab(tabId);
  });

  ipcMain.handle('browser:close-tab', (event, tabId) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para o navegador.');
    return closeBrowserTab(tabId);
  });

  ipcMain.handle('browser:navigate', async (event, input) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para o navegador.');
    const tab = getBrowserTab();
    if (!tab) throw new Error('Nenhuma aba do navegador está aberta.');
    const url = normalizeBrowserUrl(input);
    selectBrowserTab(tab.id);
    tab.url = url;
    tab.title = 'Carregando…';
    pushBrowserState();
    await tab.view.webContents.loadURL(url);
    return getBrowserState();
  });

  ipcMain.handle('browser:history', (event, direction) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para o navegador.');
    const tab = getBrowserTab();
    if (!tab) return getBrowserState();
    if (direction === 'back' && tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
    if (direction === 'forward' && tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
    if (direction === 'reload') tab.view.webContents.reload();
    return getBrowserState();
  });

  // --- WhatsApp ---
  ipcMain.handle('whatsapp:get-status', () => {
    return whatsappClient.getStatus();
  });

  ipcMain.handle('whatsapp:connect', async () => {
    setEmbeddedPage('whatsapp');
    return whatsappClient.connect();
  });

  ipcMain.handle('whatsapp:logout', async () => {
    await whatsappClient.logout();
    return { success: true, message: 'Sessão desconectada com sucesso.' };
  });

  // --- Media Attachments ---
  ipcMain.handle('attachments:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione um arquivo para enviar pelo WhatsApp',
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const sourcePath = result.filePaths[0];
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension && !/^\.[a-z0-9]{1,12}$/.test(extension)) throw new Error('Extensão de arquivo inválida.');
    const mediaType = getAttachmentType(extension);

    const fileStats = fs.statSync(sourcePath);
    if (!fileStats.isFile()) throw new Error('Selecione um arquivo válido.');
    if (fileStats.size > getMaxAttachmentSize()) {
      throw new Error(getAttachmentSizeLimitMessage());
    }

    const attachmentId = crypto.randomUUID();
    const attachmentName = path.basename(sourcePath);
    const destinationPath = getAttachmentPath(attachmentId, attachmentName);
    await fs.promises.copyFile(sourcePath, destinationPath);

    const metadata = {
      attachmentId,
      attachmentName,
      attachmentMimeType: mediaType.mimeType,
      attachmentKind: getAttachmentKind(mediaType, fileStats.size),
      attachmentSize: fileStats.size
    };
    pendingAttachments.set(attachmentId, metadata);
    return metadata;
  });

  ipcMain.handle('attachments:discard', (_event, attachmentId) => {
    const pending = pendingAttachments.get(attachmentId);
    if (pending) {
      removeAttachmentFile(pending.attachmentId, pending.attachmentName);
      pendingAttachments.delete(attachmentId);
    }
    return { success: true };
  });

  // --- Messages ---
  ipcMain.handle('messages:get-all', () => {
    return database.getMessages();
  });

  ipcMain.handle('messages:get-by-id', (_event, id) => {
    return database.getMessageById(id);
  });

  ipcMain.handle('messages:create', (_event, data) => {
    const { recipientName, recipientPhone, message, scheduledDateTime } = data;
    const attachment = getAttachmentMetadata(data.attachmentId);

    if (!recipientPhone) {
      throw new Error('O número de telefone do destinatário é obrigatório.');
    }
    if ((!message || !message.trim()) && !attachment.attachmentId) {
      throw new Error('Digite uma mensagem ou anexe uma mídia.');
    }
    if (!scheduledDateTime) {
      throw new Error('A data e o horário do agendamento são obrigatórios.');
    }

    const savedMessage = database.saveMessage({
      recipientName: recipientName || 'Contato do WhatsApp',
      recipientPhone,
      message,
      scheduledDateTime,
      status: 'SCHEDULED',
      ...attachment
    });
    if (attachment.attachmentId) pendingAttachments.delete(attachment.attachmentId);
    return savedMessage;
  });

  ipcMain.handle('messages:update', (_event, id, data) => {
    const existing = database.getMessageById(id);
    if (!existing) throw new Error('Mensagem não encontrada.');

    const attachmentId = data.attachmentId === undefined ? existing.attachmentId : data.attachmentId;
    const attachment = getAttachmentMetadata(attachmentId, existing);
    if ((!data.message || !data.message.trim()) && !attachment.attachmentId) {
      throw new Error('Digite uma mensagem ou anexe uma mídia.');
    }

    const updated = database.updateMessage(id, { ...data, ...attachment });
    if (!updated) {
      throw new Error('Mensagem não encontrada.');
    }
    if (attachmentId && pendingAttachments.has(attachmentId)) pendingAttachments.delete(attachmentId);
    if (existing.attachmentId && existing.attachmentId !== attachmentId) {
      removeAttachmentFile(existing.attachmentId, existing.attachmentName);
    }
    return updated;
  });

  ipcMain.handle('messages:delete', (_event, id) => {
    const message = database.getMessageById(id);
    const success = database.deleteMessage(id);
    if (message?.attachmentId) removeAttachmentFile(message.attachmentId, message.attachmentName);
    return { success };
  });

  ipcMain.handle('messages:send-now', async (_event, id) => {
    const result = await scheduler.sendImmediately(id);
    if (result?.status === 'FAILED') {
      throw new Error(result.errorReason || 'Não foi possível enviar a mensagem pelo WhatsApp.');
    }
    return { success: true, message: result };
  });

  // --- Contacts ---
  ipcMain.handle('contacts:get-all', () => {
    return database.getContacts();
  });

  ipcMain.handle('contacts:add', (_event, contact) => {
    return database.addContact(contact);
  });

  ipcMain.handle('contacts:import-whatsapp', async () => {
    if (!whatsappClient.getStatus().isConnected) {
      throw new Error('Conecte o WhatsApp antes de importar os contatos.');
    }

    const syncedContacts = await whatsappClient.syncContacts();
    const result = database.importContacts(syncedContacts);
    return { ...result, available: syncedContacts.length, contacts: database.getContacts() };
  });

  ipcMain.handle('automation:renderer-ready', () => {
    mainRendererReady = true;
    if (pendingAutomationContact) {
      mainWindow?.webContents.send('automation:contact-selected', pendingAutomationContact);
      pendingAutomationContact = null;
    }
    return true;
  });

  ipcMain.on('whatsapp-web:ready', (event, authenticated) => {
    if (!isWhatsAppWebEvent(event)) return;
    whatsappClient.setStatus(authenticated ? 'reconnecting' : 'connecting');
  });

  ipcMain.on('whatsapp-web:status', (event, data) => {
    if (!isWhatsAppWebEvent(event) || !data || typeof data !== 'object') return;
    whatsappClient.setStatus(data.status, data.user);
  });

  ipcMain.on('whatsapp-web:active-contact', (event, data) => {
    if (!isWhatsAppWebEvent(event) || !data || typeof data !== 'object') return;
    const phone = typeof data.phone === 'string' ? data.phone.replace(/\D/g, '') : '';
    const name = typeof data.name === 'string' ? data.name.trim().slice(0, 120) : '';
    if (!/^\d{7,15}$/.test(phone)) return;

    pendingAutomationContact = { phone, name: name || phone };
    setEmbeddedPage('app');
    if (mainRendererReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('automation:contact-selected', pendingAutomationContact);
      pendingAutomationContact = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  ipcMain.on('whatsapp-web:incoming-message', (event, payload) => {
    void handleIncomingWhatsAppMessage(event, payload).catch((error) => {
      console.error('[AutoReply] Could not process incoming WhatsApp message:', error);
    });
  });

  ipcMain.handle('whatsapp-web:auto-reply-chat-status', (event, chatId) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para respostas automáticas.');
    if (typeof chatId !== 'string' || !/^[\w.-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(chatId)) {
      throw new Error('Abra uma conversa individual para gerenciar a resposta automática.');
    }
    const rules = database.getAutoReplyRules();
    return {
      paused: database.isAutoReplyPausedForChat(chatId),
      enabledRules: rules.filter(rule => Number(rule.enabled) === 1).length,
      hasSingleRule: rules.some(rule => rule.mode === 'single')
    };
  });

  ipcMain.handle('whatsapp-web:auto-reply-chat-pause', (event, chatId, paused) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para respostas automáticas.');
    if (typeof chatId !== 'string' || !/^[\w.-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(chatId)) {
      throw new Error('Abra uma conversa individual para gerenciar a resposta automática.');
    }
    if (typeof paused !== 'boolean') throw new Error('Estado de pausa inválido.');
    return { paused: database.setAutoReplyPausedForChat(chatId, paused) };
  });

  ipcMain.handle('whatsapp-web:auto-reply-reset-single-cooldown', (event, chatId) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para respostas automáticas.');
    if (typeof chatId !== 'string' || !/^[\w.-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(chatId)) {
      throw new Error('Abra uma conversa individual para liberar a resposta única.');
    }
    database.resetSingleAutoReplyCooldown(chatId);
    return { reset: true };
  });

  ipcMain.handle('whatsapp-web:auto-reply-open-settings', (event) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para abrir as configurações.');
    setEmbeddedPage('app');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auto-replies:open-settings');
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return true;
  });

  ipcMain.handle('auto-replies:list', (event) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para respostas automáticas.');
    return database.getAutoReplyRules();
  });

  ipcMain.handle('auto-replies:save', (event, data) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para respostas automáticas.');
    if (!data || typeof data !== 'object') throw new Error('Dados da regra inválidos.');
    const id = typeof data.id === 'string' && /^reply_[a-z0-9_-]{1,80}$/i.test(data.id) ? data.id : null;
    if (data.id && !id) throw new Error('Identificador da regra inválido.');
    const existing = id ? database.getAutoReplyRules().find(rule => rule.id === id) : null;
    if (id && !existing) throw new Error('Resposta automática não encontrada.');
    const mode = typeof data.mode === 'string' ? data.mode : (existing?.mode || 'keyword');
    if (!['keyword', 'single'].includes(mode)) throw new Error('Tipo de resposta automática inválido.');
    const rules = database.getAutoReplyRules();
    const isFallback = mode === 'single'
      ? (typeof data.isFallback === 'boolean' ? data.isFallback : (existing ? Number(existing.isFallback) === 1 : true))
      : false;
    const startTime = mode === 'single' && !isFallback ? data.startTime : null;
    const endTime = mode === 'single' && !isFallback ? data.endTime : null;
    const keyword = mode === 'single' ? '' : (typeof data.keyword === 'string' ? data.keyword.trim().slice(0, 100) : '');
    const reply = typeof data.reply === 'string' ? data.reply.trim().slice(0, 1000) : '';
    const cooldownHours = data.cooldownHours === undefined ? Number(existing?.cooldownHours || 24) : Number(data.cooldownHours);
    const attachmentId = data.attachmentId === undefined ? existing?.attachmentId : data.attachmentId;
    const attachment = getAttachmentMetadata(attachmentId, existing);
    if (mode === 'keyword' && !keyword) throw new Error('Digite uma palavra ou frase para identificar.');
    if (!Number.isInteger(cooldownHours) || cooldownHours < 1 || cooldownHours > 720) {
      throw new Error('O intervalo deve ser de 1 a 720 horas.');
    }
    if (mode === 'single' && !isFallback && !isValidTimeRange(startTime, endTime)) {
      throw new Error('Informe um intervalo de horário válido. O horário inicial e final não podem ser iguais.');
    }
    if (mode === 'single' && isFallback && rules.some(rule => rule.mode === 'single' && Number(rule.isFallback) === 1 && rule.id !== id)) {
      throw new Error('Já existe uma resposta única geral. Edite ou exclua essa regra antes de cadastrar outra.');
    }
    if (mode === 'single' && !isFallback && rules.some(rule =>
      rule.mode === 'single' && Number(rule.isFallback) !== 1 && rule.id !== id
      && rangesOverlap({ startTime, endTime }, rule)
    )) {
      throw new Error('Esse intervalo de horário se sobrepõe a outra resposta única. Escolha um horário diferente.');
    }
    if (!reply && !attachment.attachmentId) throw new Error('Digite uma resposta ou anexe um arquivo.');
    if (rules.length >= 100 && !id) throw new Error('Você pode cadastrar até 100 regras.');
    const saved = database.saveAutoReplyRule({ id, keyword, reply, mode, cooldownHours, isFallback, startTime, endTime, ...attachment, enabled: existing ? Number(existing.enabled) === 1 : true });
    if (attachment.attachmentId) pendingAttachments.delete(attachment.attachmentId);
    if (existing?.attachmentId && existing.attachmentId !== attachment.attachmentId) {
      removeAttachmentIfUnused(existing.attachmentId, existing.attachmentName);
    }
    return saved;
  });

  ipcMain.handle('auto-replies:set-enabled', (event, id, enabled) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para respostas automáticas.');
    if (typeof id !== 'string' || !/^reply_[a-z0-9_-]{1,80}$/i.test(id)) throw new Error('Identificador da regra inválido.');
    if (typeof enabled !== 'boolean') throw new Error('Estado da regra inválido.');
    const updated = database.setAutoReplyRuleEnabled(id, enabled);
    if (!updated) throw new Error('Regra não encontrada.');
    return updated;
  });

  ipcMain.handle('auto-replies:delete', (event, id) => {
    if (!isMainRendererEvent(event)) throw new Error('Origem inválida para respostas automáticas.');
    if (typeof id !== 'string' || !/^reply_[a-z0-9_-]{1,80}$/i.test(id)) throw new Error('Identificador da regra inválido.');
    const existing = database.getAutoReplyRules().find(rule => rule.id === id);
    const deleted = database.deleteAutoReplyRule(id);
    if (existing?.attachmentId) removeAttachmentIfUnused(existing.attachmentId, existing.attachmentName);
    return deleted;
  });

  ipcMain.handle('whatsapp-web:quick-messages:list', (event) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para mensagens rápidas.');
    return database.getQuickMessages();
  });

  ipcMain.handle('whatsapp-web:quick-messages:select-attachment', async (event) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para selecionar arquivo.');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolha um áudio, vídeo ou documento para a mensagem rápida',
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const sourcePath = result.filePaths[0];
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension && !/^\.[a-z0-9]{1,12}$/.test(extension)) throw new Error('Extensão de arquivo inválida.');
    const mediaType = getAttachmentType(extension);
    const stats = fs.statSync(sourcePath);
    if (!stats.isFile()) throw new Error('Selecione um arquivo válido.');
    if (stats.size > getMaxAttachmentSize()) {
      throw new Error(getAttachmentSizeLimitMessage());
    }

    const attachmentId = crypto.randomUUID();
    const attachmentName = path.basename(sourcePath);
    await fs.promises.copyFile(sourcePath, getAttachmentPath(attachmentId, attachmentName));
    const metadata = {
      attachmentId,
      attachmentName,
      attachmentMimeType: mediaType.mimeType,
      attachmentKind: getAttachmentKind(mediaType, stats.size),
      attachmentSize: stats.size
    };
    pendingAttachments.set(attachmentId, metadata);
    return metadata;
  });

  ipcMain.handle('whatsapp-web:quick-messages:save', (event, data) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para mensagens rápidas.');
    if (!data || typeof data !== 'object') throw new Error('Dados da mensagem inválidos.');
    const title = typeof data.title === 'string' ? data.title.trim().slice(0, 60) : '';
    const message = typeof data.message === 'string' ? data.message.trim().slice(0, 5000) : '';
    const id = typeof data.id === 'string' && /^quick_[a-z0-9_-]{1,64}$/i.test(data.id) ? data.id : null;
    const existing = id ? database.getQuickMessageById(id) : null;
    if (id && !existing) throw new Error('Mensagem rápida não encontrada.');
    const attachmentId = data.attachmentId === undefined ? existing?.attachmentId : data.attachmentId;
    if (!title) throw new Error('Informe um nome para a mensagem rápida.');
    if (!message && !attachmentId) throw new Error('Digite um texto ou anexe um arquivo.');
    if (database.getQuickMessages().length >= 100 && !id) throw new Error('Você atingiu o limite de 100 mensagens rápidas.');
    const attachment = getAttachmentMetadata(attachmentId, existing);
    const saved = database.saveQuickMessage({ id, title, message, ...attachment });
    if (attachment.attachmentId && pendingAttachments.has(attachment.attachmentId)) pendingAttachments.delete(attachment.attachmentId);
    if (existing?.attachmentId && existing.attachmentId !== attachment.attachmentId) {
      removeAttachmentFile(existing.attachmentId, existing.attachmentName);
    }
    return saved;
  });

  ipcMain.handle('whatsapp-web:quick-messages:delete', (event, id) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para mensagens rápidas.');
    if (typeof id !== 'string' || !/^quick_[a-z0-9_-]{1,64}$/i.test(id)) throw new Error('Identificador inválido.');
    const existing = database.getQuickMessageById(id);
    const deleted = database.deleteQuickMessage(id);
    if (existing?.attachmentId) removeAttachmentFile(existing.attachmentId, existing.attachmentName);
    return deleted;
  });

  ipcMain.handle('whatsapp-web:quick-messages:discard-attachment', (event, attachmentId) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para remover arquivo.');
    const pending = pendingAttachments.get(attachmentId);
    if (pending) {
      removeAttachmentFile(pending.attachmentId, pending.attachmentName);
      pendingAttachments.delete(attachmentId);
    }
    return { success: true };
  });

  ipcMain.handle('whatsapp-web:quick-messages:send', async (event, id) => {
    if (!isWhatsAppWebEvent(event)) throw new Error('Origem inválida para enviar mensagem rápida.');
    if (typeof id !== 'string' || !/^quick_[a-z0-9_-]{1,64}$/i.test(id)) throw new Error('Identificador inválido.');
    const quickMessage = database.getQuickMessageById(id);
    if (!quickMessage) throw new Error('Mensagem rápida não encontrada.');
    return whatsappClient.sendToActiveChat(quickMessage);
  });

  // --- Settings ---
  ipcMain.handle('settings:get', () => {
    return database.getSettings();
  });

  ipcMain.handle('settings:update', (_event, data) => {
    return database.updateSettings(data);
  });

  // --- App Info ---
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });
}

// ================================================================
// Application Lifecycle
// ================================================================
app.whenReady().then(async () => {
  // Check the encrypted saved credential on every launch; ask only on first authorized setup.
  let savedPassword;
  try {
    savedPassword = getSavedAccessPassword();
  } catch (error) {
    console.error('[Access] Could not read saved access credential:', error.message);
    await showAccessBlockedMessage('Não foi possível ler a senha salva com segurança. Reinstale ou contate o suporte da Sátiro Sistemas.');
    return;
  }

  if (savedPassword) {
    try {
      const result = await querySupabaseAccess(savedPassword);
      if (result !== 'active') {
        const message = result === 'suspended'
          ? 'Aplicativo suspenso. Fale com o suporte da Sátiro Sistemas | (84) 9 3300-4200'
          : 'A senha salva não está autorizada no sistema. Fale com o suporte da Sátiro Sistemas | (84) 9 3300-4200';
        await showAccessBlockedMessage(message, result === 'suspended' ? 'warning' : 'error');
        return;
      }
      startupAccessGranted = true;
    } catch (error) {
      console.error('[Access] Supabase saved-credential check failed:', error.message);
      await showAccessBlockedMessage('Não foi possível consultar o acesso. Verifique a conexão com a internet e abra o aplicativo novamente.');
      return;
    }
  } else if (await showStartupAccessGate() !== true) {
    return;
  }

  // 1. Initialize SQLite database
  await database.init(app.getPath('userData'));
  attachmentsDirectory = path.join(app.getPath('userData'), 'attachments');
  fs.mkdirSync(attachmentsDirectory, { recursive: true });
  registerAttachmentProtocol();
  removeOrphanedAttachments();
  console.log(`[App] Database initialized at ${app.getPath('userData')}`);

  // 2. Register IPC handlers
  registerIpcHandlers();

  // 3. Create the main window
  createWindow();

  // 4. Create system tray
  createTray(mainWindow);
  startTrayUpdater(mainWindow);

  // 5. Start WhatsApp client (auto-connect if session exists)
  whatsappClient.setMainWindow(mainWindow);
  await whatsappClient.init(app.getPath('userData'));
  setEmbeddedPage('google');

  // 6. Start the background scheduler
  scheduler.start();

  console.log('[App] WhatsApp Scheduler Desktop is running');
});

app.on('window-all-closed', () => {
  // On Windows, don't quit when all windows are closed (tray keeps running)
  // Only quit if app.isQuitting is true (set by tray Quit menu)
  if (app.isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  if (!startupAccessGranted) return;
  // macOS: re-create window if dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;

  for (const attachment of pendingAttachments.values()) {
    removeAttachmentFile(attachment.attachmentId, attachment.attachmentName);
  }
  pendingAttachments.clear();

  // Graceful shutdown
  scheduler.stop();
  for (const tab of browserTabs.splice(0)) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
  activeBrowserTabId = null;
  await whatsappClient.destroy();
  database.close();
  destroyTray();

  console.log('[App] Graceful shutdown complete');
});
