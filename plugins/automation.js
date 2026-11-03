
import {
  getAutomationSettings,
  setAutomation
} from '../lib/automation.js';

const commands = [
  ['autoread', 'autoread'],
  ['alwaysonline', 'alwaysonline'],
  ['autostatus', 'autostatus'],
  ['statusreact', 'statusreact'],
  ['autoreact', 'autoreact'],
  ['anticall', 'anticall'],
  ['autotyping', 'autotyping'],
  ['autorecording', 'autorecording'],
  ['viewonce', 'viewonce']
];

const descriptions = {
  autoread: 'Automatically read incoming messages',
  alwaysonline: 'Keep the bot online',
  autostatus: 'Automatically view statuses',
  statusreact: 'Automatically react to statuses',
  autoreact: 'Automatically react to messages',
  anticall: 'Reject incoming WhatsApp calls',
  autotyping: 'Show typing while processing messages',
  autorecording: 'Show recording while processing audio',
  viewonce: 'Detect view-once messages'
};

const plugins = commands.map(([command, setting]) => ({
  command,
  category: 'owner',
  description: descriptions[setting],
  owner: true,

  async run(ctx) {
    if (!ctx.isOwner) {
      return ctx.reply('Only the bot owner can change automation settings.');
    }

    const value = String(ctx.args?.[0] || '').toLowerCase();

    if (!['on', 'off'].includes(value)) {
      const current = getAutomationSettings()[setting];

      return ctx.reply(
        `*${command.toUpperCase()}*\n\n` +
        `${descriptions[setting]}\n` +
        `Current status: ${current ? 'ON ✅' : 'OFF ❌'}\n\n` +
        `Usage: ${ctx.prefix}${command} on/off`
      );
    }

    const enabled = value === 'on';

    await setAutomation(setting, enabled);

    return ctx.reply(
      `*${command.toUpperCase()}*\n\n` +
      `${descriptions[setting]}\n` +
      `Status: ${enabled ? 'ENABLED ✅' : 'DISABLED ❌'}`
    );
  }
}));

plugins.push({
  command: 'automation',
  aliases: ['autopanel', 'autolist'],
  category: 'owner',
  description: 'Show automation settings',
  owner: true,

  async run(ctx) {
    if (!ctx.isOwner) {
      return ctx.reply('Only the bot owner can view this panel.');
    }

    const settings = getAutomationSettings();

    const lines = Object.entries(descriptions).map(([key, description]) => {
      const status = settings[key] ? 'ON ✅' : 'OFF ❌';
      return `• ${key}: ${status}\n  ${description}`;
    });

    return ctx.reply(
      `*PRECIOUS-MD AUTOMATION PANEL*\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Use ${ctx.prefix}command on/off to change a setting.`
    );
  }
});

export default plugins;
