
import config from './config.js';

import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Boom } from '@hapi/boom';

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  jidNormalizedUser
} from '@whiskeysockets/baileys';

import {
  loadDatabase,
  saveDatabase
} from './lib/database.js';

import { handleMessage } from './lib/handler.js';

import {
  loadPlugins,
  reloadPlugins
} from './lib/plugin-loader.js';

import {
  installEventHandlers
} from './lib/events.js';

import {
  installAutomationHandlers,
  stopAutomation
} from './lib/automation.js';

import {
  startReminderScheduler,
  stopReminderScheduler
} from './lib/reminders.js';

// ------------------------------------------------------
// PROJECT CONFIGURATION
// ------------------------------------------------------

globalThis.config = config;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(config.port) || 9090;
const HOST = '0.0.0.0';

const SESSION_DIR = path.resolve(
  config.sessionDir || './session'
);

const DASHBOARD_FILE = path.join(
  __dirname,
  'index.html'
);

// ------------------------------------------------------
// GLOBAL STATE
// ------------------------------------------------------

let starting = false;
let stopped = false;

let databaseLoaded = false;
let pluginsLoaded = false;

let activeSocket = null;

let retryCount = 0;
let connectionState = 'starting';

let reconnectTimer = null;
let pairingTimer = null;

let shutdownPromise = null;

const startedAt = Date.now();

const processedMessages = new Set();
const reloadRequests = new Map();

const MAX_PROCESSED_MESSAGES = 5000;
const RELOAD_COOLDOWN = 5000;

const stats = {
  messages: 0,
  errors: 0,
  reconnects: 0,
  lastConnected: null,
  lastDisconnected: null
};

// ------------------------------------------------------
// DIRECTORIES
// ------------------------------------------------------

const directories = [
  SESSION_DIR,
  path.resolve(config.mediaDir || './temp'),
  path.resolve('./plugins'),
  path.resolve('./data'),
  path.resolve('./temp'),
  path.resolve('./logs'),
  path.resolve('./backups')
];

for (const directory of directories) {
  fs.mkdirSync(directory, {
    recursive: true
  });
}

// ------------------------------------------------------
// LOGGING
// ------------------------------------------------------

function logInfo(message) {
  console.log(`[PRECIOUS-MD] ${message}`);
}

function logError(label, error) {
  console.error(
    `[${label}]`,
    error?.stack || error?.message || error
  );
}

// ------------------------------------------------------
// SECURITY HELPERS
// ------------------------------------------------------

function verifyDashboardToken(req) {
  const expected = process.env.DASHBOARD_TOKEN;

  if (
    typeof expected !== 'string' ||
    !expected.trim()
  ) {
    return false;
  }

  // Use headers instead of query parameters.
  // Query tokens can leak into browser history and logs.
  const supplied = req.headers['x-dashboard-token'];

  if (
    typeof supplied !== 'string' ||
    !supplied.trim()
  ) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    expectedBuffer.length !== suppliedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    suppliedBuffer
  );
}

function protectDashboard(req, res, next) {
  if (verifyDashboardToken(req)) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized'
  });
}

function noCache(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN'
  });

  next();
}

// ------------------------------------------------------
// EXPRESS DASHBOARD
// ------------------------------------------------------

const app = express();

app.disable('x-powered-by');

app.use(noCache);

app.use(express.json({
  limit: '20kb'
}));

app.get('/', (_req, res) => {
  if (!fs.existsSync(DASHBOARD_FILE)) {
    return res.status(404).send(
      'PRECIOUS-MD dashboard file was not found.'
    );
  }

  return res.sendFile(DASHBOARD_FILE);
});

// ------------------------------------------------------
// DASHBOARD PLUGIN STATISTICS
// ------------------------------------------------------

function getPluginStatistics() {
  const plugins = Array.isArray(globalThis.plugins)
    ? globalThis.plugins
    : [];

  const categories = {};
  const files = new Set();

  for (const plugin of plugins) {
    const category = String(
      plugin.category || 'general'
    ).toLowerCase();

    categories[category] =
      (categories[category] || 0) + 1;

    if (plugin.filename) {
      files.add(plugin.filename);
    }
  }

  return {
    files: files.size,
    plugins: plugins.length,
    commands: globalThis.commandMap?.size || 0,
    categories
  };
}

