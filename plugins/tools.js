
import {
  createHash,
  randomBytes,
  randomUUID,
  randomInt
} from 'node:crypto';

// --------------------------------------------------
// SAFE CALCULATOR
// --------------------------------------------------

function tokenize(expression) {
  if (
    typeof expression !== 'string' ||
    !expression.trim() ||
    expression.length > 500
  ) {
    throw new Error('Expression is empty or too long.');
  }

  const tokens = [];
  const pattern = /\s+|(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%^]/gy;

  let position = 0;

  while (position < expression.length) {
    pattern.lastIndex = position;

    const match = pattern.exec(expression);

    if (!match) {
      throw new Error(
        `Invalid character at position ${position + 1}.`
      );
    }

    position = pattern.lastIndex;

    if (!/^\s+$/.test(match[0])) {
      tokens.push(match[0]);
    }

    if (tokens.length > 200) {
      throw new Error('Expression contains too many tokens.');
    }
  }

  if (!tokens.length) {
    throw new Error('Expression is empty.');
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

    if (token === undefined) {
      throw new Error('Unexpected end of expression.');
    }

    if (token === '(') {
      const value = addition();

      if (take() !== ')') {
        throw new Error('Missing closing bracket.');
      }

      return value;
    }

    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
      throw new Error(`Unexpected token: ${token}`);
    }

    const number = Number(token);

    if (!Number.isFinite(number)) {
      throw new Error('Invalid number.');
    }

    return number;
  }

  // Exponentiation is right-associative.
  function power() {
    const value = primary();

    if (peek() === '^') {
      take();

      const right = unary();
      const result = value ** right;

      if (!Number.isFinite(result)) {
        throw new Error('Calculation result is too large.');
      }

      return result;
    }

    return value;
  }

  // Unary signs have lower precedence than exponentiation.
  function unary() {
    if (peek() === '+') {
      take();
      return unary();
    }

    if (peek() === '-') {
      take();
      return -unary();
    }

    return power();
  }

  function multiplication() {
    let value = unary();

    while (['*', '/', '%'].includes(peek())) {
      const operator = take();
      const right = unary();

      if (
        right === 0 &&
        (operator === '/' || operator === '%')
      ) {
        throw new Error('Cannot divide by zero.');
      }

      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;

      if (!Number.isFinite(value)) {
        throw new Error('Invalid calculation result.');
      }
    }

    return value;
  }

  function addition() {
    let value = multiplication();

    while (['+', '-'].includes(peek())) {
      const operator = take();
      const right = multiplication();

      value = operator === '+'
        ? value + right
        : value - right;

      if (!Number.isFinite(value)) {
        throw new Error('Invalid calculation result.');
      }
    }

    return value;
  }

  const result = addition();

  if (position !== tokens.length) {
    throw new Error(`Unexpected token: ${peek()}`);
  }

  if (!Number.isFinite(result)) {
    throw new Error('Invalid calculation.');
  }

  return result;
}

// --------------------------------------------------
// BASE64
// --------------------------------------------------

function encodeBase64(value) {
  return Buffer
    .from(value, 'utf8')
    .toString('base64');
}

function decodeBase64(value) {
  const input = value.trim();

  if (
    !input ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(input) ||
    input.length % 4 === 1
  ) {
    throw new Error('Invalid Base64 input.');
  }

  const unpadded = input.replace(/=+$/, '');
  const normalized = unpadded.padEnd(
    Math.ceil(unpadded.length / 4) * 4,
    '='
  );

  const decoded = Buffer.from(normalized, 'base64');

  if (
    decoded.toString('base64').replace(/=+$/, '') !== unpadded
  ) {
    throw new Error('Invalid Base64 input.');
  }

  return decoded.toString('utf8');
}

// --------------------------------------------------
// RANDOM PASSWORD
// --------------------------------------------------

function generatePassword(length) {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';

  let password = '';

  for (let i = 0; i < length; i++) {
    password += alphabet[randomInt(alphabet.length)];
  }

  return password;
}

// --------------------------------------------------
// TEXT HELPERS
// --------------------------------------------------

function getWordCount(text) {
  return text.trim()
    ? text.trim().split(/\s+/u).length
    : 0;
}

// --------------------------------------------------
// TOOLS PLUGINS
// --------------------------------------------------

