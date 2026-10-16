(() => {
  if (window.__wppAutomBootstrapInstalled) return;
  window.__wppAutomBootstrapInstalled = true;

  const bridge = window.whatsappBridge;
  let statusTimer = null;
  let autoReplyListenerInstalled = false;

  const reportStatus = () => {
    if (!window.WPP || !bridge) return;
    try {
      const authenticated = Boolean(window.WPP.conn?.isAuthenticated?.());
      const mainLoaded = Boolean(window.WPP.conn?.isMainLoaded?.());
      const streamMode = window.WPP.conn?.getStreamData?.()?.mode;
      let status = 'connecting';
      if (streamMode === 'MAIN' || mainLoaded) status = 'connected';
      else if (streamMode === 'QR' || (!authenticated && document.querySelector('[data-testid="qrcode"]'))) status = 'qr_ready';
      else if (streamMode === 'SYNCING') status = 'connecting';
      else status = 'reconnecting';

      const accountId = window.WPP.conn?.getMyUserId?.()?.toString?.() || '';
      const phone = phoneFromId(accountId);
      const user = phone ? { name: '', phone } : null;
      bridge.status(status, user);
    } catch (error) {
      console.warn('[wppAutom] WhatsApp status probe failed:', error);
    }
  };

  const installAutoReplyListener = () => {
    if (autoReplyListenerInstalled || !window.WPP?.on || !bridge) return;
    autoReplyListenerInstalled = true;
    window.WPP.on('chat.new_message', (message) => {
      try {
        const id = message?.id;
        const chatId = id?.remote?._serialized || id?.remote?.toString?.() || '';
        const messageId = id?._serialized || id?.toString?.() || '';
        const fromMe = id?.fromMe;
        const text = String(message?.body || message?.caption || '').trim();
        if (message?.isNewMsg !== true || fromMe !== false || !messageId || !chatId || !text) return;
        if (/@(g\.us|newsletter|broadcast|status)$/i.test(chatId)) return;
        bridge.incomingMessage({ messageId, chatId, fromMe, text });
      } catch (error) {
        console.warn('[wppAutom] Could not process incoming message event:', error);
      }
    });
  };

  const phoneFromId = (id) => {
    const serialized = typeof id === 'string' ? id : id?._serialized || id?.toString?.() || '';
    const match = serialized.match(/^(\d{7,15})(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/);
    return match ? match[1] : '';
  };

  const getCurrentContact = async () => {
    const chat = await window.WPP.chat.getActiveChat();
    if (!chat) return null;
    const id = chat.id?._serialized || chat.id?.toString?.() || '';
    if (!id || /@(g\.us|newsletter|broadcast)$/.test(id)) return null;

    let phone = phoneFromId(id);
    if (!phone && id.endsWith('@lid')) {
      try {
        const entry = await window.WPP.contact.getPnLidEntry(id);
        phone = phoneFromId(entry?.phoneNumber?._serialized || '');
      } catch {
        return null;
      }
    }
    if (!phone) return null;

    const contact = await window.WPP.contact.get(id).catch(() => null);
    const name = String(contact?.name || contact?.pushname || contact?.shortName || chat.name || '').trim();
    return { name: name.slice(0, 120), phone };
  };

  const onAutomationClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    const button = event.currentTarget;
    button.disabled = true;
    try {
      const contact = await getCurrentContact();
      if (!contact) {
        button.title = 'Abra uma conversa individual com um número disponível';
        return;
      }
      bridge.activeContact(contact);
    } catch (error) {
      console.error('[wppAutom] Não foi possível obter a conversa ativa:', error);
    } finally {
      button.disabled = false;
    }
  };

  const styleQuickMenu = (menu) => {
    menu.style.cssText = 'position:fixed;z-index:99999;width:min(350px,calc(100vw - 24px));max-height:min(520px,70vh);overflow:auto;box-sizing:border-box;background:#202c33;color:#e9edef;border:1px solid #374248;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.45);padding:12px;font:14px Arial,sans-serif;';
  };

  const closeQuickMenu = (menu) => {
    menu?.__cleanupPending?.();
    menu?.remove();
  };

  const renderQuickMessages = async (menu, editItem = null) => {
    const bridgeApi = bridge?.quickMessages;
    if (!bridgeApi) throw new Error('Mensagens rápidas não estão disponíveis nesta versão.');
    const entries = await bridgeApi.list();
    menu.replaceChildren();

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    const title = document.createElement('strong');
    title.textContent = editItem ? (editItem.id ? 'Editar mensagem' : 'Nova mensagem rápida') : 'Mensagens mais usadas';
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Fechar';
    close.style.cssText = 'border:0;background:transparent;color:#aebac1;font-size:22px;cursor:pointer;';
    close.addEventListener('click', () => closeQuickMenu(menu));
    header.appendChild(close);
    menu.appendChild(header);

    if (editItem !== null) {
      let selectedAttachmentId = editItem.attachmentId || null;
      let selectedAttachment = editItem.attachmentId ? {
        attachmentId: editItem.attachmentId,
        attachmentName: editItem.attachmentName,
        attachmentKind: editItem.attachmentKind
      } : null;
      let attachmentIsPending = false;
      const discardPending = async () => {
        if (attachmentIsPending && selectedAttachmentId) {
          await bridgeApi.discardAttachment(selectedAttachmentId).catch(() => {});
          attachmentIsPending = false;
        }
      };
      menu.__cleanupPending = discardPending;
      const form = document.createElement('form');
      form.innerHTML = '<label style="display:block;margin:8px 0 4px;color:#aebac1">Nome</label><input name="title" maxlength="60" required style="box-sizing:border-box;width:100%;padding:9px;border:1px solid #3b4a52;border-radius:6px;background:#111b21;color:#e9edef"><label style="display:block;margin:10px 0 4px;color:#aebac1">Texto da mensagem (opcional se anexar um arquivo)</label><textarea name="message" maxlength="5000" rows="4" style="box-sizing:border-box;width:100%;resize:vertical;padding:9px;border:1px solid #3b4a52;border-radius:6px;background:#111b21;color:#e9edef"></textarea><div style="display:flex;gap:8px;align-items:center;margin-top:10px"><button type="button" data-action="attach" style="padding:9px 12px;border:1px solid #3b4a52;border-radius:6px;background:#202c33;color:#e9edef;cursor:pointer">📎 Anexar áudio, vídeo ou documento</button><span data-attachment-name style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aebac1;font-size:12px"></span><button type="button" data-action="remove-attachment" title="Remover arquivo" style="display:none;border:0;background:transparent;color:#ff7b6b;font-size:18px;cursor:pointer">×</button></div><div style="color:#8696a0;font-size:11px;margin-top:4px">Tamanho máximo: 16 MB. O texto acompanha o arquivo; com áudio, é enviado em uma mensagem separada.</div><div data-error style="color:#ff7b6b;font-size:12px;margin-top:6px"></div><div style="display:flex;gap:8px;margin-top:10px"><button type="submit" style="flex:1;padding:9px;border:0;border-radius:6px;background:#00a884;color:#fff;font-weight:bold;cursor:pointer">Salvar</button><button type="button" data-action="cancel" style="padding:9px 12px;border:1px solid #3b4a52;border-radius:6px;background:transparent;color:#e9edef;cursor:pointer">Cancelar</button></div>';
      form.elements.title.value = editItem.title || '';
      form.elements.message.value = editItem.message || '';
      const attachmentName = form.querySelector('[data-attachment-name]');
      const removeAttachment = form.querySelector('[data-action="remove-attachment"]');
      const updateAttachmentPreview = () => {
        attachmentName.textContent = selectedAttachment?.attachmentName || '';
        attachmentName.title = selectedAttachment?.attachmentName || '';
        removeAttachment.style.display = selectedAttachmentId ? 'inline' : 'none';
      };
      updateAttachmentPreview();
      form.elements.title.focus();
      form.querySelector('[data-action="attach"]').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const error = form.querySelector('[data-error]');
        button.disabled = true;
        error.textContent = '';
        try {
          const file = await bridgeApi.selectAttachment();
          if (!file) return;
          await discardPending();
          selectedAttachmentId = file.attachmentId;
          selectedAttachment = file;
          attachmentIsPending = true;
          updateAttachmentPreview();
        } catch (fileError) {
          error.textContent = fileError.message || 'Não foi possível anexar o arquivo.';
        } finally {
          button.disabled = false;
        }
      });
      removeAttachment.addEventListener('click', async () => {
        await discardPending();
        selectedAttachmentId = null;
        selectedAttachment = null;
        updateAttachmentPreview();
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        const error = form.querySelector('[data-error]');
        const message = form.elements.message.value.trim();
        if (!message && !selectedAttachmentId) {
          error.textContent = 'Digite uma mensagem ou anexe um arquivo.';
          return;
        }
        submit.disabled = true;
        try {
          await bridgeApi.save({ id: editItem.id || null, title: form.elements.title.value, message, attachmentId: selectedAttachmentId });
          attachmentIsPending = false;
          selectedAttachmentId = null;
          menu.__cleanupPending = null;
          await renderQuickMessages(menu);
        } catch (saveError) {
          error.textContent = saveError.message || 'Não foi possível salvar.';
        } finally {
          submit.disabled = false;
        }
      });
      form.querySelector('[data-action="cancel"]').addEventListener('click', async () => {
        await discardPending();
        menu.__cleanupPending = null;
        await renderQuickMessages(menu);
      });
      menu.appendChild(form);
    } else {
      const hint = document.createElement('div');
      hint.textContent = 'Clique em uma mensagem para enviá-la imediatamente nesta conversa.';
      hint.style.cssText = 'color:#aebac1;font-size:12px;line-height:1.4;margin:-4px 0 8px;';
      menu.appendChild(hint);

      const list = document.createElement('div');
      if (!entries.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Nenhuma mensagem salva ainda. Cadastre um texto para reutilizar nas conversas.';
        empty.style.cssText = 'color:#aebac1;line-height:1.5;margin:12px 0;';
        list.appendChild(empty);
      }

      entries.forEach((entry) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 0;border-bottom:1px solid #374248;';
        const use = document.createElement('button');
        use.type = 'button';
        use.dataset.action = 'use';
        use.title = 'Enviar mensagem agora';
        use.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;border:0;background:transparent;color:#e9edef;padding:8px;cursor:pointer;';
        const preview = document.createElement('span');
        preview.textContent = entry.message || `📎 ${entry.attachmentName || 'Arquivo anexado'}`;
        preview.style.cssText = 'width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;';
        const savedName = document.createElement('span');
        savedName.textContent = entry.title;
        savedName.style.cssText = 'width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aebac1;font-size:12px;';
        use.append(preview, savedName);
        if (entry.message && entry.attachmentId) {
          const filePreview = document.createElement('span');
          filePreview.textContent = `📎 ${entry.attachmentName || 'Arquivo anexado'}`;
          filePreview.style.cssText = 'width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8696a0;font-size:11px;';
          use.appendChild(filePreview);
        }
        use.addEventListener('click', async () => {
          const notice = menu.querySelector('[data-notice]');
          use.disabled = true;
          use.style.opacity = '0.65';
          notice.style.color = '#aebac1';
          notice.textContent = 'Enviando…';
          try {
            await bridgeApi.send(entry.id);
            notice.style.color = '#25d366';
            notice.textContent = `Mensagem “${entry.title}” enviada.`;
            setTimeout(() => menu.remove(), 900);
          } catch (error) {
            notice.style.color = '#ff7b6b';
            notice.textContent = error.message || 'Não foi possível enviar a mensagem.';
            use.disabled = false;
            use.style.opacity = '1';
          }
        });
        row.appendChild(use);

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '✎';
        edit.title = 'Editar';
        edit.style.cssText = 'border:0;background:transparent;color:#aebac1;cursor:pointer;padding:7px;';
        edit.addEventListener('click', () => renderQuickMessages(menu, entry));
        row.appendChild(edit);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = 'Excluir';
        remove.style.cssText = 'border:0;background:transparent;color:#ff7b6b;cursor:pointer;padding:7px;font-size:18px;';
        remove.addEventListener('click', async () => {
          try {
            await bridgeApi.delete(entry.id);
            await renderQuickMessages(menu);
          } catch (error) {
            menu.querySelector('[data-notice]').textContent = error.message || 'Não foi possível excluir.';
          }
        });
        row.appendChild(remove);
        list.appendChild(row);
      });
      menu.appendChild(list);

      const notice = document.createElement('div');
      notice.dataset.notice = 'true';
      notice.style.cssText = 'color:#ff7b6b;font-size:12px;padding-top:6px;';
      menu.appendChild(notice);

      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = '+ Cadastrar mensagem';
      add.style.cssText = 'width:100%;margin-top:10px;padding:10px;border:0;border-radius:7px;background:#00a884;color:white;font-weight:bold;cursor:pointer;';
      add.addEventListener('click', () => renderQuickMessages(menu, {}));
      menu.appendChild(add);
    }
  };

  const openQuickMessages = async (button) => {
    closeQuickMenu(document.querySelector('[data-wppautom-quick-menu]'));
    closeQuickMenu(document.querySelector('[data-wppautom-auto-reply-menu]'));
    const menu = document.createElement('div');
    menu.dataset.wppautomQuickMenu = 'true';
    styleQuickMenu(menu);
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(rect.left - 300, window.innerWidth - 362))}px`;
    menu.style.top = `${Math.max(12, Math.min(rect.top - 12, window.innerHeight - 540))}px`;
    menu.addEventListener('click', event => event.stopPropagation());
    document.body.appendChild(menu);
    try {
      await renderQuickMessages(menu);
    } catch (error) {
      menu.textContent = error.message || 'Não foi possível carregar as mensagens salvas.';
    }
  };

  const getActiveAutoReplyChat = async () => {
    const chat = await window.WPP.chat.getActiveChat();
    const chatId = chat?.id?._serialized || chat?.id?.toString?.() || '';
    if (!/^[\w.-]+@(?:c\.us|s\.whatsapp\.net|lid)$/i.test(chatId)) return null;
    const name = String(chat?.name || chat?.formattedTitle || chat?.contact?.name || '').trim();
    return { chatId, name: name || chatId.split('@')[0] };
  };

  const renderAutoReplyMenu = async (menu, chat) => {
    menu.replaceChildren();

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    const title = document.createElement('strong');
    title.textContent = 'Respostas automáticas';
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Fechar';
    close.style.cssText = 'border:0;background:transparent;color:#aebac1;font-size:22px;cursor:pointer;';
    close.addEventListener('click', () => closeQuickMenu(menu));
    header.appendChild(close);
    menu.appendChild(header);

    const content = document.createElement('div');
    content.style.cssText = 'color:#c9d3d9;font-size:13px;line-height:1.5;';
    menu.appendChild(content);

    const api = bridge?.autoReplies;
    const configure = document.createElement('button');
    configure.type = 'button';
    configure.textContent = 'Configurar palavras e respostas';
    configure.style.cssText = 'width:100%;margin:0 0 12px;padding:10px;border:1px solid #3b4a52;border-radius:7px;background:#202c33;color:#e9edef;font-weight:bold;cursor:pointer;';
    content.appendChild(configure);

    const notice = document.createElement('div');
    notice.style.cssText = 'color:#ff7b6b;font-size:12px;margin-top:6px;';
    content.appendChild(notice);
    configure.addEventListener('click', async () => {
      configure.disabled = true;
      try {
        if (!api?.openSettings) throw new Error('Não foi possível abrir as configurações. Reabra o aplicativo atualizado.');
        await api.openSettings();
        closeQuickMenu(menu);
      } catch (error) {
        notice.textContent = error.message || 'Não foi possível abrir as configurações.';
        configure.disabled = false;
      }
    });

    if (!chat) {
      const noChat = document.createElement('div');
      noChat.textContent = 'Abra uma conversa individual para controlar as respostas automáticas dela. Grupos não são compatíveis.';
      content.insertBefore(noChat, configure);
      return;
    }

    const chatLabel = document.createElement('div');
    chatLabel.style.cssText = 'margin-bottom:8px;color:#e9edef;font-weight:600;overflow-wrap:anywhere;';
    chatLabel.textContent = `Conversa: ${chat.name}`;
    content.appendChild(chatLabel);

    const statusText = document.createElement('div');
    statusText.textContent = 'Verificando configuração…';
    content.appendChild(statusText);

    const action = document.createElement('button');
    action.type = 'button';
    action.disabled = true;
    action.style.cssText = 'width:100%;margin-top:12px;padding:10px;border:0;border-radius:7px;background:#00a884;color:white;font-weight:bold;cursor:pointer;';
    action.textContent = 'Carregando…';
    content.appendChild(action);

    const help = document.createElement('div');
    help.style.cssText = 'margin-top:10px;color:#8696a0;font-size:11px;';
    help.textContent = 'A pausa afeta somente esta conversa; as demais continuam respondendo.';
    content.appendChild(help);

    try {
      if (!api) throw new Error('Controles de respostas automáticas indisponíveis. Atualize e reabra o aplicativo.');
      const state = await api.chatStatus(chat.chatId);
      const paused = Boolean(state?.paused);
      const enabledRules = Number(state?.enabledRules) || 0;
      statusText.textContent = paused
        ? 'Pausadas somente nesta conversa.'
        : enabledRules > 0
          ? `Ativas nesta conversa · ${enabledRules} regra${enabledRules === 1 ? '' : 's'} habilitada${enabledRules === 1 ? '' : 's'}.`
          : 'Nenhuma regra ativa. Cadastre respostas nas Configurações.';
      action.textContent = paused ? 'Retomar nesta conversa' : 'Pausar nesta conversa';
      action.style.background = paused ? '#00a884' : '#3b4a52';
      action.setAttribute('aria-pressed', String(paused));
      action.disabled = false;
      action.addEventListener('click', async () => {
        action.disabled = true;
        action.textContent = 'Salvando…';
        try {
          await api.setChatPaused(chat.chatId, !paused);
          await renderAutoReplyMenu(menu, chat);
        } catch (error) {
          statusText.textContent = error.message || 'Não foi possível alterar a pausa desta conversa.';
          action.disabled = false;
          action.textContent = paused ? 'Retomar nesta conversa' : 'Pausar nesta conversa';
        }
      });
    } catch (error) {
      statusText.textContent = error.message || 'Não foi possível carregar o estado das respostas automáticas.';
      action.remove();
    }
  };

  const openAutoReplyMenu = async (button) => {
    closeQuickMenu(document.querySelector('[data-wppautom-quick-menu]'));
    closeQuickMenu(document.querySelector('[data-wppautom-auto-reply-menu]'));
    const menu = document.createElement('div');
    menu.dataset.wppautomAutoReplyMenu = 'true';
    styleQuickMenu(menu);
    menu.style.width = 'min(340px,calc(100vw - 24px))';
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(rect.left - 292, window.innerWidth - 352))}px`;
    menu.style.top = `${Math.max(12, Math.min(rect.top - 12, window.innerHeight - 360))}px`;
    menu.addEventListener('click', event => event.stopPropagation());
    document.body.appendChild(menu);
    try {
      const chat = await getActiveAutoReplyChat();
      await renderAutoReplyMenu(menu, chat);
    } catch (error) {
      menu.textContent = error.message || 'Não foi possível abrir os controles de respostas automáticas.';
    }
  };

  const addButton = (root) => {
    if (!root) return;
    let button = root.querySelector('[data-wppautom-button]') || document.querySelector('[data-wppautom-button]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.wppautomButton = 'true';
      button.setAttribute('aria-label', 'Agendar mensagem para esta conversa');
      button.title = 'Agendar mensagem para esta conversa';
      button.textContent = '⏱';
      button.style.cssText = 'width:40px;height:40px;border:0;border-radius:50%;background:transparent;color:#8696a0;font-size:21px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin:0 2px;';
      button.addEventListener('mouseenter', () => { button.style.background = '#202c33'; });
      button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
      button.addEventListener('click', onAutomationClick, true);
    }

    let quickButton = root.querySelector('[data-wppautom-quick-button]') || document.querySelector('[data-wppautom-quick-button]');
    if (!quickButton) {
      quickButton = document.createElement('button');
      quickButton.type = 'button';
      quickButton.dataset.wppautomQuickButton = 'true';
      quickButton.setAttribute('aria-label', 'Mensagens mais usadas');
      quickButton.title = 'Mensagens mais usadas';
      quickButton.textContent = '▤';
      quickButton.style.cssText = 'width:36px;height:40px;border:0;border-radius:50%;background:transparent;color:#8696a0;font-size:19px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin:0 2px;';
      quickButton.addEventListener('mouseenter', () => { quickButton.style.background = '#202c33'; });
      quickButton.addEventListener('mouseleave', () => { quickButton.style.background = 'transparent'; });
      quickButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openQuickMessages(quickButton);
      }, true);
    }

    let autoReplyButton = root.querySelector('[data-wppautom-auto-reply-button]') || document.querySelector('[data-wppautom-auto-reply-button]');
    if (!autoReplyButton) {
      autoReplyButton = document.createElement('button');
      autoReplyButton.type = 'button';
      autoReplyButton.dataset.wppautomAutoReplyButton = 'true';
      autoReplyButton.setAttribute('aria-label', 'Respostas automáticas e pausa desta conversa');
      autoReplyButton.title = 'Respostas automáticas / pausar nesta conversa';
      autoReplyButton.textContent = '⚡';
      autoReplyButton.style.cssText = 'width:36px;height:40px;border:0;border-radius:50%;background:transparent;color:#8696a0;font-size:19px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin:0 2px;';
      autoReplyButton.addEventListener('mouseenter', () => { autoReplyButton.style.background = '#202c33'; });
      autoReplyButton.addEventListener('mouseleave', () => { autoReplyButton.style.background = 'transparent'; });
      autoReplyButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openAutoReplyMenu(autoReplyButton);
      }, true);
    }

    const mic = root.querySelector('[data-testid="ptt-button"], [data-icon="ptt"], [aria-label*="voice message" i], [aria-label*="mensagem de voz" i]');
    const micControl = mic?.closest('button') || mic;
    const insertionPoint = micControl?.parentElement;
    const customButtons = [button, quickButton, autoReplyButton];
    if (!insertionPoint) {
      customButtons.forEach(control => { control.style.display = 'none'; });
      closeQuickMenu(document.querySelector('[data-wppautom-quick-menu]'));
      closeQuickMenu(document.querySelector('[data-wppautom-auto-reply-menu]'));
      return;
    }

    let nextControl = micControl;
    for (let index = customButtons.length - 1; index >= 0; index--) {
      const control = customButtons[index];
      if (control.parentElement !== insertionPoint || control.nextElementSibling !== nextControl) {
        insertionPoint.insertBefore(control, nextControl);
      }
      control.style.display = 'inline-flex';
      nextControl = control;
    }
  };

  const installButton = () => {
    const composer = document.querySelector('[data-testid="conversation-compose-box-input"]')
      ?.closest('[data-testid="conversation-compose-box"]')
      || document.querySelector('footer');
    addButton(composer);
  };

  const start = async () => {
    for (let attempt = 0; attempt < 120 && !window.WPP?.conn?.isAuthenticated; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    bridge?.ready(Boolean(window.WPP?.conn?.isAuthenticated?.()));
    installAutoReplyListener();
    installButton();
    reportStatus();
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(reportStatus, 2500);
    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-wppautom-quick-menu], [data-wppautom-quick-button]')) {
        closeQuickMenu(document.querySelector('[data-wppautom-quick-menu]'));
      }
      if (!event.target.closest('[data-wppautom-auto-reply-menu], [data-wppautom-auto-reply-button]')) {
        closeQuickMenu(document.querySelector('[data-wppautom-auto-reply-menu]'));
      }
    }, true);
    new MutationObserver(installButton).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
