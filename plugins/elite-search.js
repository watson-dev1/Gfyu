
import config from '../config.js';

// ==================================================
// ELITEPROTECH SEARCH & TOOLS
// PRECIOUS-MD v3
// ==================================================

const BASE_URL = 'https://eliteprotech-apis.zone.id';

const ENDPOINTS = {
  getpp: `${BASE_URL}/tools/getpp`,
  tiktok: `${BASE_URL}/search/tiktokstalk`,
  lyrics: `${BASE_URL}/search/lyrics`,
  bible: `${BASE_URL}/search/bible`
};

const TIMEOUT = 60000;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

// ==================================================
// CONTEXT HELPERS
// ==================================================

function getSocket(ctx) {
  return ctx.sock || ctx.conn || ctx.socket;
}

function getChat(ctx) {
  return ctx.chat || ctx.jid || ctx.from;
}

function getQuoted(ctx) {
  return ctx.msg || ctx.message || ctx.quoted;
}

function getPrefix() {
  return config.prefix || '.';
}

// ==================================================
// RESPONSE HELPERS
// ==================================================

function getResult(data) {
  return (
    data?.result ??
    data?.data ??
    data?.response ??
    data?.output ??
    data
  );
}

function isSuccess(data) {
  return data?.status !== false &&
    data?.success !== false;
}

function extractText(value, depth = 0) {
  if (depth > 7 || value == null) return '';

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map(item => extractText(item, depth + 1))
      .filter(Boolean)
      .join('\n\n');
  }

  if (typeof value === 'object') {
    const keys = [
      'text',
      'lyrics',
      'verse',
      'message',
      'answer',
      'content',
      'description',
      'bio',
      'nickname',
      'username',
      'title',
      'result',
      'data'
    ];

    const output = [];

    for (const key of keys) {
      if (value[key] !== undefined) {
        const result = extractText(
          value[key],
          depth + 1
        );

        if (result && !output.includes(result)) {
          output.push(result);
        }
      }
    }

    if (output.length) {
      return output.join('\n\n');
    }

    return Object.entries(value)
      .filter(([key]) =>
        !['status', 'success', 'creator'].includes(key)
      )
      .map(([key, item]) => {
        const result = extractText(item, depth + 1);

        return result
          ? `*${key}:* ${result}`
          : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return String(value);
}

function extractImage(value, depth = 0) {
  if (depth > 7 || value == null) return null;

  if (typeof value === 'string') {
    const input = value.trim();

    if (
      /^https?:\/\/\S+/i.test(input) ||
      /^data:image\/[a-z0-9.+-]+;base64,/i.test(input)
    ) {
      return input;
    }

    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractImage(item, depth + 1);

      if (found) return found;
    }

    return null;
  }

  if (typeof value === 'object') {
    const keys = [
      'image',
      'imageUrl',
      'image_url',
      'profile',
      'profilePicture',
      'profile_pic',
      'avatar',
      'url',
      'download',
      'result',
      'data'
    ];

    for (const key of keys) {
      if (value[key] !== undefined) {
        const found = extractImage(
          value[key],
          depth + 1
        );

        if (found) return found;
      }
    }

    for (const item of Object.values(value)) {
      const found = extractImage(item, depth + 1);

      if (found) return found;
    }
  }

  return null;
}

// ==================================================
// API REQUEST
// ==================================================

async function callAPI(endpoint, params = {}) {
  const url = new URL(endpoint);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, image/*, */*',
      'User-Agent': 'PRECIOUS-MD/3.0'
    },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(
      `EliteProTech returned HTTP ${response.status}.`
    );
  }

  const contentType =
    response.headers.get('content-type') || '';

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('API response is too large.');
  }

  if (contentType.startsWith('image/')) {
    return {
      type: 'image',
      buffer,
      mime: contentType
    };
  }

  let data;

  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error(
      'EliteProTech returned an invalid response.'
    );
  }

  if (!isSuccess(data)) {
    throw new Error(
      extractText(
        data.message ||
        data.error ||
        data.result
      ) || 'The API rejected the request.'
    );
  }

  return {
    type: 'json',
    data
  };
}

