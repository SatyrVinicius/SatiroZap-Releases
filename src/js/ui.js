/**
 * UI Renderer and View Controller
 * Features: Strikethrough Task Completion, 24/7 Automated Delivery, Zero Placeholder Contacts
 */

import { State } from './state.js';
import { Storage } from './storage.js';
import { API } from './api.js';
import { COUNTRY_CODES } from './contacts.js';
import {
  formatDateLabel,
  formatFullDate,
  formatTimeLabel,
  formatRelativeCountdown,
  parseWhatsAppFormatting,
  sanitizePhoneNumber,
  isValidPhoneNumber,
  toInputDateFormat,
  toInputTimeFormat,
  escapeHtml
} from './utils.js';

export const UI = {
  activeContact: null,
  activeAttachment: null,
  editingAttachmentMessageId: null,
  editingAutoReplyId: null,
  autoReplyAttachment: null,
  autoReplyAttachmentIsPending: false,

  init() {
    this.bindGlobalEvents();
    this.render();
    State.subscribe(() => this.render());
  },

  /**
   * Main Render Pipeline
   */
  render() {
    if (State.pendingAutomationContact) {
      const contact = State.pendingAutomationContact;
      State.pendingAutomationContact = null;
      this.openCreateSheet(contact);
    }
    this.renderHeaderStatus();
    this.renderMessageList();
    this.syncSheets();
  },

  /**
   * Updates header status & WhatsApp connection pill
   */
  renderHeaderStatus() {
    const scheduledCountEl = document.getElementById('headerScheduledCount');
    const waPill = document.getElementById('headerWaStatusPill');

    if (scheduledCountEl) {
      const scheduledCount = State.messages.filter(m => (m.status || '').toUpperCase() === 'SCHEDULED').length;
      const sentCount = State.messages.filter(m => (m.status || '').toUpperCase() === 'SENT').length;
      const failedCount = State.messages.filter(m => (m.status || '').toUpperCase() === 'FAILED').length;

      if (State.messages.length === 0) {
        scheduledCountEl.textContent = 'Nenhuma mensagem agendada';
      } else {
        const scheduledLabel = `${scheduledCount} mensagem${scheduledCount === 1 ? '' : 's'} agendada${scheduledCount === 1 ? '' : 's'}`;
        const sentLabel = `${sentCount} mensagem${sentCount === 1 ? '' : 's'} enviada${sentCount === 1 ? '' : 's'}`;
        scheduledCountEl.textContent = `${scheduledLabel} · ${sentLabel}${failedCount > 0 ? ` · ${failedCount} com falha` : ''}`;
      }
    }

    if (waPill) {
      const status = State.whatsapp.status;
      waPill.className = `wa-status-pill ${status}`;

      const textEl = waPill.querySelector('.wa-status-text');
      if (textEl) {
        if (status === 'connected') {
          const userPhone = State.whatsapp.user?.phone;
          textEl.textContent = userPhone ? `+${userPhone}` : 'Conectado';
        } else if (status === 'qr_ready') {
          textEl.textContent = 'Abrir WhatsApp';
        } else if (status === 'connecting' || status === 'reconnecting') {
          textEl.textContent = 'Conectando...';
        } else {
          textEl.textContent = 'Conectar conta';
        }
      }
    }
  },

  /**
   * Renders the list of scheduled messages
   */
  renderMessageList() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    if (!State.messages || State.messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon-wrap">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
              <circle cx="12" cy="15" r="2"></circle>
            </svg>
          </div>
          <h2 class="empty-title">Nenhuma mensagem agendada</h2>
          <p class="empty-subtitle">Agende sua primeira mensagem do WhatsApp.</p>
          <button class="btn btn-primary" id="emptyScheduleBtn" style="max-width: 240px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Agendar mensagem
          </button>
        </div>
      `;

      document.getElementById('emptyScheduleBtn')?.addEventListener('click', () => this.openCreateSheet());
      return;
    }

    let html = `
      <div class="section-header">
        <span class="section-title">Fila de mensagens</span>
        <span class="section-count">${State.messages.length}</span>
      </div>
      <div class="messages-list">
    `;

    State.messages.forEach(msg => {
      const dateLabel = formatDateLabel(msg.scheduledDateTime);
      const timeLabel = formatTimeLabel(msg.scheduledDateTime);
      const avatarInitial = (msg.recipientName || 'C').charAt(0).toUpperCase();
      const status = (msg.status || 'SCHEDULED').toUpperCase();
      const attachmentIcon = ({ image: '🖼️', video: '🎬', audio: '🔊', document: '📄' })[msg.attachmentKind] || '📎';
      const attachmentPreview = msg.attachmentId
        ? `<div class="card-attachment-preview">${attachmentIcon} ${escapeHtml(msg.attachmentName)}</div>`
        : '';

      let statusBadgeHtml = '';
      let timingHtml = '';

      if (status === 'SENT') {
        const sentTime = msg.sentAt ? formatTimeLabel(msg.sentAt) : timeLabel;
        statusBadgeHtml = `<span class="status-badge sent"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg> Enviada</span>`;

        // Completed Task Strikethrough Layout
        timingHtml = `
          <div class="schedule-datetime-group">
            <span class="scheduled-time-original">Agendada para ${dateLabel} · ${timeLabel}</span>
            <span class="sent-confirmation-time">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Enviada às ${sentTime}
            </span>
          </div>
        `;
      } else if (status === 'FAILED') {
        statusBadgeHtml = `<span class="status-badge failed"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Falhou</span>`;
        timingHtml = `
          <div class="schedule-datetime-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${dateLabel} · ${timeLabel}</span>
          </div>
        `;
      } else if (status === 'SENDING') {
        statusBadgeHtml = `<span class="status-badge sending">Enviando...</span>`;
        timingHtml = `
          <div class="schedule-datetime-pill">
            <span style="color: var(--wa-accent); font-weight: 700;">Envio em andamento...</span>
          </div>
        `;
      } else {
        statusBadgeHtml = `<span class="status-badge scheduled">Agendada</span>`;
        timingHtml = `
          <div class="schedule-datetime-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${dateLabel} · ${timeLabel}</span>
          </div>
        `;
      }

      html += `
        <div class="message-card status-${status.toLowerCase()}" data-id="${msg.id}">
          <div class="card-top">
            <div class="card-recipient-group">
              <div class="avatar-circle">${avatarInitial}</div>
              <div class="recipient-meta">
                <span class="recipient-name">${escapeHtml(msg.recipientName)}</span>
                <span class="recipient-phone">+${sanitizePhoneNumber(msg.recipientPhone)}</span>
              </div>
            </div>
            ${statusBadgeHtml}
          </div>

          ${msg.message ? `<div class="card-message-preview">${parseWhatsAppFormatting(msg.message)}</div>` : ''}
          ${attachmentPreview}

          ${msg.errorReason ? `
            <div class="card-error-notice">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <span>${escapeHtml(msg.errorReason)}</span>
            </div>
          ` : ''}

          <div class="card-footer">
            ${timingHtml}

            <div class="card-actions" onclick="event.stopPropagation()">
              ${status === 'FAILED' ? `
                <button class="card-action-btn retry-btn" data-action="send-now" data-id="${msg.id}" title="Tentar enviar novamente">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                  Tentar novamente
                </button>
              ` : status === 'SCHEDULED' ? `
                <button class="card-action-btn send-now" data-action="send-now" data-id="${msg.id}" title="Enviar agora pelo WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  Enviar agora
                </button>
              ` : ''}
              
              <button class="card-action-btn" data-action="edit" data-id="${msg.id}" title="Editar">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
              <button class="card-action-btn" data-action="delete" data-id="${msg.id}" title="Excluir">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    // Card click -> details
    container.querySelectorAll('.message-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const msg = State.messages.find(m => m.id === id);
        if (msg) State.openSheet('details', msg);
      });
    });

    // Action buttons
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const msg = State.messages.find(m => m.id === id);
        if (!msg) return;

        if (action === 'send-now') {
          UI.showToast('Enviando mensagem pelo WhatsApp...', 'info');
          try {
            await API.sendNow(id);
            await State.refreshAll();
            UI.showToast('Mensagem enviada com sucesso!', 'success');
          } catch (err) {
            await State.refreshAll();
            UI.showToast(err.message || 'Falha ao enviar mensagem.', 'error');
          }
        } else if (action === 'edit') {
          State.openSheet('edit', msg);
        } else if (action === 'delete') {
          State.openSheet('delete', id);
        }
      });
    });
  },

  /**
   * Synchronizes active overlays
   */
  syncSheets() {
    const sheets = ['qrSheet', 'createSheet', 'detailsSheet', 'editSheet', 'contactsSheet', 'settingsSheet', 'deleteDialog'];
    sheets.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });

    if (State.currentSheet === 'qr') {
      this.populateQrSheet();
      document.getElementById('qrSheet')?.classList.add('active');
    } else if (State.currentSheet === 'create') {
      document.getElementById('createSheet')?.classList.add('active');
    } else if (State.currentSheet === 'details') {
      this.populateDetailsSheet(State.selectedMessage);
      document.getElementById('detailsSheet')?.classList.add('active');
    } else if (State.currentSheet === 'edit') {
      this.populateEditSheet(State.editingMessage);
      document.getElementById('editSheet')?.classList.add('active');
    } else if (State.currentSheet === 'contacts') {
      this.populateContactsSheet();
      document.getElementById('contactsSheet')?.classList.add('active');
    } else if (State.currentSheet === 'settings') {
      this.populateSettingsSheet();
      document.getElementById('settingsSheet')?.classList.add('active');
    } else if (State.currentSheet === 'delete') {
      document.getElementById('deleteDialog')?.classList.add('active');
    }
  },

  /**
   * Populates QR Code sheet
   */
  populateQrSheet() {
    const container = document.getElementById('qrContainer');
    if (!container) return;

    const { status, qrDataUrl, user } = State.whatsapp;

    if (status === 'connected') {
      container.innerHTML = `
        <div style="background-color: rgba(37, 211, 102, 0.15); border-radius: var(--border-radius-full); width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; color: var(--wa-teal); margin-bottom: 16px;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.49 3.53 1.35 5L2 22l5.14-1.32C8.59 21.53 10.25 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </div>
        <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 6px;">WhatsApp conectado</h3>
        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px;">
          Conectado como <strong>+${user?.phone || ''}</strong> (${user?.name || 'Conta'})
        </p>
        <p style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; margin-bottom: 24px;">
          O agendador automático está conectado e enviará suas mensagens nos horários programados.
        </p>
        <button type="button" class="btn btn-danger-subtle" id="btnUnlinkWaBtn" style="width: 100%;">
          Desvincular dispositivo / desconectar
        </button>
      `;

      document.getElementById('btnUnlinkWaBtn')?.addEventListener('click', async () => {
        UI.showToast('Desconectando do WhatsApp...', 'info');
        await API.logoutWhatsApp();
        await State.refreshAll();
        UI.showToast('Desconectado do WhatsApp.', 'info');
      });
    } else if (status === 'qr_ready' && qrDataUrl) {
      container.innerHTML = `
        <div class="qr-box">
          <img src="${qrDataUrl}" alt="Código QR multidispositivo do WhatsApp">
        </div>
        <div class="qr-instructions-list">
          <ol>
            <li>Abra o <strong>WhatsApp</strong> no celular</li>
            <li>Toque em <strong>Menu</strong> (Android) ou <strong>Configurações</strong> (iOS)</li>
            <li>Toque em <strong>Dispositivos conectados</strong> ➔ <strong>Conectar dispositivo</strong></li>
            <li>Aponte a câmera do celular para este código QR</li>
          </ol>
        </div>
        <button type="button" class="btn btn-secondary" id="btnRefreshQr" style="width: 100%;">
          🔄 Atualizar código QR
        </button>
      `;

      document.getElementById('btnRefreshQr')?.addEventListener('click', async () => {
        UI.showToast('Gerando um novo código QR...', 'info');
        await API.connectWhatsApp();
        await State.refreshAll();
      });
    } else {
      container.innerHTML = `
        <div style="padding: 40px 20px; text-align: center;">
          <div style="font-size: 1.5rem; margin-bottom: 12px;">⏳</div>
          <div style="font-weight: 700; font-size: 1rem; margin-bottom: 8px;">Conectar pelo WhatsApp Web</div>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 18px;">
            A aba WhatsApp Web será aberta dentro do aplicativo. Faça login ou leia o QR exibido nela; mantenha o aplicativo aberto para enviar mensagens agendadas.
          </p>
          <button type="button" class="btn btn-teal" id="btnStartWaConnect" style="width: 100%;">
            Abrir WhatsApp Web
          </button>
        </div>
      `;

      document.getElementById('btnStartWaConnect')?.addEventListener('click', async () => {
        await API.connectWhatsApp();
        await State.refreshAll();
      });
    }
  },

  /**
   * Opens Create Message Flow
   */
  openCreateSheet(contact = null) {
    if (this.activeAttachment?.pending) API.discardAttachment(this.activeAttachment.attachmentId);
    this.activeAttachment = null;
    this.editingAttachmentMessageId = null;
    this.activeContact = contact && /^\d{7,15}$/.test(String(contact.phone || '').replace(/\D/g, ''))
      ? { name: String(contact.name || contact.phone).trim(), phone: String(contact.phone).replace(/\D/g, '') }
      : null;
    const form = document.getElementById('createMessageForm');
    if (form) form.reset();

    const now = new Date();
    const future = new Date(now.getTime() + 15 * 60 * 1000);

    const dateInput = document.getElementById('createDate');
    const timeInput = document.getElementById('createTime');

    if (dateInput) {
      dateInput.min = toInputDateFormat(now);
      dateInput.value = toInputDateFormat(future);
    }
    if (timeInput) {
      timeInput.value = toInputTimeFormat(future);
    }

    this.updateCreateContactPreview();
    this.renderAttachmentPreview('create');
    this.clearErrors('createMessageForm');
    State.openSheet('create');
  },

  async chooseAttachment(target) {
    this.attachmentTarget = target;
    try {
      const attachment = await API.selectAttachment();
      if (!attachment) return;

      if (this.activeAttachment?.pending) {
        await API.discardAttachment(this.activeAttachment.attachmentId);
      }
      this.activeAttachment = { ...attachment, pending: true };
      this.renderAttachmentPreview(target);
    } catch (err) {
      this.showToast(err.message || 'Não foi possível selecionar a mídia.', 'error');
    }
  },

  async removeAttachment() {
    if (this.activeAttachment?.pending) {
      await API.discardAttachment(this.activeAttachment.attachmentId);
    }
    this.activeAttachment = null;
    this.renderAttachmentPreview(this.attachmentTarget || 'create');
  },

  renderAttachmentPreview(target, attachment = this.activeAttachment) {
    const preview = document.getElementById(`${target}AttachmentPreview`);
    if (!preview) return;

    const button = document.getElementById(`${target}AttachmentBtn`);
    if (!attachment?.attachmentId) {
      preview.hidden = true;
      if (button) button.textContent = '📎 Anexar arquivo';
      return;
    }

    preview.hidden = false;
    preview.querySelector('.attachment-name').textContent = attachment.attachmentName;
    preview.querySelector('.attachment-icon').textContent = ({
      image: '🖼️',
      video: '🎬',
      audio: '🔊',
      document: '📄'
    })[attachment.attachmentKind] || '📎';
    if (button) button.textContent = '🔄 Alterar arquivo';
  },

  async closeActiveSheet() {
    if (this.activeAttachment?.pending) {
      await API.discardAttachment(this.activeAttachment.attachmentId);
    }
    this.activeAttachment = null;
    this.editingAttachmentMessageId = null;
    State.closeSheet();
  },

  /**
   * Populates Message Details Sheet
   */
  populateDetailsSheet(msg) {
    if (!msg) return;

    const nameEl = document.getElementById('detailRecipientName');
    const phoneEl = document.getElementById('detailRecipientPhone');
    const msgEl = document.getElementById('detailMessageText');
    const dateEl = document.getElementById('detailScheduledDate');
    const countdownEl = document.getElementById('detailCountdown');
    const statusEl = document.getElementById('detailStatus');
    const errorBox = document.getElementById('detailErrorBox');
    const errorText = document.getElementById('detailErrorText');
    const sendNowBtn = document.getElementById('detailSendNowBtn');
    const editBtn = document.getElementById('detailEditBtn');
    const deleteBtn = document.getElementById('detailDeleteBtn');

    if (nameEl) nameEl.textContent = msg.recipientName;
    if (phoneEl) phoneEl.textContent = `+${sanitizePhoneNumber(msg.recipientPhone)}`;
    if (msgEl) msgEl.innerHTML = msg.message ? parseWhatsAppFormatting(msg.message) : 'Mídia anexada, sem texto adicional.';
    this.renderAttachmentPreview('detail', msg.attachmentId ? {
      attachmentId: msg.attachmentId,
      attachmentName: msg.attachmentName,
      attachmentKind: msg.attachmentKind
    } : null);
    if (dateEl) dateEl.textContent = `${formatFullDate(msg.scheduledDateTime)} às ${formatTimeLabel(msg.scheduledDateTime)}`;

    const status = (msg.status || 'SCHEDULED').toUpperCase();
    if (statusEl) {
      statusEl.textContent = ({ SCHEDULED: 'AGENDADA', SENDING: 'ENVIANDO', SENT: 'ENVIADA', FAILED: 'FALHOU' })[status] || status;
      statusEl.className = `status-badge ${status.toLowerCase()}`;
    }

    if (countdownEl) {
      if (status === 'SENT') {
        countdownEl.textContent = `Enviada às ${formatTimeLabel(msg.sentAt || msg.updatedAt)}`;
        countdownEl.style.color = 'var(--wa-teal)';
      } else if (status === 'FAILED') {
        countdownEl.textContent = 'Falha na entrega';
        countdownEl.style.color = 'var(--wa-danger)';
      } else if (status === 'SENDING') {
        countdownEl.textContent = 'Enviando agora...';
        countdownEl.style.color = 'var(--wa-accent)';
      } else {
        countdownEl.textContent = formatRelativeCountdown(msg.scheduledDateTime);
        countdownEl.style.color = 'var(--wa-teal)';
      }
    }

    if (errorBox && errorText) {
      if (msg.errorReason) {
        errorBox.style.display = 'block';
        errorText.textContent = msg.errorReason;
      } else {
        errorBox.style.display = 'none';
      }
    }

    if (sendNowBtn) {
      if (status === 'SENT') {
        sendNowBtn.textContent = 'Reenviar pelo WhatsApp';
      } else if (status === 'FAILED') {
        sendNowBtn.textContent = 'Tentar enviar novamente pelo WhatsApp';
      } else {
        sendNowBtn.textContent = 'Enviar agora pelo WhatsApp';
      }

      sendNowBtn.onclick = async () => {
        UI.showToast('Enviando mensagem pelo WhatsApp...', 'info');
        try {
          await API.sendNow(msg.id);
          await State.refreshAll();
          UI.showToast('Mensagem enviada com sucesso!', 'success');
        } catch (err) {
          await State.refreshAll();
          UI.showToast(err.message || 'Falha ao enviar mensagem.', 'error');
        }
      };
    }

    if (editBtn) {
      editBtn.onclick = () => State.openSheet('edit', msg);
    }

    if (deleteBtn) {
      deleteBtn.onclick = () => State.openSheet('delete', msg.id);
    }
  },

  /**
   * Populates Edit Message Sheet
   */
  populateEditSheet(msg) {
    if (!msg) return;
    if (this.editingAttachmentMessageId !== msg.id) {
      if (this.activeAttachment?.pending) API.discardAttachment(this.activeAttachment.attachmentId);
      this.activeAttachment = msg.attachmentId ? {
        attachmentId: msg.attachmentId,
        attachmentName: msg.attachmentName,
        attachmentMimeType: msg.attachmentMimeType,
        attachmentKind: msg.attachmentKind
      } : null;
      this.editingAttachmentMessageId = msg.id;
    }
    this.attachmentTarget = 'edit';
    this.renderAttachmentPreview('edit');
    this.activeContact = {
      name: msg.recipientName,
      phone: msg.recipientPhone
    };

    const targetDate = new Date(msg.scheduledDateTime);
    const dateInput = document.getElementById('editDate');
    const timeInput = document.getElementById('editTime');
    const msgInput = document.getElementById('editMessageText');

    if (dateInput) {
      dateInput.min = toInputDateFormat(new Date());
      dateInput.value = toInputDateFormat(targetDate);
    }
    if (timeInput) {
      timeInput.value = toInputTimeFormat(targetDate);
    }
    if (msgInput) {
      msgInput.value = msg.message;
    }

    this.updateEditContactPreview();
    this.clearErrors('editMessageForm');
  },

  /**
   * Populates Contacts Selection Sheet (Zero placeholder contacts)
   */
  populateContactsSheet() {
    const listEl = document.getElementById('contactsListContainer');
    const searchInput = document.getElementById('contactSearchInput');
    if (!listEl) return;

    if (searchInput) searchInput.value = '';

    const renderContacts = (filterText = '') => {
      const contacts = Storage.getRecentContacts();
      const filtered = contacts.filter(c =>
        (c.name || '').toLowerCase().includes(filterText.toLowerCase()) ||
        (c.phone || '').includes(filterText)
      );

      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div style="padding: 24px 16px; text-align: center; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.5;">
            Nenhum contato salvo ainda.<br>Importe os contatos sincronizados ou informe um número abaixo.
          </div>
        `;
        return;
      }

      let html = '';
      filtered.forEach(c => {
        const initial = (c.name || 'C').charAt(0).toUpperCase();
        html += `
          <div class="contact-item" data-name="${escapeHtml(c.name)}" data-phone="${c.phone}">
            <div class="contact-item-left">
              <div class="avatar-circle" style="width: 32px; height: 32px; font-size: 0.8rem;">${initial}</div>
              <div>
                <div style="font-weight: 700; font-size: 0.9rem;">${escapeHtml(c.name)}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary); font-family: var(--font-mono);">+${sanitizePhoneNumber(c.phone)}</div>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--wa-teal)"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        `;
      });

      listEl.innerHTML = html;

      listEl.querySelectorAll('.contact-item').forEach(item => {
        item.addEventListener('click', () => {
          const name = item.getAttribute('data-name');
          const phone = item.getAttribute('data-phone');
          this.selectContact({ name, phone });
        });
      });
    };

    renderContacts('');

    if (searchInput) {
      searchInput.oninput = (e) => {
        renderContacts(e.target.value);
      };
    }

    const countrySelect = document.getElementById('manualCountryCode');
    if (countrySelect && countrySelect.options.length === 0) {
      COUNTRY_CODES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.dial;
        opt.textContent = `${c.flag} ${c.dial} (${c.name})`;
        if (c.dial === '+55') opt.selected = true;
        countrySelect.appendChild(opt);
      });
    }
  },

  /**
   * Populates Settings Sheet
   */
  populateSettingsSheet() {
    const statusLabel = document.getElementById('settingsWaStatusLabel');
    const statusSub = document.getElementById('settingsWaStatusSub');
    const themeButtons = document.querySelectorAll('.theme-pill-btn');

    if (statusLabel && statusSub) {
      if (State.whatsapp.status === 'connected') {
        statusLabel.textContent = `Conectado (+${State.whatsapp.user?.phone || ''})`;
        statusSub.textContent = 'Agendador ativo e pronto para enviar mensagens';
      } else {
        statusLabel.textContent = 'Não conectado';
        statusSub.textContent = 'Abra a aba WhatsApp Web integrada para conectar';
      }
    }

    if (themeButtons) {
      themeButtons.forEach(btn => {
        if (btn.getAttribute('data-theme') === State.settings.theme) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
  },

  async loadAutoReplyRules() {
    const list = document.getElementById('autoReplyRulesList');
    if (!list) return;
    list.textContent = 'Carregando respostas automáticas...';
    try {
      this.renderAutoReplyRules(await API.getAutoReplyRules());
    } catch (error) {
      list.textContent = error.message || 'Não foi possível carregar as respostas automáticas.';
    }
  },

  renderAutoReplyRules(rules) {
    const list = document.getElementById('autoReplyRulesList');
    if (!list) return;
    list.replaceChildren();

    if (!Array.isArray(rules) || rules.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'auto-replies-note';
      empty.textContent = 'Nenhuma resposta automática cadastrada.';
      list.appendChild(empty);
      return;
    }

    rules.forEach((rule) => {
      const row = document.createElement('div');
      row.className = 'auto-reply-rule';

      const toggle = document.createElement('input');
      toggle.className = 'auto-reply-rule-toggle';
      toggle.type = 'checkbox';
      toggle.checked = Number(rule.enabled) === 1;
      const ruleLabel = rule.mode === 'single' ? 'Resposta única' : `resposta para ${rule.keyword}`;
      toggle.setAttribute('aria-label', `${toggle.checked ? 'Desativar' : 'Ativar'} ${ruleLabel}`);
      toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try {
          await API.setAutoReplyRuleEnabled(rule.id, toggle.checked);
          this.showToast(toggle.checked ? 'Resposta automática ativada.' : 'Resposta automática desativada.', 'success');
          await this.loadAutoReplyRules();
        } catch (error) {
          toggle.checked = !toggle.checked;
          toggle.disabled = false;
          this.showToast(error.message || 'Não foi possível alterar a regra.', 'error');
        }
      });

      const content = document.createElement('div');
      content.className = 'auto-reply-rule-content';
      const keyword = document.createElement('span');
      keyword.className = 'auto-reply-rule-keyword';
      keyword.textContent = rule.mode === 'single'
        ? `Resposta única · intervalo de ${rule.cooldownHours || 24}h por contato`
        : `Se receber: ${rule.keyword}`;
      const reply = document.createElement('span');
      reply.className = 'auto-reply-rule-text';
      const mediaLabel = ({ audio: 'áudio', image: 'imagem', video: 'vídeo', document: 'documento' })[rule.attachmentKind] || 'arquivo';
      const replyParts = [rule.reply ? rule.reply : null, rule.attachmentId ? `${mediaLabel}: ${rule.attachmentName || 'anexo'}` : null].filter(Boolean);
      reply.textContent = `Responder: ${replyParts.join(' · ') || '—'}`;
      content.append(keyword, reply);

      const edit = document.createElement('button');
      edit.className = 'auto-reply-rule-edit';
      edit.type = 'button';
      edit.textContent = '✎';
      edit.title = 'Editar resposta automática';
      edit.setAttribute('aria-label', `Editar ${ruleLabel}`);
      edit.addEventListener('click', () => this.editAutoReplyRule(rule));

      const remove = document.createElement('button');
      remove.className = 'auto-reply-rule-delete';
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Excluir resposta automática';
      remove.setAttribute('aria-label', `Excluir ${ruleLabel}`);
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Excluir ${ruleLabel}?`)) return;
        remove.disabled = true;
        try {
          await API.deleteAutoReplyRule(rule.id);
          if (this.editingAutoReplyId === rule.id) await this.resetAutoReplyForm();
          this.showToast('Resposta automática excluída.', 'success');
          await this.loadAutoReplyRules();
        } catch (error) {
          remove.disabled = false;
          this.showToast(error.message || 'Não foi possível excluir a regra.', 'error');
        }
      });

      row.append(toggle, content, edit, remove);
      list.appendChild(row);
    });
  },

  updateAutoReplyAttachmentPreview() {
    const name = document.getElementById('autoReplyAttachmentName');
    const remove = document.getElementById('autoReplyRemoveAttachmentBtn');
    if (name) name.textContent = this.autoReplyAttachment?.attachmentName || 'Nenhum arquivo anexado';
    if (name) name.title = this.autoReplyAttachment?.attachmentName || '';
    if (remove) remove.hidden = !this.autoReplyAttachment;
  },

  updateAutoReplyModeFields() {
    const mode = document.getElementById('autoReplyMode')?.value || 'keyword';
    const keywordGroup = document.getElementById('autoReplyKeywordGroup');
    const keywordInput = document.getElementById('autoReplyKeyword');
    const cooldownGroup = document.getElementById('autoReplyCooldownGroup');
    const cooldownInput = document.getElementById('autoReplyCooldownHours');
    if (keywordGroup) keywordGroup.hidden = mode === 'single';
    if (keywordInput) keywordInput.required = mode === 'keyword';
    if (cooldownGroup) cooldownGroup.hidden = mode !== 'single';
    if (cooldownInput) cooldownInput.required = mode === 'single';
  },

  async editAutoReplyRule(rule) {
    if (this.autoReplyAttachmentIsPending && this.autoReplyAttachment?.attachmentId) {
      await API.discardAttachment(this.autoReplyAttachment.attachmentId);
    }
    this.editingAutoReplyId = rule.id;
    this.autoReplyAttachmentIsPending = false;
    this.autoReplyAttachment = rule.attachmentId ? {
      attachmentId: rule.attachmentId,
      attachmentName: rule.attachmentName,
      attachmentMimeType: rule.attachmentMimeType,
      attachmentKind: rule.attachmentKind
    } : null;
    document.getElementById('autoReplyMode').value = rule.mode === 'single' ? 'single' : 'keyword';
    document.getElementById('autoReplyKeyword').value = rule.keyword || '';
    document.getElementById('autoReplyCooldownHours').value = String(rule.cooldownHours || 24);
    document.getElementById('autoReplyText').value = rule.reply || '';
    this.updateAutoReplyModeFields();
    document.getElementById('autoReplySubmitBtn').textContent = 'Salvar alterações';
    document.getElementById('autoReplyCancelEditBtn').hidden = false;
    this.updateAutoReplyAttachmentPreview();
    document.getElementById('autoReplyKeyword')?.focus();
  },

  async resetAutoReplyForm(discardPending = true) {
    if (discardPending && this.autoReplyAttachmentIsPending && this.autoReplyAttachment?.attachmentId) {
      await API.discardAttachment(this.autoReplyAttachment.attachmentId);
    }
    this.editingAutoReplyId = null;
    this.autoReplyAttachment = null;
    this.autoReplyAttachmentIsPending = false;
    document.getElementById('autoReplyForm')?.reset();
    const submit = document.getElementById('autoReplySubmitBtn');
    if (submit) submit.textContent = 'Adicionar resposta automática';
    const cancel = document.getElementById('autoReplyCancelEditBtn');
    if (cancel) cancel.hidden = true;
    this.updateAutoReplyModeFields();
    this.updateAutoReplyAttachmentPreview();
  },

  selectContact(contact) {
    this.activeContact = contact;
    if (State.currentSheet === 'contacts') {
      State.openSheet('create');
    }
    this.updateCreateContactPreview();
    this.updateEditContactPreview();
  },

  updateCreateContactPreview() {
    const previewEl = document.getElementById('createContactPreview');
    if (!previewEl) return;

    if (this.activeContact) {
      previewEl.classList.add('has-contact');
      previewEl.innerHTML = `
        <div class="contact-preview-left">
          <div class="avatar-circle" style="width: 34px; height: 34px; font-size: 0.85rem;">${(this.activeContact.name || 'C').charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-weight: 700; font-size: 0.95rem;">${escapeHtml(this.activeContact.name)}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); font-family: var(--font-mono);">+${sanitizePhoneNumber(this.activeContact.phone)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-ghost" id="changeCreateContactBtn" style="padding: 4px 8px; font-size: 0.8rem; color: var(--wa-teal);">Alterar</button>
      `;

      document.getElementById('changeCreateContactBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        State.openSheet('contacts');
      });
    } else {
      previewEl.classList.remove('has-contact');
      previewEl.innerHTML = `
        <div class="contact-preview-left">
          <div class="avatar-circle" style="background: var(--bg-chip); color: var(--text-secondary); width: 34px; height: 34px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          </div>
          <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">Selecionar contato do WhatsApp</span>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" color="var(--text-muted)"><polyline points="9 18 15 12 9 6"></polyline></svg>
      `;
    }
  },

  updateEditContactPreview() {
    const previewEl = document.getElementById('editContactPreview');
    if (!previewEl || !this.activeContact) return;

    previewEl.classList.add('has-contact');
    previewEl.innerHTML = `
      <div class="contact-preview-left">
        <div class="avatar-circle" style="width: 34px; height: 34px; font-size: 0.85rem;">${(this.activeContact.name || 'C').charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-weight: 700; font-size: 0.95rem;">${escapeHtml(this.activeContact.name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); font-family: var(--font-mono);">+${sanitizePhoneNumber(this.activeContact.phone)}</div>
        </div>
      </div>
      <button type="button" class="btn btn-ghost" id="changeEditContactBtn" style="padding: 4px 8px; font-size: 0.8rem; color: var(--wa-teal);">Alterar</button>
    `;

    document.getElementById('changeEditContactBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      State.openSheet('contacts');
    });
  },

  clearErrors(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.querySelectorAll('.field-error').forEach(el => el.remove());
  },

  showFieldError(inputEl, message) {
    if (!inputEl) return;
    const existing = inputEl.parentElement.querySelector('.field-error');
    if (existing) existing.remove();

    const err = document.createElement('div');
    err.className = 'field-error';
    err.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> ${message}`;
    inputEl.parentElement.appendChild(err);
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    }

    toast.innerHTML = `${iconSvg} <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s ease-out';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  },

  bindGlobalEvents() {
    // Header Actions
    document.getElementById('headerWaStatusPill')?.addEventListener('click', () => {
      State.openSheet('qr');
    });

    document.getElementById('settingsManageWaBtn')?.addEventListener('click', () => {
      State.openSheet('qr');
    });

    document.getElementById('headerScheduleBtn')?.addEventListener('click', () => this.openCreateSheet());
    document.getElementById('headerSettingsBtn')?.addEventListener('click', () => State.openSheet('settings'));
    document.getElementById('bottomCtaBtn')?.addEventListener('click', () => this.openCreateSheet());
    API.onAutoReplySettingsRequested?.(() => State.openSheet('settings'));

    document.getElementById('autoRepliesToggleBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const manager = document.getElementById('autoRepliesManager');
      if (!manager) return;
      const willOpen = manager.hidden;
      manager.hidden = !willOpen;
      button.setAttribute('aria-expanded', String(willOpen));
      button.textContent = willOpen ? 'Fechar' : 'Configurar';
      if (willOpen) await this.loadAutoReplyRules();
    });

    document.getElementById('autoReplyMode')?.addEventListener('change', () => this.updateAutoReplyModeFields());
    this.updateAutoReplyModeFields();

    document.getElementById('autoReplyAttachmentBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const attachment = await API.selectAttachment();
        if (!attachment) return;
        if (this.autoReplyAttachmentIsPending && this.autoReplyAttachment?.attachmentId) {
          await API.discardAttachment(this.autoReplyAttachment.attachmentId);
        }
        this.autoReplyAttachment = attachment;
        this.autoReplyAttachmentIsPending = true;
        this.updateAutoReplyAttachmentPreview();
      } catch (error) {
        this.showToast(error.message || 'Não foi possível anexar a mídia.', 'error');
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('autoReplyRemoveAttachmentBtn')?.addEventListener('click', async () => {
      if (this.autoReplyAttachmentIsPending && this.autoReplyAttachment?.attachmentId) {
        await API.discardAttachment(this.autoReplyAttachment.attachmentId);
      }
      this.autoReplyAttachment = null;
      this.autoReplyAttachmentIsPending = false;
      this.updateAutoReplyAttachmentPreview();
    });

    document.getElementById('autoReplyCancelEditBtn')?.addEventListener('click', async () => {
      await this.resetAutoReplyForm();
    });

    document.getElementById('autoReplyForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const mode = document.getElementById('autoReplyMode')?.value || 'keyword';
      const keyword = document.getElementById('autoReplyKeyword')?.value || '';
      const reply = document.getElementById('autoReplyText')?.value || '';
      const cooldownHours = Number(document.getElementById('autoReplyCooldownHours')?.value || 24);
      submit.disabled = true;
      try {
        await API.saveAutoReplyRule({
          id: this.editingAutoReplyId,
          mode,
          keyword,
          reply,
          cooldownHours,
          attachmentId: this.autoReplyAttachment?.attachmentId || null
        });
        this.autoReplyAttachmentIsPending = false;
        const wasEditing = Boolean(this.editingAutoReplyId);
        await this.resetAutoReplyForm(false);
        this.showToast(wasEditing ? 'Resposta automática atualizada.' : 'Resposta automática cadastrada e ativada.', 'success');
        await this.loadAutoReplyRules();
      } catch (error) {
        this.showToast(error.message || 'Não foi possível salvar a resposta automática.', 'error');
      } finally {
        submit.disabled = false;
      }
    });

    // Close sheets
    document.querySelectorAll('[data-close-sheet]').forEach(btn => {
      btn.addEventListener('click', () => this.closeActiveSheet());
    });

    document.querySelectorAll('.sheet-overlay, .dialog-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeActiveSheet();
      });
    });

    // Contact Picker Trigger
    document.getElementById('createContactPreview')?.addEventListener('click', () => {
      State.openSheet('contacts');
    });

    document.getElementById('importWhatsAppContactsBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = 'Importando...';

      try {
        const result = await API.importWhatsAppContacts();
        Storage.setContacts(result.contacts);
        this.populateContactsSheet();

        const total = result.imported + result.updated;
        if (total > 0) {
          this.showToast(`Contatos importados: ${result.imported} novos e ${result.updated} atualizados.`, 'success');
        } else if (result.available > 0) {
          this.showToast(`${result.available} contatos sincronizados; a lista já estava atualizada.`, 'info');
        } else {
          this.showToast('O WhatsApp não disponibilizou contatos nesta sincronização. Ele pode fornecer apenas contatos associados aos dados sincronizados.', 'info');
        }
      } catch (err) {
        this.showToast(err.message || 'Falha ao importar contatos do WhatsApp.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });

    document.getElementById('createAttachmentBtn')?.addEventListener('click', () => this.chooseAttachment('create'));
    document.getElementById('editAttachmentBtn')?.addEventListener('click', () => this.chooseAttachment('edit'));
    document.getElementById('removeCreateAttachmentBtn')?.addEventListener('click', () => {
      this.attachmentTarget = 'create';
      this.removeAttachment();
    });
    document.getElementById('removeEditAttachmentBtn')?.addEventListener('click', () => {
      this.attachmentTarget = 'edit';
      this.removeAttachment();
    });



    // Manual Contact Form
    document.getElementById('manualContactForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const dial = document.getElementById('manualCountryCode')?.value || '+55';
      const rawPhone = document.getElementById('manualPhoneInput')?.value || '';
      const name = document.getElementById('manualNameInput')?.value || 'Contato';

      const fullPhone = dial + rawPhone;
      if (!isValidPhoneNumber(fullPhone)) {
        UI.showToast('Informe um número de telefone válido.', 'error');
        return;
      }

      this.selectContact({ name, phone: fullPhone });
      UI.showToast(`Contato selecionado: ${name}`, 'success');
    });

    // Quick Time Preset Chips
    document.querySelectorAll('#createSheet .chip-btn[data-shortcut]').forEach(chip => {
      chip.addEventListener('click', () => {
        const type = chip.getAttribute('data-shortcut');
        const now = new Date();
        let target = new Date();

        if (type === '15m') target = new Date(now.getTime() + 15 * 60 * 1000);
        if (type === '1h') target = new Date(now.getTime() + 60 * 60 * 1000);
        if (type === 'tomorrow9am') {
          target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
        }
        if (type === 'tomorrow6pm') {
          target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0);
        }

        const dateInput = document.getElementById('createDate');
        const timeInput = document.getElementById('createTime');
        if (dateInput) dateInput.value = toInputDateFormat(target);
        if (timeInput) timeInput.value = toInputTimeFormat(target);

        document.querySelectorAll('#createSheet .chip-btn').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Emoji Bar
    document.querySelectorAll('#createSheet .emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const textarea = document.getElementById('createMessageText');
        if (textarea) {
          textarea.value += btn.textContent;
          textarea.focus();
        }
      });
    });

    // Create Message Form Submit
    document.getElementById('createMessageForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.clearErrors('createMessageForm');

      if (!this.activeContact || !this.activeContact.phone) {
        this.showFieldError(document.getElementById('createContactPreview'), 'Selecione um contato.');
        return;
      }

      const messageText = document.getElementById('createMessageText')?.value.trim();
      if (!messageText && !this.activeAttachment) {
        this.showFieldError(document.getElementById('createMessageText'), 'Digite uma mensagem ou anexe uma mídia.');
        return;
      }

      const dateVal = document.getElementById('createDate')?.value;
      const timeVal = document.getElementById('createTime')?.value;
      if (!dateVal) {
        this.showFieldError(document.getElementById('createDate'), 'Selecione uma data.');
        return;
      }
      if (!timeVal) {
        this.showFieldError(document.getElementById('createTime'), 'Selecione um horário.');
        return;
      }

      const scheduledDateTime = new Date(`${dateVal}T${timeVal}`).toISOString();
      const scheduledTimestamp = new Date(scheduledDateTime).getTime();

      if (isNaN(scheduledTimestamp) || scheduledTimestamp <= Date.now()) {
        this.showFieldError(document.getElementById('createTime'), 'O horário agendado deve estar no futuro.');
        return;
      }

      try {
        await API.createMessage({
          recipientName: this.activeContact.name,
          recipientPhone: this.activeContact.phone,
          message: messageText,
          scheduledDateTime: scheduledDateTime,
          attachmentId: this.activeAttachment?.attachmentId || null
        });

        Storage.addRecentContact(this.activeContact);

        await State.refreshAll();
        this.activeAttachment = null;
        this.editingAttachmentMessageId = null;
        this.renderAttachmentPreview('create');
        State.closeSheet();
        UI.showToast('Mensagem agendada! O app fará o envio automaticamente.', 'success');
      } catch (err) {
        this.showToast(err.message || 'Falha ao agendar a mensagem.', 'error');
      }
    });

    // Edit Message Form Submit
    document.getElementById('editMessageForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.clearErrors('editMessageForm');
      if (!State.editingMessage) return;

      if (!this.activeContact || !this.activeContact.phone) {
        this.showFieldError(document.getElementById('editContactPreview'), 'Selecione um contato.');
        return;
      }

      const messageText = document.getElementById('editMessageText')?.value.trim();
      if (!messageText && !this.activeAttachment) {
        this.showFieldError(document.getElementById('editMessageText'), 'Digite uma mensagem ou anexe uma mídia.');
        return;
      }

      const dateVal = document.getElementById('editDate')?.value;
      const timeVal = document.getElementById('editTime')?.value;
      if (!dateVal || !timeVal) {
        this.showFieldError(document.getElementById('editDate'), 'Selecione uma data e um horário válidos.');
        return;
      }

      const scheduledDateTime = new Date(`${dateVal}T${timeVal}`).toISOString();

      try {
        await API.updateMessage(State.editingMessage.id, {
          recipientName: this.activeContact.name,
          recipientPhone: this.activeContact.phone,
          message: messageText,
          scheduledDateTime: scheduledDateTime,
          status: 'SCHEDULED',
          errorReason: null,
          attachmentId: this.activeAttachment?.attachmentId || null
        });

        await State.refreshAll();
        this.activeAttachment = null;
        this.editingAttachmentMessageId = null;
        this.renderAttachmentPreview('edit');
        State.closeSheet();
        this.showToast('Mensagem atualizada com sucesso.', 'success');
      } catch (err) {
        this.showToast(err.message || 'Falha ao atualizar a mensagem.', 'error');
      }
    });

    // Delete Modal Confirm
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', async () => {
      if (State.deletingMessageId) {
        try {
          await API.deleteMessage(State.deletingMessageId);
          await State.refreshAll();
          State.closeSheet();
          this.showToast('Mensagem agendada removida.', 'info');
        } catch (err) {
          this.showToast('Falha ao excluir a mensagem.', 'error');
        }
      }
    });

    // Theme selector
    document.querySelectorAll('.theme-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme');
        State.setTheme(theme);
      });
    });
  }
};
