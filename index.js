
import config from './config.js';

import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import path from 'node:path';

import { Boom } from '@hapi/boom';

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  jidNormalizedUser
} from '@whiskeysockets/baileys';

import { loadDatabase, saveDatabase } from './lib/database.js';
import { handleMessage } from './lib/handler.js';
import { loadPlugins } from './lib/plugin-loader.js';
import { installEventHandlers } from './lib/events.js';
import { installAutomationHandlers } from './lib/automation.js';

import {
  startReminderScheduler,
  stopReminderScheduler
} from './lib/reminders.js';

globalThis.config = config;

// Prevent duplicate startup operations.
let starting = false;
let stopped = false;
let databaseLoaded = false;
let pluginsLoaded = false;

let activeSocket = null;
let retryCount = 0;

let reconnectTimer = null;
let pairingTimer = null;

// Create required directories.
for (const directory of [
  config.sessionDir,
  config.mediaDir,
  './plugins',
  './data'
]) {
  fs.mkdirSync(path.resolve(directory), {
    recursive: true
  });
}

// EXPRESS STATUS SERVER
const app = express();

app.disable('x-powered-by');

app.get('/', (_req, res) => {
  res.sendFile(path.resolve('./index.html'));
});

// Public, read-only dashboard data. Never expose session or environment values.
app.get('/api/dashboard', (_req, res) => {
  const plugins = globalThis.plugins || [];
  const categories = {};
  for (const plugin of plugins) {
    const category = String(plugin.category || 'misc');
    categories[category] = (categories[category] || 0) + 1;
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    bot: config.botName,
    owner: config.ownerName,
    connected: Boolean(globalThis.sock?.user),
    uptime: Math.floor(process.uptime()),
    pluginFiles: new Set(plugins.map(item => item.filename)).size,
    commands: plugins.length,
    categories,
    database: databaseLoaded,
    pluginsLoaded
  });
});

app.get('/api/plugins', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json((globalThis.plugins || []).map(plugin => ({
    command: plugin.command,
    aliases: plugin.aliases || [],
    category: plugin.category || 'misc',
    description: plugin.description || ''
  })));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: Boolean(globalThis.sock?.user),
    bot: config.botName,
    connected: Boolean(globalThis.sock?.user),
    uptime: Math.floor(process.uptime()),
    plugins: globalThis.plugins?.length || 0,
    commands: globalThis.commandMap?.size || 0,
    database: databaseLoaded,
    pluginsLoaded
  });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(
    `🌐 Status server running on port ${config.port}`
  );
});

server.on('error', error => {
  console.error('[EXPRESS]', error.message);
});