// ==================================================
// IMAGE DOWNLOAD
// ==================================================

async function downloadImage(imageUrl) {
  if (imageUrl.startsWith('data:image/')) {
    const base64 = imageUrl.split(',')[1];

    if (!base64) {
      throw new Error('Invalid image data.');
    }

    const buffer = Buffer.from(base64, 'base64');

    if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
      throw new Error('Invalid or oversized image.');
    }

    return buffer;
  }

  const parsed = new URL(imageUrl);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Unsupported image URL.');
  }

  const response = await fetch(parsed, {
    headers: {
      'User-Agent': 'PRECIOUS-MD/3.0'
    },
    signal: AbortSignal.timeout(TIMEOUT)
  });

  if (!response.ok) {
    throw new Error('Could not download the image.');
  }

  const contentType =
    response.headers.get('content-type') || '';

  if (!contentType.startsWith('image/')) {
    throw new Error('The returned URL is not an image.');
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('Image is empty or too large.');
  }

  return buffer;
}

// ==================================================
// SEND IMAGE
// ==================================================

async function sendImage(ctx, buffer, caption) {
  const sock = getSocket(ctx);
  const chat = getChat(ctx);

  if (!sock || !chat) {
    throw new Error('WhatsApp connection is unavailable.');
  }

  return sock.sendMessage(
    chat,
    {
      image: buffer,
      caption
    },
    {
      quoted: getQuoted(ctx)
    }
  );
}

// ==================================================
// SEND API IMAGE RESPONSE
// ==================================================

async function sendAPIImage(ctx, response, caption) {
  if (response.type === 'image') {
    return sendImage(
      ctx,
      response.buffer,
      caption
    );
  }

  const result = getResult(response.data);
  const imageUrl = extractImage(result);

  if (!imageUrl) {
    throw new Error(
      extractText(result) ||
      'The API did not return an image.'
    );
  }

  const buffer = await downloadImage(imageUrl);

  return sendImage(ctx, buffer, caption);
}

// ==================================================
// SEND TEXT RESPONSE
// ==================================================

async function sendTextResult(ctx, response, title) {
  if (response.type !== 'json') {
    throw new Error('Expected a text response.');
  }

  const result = getResult(response.data);
  const output = extractText(result);

  if (!output) {
    throw new Error('The API returned no readable result.');
  }

  await ctx.reply(
    `${title}\n\n${output}\n\n` +
    `_Powered by EliteProTech | PRECIOUS-MD_`
  );
}

// ==================================================
// ERROR HANDLER
// ==================================================

async function handleError(ctx, command, error) {
  console.error(
    `[PRECIOUS ${command.toUpperCase()}]`,
    error
  );

  let message = error.message || 'Unknown error';

  if (
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('aborted')
  ) {
    message =
      'The API is unavailable or taking too long. Please try again.';
  }

  await ctx.reply(
    `❌ *${command.toUpperCase()} ERROR*\n\n${message}`
  );
}

// ==================================================
// COMMAND INPUT
// ==================================================

function getInput(ctx) {
  return String(ctx.q || '').trim();
}

// ==================================================
// PLUGINS
// ==================================================