// ------------------------------------------------------
// DASHBOARD DATA
// ------------------------------------------------------

app.get('/api/dashboard', (_req, res) => {
  const pluginStats = getPluginStatistics();

  const connected = Boolean(
    globalThis.sock?.user
  );

  res.json({
    success: true,

    bot: {
      name: config.botName || 'PRECIOUS-MD',
      owner: config.ownerName || 'Watson Fourpence',
      connected,
      connection: connectionState
    },

    system: {
      uptime: Math.floor(process.uptime()),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      memory: process.memoryUsage()
    },

    plugins: pluginStats,

    database: {
      loaded: databaseLoaded
    },

    statistics: {
      ...stats
    }
  });
});

// ------------------------------------------------------
// PLUGIN INFORMATION
// ------------------------------------------------------

app.get('/api/plugins', (_req, res) => {
  const plugins = Array.isArray(globalThis.plugins)
    ? globalThis.plugins
    : [];

  res.json({
    success: true,

    total: plugins.length,

    plugins: plugins.map(plugin => ({
      command: plugin.command || '',
      aliases: Array.isArray(plugin.aliases)
        ? plugin.aliases
        : [],
      category: plugin.category || 'general',
      description: plugin.description || '',
      filename: plugin.filename || 'unknown'
    }))
  });
});

// ------------------------------------------------------
// COMMAND INFORMATION
// ------------------------------------------------------

app.get('/api/commands', (_req, res) => {
  const commandMap = globalThis.commandMap instanceof Map
    ? globalThis.commandMap
    : new Map();

  const commands = [];

  for (const [name, plugin] of commandMap) {
    commands.push({
      name,
      category: plugin.category || 'general',
      description: plugin.description || '',
      aliases: plugin.aliases || []
    });
  }

  res.json({
    success: true,
    total: commands.length,
    commands
  });
});

// ------------------------------------------------------
// SYSTEM INFORMATION
// ------------------------------------------------------

app.get('/api/system', protectDashboard, (_req, res) => {
  const memory = process.memoryUsage();

  res.json({
    success: true,

    process: {
      pid: process.pid,
      uptime: process.uptime(),
      version: process.version,
      platform: process.platform,
      architecture: process.arch
    },

    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers
    },

    cpu: process.cpuUsage(),

    connection: connectionState
  });
});

// ------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------

app.get('/health', (_req, res) => {
  const connected = Boolean(
    globalThis.sock?.user
  );

  const healthy =
    databaseLoaded &&
    pluginsLoaded &&
    !stopped;

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    ok: healthy && connected,

    bot: config.botName || 'PRECIOUS-MD',

    connected,
    connection: connectionState,

    uptime: Math.floor(process.uptime()),

    plugins: globalThis.plugins?.length || 0,
    commands: globalThis.commandMap?.size || 0,

    database: databaseLoaded,
    pluginsLoaded,

    retryCount
  });
});

// ------------------------------------------------------
// READINESS CHECK
// ------------------------------------------------------

app.get('/ready', (_req, res) => {
  const ready =
    databaseLoaded &&
    pluginsLoaded &&
    Boolean(globalThis.sock?.user) &&
    !stopped;

  res.status(ready ? 200 : 503).json({
    success: ready,
    ready,
    connection: connectionState
  });
});

// ------------------------------------------------------
// PROTECTED PLUGIN RELOAD
// ------------------------------------------------------