// TIMER HELPERS
function clearPairingTimer() {
  if (pairingTimer) {
    clearTimeout(pairingTimer);
    pairingTimer = null;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function cleanupSocket(sock) {
  if (activeSocket === sock) {
    activeSocket = null;
  }

  if (globalThis.sock === sock) {
    globalThis.sock = null;
  }

  stopReminderScheduler();
}

// RECONNECTION
function scheduleReconnect(delay) {
  if (stopped || reconnectTimer) return;

  console.log(
    `🔄 Reconnecting in ${Math.ceil(delay / 1000)} seconds...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot();
  }, delay);

  reconnectTimer.unref?.();
}

// LOAD DATABASE AND PLUGINS
async function initializeProject() {
  if (!databaseLoaded) {
    await loadDatabase();

    databaseLoaded = true;

    if (globalThis.db.settings?.prefix) {
      config.prefix = globalThis.db.settings.prefix;
      config.prefixes = [config.prefix];
    }

    if (
      typeof globalThis.db.settings?.publicMode === 'boolean'
    ) {
      config.publicMode = globalThis.db.settings.publicMode;
    }
  }

  if (!pluginsLoaded) {
    await loadPlugins();
    pluginsLoaded = true;
  }
}

// MAIN WHATSAPP CONNECTION
async function startBot() {
  if (starting || stopped) return;

  starting = true;

  let sock = null;

  try {
    await initializeProject();

    const { state, saveCreds } =
      await useMultiFileAuthState(config.sessionDir);

    const { version } = await fetchLatestBaileysVersion();

    console.log(
      `Starting ${config.botName} with WhatsApp version ${version.join('.')}`
    );

    sock = makeWASocket({
      version,

      logger: pino({
        level: config.logLevel || 'silent'
      }),

      auth: state,

      browser: Browsers.ubuntu('Chrome'),

      printQRInTerminal: false,
      markOnlineOnConnect: true,
      syncFullHistory: false,

      getMessage: async () => undefined
    });

    activeSocket = sock;
    globalThis.sock = sock;

    // SAVE WHATSAPP CREDENTIALS
    sock.ev.on('creds.update', saveCreds);

    // INSTALL EVENT HANDLERS
    installEventHandlers(sock);
    installAutomationHandlers(sock);

    // INCOMING MESSAGES
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const message of messages || []) {
        try {
          await handleMessage(sock, message);
        } catch (error) {
          console.error(
            '[MESSAGE PROCESSING]',
            error
          );
        }
      }
    });

    // CONNECTION EVENTS
    sock.ev.on('connection.update', async update => {
      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr && !process.env.PAIRING_NUMBER) {
        console.log(
          '\nScan this QR with WhatsApp Linked devices:\n'
        );

        qrcode.generate(qr, {
          small: true
        });
      }

      if (connection === 'connecting') {
        console.log('🔄 Connecting to WhatsApp...');
      }

      if (connection === 'open') {
        starting = false;
        retryCount = 0;

        clearPairingTimer();

        console.log(`\n✅ ${config.botName} CONNECTED`);

        console.log(`👑 Creator: ${config.ownerName}`);

        console.log(
          `📱 Account: ${jidNormalizedUser(sock.user.id)}`
        );

        console.log(
          `🧩 Plugins: ${globalThis.plugins?.length || 0}`
        );

        console.log(
          `⚙️ Commands: ${globalThis.commandMap?.size || 0}`
        );

        console.log(
          `🌐 Health: http://localhost:${config.port}/health`
        );

        startReminderScheduler(sock);
      }

      if (connection === 'close') {
        starting = false;

        clearPairingTimer();

        const status = lastDisconnect?.error
          ? new Boom(lastDisconnect.error).output?.statusCode
          : undefined;

        const loggedOut =
          status === DisconnectReason.loggedOut;

        cleanupSocket(sock);

        console.error(
          'WhatsApp connection closed:',
          status,
          loggedOut ? 'Logged out' : 'Reconnecting'
        );

        if (loggedOut) {
          console.error(
            'Session logged out. Remove the old session and pair again.'
          );

          return;
        }

        retryCount++;

        const delay = Math.min(
          4000 * Math.pow(
            2,
            Math.min(retryCount - 1, 4)
          ),
          60000
        );

        scheduleReconnect(delay);
      }
    });

    // PAIRING CODE
    const number = (
      process.env.PAIRING_NUMBER || ''
    ).replace(/\D/g, '');

    if (number && !state.creds.registered) {
      clearPairingTimer();

      pairingTimer = setTimeout(async () => {
        pairingTimer = null;

        if (
          stopped ||
          activeSocket !== sock ||
          sock.user
        ) {
          return;
        }

        try {
          const code = await sock.requestPairingCode(number);

          console.log(
            `\n🔐 ${config.botName} PAIRING CODE: ${code}\n`
          );
        } catch (error) {
          console.error(
            'Pairing-code error:',
            error.message
          );
        }
      }, 3000);

      pairingTimer.unref?.();
    }

  } catch (error) {
    starting = false;

    console.error('[BOT STARTUP FAILED]', error);

    if (sock) {
      cleanupSocket(sock);

      try {
        sock.end(undefined);
      } catch {}
    }

    retryCount++;

    const delay = Math.min(
      7000 * Math.pow(
        2,
        Math.min(retryCount - 1, 4)
      ),
      60000
    );

    scheduleReconnect(delay);
  }
}

// GRACEFUL SHUTDOWN
async function shutdown(signal) {
  if (stopped) return;

  stopped = true;
  starting = false;

  console.log(
    `\n${signal}: stopping ${config.botName}...`
  );

  clearReconnectTimer();
  clearPairingTimer();

  stopReminderScheduler();

  const sock = activeSocket;

  activeSocket = null;
  globalThis.sock = null;

  try {
    await saveDatabase();
  } catch (error) {
    console.error(
      '[DATABASE SHUTDOWN]',
      error.message
    );
  }

  if (sock) {
    try {
      sock.end(undefined);
    } catch (error) {
      console.error(
        '[SOCKET SHUTDOWN]',
        error.message
      );
    }
  }

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 3000).unref();
}

// PROCESS ERROR HANDLERS
process.on('uncaughtException', error => {
  console.error('[UNCAUGHT EXCEPTION]', error);
});

process.on('unhandledRejection', error => {
  console.error('[UNHANDLED REJECTION]', error);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// START BOT
await startBot();
