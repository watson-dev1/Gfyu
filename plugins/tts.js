
import config from '../config.js';

// ==================================================
// PRECIOUS-MD TEXT TO SPEECH
// EliteProTech Airmore API
// ==================================================

const API_BASE = 'https://eliteprotech-apis.zone.id';
const VOICE_LIST_URL = `${API_BASE}/ai/airmore?list=voices`;

const DEFAULT_VOICE = 'BrandonMultilingual';
const MAX_TEXT_LENGTH = 3000;
const MAX_AUDIO_SIZE = 15 * 1024 * 1024;
const VOICE_CACHE_TIME = 60 * 60 * 1000;

let cachedVoices = [];
let voiceCacheTime = 0;

// ==================================================
// HELPERS
// ==================================================

function getText(ctx) {
  return String(ctx.q || '').trim();
}

function getOwner(ctx) {
  return ctx.user || {};
}

function getSavedVoice(ctx) {
  const voice = getOwner(ctx).ttsVoice;

  return typeof voice === 'string' && voice.trim()
    ? voice.trim()
    : DEFAULT_VOICE;
}

function getPrefix() {
  return config.prefix || '.';
}

function findValue(object, keys, depth = 0) {
  if (!object || typeof object !== 'object' || depth > 6) {
    return null;
  }

  for (const key of keys) {
    const value = object[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') {
      const result = findValue(value, keys, depth + 1);

      if (result) return result;
    }
  }

  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(45000)
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid API response: ${text.slice(0, 200)}`
    );
  }

  if (!response.ok || data?.status === false) {
    throw new Error(
      data?.message ||
      data?.error ||
      `API request failed (${response.status})`
    );
  }

  return data;
}

// ==================================================
// GET AVAILABLE VOICES
// ==================================================

async function getVoices(force = false) {
  if (
    !force &&
    cachedVoices.length &&
    Date.now() - voiceCacheTime < VOICE_CACHE_TIME
  ) {
    return cachedVoices;
  }

  const data = await fetchJson(VOICE_LIST_URL);

  if (!Array.isArray(data.voices)) {
    throw new Error('Voice list was not returned by the API.');
  }

  cachedVoices = [
    ...new Set(
      data.voices.filter(
        voice => typeof voice === 'string' && voice.trim()
      )
    )
  ];

  voiceCacheTime = Date.now();

  return cachedVoices;
}

// ==================================================
// VOICE VALIDATION
// ==================================================

async function isValidVoice(voice) {
  const voices = await getVoices();

  return voices.some(
    item => item.toLowerCase() === voice.toLowerCase()
  );
}

async function getActualVoice(voice) {
  const voices = await getVoices();

  return voices.find(
    item => item.toLowerCase() === voice.toLowerCase()
  ) || null;
}

// ==================================================
// AUDIO EXTRACTION
// ==================================================

function decodeBase64(value) {
  const cleaned = value
    .replace(/^data:audio\/[^;]+;base64,/i, '')
    .replace(/\s/g, '');

  return Buffer.from(cleaned, 'base64');
}

function extractAudioData(data) {
  const base64 = findValue(data, [
    'audio',
    'audioBase64',
    'audio_base64',
    'base64',
    'data'
  ]);

  const url = findValue(data, [
    'url',
    'audioUrl',
    'audio_url',
    'downloadUrl',
    'download_url',
    'result'
  ]);

  if (base64 && (
    base64.startsWith('data:audio/') ||
    /^[A-Za-z0-9+/=\s]+$/.test(base64)
  )) {
    const buffer = decodeBase64(base64);

    if (buffer.length) {
      return {
        buffer,
        mimetype: 'audio/mpeg'
      };
    }
  }

  return {
    url: url || null
  };
}

// ==================================================
// GENERATE SPEECH
// ==================================================

async function generateSpeech(text, voice) {
  const url = new URL(`${API_BASE}/ai/airmore`);

  // Assumed generation parameters.
  // Confirm these against the provider's TTS documentation.

  url.searchParams.set('text', text);
  url.searchParams.set('voice', voice);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'audio/mpeg, audio/*, application/json'
    },
    signal: AbortSignal.timeout(90000)
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `TTS API error ${response.status}: ${errorText.slice(0, 250)}`
    );
  }

  const contentType = (
    response.headers.get('content-type') || ''
  ).toLowerCase();

  // Direct audio response
  if (
    contentType.startsWith('audio/') ||
    contentType.includes('octet-stream')
  ) {
    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    if (!buffer.length) {
      throw new Error('The API returned empty audio.');
    }

    if (buffer.length > MAX_AUDIO_SIZE) {
      throw new Error('Generated audio exceeds the 15 MB limit.');
    }

    return {
      buffer,
      mimetype: contentType.startsWith('audio/')
        ? contentType.split(';')[0]
        : 'audio/mpeg'
    };
  }

  // JSON response
  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Unexpected TTS response: ${raw.slice(0, 250)}`
    );
  }

  if (data.status === false) {
    throw new Error(
      data.message || data.error || 'Speech generation failed.'
    );
  }

  const extracted = extractAudioData(data);

  if (extracted.buffer) {
    if (extracted.buffer.length > MAX_AUDIO_SIZE) {
      throw new Error('Generated audio exceeds the 15 MB limit.');
    }

    return extracted;
  }

  if (extracted.url) {
    const audioUrl = new URL(extracted.url);

    if (!['https:', 'http:'].includes(audioUrl.protocol)) {
      throw new Error('Invalid audio download URL.');
    }

    const audioResponse = await fetch(audioUrl, {
      signal: AbortSignal.timeout(90000)
    });

    if (!audioResponse.ok) {
      throw new Error('Could not download generated audio.');
    }

    const buffer = Buffer.from(
      await audioResponse.arrayBuffer()
    );

    if (!buffer.length) {
      throw new Error('Downloaded audio is empty.');
    }

    if (buffer.length > MAX_AUDIO_SIZE) {
      throw new Error('Generated audio exceeds the 15 MB limit.');
    }

    return {
      buffer,
      mimetype:
        audioResponse.headers.get('content-type')?.split(';')[0] ||
        'audio/mpeg'
    };
  }

  throw new Error(
    'The API did not return an audio URL or audio data.'
  );
}

