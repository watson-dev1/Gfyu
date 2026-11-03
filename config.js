
import 'dotenv/config';

const csv = value =>
  (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(
    String(value).toLowerCase()
  );
};

const number = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const ownerNumber = (process.env.OWNER_NUMBER || '')
  .replace(/\D/g, '');

const sudoNumbers = csv(process.env.SUDO_NUMBERS)
  .map(value => value.replace(/\D/g, ''))
  .filter(Boolean);

const prefixes = csv(process.env.PREFIX || '.');

const config = {
  // Identity
  botName: process.env.BOT_NAME || 'PRECIOUS-MD',
  ownerName: process.env.OWNER_NAME || 'Watson Fourpence',

  ownerNumber,
  sudoNumbers,

  // Commands
  prefix: prefixes[0] || '.',
  prefixes: prefixes.length ? prefixes : ['.'],

  // Storage
  sessionDir: process.env.SESSION_DIR || './session',
  databaseFile: process.env.DATABASE_FILE || './data/database.json',
  mediaDir: process.env.MEDIA_DIR || './temp',

  // Server
  port: number(process.env.PORT, 9090, 1, 65535),

  // Bot mode
  publicMode: bool(process.env.PUBLIC_MODE, true),

  // Status
  autoViewStatus: bool(process.env.AUTO_VIEW_STATUS),
  autoStatusReact: bool(process.env.AUTO_STATUS_REACT),

  statusEmojis: csv(process.env.STATUS_EMOJIS).length
    ? csv(process.env.STATUS_EMOJIS)
    : ['🔥', '❤️', '😂', '💚'],

  // WhatsApp settings
  antiCall: bool(process.env.ANTI_CALL),
  readMessages: bool(process.env.READ_MESSAGES),
  autoTyping: bool(process.env.AUTO_TYPING),

  // Media
  ytdlpPath: process.env.YTDLP_PATH || 'yt-dlp',
  maxMediaMb: number(process.env.MAX_MEDIA_MB, 45, 1, 500),

  // AI
  aiApiUrl:
    process.env.AI_API_URL ||
    'https://api.openai.com/v1/chat/completions',

  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',

  // Translation
  translateApiUrl: process.env.TRANSLATE_API_URL || '',
  translateApiKey: process.env.TRANSLATE_API_KEY || '',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'silent',

  // Limits
  maxMessageLength: number(
    process.env.MAX_MESSAGE_LENGTH,
    4000,
    100,
    10000
  ),

  commandCooldown: number(
    process.env.COMMAND_COOLDOWN,
    0,
    0,
    3600
  )
};

globalThis.config = config;

export default config;
