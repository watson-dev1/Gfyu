
import fs from 'node:fs/promises';
import path from 'node:path';

// --------------------------------------------------
// DATABASE DEFAULTS
// --------------------------------------------------

const defaults = {
  users: {},
  chats: {},
  groups: {},
  settings: {},
  bans: {},
  reminders: {},

  stats: {
    messages: 0,
    commands: 0,
    errors: 0,
    startedAt: Date.now()
  }
};

let writeQueue = Promise.resolve();

// --------------------------------------------------
// VALIDATION HELPERS
// --------------------------------------------------

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function ensureObject(parent, key) {
  if (!isObject(parent[key])) {
    parent[key] = {};
  }

  return parent[key];
}

function ensureArray(parent, key) {
  if (!Array.isArray(parent[key])) {
    parent[key] = [];
  }

  return parent[key];
}

function ensureNumber(parent, key, fallback = 0) {
  const value = Number(parent[key]);

  parent[key] = Number.isFinite(value)
    ? value
    : fallback;
}

function ensureBoolean(parent, key, fallback = false) {
  if (typeof parent[key] !== 'boolean') {
    parent[key] = fallback;
  }
}

// --------------------------------------------------
// DEFAULT RECORDS
// --------------------------------------------------

function createUserDefaults() {
  const now = Date.now();

  return {
    warnings: 0,
    banned: false,
    premium: false,
    coins: 0,

    // Watson AI
    aiChat: false,
    aiHistory: [],

    // AFK
    afk: null,

    // User activity
    createdAt: now,
    lastSeen: now
  };
}

function createGroupDefaults() {
  return {
    // Group events
    welcome: false,
    goodbye: false,
    notifySubjectChanges: false,
    notifyDescriptionChanges: false,

    // Moderation
    antiLink: false,
    antiBad: false,
    antiSpam: false,

    // Watson AI
    aiChat: false,
    aiHistory: [],

    // Group management
    locked: false,
    badWords: [],
    disabledCommands: [],
    warnings: {},

    // Custom messages
    welcomeMessage: '',
    goodbyeMessage: ''
  };
}

function createChatDefaults() {
  return {
    muted: false,
    disabledCommands: []
  };
}

// --------------------------------------------------
// DATABASE MIGRATION
// --------------------------------------------------

function mergeDefaults(saved = {}) {
  const db = {
    ...structuredClone(defaults),
    ...saved
  };

  // Validate database collections.
  for (const key of [
    'users',
    'chats',
    'groups',
    'settings',
    'bans',
    'reminders'
  ]) {
    if (!isObject(saved[key])) {
      db[key] = {};
    } else {
      db[key] = saved[key];
    }
  }

  // Validate statistics.
  db.stats = {
    ...defaults.stats,
    ...(isObject(saved.stats) ? saved.stats : {})
  };

  ensureNumber(db.stats, 'messages');
  ensureNumber(db.stats, 'commands');
  ensureNumber(db.stats, 'errors');
  ensureNumber(db.stats, 'startedAt', Date.now());

  // ------------------------------------------------
  // MIGRATE USERS
  // ------------------------------------------------

  for (const [jid, record] of Object.entries(db.users)) {
    const user = isObject(record) ? record : {};

    db.users[jid] = {
      ...createUserDefaults(),
      ...user
    };

    const current = db.users[jid];

    ensureNumber(current, 'warnings');
    ensureNumber(current, 'coins');

    ensureBoolean(current, 'banned');
    ensureBoolean(current, 'premium');
    ensureBoolean(current, 'aiChat');

    ensureArray(current, 'aiHistory');

    if (!Number.isFinite(Number(current.createdAt))) {
      current.createdAt = Date.now();
    }

    if (!Number.isFinite(Number(current.lastSeen))) {
      current.lastSeen = Date.now();
    }
  }

  // ------------------------------------------------
  // MIGRATE GROUPS
  // ------------------------------------------------

  for (const [jid, record] of Object.entries(db.groups)) {
    const group = isObject(record) ? record : {};

    db.groups[jid] = {
      ...createGroupDefaults(),
      ...group
    };

    const current = db.groups[jid];

    ensureBoolean(current, 'welcome');
    ensureBoolean(current, 'goodbye');

    ensureBoolean(current, 'notifySubjectChanges');
    ensureBoolean(current, 'notifyDescriptionChanges');

    ensureBoolean(current, 'antiLink');
    ensureBoolean(current, 'antiBad');
    ensureBoolean(current, 'antiSpam');

    ensureBoolean(current, 'aiChat');
    ensureBoolean(current, 'locked');

    ensureArray(current, 'aiHistory');
    ensureArray(current, 'badWords');
    ensureArray(current, 'disabledCommands');

    ensureObject(current, 'warnings');

    if (typeof current.welcomeMessage !== 'string') {
      current.welcomeMessage = '';
    }

    if (typeof current.goodbyeMessage !== 'string') {
      current.goodbyeMessage = '';
    }
  }

  // ------------------------------------------------
  // MIGRATE CHATS
  // ------------------------------------------------

  for (const [jid, record] of Object.entries(db.chats)) {
    const chat = isObject(record) ? record : {};

    db.chats[jid] = {
      ...createChatDefaults(),
      ...chat
    };

    const current = db.chats[jid];

    ensureBoolean(current, 'muted');
    ensureArray(current, 'disabledCommands');
  }

  return db;
}

