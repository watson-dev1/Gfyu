
const LANGUAGES = {
  english: 'en',
  shona: 'sn',
  ndebele: 'nd',
  french: 'fr',
  spanish: 'es',
  portuguese: 'pt',
  indonesian: 'id',
  swahili: 'sw',
  german: 'de',
  chinese: 'zh',
  japanese: 'ja',
  arabic: 'ar'
};

async function translate(text, target) {
  const endpoint = process.env.TRANSLATE_API_URL;
  const apiKey = process.env.TRANSLATE_API_KEY || '';

  if (!endpoint) {
    throw new Error('Translation API is not configured.');
  }

  const url = new URL(endpoint);

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Invalid translation API URL.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      q: text,
      source: 'auto',
      target,
      format: 'text',
      ...(apiKey ? { api_key: apiKey } : {})
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    throw new Error(`Translation service returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  const result = data.translatedText || data.translation;

  if (typeof result !== 'string' || !result.trim()) {
    throw new Error('The translation service returned no translated text.');
  }

  return result.trim();
}

export default [
  {
    command: 'translate',
    aliases: ['trt', 'tr'],
    category: 'tools',
    description: 'Translate text into another language',
    run: async ctx => {
      const targetName = (ctx.args[0] || 'english').toLowerCase();
      const target = LANGUAGES[targetName] || targetName;
      const text = ctx.args.slice(1).join(' ').trim();

      if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(target)) {
        return ctx.reply('Invalid target language code.');
      }

      if (!text) {
        return ctx.reply(
          `Usage: ${config.prefix}translate shona Hello, how are you?\n\n` +
          `Languages: ${Object.keys(LANGUAGES).join(', ')}`
        );
      }

      if (text.length > 4000) {
        return ctx.reply('Text is too long. Maximum length is 4000 characters.');
      }

      try {
        const result = await translate(text, target);

        await ctx.reply(
          `🌍 *TRANSLATION*\n\n` +
          `Target: ${targetName}\n\n` +
          `${result}\n\n` +
          `_Powered by PRECIOUS-MD_`
        );
      } catch (error) {
        await ctx.reply(`Translation failed: ${error.message}`);
      }
    }
  },

  {
    command: 'languages',
    aliases: ['langlist'],
    category: 'tools',
    description: 'List supported translation languages',
    run: async ctx => {
      await ctx.reply(
        `🌍 *SUPPORTED LANGUAGES*\n\n` +
        Object.entries(LANGUAGES)
          .map(([name, code]) => `${name}: ${code}`)
          .join('\n')
      );
    }
  }
];