app.post(
  '/api/plugins/reload',
  protectDashboard,
  async (req, res) => {
    const source = req.ip || 'unknown';
    const now = Date.now();

    const previous = reloadRequests.get(source) || 0;

    if (now - previous < RELOAD_COOLDOWN) {
      return res.status(429).json({
        success: false,
        error: 'Please wait before reloading plugins again.'
      });
    }

    reloadRequests.set(source, now);

    try {
      await reloadPlugins();

      return res.json({
        success: true,
        message: 'Plugins reloaded successfully.',
        plugins: globalThis.plugins?.length || 0,
        commands: globalThis.commandMap?.size || 0
      });

    } catch (error) {
      logError('PLUGIN RELOAD', error);

      return res.status(500).json({
        success: false,
        error: 'Plugin reload failed.'
      });
    }
  }
);

// ------------------------------------------------------
// EXPRESS ERROR HANDLER
// ------------------------------------------------------

app.use((error, _req, res, _next) => {
  logError('EXPRESS ERROR', error);

  if (res.headersSent) return;

  res.status(500).json({
    success: false,
    error: 'Internal server error.'
  });
});

// ------------------------------------------------------
// DASHBOARD SERVER
// ------------------------------------------------------

const server = app.listen(
  PORT,
  HOST,
  () => {
    logInfo(`Dashboard server running on port ${PORT}`);
  }
);

server.on('error', error => {
  logError('EXPRESS SERVER', error);
});

// ------------------------------------------------------
// TIMER MANAGEMENT
// ------------------------------------------------------

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

// ------------------------------------------------------
// SOCKET CLEANUP
// ------------------------------------------------------

function cleanupSocket(sock) {
  if (activeSocket !== sock) return;

  activeSocket = null;

  if (globalThis.sock === sock) {
    globalThis.sock = null;
  }

  connectionState = 'disconnected';

  clearPairingTimer();

  stopReminderScheduler();

  try {
    stopAutomation(sock);
  } catch (error) {
    logError('AUTOMATION CLEANUP', error);
  }
}

// ------------------------------------------------------
// RECONNECTION SYSTEM
// ------------------------------------------------------

