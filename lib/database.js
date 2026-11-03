
import fs from 'node:fs/promises';
import path from 'node:path';

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

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function mergeDefaults(saved = {}) {
  const db = {
    ...structuredClone(defaults),
    ...saved
  };

  db.users = isObject(saved.users) ? saved.users : {};
  db.chats = isObject(saved.chats) ? saved.chats : {};
  db.groups = isObject(saved.groups) ? saved.groups : {};
  db.settings = isObject(saved.settings) ? saved.settings : {};
  db.bans = isObject(saved.bans) ? saved.bans : {};
  db.reminders = isObject(saved.reminders) ? saved.reminders : {};

  db.stats = {
    ...defaults.stats,
    ...(isObject(saved.stats) ? saved.stats : {})
  };

  return db;
}

function databasePath() {
  return path.resolve(
    globalThis.config?.databaseFile || './data/database.json'
  );
}

export async function loadDatabase() {
  const file = databasePath();

  await fs.mkdir(path.dirname(file), { recursive: true });

  try {
    const content = await fs.readFile(file, 'utf8');
    const saved = JSON.parse(content);

    if (!isObject(saved)) {
      throw new Error('Invalid database structure.');
    }

    globalThis.db = mergeDefaults(saved);

    // Upgrade old records without deleting existing data.
    for (const [jid, user] of Object.entries(globalThis.db.users)) {
      if (!isObject(user)) {
        globalThis.db.users[jid] = {};
      }

      Object.assign(globalThis.db.users[jid], {
        warnings: 0,
        banned: false,
        premium: false,
        coins: 0,
        aiChat: false,
        aiHistory: [],
        ...(globalThis.db.users[jid] || {})
      });
    }

    for (const [jid, group] of Object.entries(globalThis.db.groups)) {
      if (!isObject(group)) {
        globalThis.db.groups[jid] = {};
      }

      Object.assign(globalThis.db.groups[jid], {
        welcome: false,
        goodbye: false,
        antiLink: false,
        antiBad: false,
        antiSpam: false,
        aiChat: false,
        badWords: [],
        disabledCommands: [],
        warnings: {},
        welcomeMessage: '',
        goodbyeMessage: '',
        ...(globalThis.db.groups[jid] || {})
      });
    }

    await saveDatabase();

  } catch (error) {
    if (error.code === 'ENOENT') {
      globalThis.db = structuredClone(defaults);
    } else {
      console.error('Database could not be loaded:', error.message);

      const backup = `${file}.corrupt-${Date.now()}`;

      await fs.rename(file, backup).catch(() => {});

      console.warn(`Damaged database preserved at: ${backup}`);

      globalThis.db = structuredClone(defaults);
    }

    await saveDatabase();
  }

  return globalThis.db;
}

export async function saveDatabase() {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    if (!globalThis.db) {
      throw new Error('Database has not been loaded.');
    }

    const file = databasePath();
    const temp = `${file}.tmp`;
    const backup = `${file}.bak`;

    await fs.mkdir(path.dirname(file), { recursive: true });

    const content = JSON.stringify(globalThis.db, null, 2);

    await fs.writeFile(temp, content, 'utf8');

    try {
      await fs.copyFile(file, backup);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await fs.rename(temp, file);
  });

  return writeQueue;
}

export function getUser(jid) {
  if (!globalThis.db) {
    throw new Error('Database has not been loaded.');
  }

  const db = globalThis.db;

  db.users[jid] ||= {
    warnings: 0,
    banned: false,
    premium: false,
    coins: 0,
    aiChat: false,
    aiHistory: [],
    createdAt: Date.now(),
    lastSeen: Date.now()
  };

  const user = db.users[jid];

  user.warnings ??= 0;
  user.banned ??= false;
  user.premium ??= false;
  user.coins ??= 0;
  user.aiChat ??= false;
  user.aiHistory ??= [];
  user.lastSeen = Date.now();

  return user;
}

export function getGroup(jid) {
  if (!globalThis.db) {
    throw new Error('Database has not been loaded.');
  }

  const db = globalThis.db;

  db.groups[jid] ||= {
    welcome: false,
    goodbye: false,
    antiLink: false,
    antiBad: false,
    antiSpam: false,
    aiChat: false,
    locked: false,
    badWords: [],
    disabledCommands: [],
    warnings: {},
    welcomeMessage: '',
    goodbyeMessage: ''
  };

  const group = db.groups[jid];

  group.badWords ??= [];
  group.disabledCommands ??= [];
  group.warnings ??= {};
  group.aiChat ??= false;

  return group;
}

export function getChat(jid) {
  if (!globalThis.db) {
    throw new Error('Database has not been loaded.');
  }

  const db = globalThis.db;

  db.chats[jid] ||= {
    muted: false,
    disabledCommands: []
  };

  const chat = db.chats[jid];

  chat.disabledCommands ??= [];

  return chat;
}

export function getStats() {
  if (!globalThis.db) {
    throw new Error('Database has not been loaded.');
  }

  return globalThis.db.stats;
}

export function getReminder(id) {
  return globalThis.db?.reminders?.[id] || null;
}

export function getAllReminders() {
  return Object.values(globalThis.db?.reminders || {});
}
