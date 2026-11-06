
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
  loadSecurityModel
} from './lib/security.js';

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

// ======================================================
// PROJECT CONFIGURATION
// ======================================================

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

// Dashboard password.
// Change this before exposing the dashboard publicly.
const DASHBOARD_PASSWORD =
  process.env.DASHBOARD_PASSWORD || 'harare@2030';

// Session lifetime: 12 hours.
const DASHBOARD_SESSION_TTL = 12 * 60 * 60 * 1000;

// HMAC secret generated at startup.
const DASHBOARD_SESSION_SECRET = crypto.randomBytes(48);

const dashboardSessions = new Map();

const MAX_DASHBOARD_SESSIONS = 500;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_LOCK_TIME = 15 * 60 * 1000;

const loginAttempts = new Map();

const MAX_RELOAD_REQUESTS = 500;
const RELOAD_COOLDOWN = 5000;

const startedAt = Date.now();

// ======================================================
// GLOBAL STATE
// ======================================================

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

const processedMessages = new Set();
const reloadRequests = new Map();

const MAX_PROCESSED_MESSAGES = 5000;

const stats = {
  messages: 0,
  errors: 0,
  reconnects: 0,
  lastConnected: null,
  lastDisconnected: null
};

// ======================================================
// DIRECTORIES
// ======================================================

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

// ======================================================
// LOGGING
// ======================================================

function logInfo(message) {
  console.log(`[PRECIOUS-MD] ${message}`);
}

function logError(label, error) {
  console.error(
    `[${label}]`,
    error?.stack || error?.message || error
  );
}

// ======================================================
// SECURITY HELPERS
// ======================================================

function safeEqual(first, second) {
  if (
    typeof first !== 'string' ||
    typeof second !== 'string'
  ) {
    return false;
  }

  const a = Buffer.from(first);
  const b = Buffer.from(second);

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function signSession(id, expiresAt) {
  return crypto
    .createHmac('sha256', DASHBOARD_SESSION_SECRET)
    .update(`${id}.${expiresAt}`)
    .digest('hex');
}

function createDashboardSession() {
  const id = crypto.randomBytes(32).toString('hex');

  const expiresAt =
    Date.now() + DASHBOARD_SESSION_TTL;

  const signature = signSession(id, expiresAt);

  dashboardSessions.set(id, {
    expiresAt,
    createdAt: Date.now()
  });

  while (dashboardSessions.size > MAX_DASHBOARD_SESSIONS) {
    const oldest = dashboardSessions.keys().next().value;

    if (!oldest) break;

    dashboardSessions.delete(oldest);
  }

  return `${id}.${expiresAt}.${signature}`;
}

function verifyDashboardToken(req) {
  const supplied = req.headers['x-dashboard-token'];

  if (
    typeof supplied !== 'string' ||
    supplied.length > 512
  ) {
    return false;
  }

  const parts = supplied.split('.');

  if (parts.length !== 3) {
    return false;
  }

  const [id, expiresString, signature] = parts;

  if (
    !/^[a-f0-9]{64}$/i.test(id) ||
    !/^\d+$/.test(expiresString) ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    return false;
  }

  const session = dashboardSessions.get(id);

  if (!session) return false;

  const expiresAt = Number(expiresString);

  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt !== session.expiresAt ||
    Date.now() > expiresAt
  ) {
    dashboardSessions.delete(id);
    return false;
  }

  const expected = signSession(id, expiresAt);

  if (!safeEqual(signature, expected)) {
    return false;
  }

  return true;
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

function getClientAddress(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function checkLoginLimit(address) {
  const current = Date.now();

  const previous = loginAttempts.get(address);

  if (!previous) {
    return {
      allowed: true
    };
  }

  if (
    previous.lockedUntil &&
    current < previous.lockedUntil
  ) {
    return {
      allowed: false,
      remaining: Math.ceil(
        (previous.lockedUntil - current) / 1000
      )
    };
  }

  if (current - previous.startedAt > LOGIN_WINDOW) {
    loginAttempts.delete(address);

    return {
      allowed: true
    };
  }

  return {
    allowed: true
  };
}

function recordFailedLogin(address) {
  const current = Date.now();

  let record = loginAttempts.get(address);

  if (
    !record ||
    current - record.startedAt > LOGIN_WINDOW
  ) {
    record = {
      attempts: 0,
      startedAt: current,
      lockedUntil: 0
    };
  }

  record.attempts++;

  if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil =
      current + LOGIN_LOCK_TIME;
  }

  loginAttempts.set(address, record);

  if (loginAttempts.size > 1000) {
    const oldest = loginAttempts.keys().next().value;

    if (oldest) loginAttempts.delete(oldest);
  }
}

function clearFailedLogins(address) {
  loginAttempts.delete(address);
}

function noCache(_req, res, next) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });

  next();
}

