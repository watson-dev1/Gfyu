
import config from '../config.js';
import { saveDatabase } from './database.js';

// ==================================================
// CONFIGURATION
// ==================================================

const defaults = {
  autoread: config.readMessages ?? false,
  alwaysonline: config.alwaysOnline ?? false,
  autostatus: config.autoViewStatus ?? false,
  statusreact: config.autoStatusReact ?? false,
  autoreact: config.autoReact ?? false,
  anticall: config.antiCall ?? false,
  autotyping: config.autoTyping ?? false,
  autorecording: config.autoRecording ?? false,
  viewonce: false
};

const statusEmojis =
  Array.isArray(config.statusEmojis) &&
  config.statusEmojis.length
    ? config.statusEmojis
    : ['🔥', '❤️', '😂', '💚'];

const onlineTimers = new WeakMap();
const activeSockets = new Set();
const installedSockets = new WeakSet();
const onlineRequests = new WeakSet();
const processedCalls = new Map();

const ONLINE_INTERVAL = 25000;
const CALL_CACHE_LIMIT = 1000;
const CALL_CACHE_TTL = 10 * 60 * 1000;

// ==================================================
// SETTINGS
// ==================================================

export function getAutomationSettings() {
  if (!globalThis.db) {
    throw new Error(
      'Database must be loaded before automation starts.'
    );
  }

  if (
    !globalThis.db.settings ||
    typeof globalThis.db.settings !== 'object' ||
    Array.isArray(globalThis.db.settings)
  ) {
    globalThis.db.settings = {};
  }

  if (
    !globalThis.db.settings.automation ||
    typeof globalThis.db.settings.automation !== 'object' ||
    Array.isArray(globalThis.db.settings.automation)
  ) {
    globalThis.db.settings.automation = {};
  }

  const saved = globalThis.db.settings.automation;

  for (const [key, value] of Object.entries(defaults)) {
    if (typeof saved[key] !== 'boolean') {
      saved[key] = value;
    }
  }

  return saved;
}

export function isAutomationEnabled(name) {
  if (!Object.hasOwn(defaults, name)) {
    return false;
  }

  return getAutomationSettings()[name] === true;
}

export async function setAutomation(name, enabled) {
  if (!Object.hasOwn(defaults, name)) {
    throw new Error(
      `Unknown automation setting: ${name}`
    );
  }

  if (typeof enabled !== 'boolean') {
    throw new TypeError(
      'Automation value must be true or false.'
    );
  }

  const settings = getAutomationSettings();

  settings[name] = enabled;

  await saveDatabase();

  if (name === 'alwaysonline') {
    for (const sock of activeSockets) {
      if (enabled) {
        startOnlineTimer(sock);
      } else {
        stopOnlineTimer(sock);
      }
    }
  }

  return settings[name];
}

// ==================================================
// ALWAYS ONLINE
// ==================================================

async function updateOnline(sock) {
  if (
    !sock ||
    !isAutomationEnabled('alwaysonline') ||
    onlineRequests.has(sock)
  ) {
    return;
  }

  onlineRequests.add(sock);

  try {
    await sock.sendPresenceUpdate('available');
  } catch (error) {
    console.error(
      '[ALWAYS ONLINE]',
      error.message
    );
  } finally {
    onlineRequests.delete(sock);
  }
}

function startOnlineTimer(sock) {
  if (!sock) return;

  stopOnlineTimer(sock);

  if (!isAutomationEnabled('alwaysonline')) {
    return;
  }

  updateOnline(sock).catch(() => {});

  const timer = setInterval(() => {
    updateOnline(sock).catch(() => {});
  }, ONLINE_INTERVAL);

  timer.unref?.();

  onlineTimers.set(sock, timer);
}

function stopOnlineTimer(sock) {
  if (!sock) return;

  const timer = onlineTimers.get(sock);

  if (timer) {
    clearInterval(timer);
    onlineTimers.delete(sock);
  }
}

// ==================================================
// MESSAGE HELPERS
// ==================================================