// --------------------------------------------------
// DATABASE PATH
// --------------------------------------------------

function databasePath() {
  return path.resolve(
    globalThis.config?.databaseFile ||
    './data/database.json'
  );
}

// --------------------------------------------------
// LOAD DATABASE
// --------------------------------------------------

export async function loadDatabase() {
  const file = databasePath();

  await fs.mkdir(path.dirname(file), {
    recursive: true
  });

  let saved;

  try {
    const content = await fs.readFile(
      file,
      'utf8'
    );

    try {
      saved = JSON.parse(content);
    } catch {
      const backup = `${file}.corrupt-${Date.now()}`;

      await fs.rename(file, backup);

      console.error(
        '[DATABASE] Invalid JSON detected.'
      );

      console.warn(
        `[DATABASE] Original file preserved at: ${backup}`
      );

      saved = structuredClone(defaults);
    }

    if (!isObject(saved)) {
      const backup = `${file}.corrupt-${Date.now()}`;

      await fs.rename(file, backup);

      console.warn(
        `[DATABASE] Invalid structure preserved at: ${backup}`
      );

      saved = structuredClone(defaults);
    }

  } catch (error) {
    if (error.code === 'ENOENT') {
      saved = structuredClone(defaults);
    } else {
      console.error(
        '[DATABASE] Could not read database:',
        error
      );

      throw error;
    }
  }

  globalThis.db = mergeDefaults(saved);

  await saveDatabase();

  console.log('[DATABASE] Loaded successfully.');

  return globalThis.db;
}

// --------------------------------------------------
// SAVE DATABASE
// --------------------------------------------------

export async function saveDatabase() {
  writeQueue = writeQueue
    .catch(error => {
      console.error(
        '[DATABASE] Previous write failed:',
        error
      );
    })
    .then(async () => {
      if (!globalThis.db) {
        throw new Error(
          'Database has not been loaded.'
        );
      }

      const file = databasePath();
      const temp = `${file}.tmp`;
      const backup = `${file}.bak`;

      await fs.mkdir(path.dirname(file), {
        recursive: true
      });

      // Serialize the current database.
      const content = JSON.stringify(
        globalThis.db,
        null,
        2
      );

      if (typeof content !== 'string') {
        throw new Error(
          'Database could not be serialized.'
        );
      }

      // Write temporary database first.
      await fs.writeFile(
        temp,
        content,
        'utf8'
      );

      // Preserve the previous database.
      try {
        await fs.copyFile(file, backup);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          await fs.unlink(temp).catch(() => {});
          throw error;
        }
      }

      // Replace the original database.
      try {
        await fs.rename(temp, file);
      } catch (error) {
        await fs.unlink(temp).catch(() => {});
        throw error;
      }
    });

  return writeQueue;
}

// --------------------------------------------------
// GET USER
// --------------------------------------------------

export function getUser(jid) {
  if (!globalThis.db) {
    throw new Error(
      'Database has not been loaded.'
    );
  }

  if (!jid || typeof jid !== 'string') {
    throw new Error(
      'A valid user JID is required.'
    );
  }

  const users = ensureObject(
    globalThis.db,
    'users'
  );

  if (!isObject(users[jid])) {
    users[jid] = createUserDefaults();
  }

  const user = users[jid];

  user.warnings ??= 0;
  user.banned ??= false;
  user.premium ??= false;
  user.coins ??= 0;

  user.aiChat ??= false;
  user.aiHistory ??= [];

  user.afk ??= null;

  user.createdAt ??= Date.now();
  user.lastSeen = Date.now();

  ensureNumber(user, 'warnings');
  ensureNumber(user, 'coins');

  ensureBoolean(user, 'banned');
  ensureBoolean(user, 'premium');
  ensureBoolean(user, 'aiChat');

  ensureArray(user, 'aiHistory');

  return user;
}