// ==================================================
// SEND AUDIO TO WHATSAPP
// ==================================================

async function sendAudio(ctx, audio, voice) {
  const sock =
    ctx.sock ||
    ctx.conn ||
    ctx.socket;

  const jid =
    ctx.chat ||
    ctx.jid ||
    ctx.from;

  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error(
      'WhatsApp socket not found in plugin context. Check your handler context.'
    );
  }

  if (!jid) {
    throw new Error(
      'WhatsApp destination chat was not found.'
    );
  }

  await sock.sendMessage(
    jid,
    {
      audio: audio.buffer,
      mimetype: audio.mimetype || 'audio/mpeg',
      ptt: true
    },
    {
      quoted: ctx.message || ctx.quoted || undefined
    }
  );

  await ctx.react('✅');
}

// ==================================================
// FORMAT VOICE LIST
// ==================================================

function formatVoiceList(voices, page = 1) {
  const perPage = 30;
  const totalPages = Math.ceil(voices.length / perPage);

  const start = (page - 1) * perPage;

  const selected = voices.slice(
    start,
    start + perPage
  );

  const list = selected
    .map((voice, index) =>
      `${start + index + 1}. ${voice}`
    )
    .join('\n');

  return (
    `╭━━〔 *PRECIOUS-MD VOICES* 〕━━╮\n` +
    `┃\n` +
    `┃ Total voices: ${voices.length}\n` +
    `┃ Page: ${page}/${totalPages}\n` +
    `┃\n` +
    `${list}\n` +
    `┃\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `Next page: ${getPrefix()}voices ${page + 1}\n` +
    `Choose: ${getPrefix()}setvoice voiceName`
  );
}

// ==================================================
// ERROR HANDLER
// ==================================================

function getErrorMessage(error) {
  const message = String(error?.message || '');

  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return 'The speech service timed out. Try again.';
  }

  if (/fetch failed|ECONNRESET|ENOTFOUND/i.test(message)) {
    return 'Could not connect to EliteProTech. Check your internet connection.';
  }

  return message.slice(0, 400) || 'Unknown TTS error.';
}

// ==================================================
// PLUGIN EXPORTS
// ==================================================

export default [

  // ==================================================
  // TEXT TO SPEECH
  // ==================================================

  {
    command: 'tts',
    aliases: ['say', 'speak', 'texttospeech'],
    category: 'ai',
    description: 'Convert text into a WhatsApp voice note',
    cooldown: 10,

    run: async ctx => {
      const input = getText(ctx);

      if (!input) {
        return ctx.reply(
          `╭━━〔 *WATSON TEXT TO SPEECH* 〕━━╮\n` +
          `┃\n` +
          `┃ Usage:\n` +
          `┃ .tts Hello Watson\n` +
          `┃\n` +
          `┃ Custom voice:\n` +
          `┃ .tts Ken Hello Watson\n` +
          `┃\n` +
          `┃ Saved voice:\n` +
          `┃ .setvoice Ken\n` +
          `┃\n` +
          `┃ View voices:\n` +
          `┃ .voices\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
        );
      }

      let voice = getSavedVoice(ctx);
      let text = input;

      try {
        const firstSpace = input.indexOf(' ');

        if (firstSpace > 0) {
          const possibleVoice = input.slice(0, firstSpace);

          const found = await getActualVoice(possibleVoice);

          if (found) {
            voice = found;
            text = input.slice(firstSpace + 1).trim();
          }
        }

        if (!text) {
          return ctx.reply(
            '❌ Please provide text to convert into speech.'
          );
        }

        if (text.length > MAX_TEXT_LENGTH) {
          return ctx.reply(
            `❌ Text is too long. Maximum: ${MAX_TEXT_LENGTH} characters.`
          );
        }

        await ctx.react('🎙️');

        const audio = await generateSpeech(text, voice);

        await sendAudio(ctx, audio, voice);

      } catch (error) {
        console.error('[PRECIOUS TTS]', error);

        await ctx.react('❌');

        await ctx.reply(
          `❌ *TEXT TO SPEECH ERROR*\n\n${getErrorMessage(error)}`
        );
      }
    }
  },

  // ==================================================
  // LIST VOICES
  // ==================================================

  {
    command: 'voices',
    aliases: ['ttsvoices', 'voicelist'],
    category: 'ai',
    description: 'Display available text-to-speech voices',

    run: async ctx => {
      try {
        const pageInput = Number(getText(ctx)) || 1;

        const voices = await getVoices();

        const totalPages = Math.max(
          1,
          Math.ceil(voices.length / 30)
        );

        const page = Math.min(
          totalPages,
          Math.max(1, pageInput)
        );

        await ctx.reply(
          formatVoiceList(voices, page)
        );

      } catch (error) {
        console.error('[TTS VOICES]', error);

        await ctx.reply(
          `❌ Could not retrieve voices.\n\n${getErrorMessage(error)}`
        );
      }
    }
  },

  // ==================================================
  // SET PREFERRED VOICE
  // ==================================================

  {
    command: 'setvoice',
    aliases: ['ttsvoice', 'voice'],
    category: 'ai',
    description: 'Save your preferred TTS voice',

    run: async ctx => {
      const input = getText(ctx);

      if (!input) {
        return ctx.reply(
          `Usage: ${getPrefix()}setvoice BrandonMultilingual\n\n` +
          `Use ${getPrefix()}voices to see available voices.`
        );
      }

      try {
        const voice = await getActualVoice(input);

        if (!voice) {
          return ctx.reply(
            `❌ Unknown voice: ${input}\n\n` +
            `Use ${getPrefix()}voices to view available voices.`
          );
        }

        getOwner(ctx).ttsVoice = voice;

        const { saveDatabase } = await import('../lib/database.js');

        await saveDatabase();

        await ctx.reply(
          `✅ *VOICE SAVED*\n\n` +
          `🎙️ Voice: ${voice}\n\n` +
          `Use ${getPrefix()}tts Hello there`
        );

      } catch (error) {
        console.error('[TTS SETVOICE]', error);

        await ctx.reply(
          `❌ Could not save voice.\n\n${getErrorMessage(error)}`
        );
      }
    }
  },

  // ==================================================
  // MY VOICE
  // ==================================================

  {
    command: 'myvoice',
    aliases: ['getvoice'],
    category: 'ai',
    description: 'Show your selected TTS voice',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *YOUR TTS SETTINGS* 〕━━╮\n` +
        `┃\n` +
        `┃ 🎙️ Voice: ${getSavedVoice(ctx)}\n` +
        `┃\n` +
        `┃ Change voice:\n` +
        `┃ ${getPrefix()}setvoice Ken\n` +
        `┃\n` +
        `┃ Generate speech:\n` +
        `┃ ${getPrefix()}tts Hello Watson\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
      );
    }
  },

  // ==================================================
  // RESET VOICE
  // ==================================================

  {
    command: 'resetvoice',
    aliases: ['defaultvoice'],
    category: 'ai',
    description: 'Reset your preferred voice',

    run: async ctx => {
      getOwner(ctx).ttsVoice = DEFAULT_VOICE;

      try {
        const { saveDatabase } = await import('../lib/database.js');

        await saveDatabase();

        await ctx.reply(
          `✅ Your voice has been reset.\n\n🎙️ Default: ${DEFAULT_VOICE}`
        );

      } catch (error) {
        console.error('[TTS RESET]', error);

        await ctx.reply(
          '❌ Could not save voice settings.'
        );
      }
    }
  },

  // ==================================================
  // TTS HELP
  // ==================================================

  {
    command: 'ttshelp',
    aliases: ['sayhelp'],
    category: 'ai',
    description: 'Show text-to-speech help',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD TTS CENTER* 〕━━╮\n` +
        `┃\n` +
        `┃ 🎙️ .tts Hello\n` +
        `┃    Convert text to voice note\n` +
        `┃\n` +
        `┃ 🎧 .tts Ken Hello\n` +
        `┃    Use a specific voice\n` +
        `┃\n` +
        `┃ 📚 .voices\n` +
        `┃    List available voices\n` +
        `┃\n` +
        `┃ 🎤 .setvoice Ken\n` +
        `┃    Save preferred voice\n` +
        `┃\n` +
        `┃ 🔊 .myvoice\n` +
        `┃    Show selected voice\n` +
        `┃\n` +
        `┃ 🔄 .resetvoice\n` +
        `┃    Restore default voice\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `_Created by Watson Fourpence_`
      );
    }
  }

];
