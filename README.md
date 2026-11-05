# 📱 Agendador de mensagens do WhatsApp (versão para computador)

Um aplicativo independente para Windows que agenda e envia mensagens do WhatsApp automaticamente usando uma janela integrada do **WhatsApp Web**.

Ao contrário de aplicativos simples de lembretes, este aplicativo **envia as mensagens do WhatsApp automaticamente** em segundo plano, na data e no horário agendados, sem que você precise clicar em “enviar”. O aplicativo precisa continuar em execução na bandeja e a sessão do WhatsApp Web deve permanecer conectada.

---

## ✨ Recursos

- 🖥️ **Aplicativo nativo para computador**: funciona como um aplicativo independente no Windows.
- 🤖 **Totalmente automatizado**: as mensagens agendadas são enviadas em segundo plano.
- 📉 **Ícone na bandeja do sistema**: ao fechar a janela, o aplicativo continua em execução na bandeja.
- 💾 **Banco de dados SQLite local**: mensagens, contatos e configurações são salvos no computador e mantidos após reinicializações.
- 🪟 **WhatsApp Web integrado**: a sessão fica em uma janela própria dentro do aplicativo e pode ser ocultada sem encerrar o agendador.
- ⏱️ **Automação contextual**: um botão na conversa aberta permite iniciar um agendamento já preenchido com o contato atual.
- 💬 **Mensagens rápidas**: salve, edite, exclua e reutilize textos, áudios, vídeos e documentos pelo botão ao lado do agendamento na conversa.
- 🔄 **Sessão persistente**: o login do WhatsApp Web é salvo localmente; pode ser necessário reconectar após logout ou expiração da sessão.

---

## 🚀 Instalação e uso

1. **Baixe o aplicativo:**
   - Acesse a página de [versões](../../releases/latest) no GitHub.
   - Baixe o arquivo de instalação mais recente.

2. **Instale:**
   - Abra o arquivo `.exe` baixado para instalar o aplicativo.
   - Os atalhos serão criados automaticamente na área de trabalho e no menu Iniciar.

3. **Conecte o WhatsApp:**
   - Abra o aplicativo e clique no ícone de **Configurações** (engrenagem), no canto superior.
   - Clique em **Gerenciar**, na seção da conta do WhatsApp.
   - Clique em **Abrir WhatsApp Web** e faça login na janela integrada. Se um QR aparecer, escaneie pelo celular em **Dispositivos conectados → Conectar dispositivo**.

4. **Agende uma mensagem:**
   - Clique no botão **Agendar mensagem**, na parte inferior.
   - Selecione o contato e escreva a mensagem. Anexe arquivos de até 2 GB; imagens, vídeos e áudios acima de 16 MB são enviados como documentos.
   - Imagens, vídeos e documentos podem usar o texto como legenda; para áudios, o texto é enviado em uma mensagem separada.
   - Escolha a data e o horário e confirme o agendamento.
   - Você pode fechar a janela: o aplicativo continuará na bandeja do sistema e enviará a mensagem no horário programado.
   - Como atalho, abra uma conversa individual no WhatsApp Web e use o botão de automação ao lado do controle de áudio para abrir o formulário com o destinatário preenchido.
   - Use o botão de mensagens rápidas ao lado do agendamento para enviar imediatamente um texto ou arquivo salvo à conversa aberta; cadastre, edite ou exclua mensagens e anexos pelo próprio menu. Anexos têm limite de 2 GB; mídias acima de 16 MB são enviadas como documentos.

---

## 👨‍💻 Configuração para desenvolvimento

If you want to run the app from source or contribute to the project:

```bash
# Instalar as dependências
npm install

# Iniciar o aplicativo em modo de desenvolvimento
npm start

# Gerar o instalador do Windows (.exe)
npm run build
```

---

## 🛠️ Arquitetura

- **Interface**: JavaScript sem framework, variáveis CSS e comunicação IPC com o Electron.
- **Backend**: processo principal do Electron.
- **Banco de dados**: `sql.js` (SQLite compilado para WebAssembly, sem dependências nativas).
- **WhatsApp**: janela persistente do WhatsApp Web, integrada com `@wppconnect/wa-js` para automações e envio de mensagens.

## ⚠️ Compatibilidade

A integração usa uma biblioteca comunitária não oficial e depende das interfaces internas do WhatsApp Web. Atualizações do WhatsApp podem interromper temporariamente o botão contextual ou o envio até que a biblioteca seja compatibilizada. O agendador só envia enquanto o aplicativo está em execução e a conta permanece conectada; grupos e conversas sem número de telefone resolvido não podem ser pré-preenchidos como contatos individuais.

## 📝 Licença
Licença MIT