function unwrapMessage(message = {}) {
  let current = message;

  const wrappers = [
    'ephemeralMessage',
    'documentWithCaptionMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'editedMessage'
  ];

  for (let i = 0; i < 20; i++) {
    if (!current || typeof current !== 'object') {
      break;
    }

    let next = null;

    for (const wrapper of wrappers) {
      const candidate = current[wrapper]?.message;

      if (
        candidate &&
        typeof candidate === 'object'
      ) {
        next = candidate;
        break;
      }
    }

    if (!next || next === current) {
      break;
    }

    current = next;
  }

  return current || {};
}

function isViewOnce(message = {}) {
  let current = message;

  for (let i = 0; i < 20; i++) {
    if (!current || typeof current !== 'object') {
      return false;
    }

    if (
      current.viewOnceMessage ||
      current.viewOnceMessageV2 ||
      current.viewOnceMessageV2Extension
    ) {
      return true;
    }

    const next =
      current.ephemeralMessage?.message ||
      current.documentWithCaptionMessage?.message ||
      current.editedMessage?.message;

    if (!next || next === current) {
      break;
    }

    current = next;
  }

  return false;
}

function randomEmoji() {
  return statusEmojis[
    Math.floor(Math.random() * statusEmojis.length)
  ];
}

function isStatusMessage(msg) {
  return msg?.key?.remoteJid === 'status@broadcast';
}

function isValidMessage(msg) {
  return Boolean(
    msg?.key?.remoteJid &&
    msg?.key?.id &&
    msg?.message
  );
}

// ==================================================
// STATUS AUTOMATION
// ==================================================

async function handleStatus(sock, msg) {
  if (!msg?.key?.participant) return;
  if (msg.key.fromMe) return;

  if (isAutomationEnabled('autostatus')) {
    try {
      await sock.readMessages([msg.key]);
    } catch (error) {
      console.error(
        '[STATUS READ]',
        error.message
      );
    }
  }

  if (isAutomationEnabled('statusreact')) {
    try {
      await sock.sendMessage('status@broadcast', {
        react: {
          text: randomEmoji(),
          key: msg.key
        }
      });
    } catch (error) {
      console.error(
        '[STATUS REACTION]',
        error.message
      );
    }
  }
}

// ==================================================
// PRIVATE / GROUP MESSAGE AUTOMATION
// ==================================================

async function handleMessageAutomation(sock, msg) {
  if (!isValidMessage(msg)) return;

  const jid = msg.key.remoteJid;

  if (msg.key.fromMe) return;

  if (isStatusMessage(msg)) {
    await handleStatus(sock, msg);
    return;
  }

  // Autoread.
  // Do not duplicate this feature in handler.js.

  if (isAutomationEnabled('autoread')) {
    try {
      await sock.readMessages([msg.key]);
    } catch (error) {
      console.error(
        '[AUTOREAD]',
        error.message
      );
    }
  }

  // Automatic reactions.

  if (isAutomationEnabled('autoreact')) {
    try {
      await sock.sendMessage(jid, {
        react: {
          text: randomEmoji(),
          key: msg.key
        }
      });
    } catch (error) {
      console.error(
        '[AUTOREACT]',
        error.message
      );
    }
  }

  // View-once detection only.
  // This does not download or bypass view-once protection.

  if (
    isAutomationEnabled('viewonce') &&
    isViewOnce(msg.message)
  ) {
    const content = unwrapMessage(msg.message);

    const type = Object.keys(content)[0] || 'unknown';

    console.log(
      `[PRECIOUS-MD] View-once message detected: ${type}`
    );
  }
}

// ==================================================
// ANTI-CALL
// ==================================================

function cleanProcessedCalls() {
  const now = Date.now();

  for (const [key, timestamp] of processedCalls) {
    if (now - timestamp > CALL_CACHE_TTL) {
      processedCalls.delete(key);
    }
  }

  while (processedCalls.size > CALL_CACHE_LIMIT) {
    const oldest = processedCalls.keys().next().value;

    if (oldest === undefined) break;

    processedCalls.delete(oldest);
  }
}

