
import {
  getAutomationSettings,
  setAutomation
} from '../lib/automation.js';

// --------------------------------------------------
// AUTOMATION COMMAND DEFINITIONS
// --------------------------------------------------

const commands = [
  {
    command: 'autoread',
    setting: 'autoread',
    description: 'Automatically read incoming messages',
    aliases: ['readmsg']
  },
  {
    command: 'alwaysonline',
    setting: 'alwaysonline',
    description: 'Keep the bot online',
    aliases: ['online']
  },
  {
    command: 'autostatus',
    setting: 'autostatus',
    description: 'Automatically view statuses',
    aliases: ['statusview']
  },
  {
    command: 'statusreact',
    setting: 'statusreact',
    description: 'Automatically react to statuses',
    aliases: ['statuslike']
  },
  {
    command: 'autoreact',
    setting: 'autoreact',
    description: 'Automatically react to incoming messages',
    aliases: ['reactmsg']
  },
  {
    command: 'anticall',
    setting: 'anticall',
    description: 'Reject incoming WhatsApp calls',
    aliases: ['callblock']
  },
  {
    command: 'autotyping',
    setting: 'autotyping',
    description: 'Show typing while processing messages',
    aliases: ['typing']
  },
  {
    command: 'autorecording',
    setting: 'autorecording',
    description: 'Show recording while processing audio',
    aliases: ['recording']
  },
  {
    command: 'viewonce',
    setting: 'viewonce',
    description: 'Detect view-once messages',
    aliases: ['viewoncecheck']
  }
];

const descriptions = Object.fromEntries(
  commands.map(item => [
    item.setting,
    item.description
  ])
);

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function isOwner(ctx) {
  return Boolean(ctx?.isOwner);
}

function getPrefix(ctx) {
  return ctx?.prefix || '.';
}

function parseMode(value) {
  const mode = String(value || '')
    .trim()
    .toLowerCase();

  if ([
    'on',
    'enable',
    'enabled',
    'yes',
    'true'
  ].includes(mode)) {
    return true;
  }

  if ([
    'off',
    'disable',
    'disabled',
    'no',
    'false'
  ].includes(mode)) {
    return false;
  }

  return null;
}

function statusText(enabled) {
  return enabled ? 'ON ✅' : 'OFF ❌';
}

async function ownerOnly(ctx) {
  if (isOwner(ctx)) {
    return true;
  }

  await ctx.reply(
    '❌ Only the bot owner can manage automation settings.'
  );

  return false;
}

function getSettingDescription(setting) {
  return descriptions[setting] || 'Automation setting';
}

function automationHeader(title) {
  return `╭━━〔 ${title} 〕\n┃`;
}

function automationFooter() {
  return '╰━━━━━━━━━━━━';
}

function findSetting(value) {
  const setting = String(value || '')
    .trim()
    .toLowerCase();

  return commands.find(item =>
    item.setting === setting ||
    item.command === setting ||
    item.aliases.includes(setting)
  );
}

async function changeSetting(ctx, item, enabled) {
  try {
    await setAutomation(item.setting, enabled);

    return ctx.reply(
      `${automationHeader(item.command.toUpperCase())}\n` +
      `┃\n` +
      `┃ ${item.description}\n` +
      `┃ Status: ${statusText(enabled)}\n` +
      `┃\n` +
      `${automationFooter()}`
    );
  } catch (error) {
    console.error('[AUTOMATION COMMAND]', error);

    return ctx.reply(
      '❌ Failed to update automation settings. Please try again.'
    );
  }
}

// --------------------------------------------------
// INDIVIDUAL AUTOMATION COMMANDS
// --------------------------------------------------

