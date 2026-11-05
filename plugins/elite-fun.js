
import { URLSearchParams } from 'node:url';

// ==================================================
// ELITEPROTECH API CONFIGURATION
// ==================================================

const API_BASE = 'https://eliteprotech-apis.zone.id';

const API = {
  insult: `${API_BASE}/fun/insult`,
  font: `${API_BASE}/fun/font`,
  image: `${API_BASE}/image/image`,
  flux: `${API_BASE}/image/flux`
};

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

// ==================================================
// HELPERS
// ==================================================

function getQuoted(ctx) {
  return ctx.msg || ctx.message || ctx.quoted;
}

function getSocket(ctx) {
  return ctx.sock || ctx.conn || ctx.socket;
}

function getChat(ctx) {
  return ctx.chat || ctx.jid || ctx.from;
}

function getResult(data) {
  return data?.result ??
    data?.data ??
    data?.response ??
    data?.output ??
    data;
}

function findText(value, depth = 0) {
  if (depth > 6 || value == null) return '';

  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findText(item, depth + 1);
      if (result) return result;
    }

    return '';
  }

  if (typeof value === 'object') {
    const preferredKeys = [
      'text',
      'message',
      'insult',
      'font',
      'styled',
      'result',
      'output',
      'response',
      'data'
    ];

    for (const key of preferredKeys) {
      if (value[key] !== undefined) {
        const result = findText(value[key], depth + 1);
        if (result) return result;
      }
    }

    for (const item of Object.values(value)) {
      const result = findText(item, depth + 1);
      if (result) return result;
    }
  }

  return '';
}

function findImage(value, depth = 0) {
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
      const result = findImage(item, depth + 1);
      if (result) return result;
    }

    return null;
  }

  if (typeof value === 'object') {
    const keys = [
      'image',
      'imageUrl',
      'image_url',
      'url',
      'download',
      'link',
      'result',
      'output',
      'data',
      'images'
    ];

    for (const key of keys) {
      if (value[key] !== undefined) {
        const result = findImage(value[key], depth + 1);
        if (result) return result;
      }
    }

    for (const item of Object.values(value)) {
      const result = findImage(item, depth + 1);
      if (result) return result;
    }
  }

  return null;
}

function findBase64(value, depth = 0) {
  if (depth > 7 || value == null) return null;

  if (typeof value === 'string') {
    const input = value.trim();

    const match = input.match(
      /^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i
    );

    if (match) {
      return {
        mime: `image/${match[1]}`,
        data: match[2]
      };
    }

    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findBase64(item, depth + 1);
      if (result) return result;
    }

    return null;
  }

  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (
        ['base64', 'imageBase64', 'image_base64'].includes(key) &&
        typeof item === 'string'
      ) {
        return {
          mime: value.mimeType || value.mime || 'image/png',
          data: item
        };
      }

      const result = findBase64(item, depth + 1);
      if (result) return result;
    }
  }

  return null;
}

// ==================================================
// API REQUEST
// ==================================================