// ======================================================
// EXPRESS DASHBOARD
// ======================================================

const app = express();

app.disable('x-powered-by');

app.set('trust proxy', false);

app.use(noCache);

app.use(express.json({
  limit: '20kb'
}));

// ======================================================
// DASHBOARD PAGE
// ======================================================

app.get('/', (_req, res) => {
  if (!fs.existsSync(DASHBOARD_FILE)) {
    return res.status(404).send(
      'PRECIOUS-MD dashboard file was not found.'
    );
  }

  return res.sendFile(DASHBOARD_FILE);
});

// ======================================================
// DASHBOARD LOGIN
// ======================================================

app.post('/api/login', (req, res) => {
  const address = getClientAddress(req);

  const limit = checkLoginLimit(address);

  if (!limit.allowed) {
    return res.status(429).json({
      success: false,
      error: 'Too many login attempts. Try again later.',
      retryAfter: limit.remaining
    });
  }

  const password = req.body?.password;

  if (
    typeof password !== 'string' ||
    !safeEqual(password, DASHBOARD_PASSWORD)
  ) {
    recordFailedLogin(address);

    return res.status(401).json({
      success: false,
      error: 'Incorrect dashboard password.'
    });
  }

  clearFailedLogins(address);

  const token = createDashboardSession();

  return res.json({
    success: true,
    message: 'Dashboard login successful.',
    token,
    expiresIn: DASHBOARD_SESSION_TTL
  });
});

// ======================================================
// DASHBOARD LOGOUT
// ======================================================

app.post('/api/logout', protectDashboard, (req, res) => {
  const supplied = req.headers['x-dashboard-token'];

  const [id] = supplied.split('.');

  dashboardSessions.delete(id);

  return res.json({
    success: true,
    message: 'Logged out successfully.'
  });
});

// ======================================================
// SESSION VALIDATION
// ======================================================

app.get('/api/session', protectDashboard, (_req, res) => {
  return res.json({
    success: true,
    authenticated: true
  });
});

// ======================================================
// DASHBOARD PLUGIN STATISTICS
// ======================================================

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

// ======================================================
// DASHBOARD DATA
// ======================================================