const plugins = commands.map(item => ({
  command: item.command,
  aliases: item.aliases,
  category: 'owner',
  description: item.description,
  owner: true,

  async run(ctx) {
    if (!await ownerOnly(ctx)) return;

    const mode = parseMode(ctx.args?.[0]);

    if (mode === null) {
      try {
        const settings = getAutomationSettings();
        const current = settings[item.setting] === true;

        return ctx.reply(
          `${automationHeader(item.command.toUpperCase())}\n` +
          `┃\n` +
          `┃ Description: ${item.description}\n` +
          `┃ Status: ${statusText(current)}\n` +
          `┃\n` +
          `┃ Usage:\n` +
          `┃ ${getPrefix(ctx)}${item.command} on\n` +
          `┃ ${getPrefix(ctx)}${item.command} off\n` +
          `${automationFooter()}`
        );
      } catch (error) {
        console.error('[AUTOMATION SETTINGS]', error);

        return ctx.reply(
          '❌ Could not load automation settings.'
        );
      }
    }

    return changeSetting(ctx, item, mode);
  }
}));

// --------------------------------------------------
// AUTOMATION PANEL
// --------------------------------------------------

plugins.push({
  command: 'automation',
  aliases: ['autopanel', 'autolist'],
  category: 'owner',
  description: 'Show all automation settings',
  owner: true,

  async run(ctx) {
    if (!await ownerOnly(ctx)) return;

    try {
      const settings = getAutomationSettings();

      const lines = commands.map(item => {
        const enabled = settings[item.setting] === true;

        return (
          `┃ ${item.command}: ${statusText(enabled)}\n` +
          `┃ ${item.description}`
        );
      });

      return ctx.reply(
        `╭━━〔 PRECIOUS-MD AUTOMATION 〕\n` +
        `┃\n` +
        `${lines.join('\n┃\n')}\n` +
        `┃\n` +
        `┃ Change settings using:\n` +
        `┃ ${getPrefix(ctx)}command on/off\n` +
        `╰━━━━━━━━━━━━`
      );
    } catch (error) {
      console.error('[AUTOMATION PANEL]', error);

      return ctx.reply(
        '❌ Could not load the automation panel.'
      );
    }
  }
});

// --------------------------------------------------
// UNIVERSAL AUTOMATION TOGGLE
// --------------------------------------------------

plugins.push({
  command: 'autotoggle',
  aliases: ['setautomation'],
  category: 'owner',
  description: 'Change any automation setting',
  owner: true,

  async run(ctx) {
    if (!await ownerOnly(ctx)) return;

    const selected = findSetting(ctx.args?.[0]);
    const mode = parseMode(ctx.args?.[1]);

    if (!selected || mode === null) {
      return ctx.reply(
        `╭━━〔 AUTOMATION TOGGLE 〕\n` +
        `┃\n` +
        `┃ Usage:\n` +
        `┃ ${getPrefix(ctx)}autotoggle autoread on\n` +
        `┃ ${getPrefix(ctx)}autotoggle anticall off\n` +
        `┃\n` +
        `┃ Available settings:\n` +
        commands.map(item => `┃ • ${item.setting}`).join('\n') +
        `\n╰━━━━━━━━━━━━`
      );
    }

    return changeSetting(ctx, selected, mode);
  }
});

// --------------------------------------------------
// AUTOMATION HELP
// --------------------------------------------------

plugins.push({
  command: 'automationhelp',
  aliases: ['autohelp'],
  category: 'owner',
  description: 'Show automation command help',
  owner: true,

  async run(ctx) {
    if (!await ownerOnly(ctx)) return;

    const prefix = getPrefix(ctx);

    const lines = commands.map(item =>
      `┃ ${prefix}${item.command} on/off\n` +
      `┃ ${item.description}`
    );

    return ctx.reply(
      `╭━━〔 AUTOMATION HELP 〕\n` +
      `┃\n` +
      `┃ ${prefix}automation\n` +
      `┃ View all automation settings\n` +
      `┃\n` +
      `${lines.join('\n┃\n')}\n` +
      `┃\n` +
      `┃ ${prefix}autotoggle setting on/off\n` +
      `┃ Change any setting\n` +
      `╰━━━━━━━━━━━━`
    );
  }
});

export default plugins;