function scheduleReconnect(delay) {
  if (stopped || reconnectTimer) return;

  connectionState = 'reconnecting';

  logInfo(
    `Reconnecting in ${Math.ceil(delay / 1000)} seconds...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot();
  }, delay);

  reconnectTimer.unref?.();
}

function getReconnectDelay() {
  const base = 4000;

  const exponential = base * Math.pow(
    2,
    Math.min(Math.max(retryCount - 1, 0), 4)
  );

  const jitter = Math.floor(
    Math.random() * 1500
  );

  return Math.min(
    exponential + jitter,
    60000
  );
}

// ------------------------------------------------------
// DATABASE AND PLUGIN INITIALIZATION
// ------------------------------------------------------

async function initializeProject() {
  if (!databaseLoaded) {
    logInfo('Loading database...');

    await loadDatabase();

    databaseLoaded = true;

    // Restore saved prefix.
    if (
      typeof globalThis.db?.settings?.prefix === 'string' &&
      globalThis.db.settings.prefix.length
    ) {
      config.prefix = globalThis.db.settings.prefix;
      config.prefixes = [config.prefix];
    }

    // Restore saved public/private mode.
    if (
      typeof globalThis.db?.settings?.publicMode === 'boolean'
    ) {
      config.publicMode =
        globalThis.db.settings.publicMode;
    }

    logInfo('Database loaded.');
  }

  if (!pluginsLoaded) {
    logInfo('Loading plugins...');

    await loadPlugins();

    pluginsLoaded = true;

    logInfo(
      `Loaded ${globalThis.plugins?.length || 0} plugins.`
    );

    logInfo(
      `Registered ${globalThis.commandMap?.size || 0} commands.`
    );
  }
}

// ------------------------------------------------------
// MESSAGE DEDUPLICATION
// ------------------------------------------------------

function getMessageId(message) {
  const id = message?.key?.id;

  if (!id) return null;

  const chat = message.key.remoteJid || '';
  const participant = message.key.participant || '';

  return `${chat}:${participant}:${id}`;
}

function rememberMessage(id) {
  if (!id) return false;

  if (processedMessages.has(id)) {
    return false;
  }

  processedMessages.add(id);

  if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
    const oldest = processedMessages.values().next().value;

    if (oldest) {
      processedMessages.delete(oldest);
    }
  }

  return true;
}

// ------------------------------------------------------
// MESSAGE PROCESSING
// ------------------------------------------------------

async function processMessage(sock, message) {
  if (!message?.message) return;

  if (activeSocket !== sock) return;

  const id = getMessageId(message);

  if (id && !rememberMessage(id)) {
    return;
  }

  try {
    stats.messages++;

    await handleMessage(sock, message);

  } catch (error) {
    stats.errors++;

    logError('MESSAGE PROCESSING', error);
  }
}

// ------------------------------------------------------
// PAIRING NUMBER
// ------------------------------------------------------

function getPairingNumber() {
  return String(
    process.env.PAIRING_NUMBER ||
    config.pairingNumber ||
    ''
  ).replace(/\D/g, '');
}

// ------------------------------------------------------
// MAIN WHATSAPP CONNECTION
// ------------------------------------------------------

async function startBot() {
  if (
    starting ||
    stopped ||
    activeSocket
  ) {
    return;
  }

  starting = true;
  connectionState = 'connecting';

  let sock = null;

  try {
    await initializeProject();

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      SESSION_DIR
    );

    const { version } =
      await fetchLatestBaileysVersion();

    logInfo(
      `WhatsApp version: ${version.join('.')}`
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

      generateHighQualityLinkPreview: false,

      getMessage: async () => undefined
    });

    activeSocket = sock;
    globalThis.sock = sock;

    // --------------------------------------------------
    // SAVE CREDENTIALS
    // --------------------------------------------------

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (error) {
        logError('CREDENTIAL SAVE', error);
      }
    });

    // --------------------------------------------------
    // INSTALL EVENT MODULES
    // --------------------------------------------------

    installEventHandlers(sock);
    installAutomationHandlers(sock);

    // --------------------------------------------------
    // INCOMING MESSAGES
    // --------------------------------------------------

    sock.ev.on(
      'messages.upsert',
      async ({ messages, type }) => {
        if (type !== 'notify') return;

        if (activeSocket !== sock) return;

        for (const message of messages || []) {
          if (activeSocket !== sock) break;

          await processMessage(sock, message);
        }
      }
    );

    // --------------------------------------------------
    // CONNECTION EVENTS
    // --------------------------------------------------

    sock.ev.on(
      'connection.update',
      async update => {
        if (activeSocket !== sock) return;

        const {
          connection,
          lastDisconnect,
          qr
        } = update;

        // QR LOGIN
        if (
          qr &&
          !getPairingNumber()
        ) {
          console.log(
            '\n📱 Scan this QR with WhatsApp Linked Devices:\n'
          );

          qrcode.generate(qr, {
            small: true
          });
        }

        if (connection === 'connecting') {
          connectionState = 'connecting';

          logInfo('Connecting to WhatsApp...');
        }

        // ------------------------------------------------
        // SUCCESSFUL CONNECTION
        // ------------------------------------------------

        if (connection === 'open') {
          starting = false;
          retryCount = 0;

          connectionState = 'connected';

          clearPairingTimer();
          clearReconnectTimer();

          stats.lastConnected =
            new Date().toISOString();

          console.log('');
          console.log('╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮');
          console.log('┃   PRECIOUS-MD CONNECTED    ┃');
          console.log('╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯');

          console.log(
            `🤖 Bot: ${config.botName || 'PRECIOUS-MD'}`
          );

          console.log(
            `👑 Creator: ${config.ownerName || 'Watson Fourpence'}`
          );

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
            `🌐 Dashboard: http://localhost:${PORT}`
          );

          console.log(
            `❤️ Health: http://localhost:${PORT}/health`
          );

          try {
            startReminderScheduler(sock);
          } catch (error) {
            logError('REMINDER SCHEDULER', error);
          }
        }

        // ------------------------------------------------
        // CONNECTION CLOSED
        // ------------------------------------------------

        if (connection === 'close') {
          starting = false;

          clearPairingTimer();

          const status = lastDisconnect?.error
            ? new Boom(lastDisconnect.error).output?.statusCode
            : undefined;

          const loggedOut =
            status === DisconnectReason.loggedOut;

          stats.lastDisconnected =
            new Date().toISOString();

          cleanupSocket(sock);

          logError(
            'WHATSAPP CONNECTION CLOSED',
            status || lastDisconnect?.error || 'Unknown reason'
          );

          if (loggedOut) {
            connectionState = 'logged_out';

            console.error(
              'Session logged out. Remove the old session and pair again.'
            );

            return;
          }

          retryCount++;
          stats.reconnects++;

          scheduleReconnect(
            getReconnectDelay()
          );
        }
      }
    );

    // --------------------------------------------------
    // PAIRING CODE LOGIN
    // --------------------------------------------------

    const number = getPairingNumber();

    if (
      number &&
      !state.creds.registered
    ) {
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
          const code = await sock.requestPairingCode(
            number
          );

          console.log('');
          console.log('╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮');
          console.log('┃   PRECIOUS-MD PAIRING CODE  ┃');
          console.log('╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯');

          console.log(`🔐 CODE: ${code}`);
          console.log('');
          console.log(
            'Enter this code in WhatsApp Linked Devices.'
          );

        } catch (error) {
          logError('PAIRING CODE', error);
        }
      }, 3000);

      pairingTimer.unref?.();
    }

  } catch (error) {
    starting = false;

    logError('BOT STARTUP FAILED', error);

    if (sock) {
      cleanupSocket(sock);

      try {
        sock.end(undefined);
      } catch {}
    }

    retryCount++;
    stats.reconnects++;

    scheduleReconnect(
      getReconnectDelay()
    );
  }
}

