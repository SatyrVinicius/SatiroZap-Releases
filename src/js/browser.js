export function initBrowserControls(onError = () => {}) {
  const tabList = document.getElementById('browserTabs');
  const addressForm = document.getElementById('browserAddressForm');
  const addressInput = document.getElementById('browserAddress');
  const newTabButton = document.getElementById('browserNewTab');
  const chromeToggle = document.getElementById('browserChromeToggle');
  const historyButtons = [...document.querySelectorAll('[data-browser-action]')];

  let browserState = { activeTabId: null, tabs: [] };

  const activeTab = () => browserState.tabs.find(tab => tab.id === browserState.activeTabId) || null;

  const render = (state) => {
    if (!state || !Array.isArray(state.tabs)) return;
    browserState = state;
    document.body.classList.toggle('browser-chrome-collapsed', Boolean(state.chromeCollapsed));
    chromeToggle.setAttribute('aria-expanded', String(!state.chromeCollapsed));
    chromeToggle.setAttribute('aria-label', state.chromeCollapsed ? 'Mostrar barra do navegador' : 'Ocultar barra do navegador');
    chromeToggle.title = state.chromeCollapsed ? 'Mostrar barra do navegador' : 'Ocultar barra do navegador';
    tabList.replaceChildren();

    for (const tab of state.tabs) {
      const tabElement = document.createElement('div');
      tabElement.className = `browser-tab${tab.id === state.activeTabId ? ' active' : ''}`;
      tabElement.setAttribute('role', 'presentation');

      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'browser-tab-select';
      selectButton.setAttribute('role', 'tab');
      selectButton.setAttribute('aria-selected', String(tab.id === state.activeTabId));
      selectButton.textContent = tab.isLoading ? 'Carregando…' : (tab.title || tab.url || 'Nova guia');
      selectButton.title = tab.url || tab.title || 'Nova guia';
      selectButton.addEventListener('click', async () => {
        try {
          render(await window.api.selectBrowserTab(tab.id));
        } catch (error) {
          onError(error);
        }
      });

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'browser-tab-close';
      closeButton.setAttribute('aria-label', `Fechar aba ${tab.title || 'Nova guia'}`);
      closeButton.title = 'Fechar aba';
      closeButton.textContent = '×';
      closeButton.addEventListener('click', async () => {
        try {
          render(await window.api.closeBrowserTab(tab.id));
        } catch (error) {
          onError(error);
        }
      });

      tabElement.append(selectButton, closeButton);
      tabList.appendChild(tabElement);
    }

    const selected = activeTab();
    if (selected && document.activeElement !== addressInput) addressInput.value = selected.url || '';
    historyButtons.forEach((button) => {
      const action = button.dataset.browserAction;
      button.disabled = action === 'back' ? !selected?.canGoBack : action === 'forward' ? !selected?.canGoForward : false;
    });
  };

  const updatePageVisibility = (page) => {
    document.body.classList.toggle('browser-page-active', page === 'google');
  };

  const safeAction = async (action) => {
    try {
      if (action === 'back' || action === 'forward' || action === 'reload') {
        render(await window.api.browserHistory(action));
      }
    } catch (error) {
      onError(error);
    }
  };

  addressForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      render(await window.api.navigateBrowser(addressInput.value));
      addressInput.blur();
    } catch (error) {
      onError(error);
      addressInput.select();
    }
  });

  newTabButton.addEventListener('click', async () => {
    try {
      render(await window.api.newBrowserTab());
      addressInput.value = 'https://pms.satirosistemas.com.br/';
    } catch (error) {
      onError(error);
    }
  });

  chromeToggle.addEventListener('click', async () => {
    try {
      render(await window.api.toggleBrowserChrome());
    } catch (error) {
      onError(error);
    }
  });

  historyButtons.forEach(button => button.addEventListener('click', () => safeAction(button.dataset.browserAction)));
  window.api.onBrowserState(render);
  window.api.onEmbeddedPageChanged(updatePageVisibility);

  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key === 'l' && document.body.classList.contains('browser-page-active')) {
      event.preventDefault();
      addressInput.focus();
      addressInput.select();
    } else if (key === 't' && document.body.classList.contains('browser-page-active')) {
      event.preventDefault();
      newTabButton.click();
    } else if (key === 'w' && document.body.classList.contains('browser-page-active')) {
      event.preventDefault();
      const selected = activeTab();
      if (selected) window.api.closeBrowserTab(selected.id).then(render).catch(onError);
    }
  });

  Promise.all([window.api.getBrowserState(), window.api.getActiveEmbeddedPage()])
    .then(([state, page]) => {
      render(state);
      updatePageVisibility(page);
    })
    .catch(onError);
}
