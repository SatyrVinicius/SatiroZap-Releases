/**
 * Application Entrypoint
 */

import { State } from './state.js';
import { UI } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize State (Theme & stored records & WhatsApp connection sync)
  await State.init();

  // 2. Initialize UI & Event Handlers
  UI.init();

  console.log('WhatsApp Automated Message Scheduler initialized successfully.');
});
