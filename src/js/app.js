/**
 * Application Entrypoint — Electron Desktop Version
 */

import { State } from './state.js';
import { UI } from './ui.js';
import { initBrowserControls } from './browser.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize State (Theme, stored records, WhatsApp connection sync, IPC listeners)
  await State.init();

  // 2. Initialize UI & Event Handlers
  UI.init();

  const updateBanner = document.getElementById('appUpdateBanner');
  const updateMessage = document.getElementById('appUpdateMessage');
  const updateButton = document.getElementById('appUpdateButton');
  const showUpdateBanner = (update) => {
    if (!update?.version) return;
    updateMessage.textContent = `Você tem novas atualizações disponíveis (versão ${update.version}).`;
    updateBanner.hidden = false;
  };
  window.api.onUpdateReady(showUpdateBanner);
  window.api.getReadyUpdate().then(showUpdateBanner).catch((error) => {
    console.error('Não foi possível verificar atualização baixada:', error);
  });
  updateButton.addEventListener('click', async () => {
    updateButton.disabled = true;
    updateButton.textContent = 'INSTALANDO...';
    try {
      await window.api.installUpdate();
    } catch (error) {
      updateButton.disabled = false;
      updateButton.textContent = 'ATUALIZAR';
      UI.showToast(error.message || 'Não foi possível iniciar a atualização.', 'error');
    }
  });

  const navigationButtons = [...document.querySelectorAll('[data-embedded-page]')];
  const whatsappSidebarButton = document.querySelector('.app-sidebar-button[data-embedded-page="whatsapp"]');
  const updateNavigationState = (activePage) => {
    navigationButtons.forEach((button) => {
      const active = button.dataset.embeddedPage === activePage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  window.api.onEmbeddedPageChanged(updateNavigationState);
  window.api.onWhatsAppLinkSendStatus(({ status, phone, message }) => {
    if (status === 'sending') UI.showToast(`Enviando mensagem para +${phone}...`, 'info');
    else if (status === 'opening') UI.showToast(`Abrindo conversa com +${phone}...`, 'info');
    else if (status === 'opened') UI.showToast(`Conversa com +${phone} aberta.`, 'success');
    else if (status === 'success') {
      whatsappSidebarButton?.classList.add('message-sent-alert');
      UI.showToast(`Mensagem enviada para +${phone}.`, 'success');
    } else if (status === 'error') UI.showToast(message || 'Não foi possível enviar a mensagem pelo WhatsApp.', 'error');
  });
  window.api.onWhatsAppLinkSendSound((dataUrl) => {
    const audio = new Audio(dataUrl);
    audio.play().catch((error) => {
      console.warn('Não foi possível reproduzir o áudio personalizado:', error);
      window.api.reportWhatsAppLinkSendSoundFailed();
    });
  });
  navigationButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (button === whatsappSidebarButton) {
        whatsappSidebarButton.classList.remove('message-sent-alert');
      }
      try {
        updateNavigationState(await window.api.selectEmbeddedPage(button.dataset.embeddedPage));
      } catch (error) {
        UI.showToast(error.message || 'Não foi possível abrir esta aba.', 'error');
      }
    });
  });
  document.querySelectorAll('[data-window-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await window.api.controlWindow(button.dataset.windowAction);
      } catch (error) {
        UI.showToast(error.message || 'Não foi possível controlar a janela.', 'error');
      }
    });
  });
  updateNavigationState(await window.api.getActiveEmbeddedPage());
  initBrowserControls((error) => UI.showToast(error.message || 'Falha ao navegar.', 'error'));

  console.log('WhatsApp Scheduler Desktop — initialized successfully.');
});
