
import 'dotenv/config';

// ==================================================
// HELPERS
// ==================================================

const csv = value =>
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;

  return [
    'true',
    '1',
    'yes',
    'on'
  ].includes(String(value).toLowerCase());
};

const number = (value, fallback, min, max) => {
  if (value == null || value === '') return fallback;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  return Math.min(max, Math.max(min, parsed));
};

const string = (value, fallback = '') =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : fallback;

// ==================================================
// OWNER CONFIGURATION
// ==================================================

const ownerNumber = String(
  process.env.OWNER_NUMBER || ''
).replace(/\D/g, '');

const sudoNumbers = csv(
  process.env.SUDO_NUMBERS
)
  .map(value => value.replace(/\D/g, ''))
  .filter(Boolean);

// ==================================================
// PREFIX CONFIGURATION
// ==================================================

const prefixes = csv(process.env.PREFIX || '.');

// ==================================================
// STATUS EMOJIS
// ==================================================

const statusEmojis = csv(process.env.STATUS_EMOJIS);

// ==================================================
// CONFIGURATION
// ==================================================

const config = {

  // IDENTITY
  botName: string(process.env.BOT_NAME, 'PRECIOUS-MD'),
  ownerName: string(process.env.OWNER_NAME, 'Watson Fourpence'),

  ownerNumber,
  sudoNumbers,

  // PAIRING
  pairingNumber: String(
    process.env.PAIRING_NUMBER || ''
  ).replace(/\D/g, ''),

  // COMMANDS
  prefix: prefixes[0] || '.',
  prefixes: prefixes.length ? prefixes : ['.'],

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

  // STORAGE
  sessionDir: string(process.env.SESSION_DIR, './session'),
  databaseFile: string(process.env.DATABASE_FILE, './data/database.json'),
  mediaDir: string(process.env.MEDIA_DIR, './temp'),

  // SERVER
  port: number(process.env.PORT, 9090, 1, 65535),

  dashboardToken: string(process.env.DASHBOARD_TOKEN),

  // BOT MODE
  publicMode: bool(process.env.PUBLIC_MODE, true),

  // WHATSAPP AUTOMATION
  readMessages: bool(process.env.READ_MESSAGES, false),
  alwaysOnline: bool(process.env.ALWAYS_ONLINE, false),
  autoViewStatus: bool(process.env.AUTO_VIEW_STATUS, false),
  autoStatusReact: bool(process.env.AUTO_STATUS_REACT, false),
  autoReact: bool(process.env.AUTO_REACT, false),
  antiCall: bool(process.env.ANTI_CALL, false),
  autoTyping: bool(process.env.AUTO_TYPING, false),
  autoRecording: bool(process.env.AUTO_RECORDING, false),

  // STATUS
  statusEmojis: statusEmojis.length
    ? statusEmojis
    : ['🔥', '❤️', '😂', '💚'],

  // MEDIA
  ytdlpPath: string(process.env.YTDLP_PATH, 'yt-dlp'),

  maxMediaMb: number(
    process.env.MAX_MEDIA_MB,
    45,
    1,
    500
  ),

  // ARTIFICIAL INTELLIGENCE
  aiEnabled: bool(process.env.AI_ENABLED, true),

  aiApiUrl: string(
    process.env.AI_API_URL,
    'https://api.openai.com/v1/chat/completions'
  ),

  aiApiKey: string(process.env.AI_API_KEY),

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

  // TRANSLATION
  translateApiUrl: string(process.env.TRANSLATE_API_URL),
  translateApiKey: string(process.env.TRANSLATE_API_KEY),

  // LOGGING
  logLevel: string(process.env.LOG_LEVEL, 'silent'),

  // MAINTENANCE
  // Supports both the current and legacy environment names.

  maintenanceInterval: number(
    process.env.MAINTENANCE_INTERVAL ??
    process.env.TEMP_CLEANUP_INTERVAL,
    3600000,
    60000,
    86400000
  ),

  tempCleanupInterval: number(
    process.env.TEMP_CLEANUP_INTERVAL ??
    process.env.MAINTENANCE_INTERVAL,
    3600000,
    60000,
    86400000
  ),

  tempFileMaxAgeHours: number(
    process.env.TEMP_FILE_MAX_AGE_HOURS,
    number(
      process.env.TEMP_FILE_MAX_AGE,
      86400000,
      60000,
      604800000
    ) / 3600000,
    1 / 60,
    168
  ),

  tempFileMaxAge: number(
    process.env.TEMP_FILE_MAX_AGE,
    number(
      process.env.TEMP_FILE_MAX_AGE_HOURS,
      24,
      1 / 60,
      168
    ) * 3600000,
    60000,
    604800000
  ),

  // SECURITY AND MODERATION
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
  )

};

// ==================================================
// GLOBAL CONFIGURATION
// ==================================================

globalThis.config = config;

export default config;
