
import 'dotenv/config';

// ==================================================
// HELPERS
// ==================================================

const csv = value =>
  String(value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const bool = (value, fallback = false) => {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }

  return [
    'true',
    '1',
    'yes',
    'on'
  ].includes(String(value).trim().toLowerCase());
};

const number = (value, fallback, min, max) => {
  if (value == null || String(value).trim() === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
};

const string = (value, fallback = '') =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : fallback;

const phone = value =>
  String(value ?? '').replace(/\D/g, '');

const validDeleteMode = value => {
  const mode = String(value || 'all').trim().toLowerCase();

  return ['all', 'private', 'group'].includes(mode)
    ? mode
    : 'all';
};

const validLogLevel = value => {
  const level = String(value || 'silent').toLowerCase();

  return [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent'
  ].includes(level)
    ? level
    : 'silent';
};

// ==================================================
// OWNER CONFIGURATION
// ==================================================

// Both numbers receive owner-level access.
// OWNER_NUMBER is retained for compatibility
// with existing code that expects one owner.

const ownerNumbers = [
  ...new Set([
    ...csv(process.env.OWNER_NUMBER),
    ...csv(process.env.SUDO_NUMBERS)
  ]
    .map(phone)
    .filter(Boolean))
];

const ownerNumber = phone(
  process.env.OWNER_NUMBER
) || ownerNumbers[0] || '263781330745';

const sudoNumbers = ownerNumbers.filter(
  number => number !== ownerNumber
);

// ==================================================
// PREFIX CONFIGURATION
// ==================================================

const prefixes = [
  ...new Set(
    csv(process.env.PREFIX || '.')
  )
];

// ==================================================
// STATUS EMOJIS
// ==================================================

const statusEmojis = csv(
  process.env.STATUS_EMOJIS
);

// ==================================================
// MAINTENANCE CONFIGURATION
// ==================================================

const maintenanceInterval = number(
  process.env.MAINTENANCE_INTERVAL ??
  process.env.TEMP_CLEANUP_INTERVAL,
  3600000,
  60000,
  86400000
);

const tempCleanupInterval = number(
  process.env.TEMP_CLEANUP_INTERVAL ??
  process.env.MAINTENANCE_INTERVAL,
  3600000,
  60000,
  86400000
);

const tempFileMaxAgeHours = number(
  process.env.TEMP_FILE_MAX_AGE_HOURS,
  24,
  1 / 60,
  168
);

const tempFileMaxAge = tempFileMaxAgeHours * 3600000;

// ==================================================
// CONFIGURATION
// ==================================================

const config = {

  // ================================================
  // IDENTITY
  // ================================================

  botName: string(
    process.env.BOT_NAME,
    'PRECIOUS-MD'
  ),

  ownerName: string(
    process.env.OWNER_NAME,
    'Watson Fourpence'
  ),

  ownerNumber,
  ownerNumbers,
  sudoNumbers,

  // ================================================
  // WHATSAPP LOGIN
  // ================================================

  pairingNumber: phone(
    process.env.PAIRING_NUMBER
  ),

  // ================================================
  // COMMAND SETTINGS
  // ================================================

  prefix: prefixes[0] || '.',

  prefixes: prefixes.length
    ? prefixes
    : ['.'],

  publicMode: bool(
    process.env.PUBLIC_MODE,
    true
  ),

  commandCooldown: number(
    process.env.COMMAND_COOLDOWN,
    0,
    0,
    3600
  ),

  maxMessageLength: number(
    process.env.MAX_MESSAGE_LENGTH,
    4000,
    100,
    10000
  ),

  // ================================================
  // DASHBOARD
  // ================================================

  port: number(
    process.env.PORT,
    9090,
    1,
    65535
  ),

  dashboardPassword: string(
    process.env.DASHBOARD_PASSWORD
  ),

  dashboardToken: string(
    process.env.DASHBOARD_TOKEN,
    string(process.env.DASHBOARD_PASSWORD)
  ),

  // ================================================
  // STORAGE
  // ================================================

  sessionDir: string(
    process.env.SESSION_DIR,
    './session'
  ),

  databaseFile: string(
    process.env.DATABASE_FILE,
    './data/database.json'
  ),

  mediaDir: string(
    process.env.MEDIA_DIR,
    './temp'
  ),

  // ================================================
  // LOGGING
  // ================================================

  logLevel: validLogLevel(
    process.env.LOG_LEVEL
  ),

  // ================================================
  // WHATSAPP AUTOMATION
  // ================================================

  readMessages: bool(
    process.env.READ_MESSAGES,
    false
  ),

  alwaysOnline: bool(
    process.env.ALWAYS_ONLINE,
    true
  ),

  autoTyping: bool(
    process.env.AUTO_TYPING,
    true
  ),

  autoRecording: bool(
    process.env.AUTO_RECORDING,
    false
  ),

  autoReact: bool(
    process.env.AUTO_REACT,
    false
  ),

  // ================================================
  // STATUS AUTOMATION
  // ================================================

  autoViewStatus: bool(
    process.env.AUTO_VIEW_STATUS,
    true
  ),

  autoStatusReact: bool(
    process.env.AUTO_STATUS_REACT,
    true
  ),

  statusEmojis: statusEmojis.length
    ? statusEmojis
    : ['🔥', '❤️', '😂', '💚'],

  // ================================================
  // CALL MANAGEMENT
  // ================================================

  antiCall: bool(
    process.env.ANTI_CALL,
    true
  ),

  // ================================================
  // MESSAGE MANAGEMENT
  // ================================================

  antiDelete: bool(
    process.env.ANTI_DELETE,
    true
  ),

  antiDeleteMode: validDeleteMode(
    process.env.ANTI_DELETE_MODE
  ),

  antiDeleteNotify: bool(
    process.env.ANTI_DELETE_NOTIFY,
    true
  ),

  // ================================================
  // MEDIA DOWNLOADER
  // ================================================

  ytdlpPath: string(
    process.env.YTDLP_PATH,
    'yt-dlp'
  ),

  maxMediaMb: number(
    process.env.MAX_MEDIA_MB,
    45,
    1,
    500
  ),

  // ================================================
  // ARTIFICIAL INTELLIGENCE
  // ================================================

  aiEnabled: bool(
    process.env.AI_ENABLED,
    true
  ),

  aiApiUrl: string(
    process.env.AI_API_URL,
    'https://api.openai.com/v1/chat/completions'
  ),

  aiApiKey: string(
    process.env.AI_API_KEY
  ),

  aiModel: string(
    process.env.AI_MODEL,
    'gpt-4o-mini'
  ),

  aiTimeout: number(
    process.env.AI_TIMEOUT,
    45000,
    5000,
    120000
  ),

  aiMaxTokens: number(
    process.env.AI_MAX_TOKENS,
    1000,
    100,
    8000
  ),

  aiMaxHistory: number(
    process.env.AI_MAX_HISTORY,
    10,
    2,
    30
  ),

  // ================================================
  // TRANSLATION
  // ================================================

  translateApiUrl: string(
    process.env.TRANSLATE_API_URL
  ),

  translateApiKey: string(
    process.env.TRANSLATE_API_KEY
  ),

  // ================================================
  // MODERATION
  // ================================================

  maxWarnings: number(
    process.env.MAX_WARNINGS,
    3,
    1,
    20
  ),

  spamLimit: number(
    process.env.SPAM_LIMIT,
    5,
    2,
    50
  ),

  spamWindow: number(
    process.env.SPAM_WINDOW,
    10000,
    1000,
    120000
  ),

  maxGroupMentions: number(
    process.env.MAX_GROUP_MENTIONS,
    20,
    1,
    500
  ),

  // ================================================
  // MAINTENANCE
  // ================================================

  maintenanceInterval,
  tempCleanupInterval,

  tempFileMaxAgeHours,
  tempFileMaxAge

};

// ==================================================
// GLOBAL CONFIGURATION
// ==================================================

globalThis.config = config;

export default config;
