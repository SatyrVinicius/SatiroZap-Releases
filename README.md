# 📱 WhatsApp Message Scheduler (Desktop Edition)

A standalone Windows desktop application for scheduling and automatically sending WhatsApp messages using the **WhatsApp Multi-Device Protocol (Baileys)**.

Unlike basic reminder apps, this application **actually delivers WhatsApp messages automatically** in the background at the exact scheduled date and time without requiring you to click "send" or keep a browser open.

---

## ✨ Features

- 🖥️ **Native Desktop App**: Runs as a standalone Windows application.
- 🤖 **100% Automated**: Scheduled messages are dispatched directly in the background.
- 📉 **System Tray Support**: Close the window, and the app minimizes to the system tray to keep running 24/7.
- 💾 **Local SQLite Database**: All scheduled messages, contacts, and settings are saved locally and persist across computer restarts.
- 📲 **Zero Browser Overhead**: Powered by `@whiskeysockets/baileys` directly in Node.js — no heavy headless browser needed.
- 🔄 **Auto-Reconnect**: Handles internet drops and automatically reconnects to WhatsApp.

---

## 🚀 Installation & Usage

1. **Download the App:**
   - Go to the [Releases](../../releases/latest) page on GitHub.
   - Download the latest `WhatsApp-Scheduler-Setup-x.x.x.exe` file.

2. **Install:**
   - Double-click the downloaded `.exe` file to install the application.
   - It will automatically create shortcuts on your Desktop and Start Menu.

3. **Connect WhatsApp:**
   - Open the app and click the **Settings** icon (gear) in the top right.
   - Click **Manage** under WhatsApp Account.
   - Scan the QR code using your WhatsApp mobile app (Linked Devices -> Link a Device).

4. **Schedule a Message:**
   - Click the **Schedule Message** button at the bottom.
   - Enter the recipient's phone number and the message text.
   - Choose the date and time, and click Schedule.
   - You can safely close the window! The app will minimize to the System Tray and send the message at the exact time in the background.

---

## 👨‍💻 Development Setup

If you want to run the app from source or contribute to the project:

```bash
# Install dependencies
npm install

# Start the application in development mode
npm start

# Build the Windows Installer (.exe)
npm run build
```

---

## 🛠️ Architecture

- **Frontend**: Vanilla JS, CSS Variables, IPC Renderer calls.
- **Backend**: Electron Main Process.
- **Database**: `sql.js` (SQLite compiled to WASM — zero native dependencies).
- **WhatsApp**: `@whiskeysockets/baileys` Multi-Device library.

## 📝 License
MIT License
