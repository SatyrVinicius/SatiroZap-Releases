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

  const navigationButtons = [...document.querySelectorAll('[data-embedded-page]')];
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
    else if (status === 'success') UI.showToast(`Mensagem enviada para +${phone}.`, 'success');
    else if (status === 'error') UI.showToast(message || 'Não foi possível enviar a mensagem pelo WhatsApp.', 'error');
  });
  navigationButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        updateNavigationState(await window.api.selectEmbeddedPage(button.dataset.embeddedPage));
      } catch (error) {
        UI.showToast(error.message || 'Não foi possível abrir esta aba.', 'error');
      }
    });
  });
  updateNavigationState(await window.api.getActiveEmbeddedPage());
  initBrowserControls((error) => UI.showToast(error.message || 'Falha ao navegar.', 'error'));

  console.log('WhatsApp Scheduler Desktop — initialized successfully.');
});
