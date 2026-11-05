
import config from '../config.js';

import {
  askAI,
  isAIConfigured,
  getAIModel
} from '../lib/ai-client.js';

import { saveDatabase } from '../lib/database.js';

// ==================================================
// WATSON AI SETTINGS
// ==================================================

const MAX_PROMPT_LENGTH = 4000;
const MAX_REPLY_LENGTH = 3500;

const MAX_HISTORY = Math.min(
  30,
  Math.max(2, Number(config.aiMaxHistory) || 10)
);

const ELITE_API = 'https://eliteprotech-apis.zone.id';

// ==================================================
// HELPERS
// ==================================================

function getQuestion(ctx) {
  return String(ctx.q || '').trim();
}

function getHistoryOwner(ctx) {
  if (ctx.isGroup) {
    return ctx.group;
  }

  return ctx.user;
}

function trimHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(item =>
      item &&
      ['user', 'assistant'].includes(item.role) &&
      typeof item.content === 'string' &&
      item.content.trim()
    )
    .slice(-MAX_HISTORY);
}

function truncateReply(text) {
  const answer = String(text || '').trim();

  if (answer.length <= MAX_REPLY_LENGTH) {
    return answer;
  }

  return (
    answer.slice(0, MAX_REPLY_LENGTH) +
    '\n\n_Reply shortened._'
  );
}

function isAIEnabled() {
  return config.aiEnabled !== false;
}

function isAIReady() {
  return isAIEnabled() && isAIConfigured();
}

function getAIError(error) {
  const message = String(error?.message || '');

  if (/401|unauthorized|invalid.*key/i.test(message)) {
    return 'AI authentication failed. Check your API configuration.';
  }

  if (/403|forbidden/i.test(message)) {
    return 'EliteProTech denied access to the AI service.';
  }

  if (/404|not found/i.test(message)) {
    return 'AI endpoint was not found. Check your API URL.';
  }

  if (/429|quota|rate.?limit/i.test(message)) {
    return 'Watson AI has reached its request limit. Try again later.';
  }

  if (/timeout|timed out|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return 'Watson AI took too long to respond. Please try again.';
  }

  if (/disabled/i.test(message)) {
    return 'Watson AI is disabled by the bot owner.';
  }

  return message.slice(0, 500) ||
    'Unknown AI error. Please try again.';
}

function getStatusHistory(ctx) {
  const owner = getHistoryOwner(ctx);

  return trimHistory(owner?.aiHistory);
}

function aiUnavailableMessage() {
  if (!isAIEnabled()) {
    return '⚠️ Watson AI is currently disabled by the bot owner.';
  }

  if (!isAIConfigured()) {
    return (
      '⚠️ Watson AI is not configured.\n\n' +
      'Check the EliteProTech API URL and server connection.'
    );
  }

  return '';
}

// ==================================================
// ELITEPROTECH API HELPERS
// ==================================================

