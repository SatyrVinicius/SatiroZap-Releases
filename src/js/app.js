/**
 * Application Entrypoint — Electron Desktop Version
 */

import { State } from './state.js';
import { UI } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize State (Theme, stored records, WhatsApp connection sync, IPC listeners)
  await State.init();

  // 2. Initialize UI & Event Handlers
  UI.init();

  console.log('WhatsApp Scheduler Desktop — initialized successfully.');
});
