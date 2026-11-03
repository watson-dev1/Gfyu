
import {
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto';

function tokenize(expression) {
  const tokens = expression.match(
    /\d+(?:\.\d+)?|[()+\-*/%^]/g
  );

  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) {
    throw new Error('Invalid expression.');
  }

  return tokens;
}

function calculate(expression) {
  const tokens = tokenize(expression);
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function primary() {
    const token = take();

    if (token === '+') return primary();
    if (token === '-') return -primary();

    if (token === '(') {
      const value = addition();

      if (take() !== ')') {
        throw new Error('Missing closing bracket.');
      }

      return value;
    }

    const number = Number(token);

    if (!Number.isFinite(number)) {
      throw new Error('Invalid number.');
    }

    return number;
  }

  function power() {
    let value = primary();

    if (peek() === '^') {
      take();
      value = value ** power();
    }

    return value;
  }

  function multiplication() {
    let value = power();

    while (['*', '/', '%'].includes(peek())) {
      const operator = take();
      const right = power();

      if (right === 0 && ['/', '%'].includes(operator)) {
        throw new Error('Cannot divide by zero.');
      }

      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;
    }

    return value;
  }

  function addition() {
    let value = multiplication();

    while (['+', '-'].includes(peek())) {
      const operator = take();
      const right = multiplication();

      value = operator === '+' ? value + right : value - right;
    }

    return value;
  }

  const result = addition();

  if (position !== tokens.length || !Number.isFinite(result)) {
    throw new Error('Invalid calculation.');
  }

  return result;
}

function encodeBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function decodeBase64(value) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid Base64 input.');
  }

  return Buffer.from(value, 'base64').toString('utf8');
}

export default [
  {
    command: 'calculate',
    aliases: ['maths'],
    category: 'tools',
    description: 'Safely calculate an arithmetic expression',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .calculate (10 + 5) * 2');

      try {
        const result = calculate(ctx.q);

        await ctx.reply(
          `🧮 *CALCULATOR*\n\n${ctx.q} = *${result}*`
        );
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  {
    command: 'base64',
    aliases: ['b64encode'],
    category: 'tools',
    description: 'Encode text as Base64',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .base64 Hello world');

      await ctx.reply(encodeBase64(ctx.q));
    }
  },

  {
    command: 'unbase64',
    aliases: ['b64decode'],
    category: 'tools',
    description: 'Decode Base64 text',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .unbase64 SGVsbG8=');

      try {
        await ctx.reply(decodeBase64(ctx.q));
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  {
    command: 'reverse',
    aliases: ['rev'],
    category: 'tools',
    description: 'Reverse text',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .reverse Hello');

      await ctx.reply([...ctx.q].reverse().join(''));
    }
  },

  {
    command: 'count',
    aliases: ['wordcount'],
    category: 'tools',
    description: 'Count characters and words',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .count Your text');

      const words = ctx.q.trim().split(/\s+/).filter(Boolean);

      await ctx.reply(
        `📝 *TEXT STATISTICS*\n\n` +
        `Characters: ${ctx.q.length}\n` +
        `Words: ${words.length}\n` +
        `Lines: ${ctx.q.split(/\n/).length}`
      );
    }
  },

  {
    command: 'sha256',
    aliases: ['hash'],
    category: 'tools',
    description: 'Generate a SHA-256 hash',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .sha256 Your text');

      const hash = createHash('sha256')
        .update(ctx.q)
        .digest('hex');

      await ctx.reply(hash);
    }
  },

  {
    command: 'uuid',
    aliases: ['guid'],
    category: 'tools',
    description: 'Generate a UUID',
    run: async ctx => {
      await ctx.reply(randomUUID());
    }
  },

  {
    command: 'random',
    aliases: ['choose'],
    category: 'tools',
    description: 'Choose a random item from a list',
    run: async ctx => {
      const choices = ctx.q
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      if (choices.length < 2) {
        return ctx.reply('Usage: .random red, blue, green');
      }

      const selected = choices[
        Math.floor(Math.random() * choices.length)
      ];

      await ctx.reply(`🎲 My choice: *${selected}*`);
    }
  },

  {
    command: 'password',
    aliases: ['genpass'],
    category: 'tools',
    description: 'Generate a secure random password',
    run: async ctx => {
      const requested = Number(ctx.args[0] || 16);

      if (!Number.isInteger(requested) || requested < 8 || requested > 64) {
        return ctx.reply('Choose a password length between 8 and 64.');
      }

      const alphabet =
        'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';

      const bytes = randomBytes(requested);
      let password = '';

      for (let i = 0; i < requested; i++) {
        password += alphabet[bytes[i] % alphabet.length];
      }

      await ctx.reply(`🔐 *Generated password*\n\n${password}`);
    }
  },

  {
    command: 'uppercase',
    aliases: ['upper'],
    category: 'tools',
    description: 'Convert text to uppercase',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .uppercase hello');

      await ctx.reply(ctx.q.toUpperCase());
    }
  },

  {
    command: 'lowercase',
    aliases: ['lower'],
    category: 'tools',
    description: 'Convert text to lowercase',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .lowercase HELLO');

      await ctx.reply(ctx.q.toLowerCase());
    }
  },

  {
    command: 'urlencode',
    aliases: ['urlenc'],
    category: 'tools',
    description: 'Encode text for URLs',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .urlencode Hello world');

      await ctx.reply(encodeURIComponent(ctx.q));
    }
  },

  {
    command: 'urldecode',
    aliases: ['urldec'],
    category: 'tools',
    description: 'Decode URL-encoded text',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .urldecode Hello%20world');

      try {
        await ctx.reply(decodeURIComponent(ctx.q));
      } catch {
        await ctx.reply('❌ Invalid URL-encoded text.');
      }
    }
  }
];