// ------------------------------------------------------
// GRACEFUL SHUTDOWN
// ------------------------------------------------------

async function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    stopped = true;
    starting = false;

    connectionState = 'stopping';

    console.log(
      `\n🛑 ${signal}: stopping ${config.botName || 'PRECIOUS-MD'}...`
    );

    clearReconnectTimer();
    clearPairingTimer();

    stopReminderScheduler();

    const sock = activeSocket;

    activeSocket = null;
    globalThis.sock = null;

    if (sock) {
      try {
        stopAutomation(sock);
      } catch (error) {
        logError('AUTOMATION SHUTDOWN', error);
      }
    }

    // SAVE DATABASE
    try {
      if (databaseLoaded) {
        await saveDatabase();
        logInfo('Database saved.');
      }
    } catch (error) {
      logError('DATABASE SHUTDOWN', error);
    }

    // CLOSE WHATSAPP
    if (sock) {
      try {
        sock.end(undefined);
      } catch (error) {
        logError('SOCKET SHUTDOWN', error);
      }
    }

    // CLOSE EXPRESS
    await new Promise(resolve => {
      if (!server.listening) {
        resolve();
        return;
      }

      const timeout = setTimeout(resolve, 3000);
      timeout.unref?.();

      server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    connectionState = 'stopped';

    console.log(
      `👋 ${config.botName || 'PRECIOUS-MD'} stopped.`
    );

    process.exit(0);
  })();

  return shutdownPromise;
}

// ------------------------------------------------------
// PROCESS ERROR HANDLING
// ------------------------------------------------------

process.on('uncaughtException', error => {
  stats.errors++;

  logError('UNCAUGHT EXCEPTION', error);
});

process.on('unhandledRejection', error => {
  stats.errors++;

  logError('UNHANDLED REJECTION', error);
});

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

// ------------------------------------------------------
// START APPLICATION
// ------------------------------------------------------

console.log('');
console.log('╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮');
console.log('┃    PRECIOUS-MD STARTING    ┃');
console.log('╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯');

console.log(
  `👑 Creator: ${config.ownerName || 'Watson Fourpence'}`
);

console.log(
  `🤖 Bot: ${config.botName || 'PRECIOUS-MD'}`
);

console.log(
  `🟢 Node.js: ${process.version}`
);

console.log('');

await startBot();