app.get('/api/dashboard', (_req, res) => {
  const pluginStats = getPluginStatistics();

  const connected = Boolean(
    globalThis.sock?.user
  );

  return res.json({
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

// ======================================================
// PLUGIN INFORMATION
// ======================================================

app.get('/api/plugins', (_req, res) => {
  const plugins = Array.isArray(globalThis.plugins)
    ? globalThis.plugins
    : [];

  return res.json({
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

// ======================================================
// COMMAND INFORMATION
// ======================================================

app.get('/api/commands', (_req, res) => {
  const commandMap = globalThis.commandMap instanceof Map
    ? globalThis.commandMap
    : new Map();

  const commands = [];

  for (const [name, plugin] of commandMap) {
    commands.push({
      command: name,
      name,
      category: plugin.category || 'general',
      description: plugin.description || '',
      aliases: Array.isArray(plugin.aliases)
        ? plugin.aliases
        : []
    });
  }

  return res.json({
    success: true,
    total: commands.length,
    commands
  });
});

// ======================================================
// SYSTEM INFORMATION
// ======================================================

app.get('/api/system', protectDashboard, (_req, res) => {
  const memory = process.memoryUsage();

  return res.json({
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

// ======================================================
// HEALTH CHECK
// ======================================================

app.get('/health', (_req, res) => {
  const connected = Boolean(
    globalThis.sock?.user
  );

  const healthy =
    databaseLoaded &&
    pluginsLoaded &&
    !stopped;

  return res.status(healthy ? 200 : 503).json({
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

// ======================================================
// READINESS CHECK
// ======================================================

app.get('/ready', (_req, res) => {
  const ready =
    databaseLoaded &&
    pluginsLoaded &&
    Boolean(globalThis.sock?.user) &&
    !stopped;

  return res.status(ready ? 200 : 503).json({
    success: ready,
    ready,
    connection: connectionState
  });
});

// ======================================================
// PROTECTED PLUGIN RELOAD
// ======================================================

app.post(
  '/api/plugins/reload',
  protectDashboard,
  async (req, res) => {
    const source = getClientAddress(req);
    const current = Date.now();

    const previous = reloadRequests.get(source) || 0;

    if (current - previous < RELOAD_COOLDOWN) {
      return res.status(429).json({
        success: false,
        error: 'Please wait before reloading plugins again.'
      });
    }

    reloadRequests.set(source, current);

    if (reloadRequests.size > MAX_RELOAD_REQUESTS) {
      const oldest = reloadRequests.keys().next().value;

      if (oldest) reloadRequests.delete(oldest);
    }

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

// ======================================================
// EXPRESS ERROR HANDLER
// ======================================================

app.use((error, _req, res, _next) => {
  logError('EXPRESS ERROR', error);

  if (res.headersSent) return;

  res.status(500).json({
    success: false,
    error: 'Internal server error.'
  });
});

// ======================================================
// DASHBOARD SERVER
// ======================================================

const server = app.listen(
  PORT,
  HOST,
  () => {
    logInfo(`Dashboard server running on port ${PORT}`);
    logInfo('Dashboard password authentication enabled.');
  }
);

server.on('error', error => {
  logError('EXPRESS SERVER', error);
});

// ======================================================
// TIMER MANAGEMENT
// ======================================================

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

// ======================================================
// SOCKET CLEANUP
// ======================================================

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

// ======================================================
// RECONNECTION SYSTEM
// ======================================================

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

// ======================================================
// DATABASE AND PLUGIN INITIALIZATION
// ======================================================

async function initializeProject() {
  if (!databaseLoaded) {
    logInfo('Loading database...');

    await loadDatabase();

    databaseLoaded = true;

    if (
      typeof globalThis.db?.settings?.prefix === 'string' &&
      globalThis.db.settings.prefix.length
    ) {
      config.prefix = globalThis.db.settings.prefix;
      config.prefixes = [config.prefix];
    }

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

// ======================================================
// LOCAL NSFW MODEL INITIALIZATION
// ======================================================

async function initializeSecurityModel() {
  const groups = Object.values(
    globalThis.db?.groups || {}
  );

  const antiPornEnabled = groups.some(
    group => group?.antiPorn === true
  );

  if (!antiPornEnabled) {
    logInfo(
      'Local image moderation is idle. The model will load when AntiPorn is first used.'
    );

    return;
  }

  try {
    logInfo('Initializing local NSFW image moderation...');

    await loadSecurityModel();

    logInfo('Local NSFW image moderation is ready.');

  } catch (error) {
    logError('NSFW MODEL INITIALIZATION', error);

    logInfo(
      'Bot startup will continue. AntiPorn will fail open until the model becomes available.'
    );
  }
}

// ======================================================
// MESSAGE DEDUPLICATION
// ======================================================

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

// ======================================================
// MESSAGE PROCESSING
// ======================================================

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

// ======================================================
// PAIRING NUMBER
// ======================================================

function getPairingNumber() {
  return String(
    process.env.PAIRING_NUMBER ||
    config.pairingNumber ||
    ''
  ).replace(/\D/g, '');
}

// ======================================================
// MAIN WHATSAPP CONNECTION
// ======================================================

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

    // Load local NSFWJS only when a group has AntiPorn
    // enabled. The security module can also load it lazily.
    await initializeSecurityModel();

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

    // ==================================================
    // SAVE CREDENTIALS
    // ==================================================

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (error) {
        logError('CREDENTIAL SAVE', error);
      }
    });

    // ==================================================
    // INSTALL EVENT MODULES
    // ==================================================

    installEventHandlers(sock);
    installAutomationHandlers(sock);

    // ==================================================
    // INCOMING MESSAGES
    // ==================================================

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

    // ==================================================
    // CONNECTION EVENTS
    // ==================================================

    sock.ev.on(
      'connection.update',
      async update => {
        if (activeSocket !== sock) return;

        const {
          connection,
          lastDisconnect,
          qr
        } = update;

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

        // ==================================================
        // SUCCESSFUL CONNECTION
        // ==================================================

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

        // ==================================================
        // CONNECTION CLOSED
        // ==================================================

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

    // ==================================================
    // PAIRING CODE LOGIN
    // ==================================================

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

// ======================================================
// GRACEFUL SHUTDOWN
// ======================================================

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

    dashboardSessions.clear();

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

// ======================================================
// PROCESS ERROR HANDLING
// ======================================================

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

// ======================================================
// START APPLICATION
// ======================================================

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