export default [

  // --------------------------------------------------
  // WHATSAPP PROFILE PICTURE
  // --------------------------------------------------

  {
    command: 'getpp',
    aliases: ['whatsappdp', 'profilepic'],
    category: 'tools',
    description: 'Generate or retrieve a WhatsApp profile picture',

    run: async ctx => {
      try {
        const number = getInput(ctx).replace(/[^\d]/g, '');

        if (!number) {
          return ctx.reply(
            `👤 *WHATSAPP PROFILE PICTURE*\n\n` +
            `Usage: ${getPrefix()}getpp 263771234567\n\n` +
            `Enter a WhatsApp number with country code.`
          );
        }

        if (number.length < 7 || number.length > 15) {
          return ctx.reply(
            'Please enter a valid international phone number.'
          );
        }

        await ctx.react?.('🖼️');

        const response = await callAPI(
          ENDPOINTS.getpp,
          { number }
        );

        await sendAPIImage(
          ctx,
          response,
          `👤 *WHATSAPP PROFILE PICTURE*\n\n` +
          `Number: ${number}\n` +
          `_Powered by EliteProTech_`
        );

      } catch (error) {
        await handleError(ctx, 'getpp', error);
      }
    }
  },

  // --------------------------------------------------
  // TIKTOK STALK
  // --------------------------------------------------

  {
    command: 'tiktokstalk',
    aliases: ['ttstalk', 'tiktokinfo'],
    category: 'tools',
    description: 'Get TikTok account information',

    run: async ctx => {
      try {
        const username = getInput(ctx)
          .replace(/^@/, '')
          .trim();

        if (!username) {
          return ctx.reply(
            `🎵 *TIKTOK STALK*\n\n` +
            `Usage: ${getPrefix()}tiktokstalk username\n\n` +
            `Example: ${getPrefix()}tiktokstalk tiktok`
          );
        }

        await ctx.react?.('🔎');

        const response = await callAPI(
          ENDPOINTS.tiktok,
          { username }
        );

        const result = getResult(response.data);
        const profileImage = extractImage(result);

        if (profileImage) {
          const buffer = await downloadImage(profileImage);

          const sock = getSocket(ctx);
          const chat = getChat(ctx);

          await sock.sendMessage(
            chat,
            {
              image: buffer,
              caption:
                `🎵 *TIKTOK PROFILE*\n\n` +
                `${extractText(result) || `Username: @${username}`}\n\n` +
                `_Powered by EliteProTech_`
            },
            {
              quoted: getQuoted(ctx)
            }
          );
        } else {
          await sendTextResult(
            ctx,
            response,
            '🎵 *TIKTOK PROFILE INFORMATION*'
          );
        }

      } catch (error) {
        await handleError(ctx, 'tiktokstalk', error);
      }
    }
  },

  // --------------------------------------------------
  // SONG LYRICS
  // --------------------------------------------------

  {
    command: 'lyrics',
    aliases: ['lyric', 'songlyrics'],
    category: 'media',
    description: 'Search for song lyrics',

    run: async ctx => {
      try {
        const query = getInput(ctx);

        if (!query) {
          return ctx.reply(
            `🎶 *LYRICS SEARCH*\n\n` +
            `Usage: ${getPrefix()}lyrics song title\n\n` +
            `Example: ${getPrefix()}lyrics Faded Alan Walker`
          );
        }

        if (query.length > 200) {
          return ctx.reply(
            'Your song search is too long.'
          );
        }

        await ctx.react?.('🎶');

        const response = await callAPI(
          ENDPOINTS.lyrics,
          { q: query }
        );

        await sendTextResult(
          ctx,
          response,
          `🎶 *LYRICS SEARCH*\n\nSong: ${query}`
        );

      } catch (error) {
        await handleError(ctx, 'lyrics', error);
      }
    }
  },

  // --------------------------------------------------
  // BIBLE SEARCH
  // --------------------------------------------------

  {
    command: 'bible',
    aliases: ['verse', 'bibleverse'],
    category: 'utility',
    description: 'Search Bible verses and passages',

    run: async ctx => {
      try {
        const query = getInput(ctx);

        if (!query) {
          return ctx.reply(
            `📖 *BIBLE SEARCH*\n\n` +
            `Usage: ${getPrefix()}bible John 3:16\n\n` +
            `Examples:\n` +
            `${getPrefix()}bible Psalm 23\n` +
            `${getPrefix()}bible Romans 8:28`
          );
        }

        if (query.length > 200) {
          return ctx.reply(
            'Your Bible search is too long.'
          );
        }

        await ctx.react?.('📖');

        const response = await callAPI(
          ENDPOINTS.bible,
          { q: query }
        );

        await sendTextResult(
          ctx,
          response,
          `📖 *BIBLE SEARCH*\n\nReference: ${query}`
        );

      } catch (error) {
        await handleError(ctx, 'bible', error);
      }
    }
  }

];