// --------------------------------------------------
// GET GROUP
// --------------------------------------------------

export function getGroup(jid) {
  if (!globalThis.db) {
    throw new Error(
      'Database has not been loaded.'
    );
  }

  if (!jid || typeof jid !== 'string') {
    throw new Error(
      'A valid group JID is required.'
    );
  }

  const groups = ensureObject(
    globalThis.db,
    'groups'
  );

  if (!isObject(groups[jid])) {
    groups[jid] = createGroupDefaults();
  }

  const group = groups[jid];

  const defaults = createGroupDefaults();

  for (const [key, value] of Object.entries(defaults)) {
    if (group[key] === undefined || group[key] === null) {
      group[key] = structuredClone(value);
    }
  }

  ensureBoolean(group, 'welcome');
  ensureBoolean(group, 'goodbye');

  ensureBoolean(group, 'notifySubjectChanges');
  ensureBoolean(group, 'notifyDescriptionChanges');

  ensureBoolean(group, 'antiLink');
  ensureBoolean(group, 'antiBad');
  ensureBoolean(group, 'antiSpam');

  ensureBoolean(group, 'aiChat');
  ensureBoolean(group, 'locked');

  ensureArray(group, 'aiHistory');
  ensureArray(group, 'badWords');
  ensureArray(group, 'disabledCommands');

  ensureObject(group, 'warnings');

  return group;
}

// --------------------------------------------------
// GET CHAT
// --------------------------------------------------

export function getChat(jid) {
  if (!globalThis.db) {
    throw new Error(
      'Database has not been loaded.'
    );
  }

  if (!jid || typeof jid !== 'string') {
    throw new Error(
      'A valid chat JID is required.'
    );
  }

  const chats = ensureObject(
    globalThis.db,
    'chats'
  );

  if (!isObject(chats[jid])) {
    chats[jid] = createChatDefaults();
  }

  const chat = chats[jid];

  chat.muted ??= false;

  ensureBoolean(chat, 'muted');
  ensureArray(chat, 'disabledCommands');

  return chat;
}

// --------------------------------------------------
// GET STATISTICS
// --------------------------------------------------

export function getStats() {
  if (!globalThis.db) {
    throw new Error(
      'Database has not been loaded.'
    );
  }

  if (!isObject(globalThis.db.stats)) {
    globalThis.db.stats = {
      messages: 0,
      commands: 0,
      errors: 0,
      startedAt: Date.now()
    };
  }

  const stats = globalThis.db.stats;

  ensureNumber(stats, 'messages');
  ensureNumber(stats, 'commands');
  ensureNumber(stats, 'errors');
  ensureNumber(stats, 'startedAt', Date.now());

  return stats;
}

// --------------------------------------------------
// REMINDERS
// --------------------------------------------------

export function getReminder(id) {
  if (!globalThis.db || !id) {
    return null;
  }

  const reminders = ensureObject(
    globalThis.db,
    'reminders'
  );

  return reminders[String(id)] || null;
}

export function getAllReminders() {
  if (!globalThis.db) {
    return [];
  }

  const reminders = ensureObject(
    globalThis.db,
    'reminders'
  );

  return Object.values(reminders)
    .filter(isObject);
}

// --------------------------------------------------
// SETTINGS
// --------------------------------------------------

export function getSetting(key, fallback = null) {
  if (!globalThis.db || !key) {
    return fallback;
  }

  const settings = ensureObject(
    globalThis.db,
    'settings'
  );

  return settings[key] ?? fallback;
}

export function setSetting(key, value) {
  if (!globalThis.db) {
    throw new Error(
      'Database has not been loaded.'
    );
  }

  if (!key || typeof key !== 'string') {
    throw new Error(
      'A valid setting key is required.'
    );
  }

  const settings = ensureObject(
    globalThis.db,
    'settings'
  );

  settings[key] = value;

  return saveDatabase();
}

// --------------------------------------------------
// DATABASE STATUS
// --------------------------------------------------

export function isDatabaseLoaded() {
  return isObject(globalThis.db);
}

// --------------------------------------------------
// DATABASE BACKUP
// --------------------------------------------------

export async function createDatabaseBackup() {
  if (!globalThis.db) {
    throw new Error(
      'Database has not been loaded.'
    );
  }

  await saveDatabase();

  const file = databasePath();
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const backup = `${file}.${timestamp}.backup`;

  await fs.copyFile(file, backup);

  return backup;
}