export default [

  // CALCULATOR
  {
    command: 'calculate',
    aliases: ['maths', 'calc'],
    category: 'tools',
    description: 'Safely calculate an arithmetic expression',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          'Usage: .calculate (10 + 5) * 2'
        );
      }

      try {
        const result = calculate(ctx.q);

        await ctx.reply(
          `🧮 *PRECIOUS-MD CALCULATOR*\n\n` +
          `${ctx.q} = *${result}*`
        );

      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  // BASE64 ENCODE
  {
    command: 'base64',
    aliases: ['b64encode'],
    category: 'tools',
    description: 'Encode text as Base64',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          'Usage: .base64 Hello world'
        );
      }

      await ctx.reply(encodeBase64(ctx.q));
    }
  },

  // BASE64 DECODE
  {
    command: 'unbase64',
    aliases: ['b64decode'],
    category: 'tools',
    description: 'Decode Base64 text',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          'Usage: .unbase64 SGVsbG8='
        );
      }

      try {
        await ctx.reply(decodeBase64(ctx.q));
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  // REVERSE TEXT
  {
    command: 'reverse',
    aliases: ['rev'],
    category: 'tools',
    description: 'Reverse text',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply('Usage: .reverse Hello');
      }

      await ctx.reply(
        Array.from(ctx.q).reverse().join('')
      );
    }
  },

  // TEXT COUNT
  {
    command: 'count',
    aliases: ['wordcount'],
    category: 'tools',
    description: 'Count characters, words and lines',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply('Usage: .count Your text');
      }

      const characters = Array.from(ctx.q).length;
      const words = getWordCount(ctx.q);
      const lines = ctx.q.split(/\r\n|\r|\n/).length;

      await ctx.reply(
        `📝 *TEXT STATISTICS*\n\n` +
        `Characters: ${characters}\n` +
        `Words: ${words}\n` +
        `Lines: ${lines}`
      );
    }
  },

  // SHA256 HASH
  {
    command: 'sha256',
    aliases: ['hash'],
    category: 'tools',
    description: 'Generate a SHA-256 hash',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply('Usage: .sha256 Your text');
      }

      const hash = createHash('sha256')
        .update(ctx.q, 'utf8')
        .digest('hex');

      await ctx.reply(
        `🔐 *SHA-256 HASH*\n\n${hash}`
      );
    }
  },

  // UUID
  {
    command: 'uuid',
    aliases: ['guid'],
    category: 'tools',
    description: 'Generate a unique UUID',

    run: async ctx => {
      await ctx.reply(
        `🆔 *GENERATED UUID*\n\n${randomUUID()}`
      );
    }
  },

  // RANDOM CHOICE
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
        return ctx.reply(
          'Usage: .random red, blue, green'
        );
      }

      const selected = choices[
        randomInt(choices.length)
      ];

      await ctx.reply(
        `🎲 *RANDOM CHOICE*\n\n` +
        `My choice: *${selected}*`
      );
    }
  },

  // PASSWORD GENERATOR
  {
    command: 'password',
    aliases: ['genpass'],
    category: 'tools',
    description: 'Generate a secure random password',

    run: async ctx => {
      const requested = Number(
        ctx.args?.[0] || 16
      );

      if (
        !Number.isInteger(requested) ||
        requested < 8 ||
        requested > 64
      ) {
        return ctx.reply(
          'Choose a password length between 8 and 64.'
        );
      }

      const password = generatePassword(requested);

      await ctx.reply(
        `🔐 *SECURE PASSWORD GENERATED*\n\n` +
        `Length: ${requested}\n\n` +
        `\`${password}\`\n\n` +
        `_Keep your password private._`
      );
    }
  },

  // UPPERCASE
  {
    command: 'uppercase',
    aliases: ['upper'],
    category: 'tools',
    description: 'Convert text to uppercase',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply('Usage: .uppercase hello');
      }

      await ctx.reply(ctx.q.toUpperCase());
    }
  },

  // LOWERCASE
  {
    command: 'lowercase',
    aliases: ['lower'],
    category: 'tools',
    description: 'Convert text to lowercase',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply('Usage: .lowercase HELLO');
      }

      await ctx.reply(ctx.q.toLowerCase());
    }
  },

  // URL ENCODE
  {
    command: 'urlencode',
    aliases: ['urlenc'],
    category: 'tools',
    description: 'Encode text for URLs',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply('Usage: .urlencode Hello world');
      }

      await ctx.reply(
        encodeURIComponent(ctx.q)
      );
    }
  },

  // URL DECODE
  {
    command: 'urldecode',
    aliases: ['urldec'],
    category: 'tools',
    description: 'Decode URL-encoded text',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          'Usage: .urldecode Hello%20world'
        );
      }

      try {
        await ctx.reply(
          decodeURIComponent(ctx.q)
        );
      } catch {
        await ctx.reply(
          '❌ Invalid URL-encoded text.'
        );
      }
    }
  }

];
