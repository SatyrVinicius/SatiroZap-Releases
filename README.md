# 📱 WhatsApp Message Scheduler (Automated Sending)

An automated, local-first WhatsApp message scheduler that **actually sends scheduled messages automatically** via the **WhatsApp Multi-Device Protocol (Baileys)**.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![WhatsApp Protocol](https://img.shields.io/badge/WhatsApp-Multi--Device%20(Baileys)-25D366.svg)](#how-automated-sending-works)
[![Zero Cloud Database](https://img.shields.io/badge/database-Local%20JSON%20Persistence-128C7E.svg)](#architecture)
[![Automated Delivery](https://img.shields.io/badge/delivery-100%25%20Automated-0288D1.svg)](#message-lifecycle)

---

## 🎯 What Makes This Different?

Unlike basic reminder apps that only send a notification and require you to manually click and send, this application **actually delivers WhatsApp messages automatically** at the exact scheduled date and time.

- 🤖 **100% Automated**: Scheduled messages are dispatched directly through your linked WhatsApp session in the background.
- 📲 **Multi-Device WebSocket Engine**: Powered by `@whiskeysockets/baileys` — zero Chromium/headless browser overhead, ultra-fast and lightweight.
- ⚡ **Zero API Keys Required**: No Meta Developer account, no paid WhatsApp Business API credentials, and no billing setup.
- 🔒 **Private & Local-First**: Session keys and scheduled messages are stored exclusively on your local machine (`./data/`).

---

## 🔄 Core Experience Flow

```text
Connect WhatsApp via QR ➔ Select Contact ➔ Write Message ➔ Choose Date & Time ➔ Schedule ➔ Message is Automatically Sent on WhatsApp
```

1. **One-Time Pairing**: Click the connection pill in the header to open the QR Code modal, open WhatsApp on your phone (`Linked Devices > Link a Device`), and scan the QR code.
2. **Schedule**: Select recipient, write message (with emoji and WhatsApp formatting support), and pick the target timestamp.
3. **Automated Dispatch**: The background scheduler monitors due messages and automatically sends them via your active WhatsApp session.
4. **Track Delivery**: View real-time status: **Scheduled ➔ Sending ➔ Sent ✓✓ / Failed**.

---

## 📊 Message Lifecycle & Statuses

| Status | Badge | Description |
| :--- | :--- | :--- |
| **`scheduled`** | 🟡 **Scheduled** | Queued and waiting for the target timestamp. |
| **`sending`** | 🔵 **Sending...** | In-flight dispatching to WhatsApp servers. |
| **`sent`** | 🟢 **Sent ✓✓** | Successfully transmitted through WhatsApp (records delivery timestamp and WhatsApp message ID). |
| **`failed`** | 🔴 **Failed** | Delivery failed (e.g. invalid phone number, phone not on WhatsApp, or device unlinked). Includes detailed reason and a 1-tap **Retry** button. |

---

## 🛠️ Architecture & System Structure

```text
┌─────────────────────────────────────────────────────────────┐
│                 Frontend UI (Vite / Mobile)                 │
│  ├── WhatsApp Status Pill (🟢 Connected / 🟡 Scan QR / 🔴)   │
│  ├── QR Code Setup Modal (Step-by-step pairing screen)      │
│  ├── Message List with Real Status (Scheduled/Sending/Sent) │
│  ├── Message Details (Delivery status, WhatsApp Msg ID)     │
│  └── Send Now & Retry actions                               │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST API (/api/*)
┌──────────────────────────────▼──────────────────────────────┐
│             Node.js Backend Server (Port 3005)              │
│  ├── server/index.js (Express API endpoints)                │
│  ├── server/whatsappClient.js (Baileys WebSocket & QR Gen)  │
│  ├── server/scheduler.js (Automated Ticker Engine)          │
│  └── server/db.js (JSON persistent database in ./data/)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Secure TLS WebSocket
┌──────────────────────────────▼──────────────────────────────┐
│               WhatsApp Multi-Device Network                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- WhatsApp on your mobile phone

### 1. Installation
```bash
git clone https://github.com/your-username/whatsapp-message-scheduler.git
cd whatsapp-message-scheduler
npm install
```

### 2. Start Backend & Automated Scheduler
```bash
npm run server
```
*The server will start on `http://localhost:3005` and initialize the WhatsApp Multi-Device client.*

### 3. Start Frontend Development UI
In a second terminal window:
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

### 4. Link WhatsApp Account
1. In the app header, click the **Link Account / Scan QR** pill.
2. Open WhatsApp on your phone:
   - **Android**: Tap `⋮` (Menu) ➔ **Linked Devices** ➔ **Link a Device**
   - **iOS**: Go to **Settings** ➔ **Linked Devices** ➔ **Link a Device**
3. Scan the QR code displayed on your screen.
4. The header indicator will turn green (🟢 `+YourNumber`). You're now ready to schedule automated messages!

### 5. Run Unit & Integration Tests
```bash
npm test
```

---

## 🔒 Privacy & Local-First Security

- **Session Security**: Multi-Device authentication tokens are stored strictly on your local disk in `./data/auth/`.
- **Zero Cloud Leakage**: No contacts, messages, or keys are ever transmitted to any third-party cloud database or server.
- **One-Tap Unlink**: You can disconnect or log out of your session at any time directly from the app or from your phone's Linked Devices list.

---

## 📄 License

MIT License.