async function requestEliteAI(endpoint, params = {}) {
  const url = new URL(`${ELITE_API}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PRECIOUS-MD/3.0'
    },
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    throw new Error(
      `EliteProTech returned HTTP ${response.status}.`
    );
  }

  const data = await response.json();

  if (
    data?.success === false ||
    data?.status === false
  ) {
    throw new Error(
      data?.message ||
      data?.error ||
      'EliteProTech AI rejected the request.'
    );
  }

  const answer = String(
    data?.response ||
    data?.result?.response ||
    data?.result ||
    data?.message ||
    ''
  ).trim();

  if (!answer) {
    throw new Error(
      'EliteProTech returned an empty response.'
    );
  }

  return {
    answer,
    sessionId: data?.session_id || null
  };
}

function getEliteAIError(error) {
  const message = String(error?.message || '');

  if (/timeout|timed out|aborted|fetch failed/i.test(message)) {
    return 'EliteProTech AI is unavailable or taking too long. Try again.';
  }

  return message.slice(0, 500) ||
    'Unknown EliteProTech AI error.';
}

function getAsyntaiSession(ctx) {
  ctx.user.asyntaiSession ||= null;

  return ctx.user.asyntaiSession;
}

async function saveAsyntaiSession(ctx, sessionId) {
  if (!sessionId) return;

  ctx.user.asyntaiSession = sessionId;

  await saveDatabase();
}

// ==================================================
// DATABASE HISTORY
// ==================================================

async function updateHistory(
  ctx,
  history,
  question,
  answer
) {
  const owner = getHistoryOwner(ctx);

  owner.aiHistory = [
    ...history,
    {
      role: 'user',
      content: question
    },
    {
      role: 'assistant',
      content: String(answer)
    }
  ].slice(-MAX_HISTORY);

  await saveDatabase();
}

async function clearHistory(ctx) {
  const owner = getHistoryOwner(ctx);

  owner.aiHistory = [];

  await saveDatabase();
}

// ==================================================
// WATSON AI REQUEST
// ==================================================

async function generateAnswer(ctx, question) {
  const history = getStatusHistory(ctx);

  const answer = await askAI(
    question,
    history
  );

  if (
    !answer ||
    !String(answer).trim()
  ) {
    throw new Error(
      'Watson AI returned an empty response.'
    );
  }

  await updateHistory(
    ctx,
    history,
    question,
    answer
  );

  return answer;
}

// ==================================================
// PLUGINS
// ==================================================

export default [

  // ==================================================
  // ASK WATSON AI
  // ==================================================

  {
    command: 'ai',
    aliases: ['ask', 'watsonai', 'gpt'],
    category: 'ai',
    description: 'Ask Watson AI anything',
    cooldown: 5,

    run: async ctx => {
      const question = getQuestion(ctx);

      if (!question) {
        return ctx.reply(
          `╭━━〔 *WATSON AI* 〕━━╮\n` +
          `┃\n` +
          `┃ 🤖 Ask me anything.\n` +
          `┃\n` +
          `┃ Usage:\n` +
          `┃ ${config.prefix}ai your question\n` +
          `┃\n` +
          `┃ Example:\n` +
          `┃ ${config.prefix}ai Explain JavaScript promises.\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━╯`
        );
      }

      if (question.length > MAX_PROMPT_LENGTH) {
        return ctx.reply(
          `❌ Your question is too long.\n` +
          `Maximum: ${MAX_PROMPT_LENGTH} characters.`
        );
      }

      const unavailable = aiUnavailableMessage();

      if (unavailable) {
        return ctx.reply(unavailable);
      }

      try {
        await ctx.react('🤖');

        const answer = await generateAnswer(
          ctx,
          question
        );

        await ctx.reply(
          `🤖 *WATSON AI*\n\n` +
          `${truncateReply(answer)}\n\n` +
          `_Powered by Watson XD | PRECIOUS-MD_`
        );

        await ctx.react('✅');

      } catch (error) {
        console.error('[WATSON AI]', error);

        await ctx.reply(
          `❌ *WATSON AI ERROR*\n\n${getAIError(error)}`
        );

        await ctx.react('❌');
      }
    }
  },

  // ==================================================
  // ELITEPROTECH TALKAI
  // ==================================================

  {
    command: 'talkai',
    aliases: ['talk', 'elitechat'],
    category: 'ai',
    description: 'Chat with EliteProTech TalkAI',
    cooldown: 3,

    run: async ctx => {
      const question = getQuestion(ctx);

      if (!question) {
        return ctx.reply(
          `🤖 *ELITE TALKAI*\n\n` +
          `Usage: ${config.prefix}talkai Hi\n\n` +
          `Ask TalkAI anything.`
        );
      }

      if (question.length > MAX_PROMPT_LENGTH) {
        return ctx.reply(
          `❌ Your question is too long.\n` +
          `Maximum: ${MAX_PROMPT_LENGTH} characters.`
        );
      }

      try {
        await ctx.react('🤖');

        const result = await requestEliteAI(
          '/ai/talkai',
          { q: question }
        );

        await ctx.reply(
          `🤖 *ELITE TALKAI*\n\n` +
          `${truncateReply(result.answer)}\n\n` +
          `_Powered by EliteProTech | PRECIOUS-MD_`
        );

        await ctx.react('✅');

      } catch (error) {
        console.error('[TALKAI]', error);

        await ctx.reply(
          `❌ *TALKAI ERROR*\n\n${getEliteAIError(error)}`
        );

        await ctx.react('❌');
      }
    }
  },

  // ==================================================
  // ELITEPROTECH ASYNTAI
  // ==================================================

  {
    command: 'asyntai',
    aliases: ['asyn', 'asyntchat'],
    category: 'ai',
    description: 'Chat with Asyntai AI',
    cooldown: 3,

    run: async ctx => {
      const question = getQuestion(ctx);

      if (!question) {
        return ctx.reply(
          `🧠 *ASYNTAI AI*\n\n` +
          `Usage: ${config.prefix}asyntai Hi\n\n` +
          `Your session ID is saved for follow-up messages.\n\n` +
          `Reset: ${config.prefix}asyntaireset`
        );
      }

      if (question.length > MAX_PROMPT_LENGTH) {
        return ctx.reply(
          `❌ Your question is too long.\n` +
          `Maximum: ${MAX_PROMPT_LENGTH} characters.`
        );
      }

      try {
        await ctx.react('🧠');

        const sessionId = getAsyntaiSession(ctx);

        const result = await requestEliteAI(
          '/ai/asyntai',
          {
            prompt: question,
            session_id: sessionId
          }
        );

        if (result.sessionId) {
          await saveAsyntaiSession(
            ctx,
            result.sessionId
          );
        }

        await ctx.reply(
          `🧠 *ASYNTAI AI*\n\n` +
          `${truncateReply(result.answer)}\n\n` +
          `_Session: ${result.sessionId || sessionId || 'New session'}_\n` +
          `_Powered by EliteProTech | PRECIOUS-MD_`
        );

        await ctx.react('✅');

      } catch (error) {
        console.error('[ASYNTAI]', error);

        await ctx.reply(
          `❌ *ASYNTAI ERROR*\n\n${getEliteAIError(error)}`
        );

        await ctx.react('❌');
      }
    }
  },

  // ==================================================
  // RESET ASYNTAI SESSION
  // ==================================================

  {
    command: 'asyntaireset',
    aliases: ['resetasyntai'],
    category: 'ai',
    description: 'Reset your Asyntai conversation session',

    run: async ctx => {
      try {
        ctx.user.asyntaiSession = null;

        await saveDatabase();

        await ctx.reply(
          `✅ *ASYNTAI SESSION RESET*\n\n` +
          `Your previous conversation session has been cleared.\n\n` +
          `Start again:\n` +
          `${config.prefix}asyntai Hi`
        );

      } catch (error) {
        console.error('[ASYNTAI RESET]', error);

        await ctx.reply(
          '❌ Could not reset your Asyntai session.'
        );
      }
    }
  },

  // ==================================================
  // AUTOMATIC PRIVATE AI CHAT
  // ==================================================

  {
    command: 'aichat',
    aliases: ['autochat'],
    category: 'ai',
    description: 'Enable or disable private automatic AI replies',

    run: async ctx => {
      const mode = getQuestion(ctx).toLowerCase();

      if (!['on', 'off'].includes(mode)) {
        return ctx.reply(
          `╭━━〔 *AUTOMATIC AI CHAT* 〕━━╮\n` +
          `┃\n` +
          `┃ Enable: ${config.prefix}aichat on\n` +
          `┃ Disable: ${config.prefix}aichat off\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
        );
      }

      if (ctx.isGroup) {
        return ctx.reply(
          'Use this command in a private chat. For groups, use .aigroup on/off.'
        );
      }

      if (mode === 'on' && !isAIReady()) {
        return ctx.reply(aiUnavailableMessage());
      }

      ctx.user.aiChat = mode === 'on';

      await saveDatabase();

      await ctx.reply(
        mode === 'on'
          ? '✅ Automatic Watson AI replies enabled in your private chat.'
          : '❌ Automatic Watson AI replies disabled.'
      );
    }
  },

  // ==================================================
  // AUTOMATIC GROUP AI CHAT
  // ==================================================

  {
    command: 'aigroup',
    aliases: ['groupai'],
    category: 'ai',
    description: 'Enable or disable group AI replies',

    run: async ctx => {
      const mode = getQuestion(ctx).toLowerCase();

      if (!ctx.isGroup) {
        return ctx.reply(
          '❌ This command only works in groups.'
        );
      }

      if (!['on', 'off'].includes(mode)) {
        return ctx.reply(
          `╭━━〔 *GROUP AI CHAT* 〕━━╮\n` +
          `┃\n` +
          `┃ Enable: ${config.prefix}aigroup on\n` +
          `┃ Disable: ${config.prefix}aigroup off\n` +
          `┃\n` +
          `┃ Watson responds when mentioned\n` +
          `┃ or quoted.\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━╯`
        );
      }

      if (mode === 'on' && !isAIReady()) {
        return ctx.reply(aiUnavailableMessage());
      }

      ctx.group.aiChat = mode === 'on';

      await saveDatabase();

      await ctx.reply(
        mode === 'on'
          ? '✅ Watson AI enabled in this group. Mention or quote the bot to talk to it.'
          : '❌ Watson AI disabled in this group.'
      );
    }
  },

  // ==================================================
  // AI STATUS
  // ==================================================

  {
    command: 'aistatus',
    aliases: ['aiinfo'],
    category: 'ai',
    description: 'Show Watson AI configuration status',

    run: async ctx => {
      const enabled = isAIEnabled();
      const configured = isAIConfigured();

      const model = getAIModel();

      const history = getStatusHistory(ctx);

      const autoChat = ctx.isGroup
        ? Boolean(ctx.group.aiChat)
        : Boolean(ctx.user.aiChat);

      const historyType = ctx.isGroup
        ? 'Group'
        : 'Private';

      await ctx.reply(
        `╭━━〔 *WATSON AI STATUS* 〕━━╮\n` +
        `┃\n` +
        `┃ 🤖 AI system: ${enabled ? 'ENABLED' : 'DISABLED'}\n` +
        `┃ 🌐 API: ${configured ? 'CONFIGURED' : 'NOT CONFIGURED'}\n` +
        `┃ 🧠 Provider: EliteProTech\n` +
        `┃ ⚙️ Model: ${model}\n` +
        `┃ 💬 Automatic chat: ${autoChat ? 'ON' : 'OFF'}\n` +
        `┃ 📚 History type: ${historyType}\n` +
        `┃ 📝 Saved messages: ${history.length}\n` +
        `┃ 👑 Creator: ${config.ownerName || 'Watson Fourpence'}\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯`
      );
    }
  },

  // ==================================================
  // CLEAR AI HISTORY
  // ==================================================

  {
    command: 'aiclear',
    aliases: ['clearai'],
    category: 'ai',
    description: 'Clear AI conversation history',

    run: async ctx => {
      try {
        await clearHistory(ctx);

        await ctx.reply(
          ctx.isGroup
            ? '🧹 This group Watson AI conversation history has been cleared.'
            : '🧹 Your Watson AI conversation history has been cleared.'
        );

      } catch (error) {
        console.error('[AI CLEAR]', error);

        await ctx.reply(
          '❌ Could not clear AI history.'
        );
      }
    }
  },

  // ==================================================
  // FORGET AI HISTORY
  // ==================================================

  {
    command: 'aiforget',
    aliases: ['forgetai'],
    category: 'ai',
    description: 'Remove saved AI conversation history',

    run: async ctx => {
      try {
        await clearHistory(ctx);

        await ctx.reply(
          '✅ Saved Watson AI conversation history has been removed.'
        );

      } catch (error) {
        console.error('[AI FORGET]', error);

        await ctx.reply(
          '❌ Could not remove AI history.'
        );
      }
    }
  },

  // ==================================================
  // AI HELP
  // ==================================================

  {
    command: 'aihelp',
    aliases: ['helpai'],
    category: 'ai',
    description: 'Show Watson AI commands',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD AI CENTER* 〕━━╮\n` +
        `┃\n` +
        `┃ 🤖 .ai <question>\n` +
        `┃    Ask Watson AI anything\n` +
        `┃\n` +
        `┃ 🌐 .talkai <question>\n` +
        `┃    EliteProTech TalkAI\n` +
        `┃\n` +
        `┃ 🧠 .asyntai <question>\n` +
        `┃    Asyntai conversation AI\n` +
        `┃\n` +
        `┃ 🔄 .asyntaireset\n` +
        `┃    Reset Asyntai session\n` +
        `┃\n` +
        `┃ 💬 .aichat on/off\n` +
        `┃    Automatic private AI chat\n` +
        `┃\n` +
        `┃ 👥 .aigroup on/off\n` +
        `┃    Automatic group AI chat\n` +
        `┃\n` +
        `┃ 📊 .aistatus\n` +
        `┃    Check AI configuration\n` +
        `┃\n` +
        `┃ 🧹 .aiclear\n` +
        `┃    Clear conversation history\n` +
        `┃\n` +
        `┃ ❌ .aiforget\n` +
        `┃    Remove saved AI history\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `_Created by Watson Fourpence_`
      );
    }
  }

];