async function handleCalls(sock, calls) {
  if (!isAutomationEnabled('anticall')) return;

  const callList = Array.isArray(calls)
    ? calls
    : calls
      ? [calls]
      : [];

  for (const call of callList) {
    if (
      !call ||
      call.status !== 'offer' ||
      !call.id ||
      !call.from
    ) {
      continue;
    }

    const callKey = `${call.from}:${call.id}`;

    if (processedCalls.has(callKey)) {
      continue;
    }

    processedCalls.set(callKey, Date.now());

    cleanProcessedCalls();

    try {
      if (typeof sock.rejectCall === 'function') {
        await sock.rejectCall(
          call.id,
          call.from
        );
      }

      await sock.sendMessage(call.from, {
        text:
          '📵 Sorry, calls are disabled. Please message this bot.'
      }).catch(() => {});

    } catch (error) {
      console.error(
        '[ANTI-CALL]',
        error.message
      );
    }
  }
}

// ==================================================
// CONNECTION MANAGEMENT
// ==================================================

function handleConnectionUpdate(sock, update) {
  if (update?.connection === 'open') {
    activeSockets.add(sock);

    startOnlineTimer(sock);

    return;
  }

  if (
    update?.connection === 'close' ||
    update?.connection === 'connecting'
  ) {
    stopOnlineTimer(sock);

    if (update.connection === 'close') {
      activeSockets.delete(sock);
    }
  }
}

// ==================================================
// INSTALL EVENT HANDLERS
// ==================================================

export function installAutomationHandlers(sock) {
  if (!sock?.ev) {
    throw new Error(
      'A valid Baileys socket is required.'
    );
  }

  if (installedSockets.has(sock)) {
    return false;
  }

  installedSockets.add(sock);

  // Connection and reconnect handling.

  sock.ev.on(
    'connection.update',
    update => {
      try {
        handleConnectionUpdate(sock, update);
      } catch (error) {
        console.error(
          '[AUTOMATION CONNECTION]',
          error.message
        );
      }
    }
  );

  // Start if socket is already connected.

  if (sock.user) {
    activeSockets.add(sock);
    startOnlineTimer(sock);
  }

  // Incoming messages.

  sock.ev.on(
    'messages.upsert',
    async update => {
      if (update?.type !== 'notify') return;

      for (const msg of update.messages || []) {
        try {
          await handleMessageAutomation(
            sock,
            msg
          );
        } catch (error) {
          console.error(
            '[AUTOMATION]',
            error.message
          );
        }
      }
    }
  );

  // Incoming calls.

  sock.ev.on(
    'call',
    async calls => {
      try {
        await handleCalls(
          sock,
          calls
        );
      } catch (error) {
        console.error(
          '[ANTI-CALL]',
          error.message
        );
      }
    }
  );

  console.log(
    '[PRECIOUS-MD] Automation handlers installed.'
  );

  return true;
}

// ==================================================
// TYPING / RECORDING PRESENCE
// ==================================================

export async function startProcessingPresence(
  sock,
  jid,
  audio = false
) {
  const enabled = audio
    ? isAutomationEnabled('autorecording')
    : isAutomationEnabled('autotyping');

  if (!enabled || !sock || !jid) {
    return async () => {};
  }

  const presence = audio
    ? 'recording'
    : 'composing';

  try {
    await sock.sendPresenceUpdate(
      presence,
      jid
    );
  } catch (error) {
    console.error(
      '[PRESENCE]',
      error.message
    );
  }

  let stopped = false;

  return async () => {
    if (stopped) return;

    stopped = true;

    try {
      await sock.sendPresenceUpdate(
        'paused',
        jid
      );
    } catch (error) {
      console.error(
        '[PRESENCE STOP]',
        error.message
      );
    }
  };
}

// ==================================================
// CLEANUP
// ==================================================

export function stopAutomation(sock) {
  if (sock) {
    stopOnlineTimer(sock);
    activeSockets.delete(sock);
    return;
  }

  for (const activeSocket of [...activeSockets]) {
    stopOnlineTimer(activeSocket);
    activeSockets.delete(activeSocket);
  }

  processedCalls.clear();
}
