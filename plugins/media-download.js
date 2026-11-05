
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import ytSearch from 'yt-search';
import config from '../config.js';

const execFileAsync = promisify(execFile);

const TEMP_DIR = config.mediaDir || './temp';
const MAX_SIZE = (Number(config.maxMediaMb) || 45) * 1024 * 1024;
const YTDLP = config.ytdlpPath || 'yt-dlp';

const DOWNLOAD_TIMEOUT = 180000;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getQuery(ctx) {
  return (ctx.args || []).join(' ').trim();
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);

    return [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'www.youtu.be'
    ].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(Number(seconds))) {
    return 'Unknown';
  }

  const total = Number(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatViews(views) {
  const number = Number(views || 0);

  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(1)}M`;
  }

  if (number >= 1_000) {
    return `${(number / 1_000).toFixed(1)}K`;
  }

  return String(number);
}

function safeFilename(name) {
  return String(name || 'precious-media')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

async function searchYouTube(query) {
  if (!query) {
    throw new Error('Please provide a song or video name.');
  }

  const results = await ytSearch(query);
  const videos = results?.videos || [];

  if (!videos.length) {
    throw new Error('No YouTube results were found.');
  }

  return videos;
}

async function resolveVideo(input) {
  if (isYouTubeUrl(input)) {
    return {
      url: input,
      title: 'YouTube media'
    };
  }

  const videos = await searchYouTube(input);

  return {
    url: videos[0].url,
    title: videos[0].title,
    video: videos[0]
  };
}

// --------------------------------------------------
// DOWNLOAD ENGINE
// --------------------------------------------------

async function downloadMedia(url, type = 'mp3') {
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const id = `precious-${randomUUID()}`;
  const outputTemplate = path.join(
    TEMP_DIR,
    `${id}.%(ext)s`
  );

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--restrict-filenames',
    '--socket-timeout',
    '20',
    '-o',
    outputTemplate
  ];

  if (type === 'mp3') {
    args.push(
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '5'
    );
  } else {
    args.push(
      '-f',
      'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]',
      '--merge-output-format',
      'mp4'
    );
  }

  args.push(url);

  try {
    await execFileAsync(YTDLP, args, {
      timeout: DOWNLOAD_TIMEOUT,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'yt-dlp is not installed or could not be found. Install yt-dlp on your hosting server.'
      );
    }

    if (error.killed) {
      throw new Error('Download timed out. Please try again.');
    }

    const details = String(
      error.stderr || error.message || ''
    ).trim();

    console.error('[YTDLP]', details);

    throw new Error(
      'Download failed. The video may be unavailable or require a supported format.'
    );
  }

  const files = await fs.readdir(TEMP_DIR);

  const matches = files.filter(file =>
    file.startsWith(`${id}.`)
  );

  if (!matches.length) {
    throw new Error('Downloaded file could not be found.');
  }

  const filepath = path.join(TEMP_DIR, matches[0]);
  const stat = await fs.stat(filepath);

  if (!stat.isFile() || stat.size === 0) {
    await fs.rm(filepath, { force: true });
    throw new Error('Downloaded file is empty.');
  }

  if (stat.size > MAX_SIZE) {
    await fs.rm(filepath, { force: true });

    throw new Error(
      `File is too large. Maximum allowed size is ${config.maxMediaMb || 45} MB.`
    );
  }

  return {
    filepath,
    size: stat.size
  };
}

// --------------------------------------------------
// SEND DOWNLOADED MEDIA
// --------------------------------------------------

async function sendDownloaded(ctx, url, type) {
  let filepath;

  try {
    await ctx.reply(
      type === 'mp3'
        ? '🎵 Downloading audio... Please wait.'
        : '🎬 Downloading video... Please wait.'
    );

    const result = await downloadMedia(url, type);
    filepath = result.filepath;

    const buffer = await fs.readFile(filepath);

    if (type === 'mp3') {
      await ctx.send({
        audio: buffer,
        mimetype: 'audio/mpeg',
        fileName: `${path.basename(filepath, path.extname(filepath))}.mp3`,
        ptt: false
      });
    } else {
      if (path.extname(filepath).toLowerCase() !== '.mp4') {
        throw new Error(
          'Could not produce an MP4 video. Check that FFmpeg is installed on your server.'
        );
      }

      await ctx.send({
        video: buffer,
        mimetype: 'video/mp4',
        fileName: path.basename(filepath),
        caption: '🎬 Downloaded by PRECIOUS-MD'
      });
    }

  } catch (error) {
    console.error('[MEDIA DOWNLOAD]', error);

    await ctx.reply(
      `❌ ${error.message || 'Media download failed.'}`
    );

  } finally {
    if (filepath) {
      await fs.rm(filepath, { force: true }).catch(() => {});
    }
  }
}

// --------------------------------------------------
// PLUGINS
// --------------------------------------------------

export default [

  // ------------------------------------------------
  // PLAY AUDIO
  // ------------------------------------------------

  {
    command: 'play',
    aliases: ['song', 'music'],
    category: 'media',
    description: 'Search YouTube and download a song',
    cooldown: 10,

    run: async ctx => {
      const query = getQuery(ctx);

      if (!query) {
        return ctx.reply(
          '🎵 Usage: .play song name\nExample: .play Faded Alan Walker'
        );
      }

      try {
        const videos = await searchYouTube(query);
        const video = videos[0];

        await ctx.reply(
          `╭━━〔 *PRECIOUS-MD MUSIC* 〕━━╮\n` +
          `┃\n` +
          `┃ 🎵 *Title:* ${video.title}\n` +
          `┃ 👤 *Channel:* ${video.author?.name || 'Unknown'}\n` +
          `┃ ⏱️ *Duration:* ${video.timestamp || formatDuration(video.seconds)}\n` +
          `┃ 👁️ *Views:* ${formatViews(video.views)}\n` +
          `┃\n` +
          `┃ ⬇️ Downloading audio...\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━━╯`
        );

        await sendDownloaded(ctx, video.url, 'mp3');

      } catch (error) {
        await ctx.reply(
          `❌ ${error.message || 'Could not find that song.'}`
        );
      }
    }
  },

  // ------------------------------------------------
  // YOUTUBE SEARCH
  // ------------------------------------------------

  {
    command: 'ytsearch',
    aliases: ['yts', 'youtube'],
    category: 'media',
    description: 'Search YouTube videos',
    cooldown: 5,

    run: async ctx => {
      const query = getQuery(ctx);

      if (!query) {
        return ctx.reply(
          'Usage: .ytsearch video name'
        );
      }

      try {
        const videos = await searchYouTube(query);

        const results = videos.slice(0, 5);

        let message =
          `╭━━〔 *YOUTUBE SEARCH* 〕━━╮\n┃\n`;

        results.forEach((video, index) => {
          message +=
            `┃ *${index + 1}. ${video.title}*\n` +
            `┃ 👤 ${video.author?.name || 'Unknown'}\n` +
            `┃ ⏱️ ${video.timestamp || 'Unknown'}\n` +
            `┃ 👁️ ${formatViews(video.views)} views\n` +
            `┃ 🔗 ${video.url}\n┃\n`;
        });

        message += '╰━━━━━━━━━━━━━━━━━━━━━━━━╯';

        await ctx.reply(message);

      } catch (error) {
        await ctx.reply(
          `❌ Search failed: ${error.message}`
        );
      }
    }
  },

  // ------------------------------------------------
  // MP3 DOWNLOAD
  // ------------------------------------------------

  {
    command: 'ytmp3',
    aliases: ['yta', 'ytaudio'],
    category: 'media',
    description: 'Download YouTube audio as MP3',
    cooldown: 10,

    run: async ctx => {
      const input = getQuery(ctx);

      if (!input) {
        return ctx.reply(
          '🎵 Usage:\n.ytmp3 song name\n.ytmp3 YouTube URL'
        );
      }

      try {
        const video = await resolveVideo(input);

        await sendDownloaded(
          ctx,
          video.url,
          'mp3'
        );

      } catch (error) {
        await ctx.reply(
          `❌ ${error.message}`
        );
      }
    }
  },

  // ------------------------------------------------
  // MP4 DOWNLOAD
  // ------------------------------------------------

  {
    command: 'ytmp4',
    aliases: ['ytv', 'ytvideo'],
    category: 'media',
    description: 'Download YouTube video as MP4',
    cooldown: 15,

    run: async ctx => {
      const input = getQuery(ctx);

      if (!input) {
        return ctx.reply(
          '🎬 Usage:\n.ytmp4 video name\n.ytmp4 YouTube URL'
        );
      }

      try {
        const video = await resolveVideo(input);

        await sendDownloaded(
          ctx,
          video.url,
          'mp4'
        );

      } catch (error) {
        await ctx.reply(
          `❌ ${error.message}`
        );
      }
    }
  },

  // ------------------------------------------------
  // MEDIA HELP
  // ------------------------------------------------

  {
    command: 'mediahelp',
    aliases: ['media'],
    category: 'media',
    description: 'Show media downloader commands',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD MEDIA CENTER* 〕━━╮\n` +
        `┃\n` +
        `┃ 🎵 .play <song>\n` +
        `┃    Search and download music\n` +
        `┃\n` +
        `┃ 🔎 .ytsearch <query>\n` +
        `┃    Search YouTube videos\n` +
        `┃\n` +
        `┃ 🎧 .ytmp3 <name/URL>\n` +
        `┃    Download MP3 audio\n` +
        `┃\n` +
        `┃ 🎬 .ytmp4 <name/URL>\n` +
        `┃    Download MP4 video\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `*Maximum file size:* ${config.maxMediaMb || 45} MB`
      );
    }
  }

];
