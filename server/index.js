import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Database } from './db.js';
import { WhatsAppClient } from './whatsappClient.js';
import { Scheduler } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================================
// WhatsApp Connection Endpoints
// ============================================================

app.get('/api/whatsapp/status', (req, res) => {
  const status = WhatsAppClient.getStatus();
  res.json(status);
});

app.post('/api/whatsapp/connect', async (req, res) => {
  try {
    await WhatsAppClient.init();
    res.json({ success: true, ...WhatsAppClient.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    await WhatsAppClient.logout();
    res.json({ success: true, message: 'Sessão desconectada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Scheduled Messages Endpoints
// ============================================================

app.get('/api/messages', (req, res) => {
  const messages = Database.getMessages();
  res.json(messages);
});

app.get('/api/messages/:id', (req, res) => {
  const message = Database.getMessageById(req.params.id);
  if (!message) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }
  res.json(message);
});

app.post('/api/messages', (req, res) => {
  const { recipientName, recipientPhone, message, scheduledDateTime } = req.body;

  if (!recipientPhone) {
    return res.status(400).json({ error: 'O número de telefone do destinatário é obrigatório.' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'O conteúdo da mensagem é obrigatório.' });
  }
  if (!scheduledDateTime) {
    return res.status(400).json({ error: 'A data e o horário do agendamento são obrigatórios.' });
  }

  const created = Database.saveMessage({
    recipientName: recipientName || 'Contato do WhatsApp',
    recipientPhone,
    message,
    scheduledDateTime,
    status: 'scheduled'
  });

  res.status(201).json(created);
});

app.put('/api/messages/:id', (req, res) => {
  const updated = Database.updateMessage(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ error: 'Mensagem não encontrada.' });
  }
  res.json(updated);
});

app.delete('/api/messages/:id', (req, res) => {
  const deleted = Database.deleteMessage(req.params.id);
  res.json({ success: deleted });
});

app.post('/api/messages/:id/send-now', async (req, res) => {
  try {
    const result = await Scheduler.sendImmediately(req.params.id);
    res.json({ success: true, message: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings Endpoints
// ============================================================

app.get('/api/settings', (req, res) => {
  res.json(Database.getSettings());
});

app.put('/api/settings', (req, res) => {
  res.json(Database.updateSettings(req.body));
});

// Serve frontend static build in production
const DIST_PATH = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

// Start Server, WhatsApp Client, and Scheduler
app.listen(PORT, async () => {
  console.log(`[Server] WhatsApp Message Scheduler API running at http://localhost:${PORT}`);
  
  // Start WhatsApp Multi-Device client
  WhatsAppClient.init();

  // Start automated scheduler
  Scheduler.start();
});
