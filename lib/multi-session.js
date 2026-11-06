import fs from 'node:fs/promises';
import path from 'node:path';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { installEventHandlers } from './events.js';
import { installAutomationHandlers, stopAutomation } from './automation.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Additional WhatsApp linked-device sessions.
 * Each session has an isolated Baileys auth directory and reconnect loop.
 * The primary session remains managed by index.js.
 */
export function createMultiSessionManager({
  baseDir = './sessions',
  onMessage = async () => {},
  onLog = () => {},
  logLevel = 'silent'
} = {}) {
  const sessions = new Map();
  let stopping = false;

  const safeId = value => {
    const id = String(value || '').trim();
    if (!ID_PATTERN.test(id) || id.toLowerCase() === 'primary') {
      throw new Error('Session ID must be 2–32 letters, numbers, _ or -; "primary" is reserved.');
    }
    return id;
  };

  async function start({ id, phoneNumber = '' } = {}) {
    const sessionId = safeId(id);
    const phone = String(phoneNumber || '').replace(/\D/g, '');
    if (!phone || phone.length < 8 || phone.length > 15) {
      throw new Error('A phone number with country code is required (8–15 digits).');
    }
    if (!sessions.has(sessionId) && sessions.size >= 5) {
      throw new Error('Maximum of five additional sessions reached.');
    }

    const existing = sessions.get(sessionId);
    if (existing && !['stopped', 'logged_out', 'error'].includes(existing.state)) {
      throw new Error(`Session "${sessionId}" is already running.`);
    }

    const record = {
      id: sessionId,
      state: 'starting',
      phone: null,
      socket: null,
      reconnectTimer: null,
      retryCount: 0,
      pairingCode: null,
      startedAt: new Date().toISOString(),
      lastError: null,
      intentionalStop: false
    };
    sessions.set(sessionId, record);

    const authDir = path.resolve(baseDir, sessionId);
    await fs.mkdir(authDir, { recursive: true });

    const connect = async () => {
      if (stopping || record.intentionalStop) return;
      record.state = record.retryCount ? 'reconnecting' : 'connecting';
      try {
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({
          version,
          logger: pino({ level: logLevel }),
          auth: state,
          browser: Browsers.ubuntu('Chrome'),
          printQRInTerminal: false,
          markOnlineOnConnect: true,
          syncFullHistory: false,
          getMessage: async () => undefined
        });
        record.socket = sock;
        installEventHandlers(sock);
        installAutomationHandlers(sock);

        sock.ev.on('creds.update', () => saveCreds().catch(error => {
          record.lastError = error?.message || String(error);
          onLog(`[SESSION ${sessionId}] credential save failed: ${record.lastError}`);
        }));

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
          if (type !== 'notify' || record.socket !== sock) return;
          for (const message of messages || []) {
            if (record.socket !== sock) break;
            try { await onMessage(sock, message, sessionId); }
            catch (error) {
              record.lastError = error?.message || String(error);
              onLog(`[SESSION ${sessionId}] message error: ${record.lastError}`);
            }
          }
        });

        sock.ev.on('connection.update', update => {
          if (record.socket !== sock) return;
          if (update.connection === 'open') {
            record.state = 'connected';
            record.phone = sock.user?.id?.split('@')[0]?.split(':')[0] || null;
            record.retryCount = 0;
            record.pairingCode = null;
            record.lastError = null;
            onLog(`[SESSION ${sessionId}] connected as ${record.phone || 'WhatsApp account'}`);
          }
          if (update.connection === 'close') {
            try { stopAutomation(sock); } catch {}
            record.socket = null;
            const status = update.lastDisconnect?.error?.output?.statusCode;
            if (record.intentionalStop || stopping) {
              record.state = 'stopped';
              return;
            }
            if (status === DisconnectReason.loggedOut) {
              record.state = 'logged_out';
              record.lastError = 'WhatsApp logged this session out. Remove its auth folder and pair again.';
              return;
            }
            record.state = 'reconnecting';
            record.retryCount += 1;
            const delay = Math.min(4000 * (2 ** Math.min(record.retryCount - 1, 4)) + Math.floor(Math.random() * 1200), 60000);
            clearTimeout(record.reconnectTimer);
            record.reconnectTimer = setTimeout(connect, delay);
            record.reconnectTimer.unref?.();
          }
        });

        if (phone && !state.creds.registered) {
          await sleep(1200);
          if (record.socket === sock && !sock.user) {
            record.pairingCode = await sock.requestPairingCode(phone);
          }
        }
        return this.status(sessionId);
      } catch (error) {
        record.state = 'error';
        record.lastError = error?.message || String(error);
        onLog(`[SESSION ${sessionId}] startup failed: ${record.lastError}`);
        if (!record.intentionalStop && !stopping) {
          record.retryCount += 1;
          const delay = Math.min(5000 * (2 ** Math.min(record.retryCount - 1, 4)), 60000);
          record.reconnectTimer = setTimeout(connect, delay);
          record.reconnectTimer.unref?.();
        }
        throw error;
      }
    };

    await connect();
    return this.status(sessionId);
  }

  function status(id) {
    const record = sessions.get(id);
    if (!record) return null;
    return {
      id: record.id,
      state: record.state,
      phone: record.phone,
      pairingCode: record.pairingCode,
      retryCount: record.retryCount,
      startedAt: record.startedAt,
      lastError: record.lastError
    };
  }

  function list() {
    return [...sessions.keys()].map(status);
  }

  async function stop(id) {
    const sessionId = safeId(id);
    const record = sessions.get(sessionId);
    if (!record) return false;
    record.intentionalStop = true;
    clearTimeout(record.reconnectTimer);
    record.reconnectTimer = null;
    const sock = record.socket;
    record.socket = null;
    try { if (sock) stopAutomation(sock); } catch {}
    try { sock?.end(undefined); } catch {}
    record.state = 'stopped';
    record.pairingCode = null;
    return true;
  }

  async function stopAll() {
    stopping = true;
    await Promise.all([...sessions.keys()].map(id => stop(id).catch(() => false)));
  }

  return { start, stop, stopAll, list, status };
}