async function requestAPI(endpoint, params = {}) {
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
    signal: AbortSignal.timeout(90000)
  });

  if (!response.ok) {
    throw new Error(
      `API request failed: HTTP ${response.status}`
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

  if (
    contentType.includes('image/') ||
    contentType.includes('application/octet-stream')
  ) {
    return {
      type: 'binary',
      buffer,
      mime: contentType || 'image/png'
    };
  }

  let data;

  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error(
      'The API returned an unsupported response.'
    );
  }

  if (data?.status === false) {
    throw new Error(
      findText(data.message || data.error || data.result) ||
      'The API could not process your request.'
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

async function downloadImage(url) {
  if (url.startsWith('data:image/')) {
    const base64 = url.split(',')[1];

    if (!base64) {
      throw new Error('Invalid base64 image.');
    }

    const buffer = Buffer.from(base64, 'base64');

    if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
      throw new Error('Invalid or oversized image.');
    }

    return buffer;
  }

  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Unsupported image URL.');
  }

  const response = await fetch(parsed, {
    headers: {
      'User-Agent': 'PRECIOUS-MD/3.0'
    },
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    throw new Error(
      `Image download failed: HTTP ${response.status}`
    );
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
// GENERIC IMAGE API HANDLER
// ==================================================

async function generateImage(ctx, endpoint, params, caption) {
  const response = await requestAPI(endpoint, params);

  if (response.type === 'binary') {
    return sendImage(
      ctx,
      response.buffer,
      caption
    );
  }

  const data = response.data;
  const result = getResult(data);

  const base64 = findBase64(result);

  if (base64) {
    const buffer = Buffer.from(
      base64.data,
      'base64'
    );

    if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
      throw new Error('Generated image is invalid or too large.');
    }

    return sendImage(ctx, buffer, caption);
  }

  const imageUrl = findImage(result);

  if (!imageUrl) {
    const message = findText(result);

    throw new Error(
      message || 'The API did not return an image.'
    );
  }

  const buffer = await downloadImage(imageUrl);

  return sendImage(ctx, buffer, caption);
}

// ==================================================
// ERROR HANDLER
// ==================================================

async function handleError(ctx, error, command) {
  console.error(`[PRECIOUS ${command.toUpperCase()}]`, error);

  let message = error.message || 'Unknown error';

  if (
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('aborted')
  ) {
    message =
      'The API is taking too long or is temporarily unavailable. Try again later.';
  }

  await ctx.reply(
    `❌ *${command.toUpperCase()} ERROR*\n\n${message}`
  );
}

// ==================================================
// EXPORT PLUGINS
// ==================================================

export default [

  // ==================================================
  // INSULT
  // ==================================================

  {
    command: 'insult',
    aliases: ['roast', 'randominsult'],
    category: 'fun',
    description: 'Generate a random insult',

    run: async ctx => {
      try {
        await ctx.react?.('🔥');

        const response = await requestAPI(
          API.insult
        );

        const insult = findText(
          getResult(response.data)
        );

        if (!insult) {
          throw new Error(
            'The API did not return an insult.'
          );
        }

        await ctx.reply(
          `🔥 *PRECIOUS-MD INSULT GENERATOR*\n\n` +
          `${insult}\n\n` +
          `_Powered by EliteProTech_`
        );
      } catch (error) {
        await handleError(ctx, error, 'insult');
      }
    }
  },

  // ==================================================
  // FONT GENERATOR
  // ==================================================

  {
    command: 'font',
    aliases: ['fonts', 'fancyfont', 'styletext'],
    category: 'fun',
    description: 'Convert text into stylish fonts',

    run: async ctx => {
      try {
        const text = String(ctx.q || '').trim();

        if (!text) {
          return ctx.reply(
            `✍️ *FONT GENERATOR*\n\n` +
            `Usage: ${config.prefix || '.'}font Watson Fourpence\n\n` +
            `Example:\n` +
            `${config.prefix || '.'}font PRECIOUS-MD`
          );
        }

        if (text.length > 500) {
          return ctx.reply(
            'Please keep your text below 500 characters.'
          );
        }

        await ctx.react?.('✨');

        const response = await requestAPI(
          API.font,
          { text }
        );

        const result = getResult(response.data);
        const output = findText(result);

        if (!output) {
          throw new Error(
            'The font API returned no styled text.'
          );
        }

        await ctx.reply(
          `✨ *PRECIOUS-MD FONT GENERATOR*\n\n` +
          `${output}\n\n` +
          `_Powered by EliteProTech_`
        );
      } catch (error) {
        await handleError(ctx, error, 'font');
      }
    }
  },

  // ==================================================
  // IMAGE SEARCH / GENERATION
  // ==================================================

  {
    command: 'image',
    aliases: ['img', 'imagegen'],
    category: 'media',
    description: 'Generate or find an image using a search query',

    run: async ctx => {
      try {
        const query = String(ctx.q || '').trim();

        if (!query) {
          return ctx.reply(
            `🖼️ *IMAGE GENERATOR*\n\n` +
            `Usage: ${config.prefix || '.'}image beautiful sunset\n\n` +
            `Example:\n` +
            `${config.prefix || '.'}image anime girl`
          );
        }

        if (query.length > 500) {
          return ctx.reply(
            'Your image query is too long. Maximum: 500 characters.'
          );
        }

        await ctx.react?.('🎨');

        await generateImage(
          ctx,
          API.image,
          { q: query },
          `🖼️ *PRECIOUS-MD IMAGE*\n\n` +
          `Prompt: ${query}\n\n` +
          `_Powered by EliteProTech_`
        );
      } catch (error) {
        await handleError(ctx, error, 'image');
      }
    }
  },

  // ==================================================
  // FLUX AI IMAGE GENERATOR
  // ==================================================

  {
    command: 'flux',
    aliases: ['fluxai', 'aiimage'],
    category: 'media',
    description: 'Generate AI images using Flux',

    run: async ctx => {
      try {
        const prompt = String(ctx.q || '').trim();

        if (!prompt) {
          return ctx.reply(
            `🎨 *FLUX AI IMAGE GENERATOR*\n\n` +
            `Usage: ${config.prefix || '.'}flux a futuristic city at night\n\n` +
            `Example:\n` +
            `${config.prefix || '.'}flux a beautiful cinematic anime landscape`
          );
        }

        if (prompt.length > 1000) {
          return ctx.reply(
            'Your prompt is too long. Maximum: 1000 characters.'
          );
        }

        await ctx.react?.('🎨');

        await generateImage(
          ctx,
          API.flux,
          { prompt },
          `🎨 *PRECIOUS-MD FLUX AI*\n\n` +
          `Prompt: ${prompt}\n\n` +
          `_Generated by EliteProTech_`
        );
      } catch (error) {
        await handleError(ctx, error, 'flux');
      }
    }
  }

];
