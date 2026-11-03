
import config from '../config.js';
import { saveDatabase } from './database.js';

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

const statusEmojis = ['❤️', '🔥', '😂', '😍', '💚', '👏'];

const onlineTimers = new WeakMap();

export function getAutomationSettings() {
  if (!globalThis.db) globalThis.db = {};
  if (!globalThis.db.settings) globalThis.db.settings = {};

  if (!globalThis.db.settings.automation) {
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
  if (!(name in defaults)) return false;

  return getAutomationSettings()[name] === true;
}

async function updateOnline(sock) {
  if (!isAutomationEnabled('alwaysonline')) return;

  try {
    await sock.sendPresenceUpdate('available');
  } catch (error) {
    console.error('[ALWAYS ONLINE]', error.message);
  }
}

function startOnlineTimer(sock) {
  stopOnlineTimer(sock);

  if (!isAutomationEnabled('alwaysonline')) return;

  updateOnline(sock);

  const timer = setInterval(() => {
    updateOnline(sock);
  }, 25000);

  timer.unref?.();
  onlineTimers.set(sock, timer);
}

function stopOnlineTimer(sock) {
  const timer = onlineTimers.get(sock);

  if (timer) {
    clearInterval(timer);
    onlineTimers.delete(sock);
  }
}

export async function setAutomation(name, enabled) {
  if (!(name in defaults)) {
    throw new Error(`Unknown automation setting: ${name}`);
  }

  const settings = getAutomationSettings();

  settings[name] = Boolean(enabled);

  await saveDatabase();

  return settings[name];
}

function isViewOnce(message) {
  let current = message;

  for (let i = 0; i < 8 && current; i++) {
    if (
      current.viewOnceMessage ||
      current.viewOnceMessageV2 ||
      current.viewOnceMessageV2Extension
    ) {
      return true;
    }

    current =
      current.ephemeralMessage?.message ||
      current.documentWithCaptionMessage?.message;
  }

  return false;
}

function randomEmoji() {
  return statusEmojis[
    Math.floor(Math.random() * statusEmojis.length)
  ];
}

export function installAutomationHandlers(sock) {
  sock.ev.on('connection.update', update => {
    if (update.connection === 'open') {
      startOnlineTimer(sock);
    }

    if (update.connection === 'close') {
      stopOnlineTimer(sock);
    }
  });

  // Start if this socket is already connected.
  if (sock.user) {
    startOnlineTimer(sock);
  }

  sock.ev.on('messages.upsert', async update => {
    if (!['notify', 'append'].includes(update.type)) return;

    for (const msg of update.messages || []) {
      try {
        if (!msg?.key?.remoteJid || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        const isStatus = jid === 'status@broadcast';

        if (isStatus) {
          if (
            isAutomationEnabled('autostatus') &&
            msg.key.participant
          ) {
            await sock.readMessages([msg.key]).catch(() => {});
          }

          if (
            isAutomationEnabled('statusreact') &&
            msg.key.participant
          ) {
            await sock.sendMessage('status@broadcast', {
              react: {
                text: randomEmoji(),
                key: msg.key
              }
            }).catch(() => {});
          }

          continue;
        }

        if (isAutomationEnabled('autoread')) {
          await sock.readMessages([msg.key]).catch(() => {});
        }

        if (isAutomationEnabled('autoreact')) {
          await sock.sendMessage(jid, {
            react: {
              text: randomEmoji(),
              key: msg.key
            }
          }).catch(() => {});
        }

        if (
          isAutomationEnabled('viewonce') &&
          isViewOnce(msg.message)
        ) {
          console.log(
            `[PRECIOUS-MD] View-once message detected in ${jid}`
          );
        }
      } catch (error) {
        console.error('[AUTOMATION]', error.message);
      }
    }
  });

  sock.ev.on('call', async calls => {
    if (!isAutomationEnabled('anticall')) return;

    for (const call of calls || []) {
      if (call.status !== 'offer') continue;

      try {
        if (typeof sock.rejectCall === 'function') {
          await sock.rejectCall(call.id, call.from);
        }

        await sock.sendMessage(call.from, {
          text: '📵 Sorry, calls are disabled. Please message this bot.'
        }).catch(() => {});
      } catch (error) {
        console.error('[ANTI-CALL]', error.message);
      }
    }
  });

  console.log('[PRECIOUS-MD] Automation handlers installed.');
}

export async function startProcessingPresence(
  sock,
  jid,
  audio = false
) {
  const enabled = audio
    ? isAutomationEnabled('autorecording')
    : isAutomationEnabled('autotyping');

  if (!enabled) {
    return async () => {};
  }

  const presence = audio ? 'recording' : 'composing';

  try {
    await sock.sendPresenceUpdate(presence, jid);
  } catch (error) {
    console.error('[PRESENCE]', error.message);
  }

  return async () => {
    try {
      await sock.sendPresenceUpdate('paused', jid);
    } catch {}
  };
}
