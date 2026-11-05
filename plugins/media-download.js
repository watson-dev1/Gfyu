import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import ytSearch from 'yt-search';
import config from '../config.js';

const execFileAsync = promisify(execFile);

const API_BASE = 'https://eliteprotech-apis.zone.id';
const API_TIMEOUT = 120000;
const DOWNLOAD_TIMEOUT = 180000;

const TEMP_DIR = config.mediaDir || './temp';
const MAX_SIZE = (Number(config.maxMediaMb) || 45) * 1024 * 1024;
const YTDLP = config.ytdlpPath || 'yt-dlp';

// ==================================================
// HELPERS
// ==================================================

function getQuery(ctx) {
  return (ctx.args || []).join(' ').trim();
}

function safeFilename(name) {
  return String(name || 'precious-media')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
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

async function searchYouTube(query) {
  if (!query) {
    throw new Error('Please provide a search query.');
  }

  const result = await ytSearch(query);
  const videos = result?.videos || [];

  if (!videos.length) {
    throw new Error('No YouTube results found.');
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

// ==================================================
// API HELPERS
// ==================================================

function buildApiUrl(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value).trim());
    }
  }

  return url;
}

async function apiFetch(endpoint, params = {}) {
  const response = await fetch(buildApiUrl(endpoint, params), {
    method: 'GET',
    headers: {
      accept: 'application/json, audio/*, video/*, application/octet-stream, */*'
    },
    signal: AbortSignal.timeout(API_TIMEOUT)
  });

  if (!response.ok) {
    const message = (await response.text().catch(() => '')).slice(0, 300);

    throw new Error(
      `API error ${response.status}: ${message || response.statusText}`
    );
  }

  const contentType = response.headers.get('content-type') || '';

  if (
    contentType.includes('json') ||
    contentType.includes('text')
  ) {
    const text = await response.text();

    try {
      return {
        kind: 'json',
        data: JSON.parse(text)
      };
    } catch {
      return {
        kind: 'text',
        data: text
      };
    }
  }

  return {
    kind: 'binary',
    data: Buffer.from(await response.arrayBuffer()),
    contentType
  };
}

function findMediaUrl(value, depth = 0) {
  if (!value || depth > 7) return null;

  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value) ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMediaUrl(item, depth + 1);
      if (found) return found;
    }

    return null;
  }

  if (typeof value === 'object') {
    const keys = [
      'downloadUrl',
      'download_url',
      'url',
      'link',
      'video',
      'videoUrl',
      'audio',
      'audioUrl',
      'file',
      'media',
      'result',
      'data'
    ];

    for (const key of keys) {
      if (key in value) {
        const found = findMediaUrl(value[key], depth + 1);
        if (found) return found;
      }
    }

    for (const item of Object.values(value)) {
      const found = findMediaUrl(item, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function findLyrics(value, depth = 0) {
  if (value == null || depth > 7) return '';

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map(item => findLyrics(item, depth + 1))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    for (const key of [
      'lyrics',
      'lyric',
      'text',
      'content',
      'result',
      'data'
    ]) {
      if (key in value) {
        const found = findLyrics(value[key], depth + 1);

        if (found) return found;
      }
    }
  }

  return '';
}

// ==================================================
// API MEDIA DOWNLOADER
// ==================================================

async function fetchApiMedia(endpoint, params = {}) {
  const result = await apiFetch(endpoint, params);

  if (result.kind === 'binary') {
    return {
      buffer: result.data,
      contentType: result.contentType,
      filename: 'precious-media'
    };
  }

  const mediaUrl = result.kind === 'json'
    ? findMediaUrl(result.data)
    : null;

  if (!mediaUrl) {
    const message = result.kind === 'json'
      ? result.data?.message || result.data?.error
      : result.data;

    throw new Error(
      String(message || 'API did not return a downloadable media URL.')
        .slice(0, 300)
    );
  }

  const mediaResponse = await fetch(mediaUrl, {
    signal: AbortSignal.timeout(API_TIMEOUT)
  });

  if (!mediaResponse.ok) {
    throw new Error(`Media server returned HTTP ${mediaResponse.status}.`);
  }

  const buffer = Buffer.from(await mediaResponse.arrayBuffer());

  return {
    buffer,
    contentType: mediaResponse.headers.get('content-type') || '',
    filename: decodeURIComponent(
      new URL(mediaUrl).pathname.split('/').pop() || 'precious-media'
    )
  };
}

// ==================================================
// SEND API MEDIA
// ==================================================

function getMediaKind(contentType = '', filename = '', fallback = 'video') {
  const type = contentType.toLowerCase();
  const ext = path.extname(filename).toLowerCase();

  if (
    type.includes('audio/') ||
    ['.mp3', '.m4a', '.ogg', '.wav'].includes(ext)
  ) {
    return 'audio';
  }

  if (
    type.includes('image/') ||
    ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
  ) {
    return 'image';
  }

  if (
    type.includes('application/') ||
    ['.zip', '.pdf', '.apk', '.rar', '.exe'].includes(ext)
  ) {
    return 'document';
  }

  return fallback;
}

async function sendApiMedia(
  ctx,
  endpoint,
  params = {},
  caption = 'Downloaded by PRECIOUS-MD',
  fallback = 'video'
) {
  const result = await fetchApiMedia(endpoint, params);

  if (!result.buffer?.length) {
    throw new Error('API returned an empty media file.');
  }

  if (result.buffer.length > MAX_SIZE) {
    throw new Error(
      `File exceeds the ${config.maxMediaMb || 45} MB limit.`
    );
  }

  const kind = getMediaKind(
    result.contentType,
    result.filename,
    fallback
  );

  const filename = safeFilename(result.filename);

  if (kind === 'audio') {
    await ctx.send({
      audio: result.buffer,
      mimetype: result.contentType || 'audio/mpeg',
      fileName: filename,
      ptt: false
    });
  } else if (kind === 'image') {
    await ctx.send({
      image: result.buffer,
      mimetype: result.contentType || 'image/jpeg',
      fileName: filename,
      caption
    });
  } else if (kind === 'document') {
    await ctx.send({
      document: result.buffer,
      mimetype: result.contentType || 'application/octet-stream',
      fileName: filename,
      caption
    });
  } else {
    await ctx.send({
      video: result.buffer,
      mimetype: result.contentType?.includes('video/')
        ? result.contentType
        : 'video/mp4',
      fileName: filename,
      caption
    });
  }
}

// ==================================================
// SOCIAL MEDIA DOWNLOADERS
// ==================================================

async function runSocialDownload(ctx, service) {
  const input = getQuery(ctx);

  if (!input) {
    return ctx.reply(`Usage: .${service} <URL>`);
  }

  try {
    await ctx.reply(
      `⬇️ Downloading ${service} media...\nPlease wait.`
    );

    await sendApiMedia(
      ctx,
      `/download/${service}`,
      { url: input },
      `📥 ${service} download | PRECIOUS-MD`,
      service === 'mediafire' ? 'document' : 'video'
    );

  } catch (error) {
    console.error(`[${service.toUpperCase()} API]`, error);

    await ctx.reply(
      `❌ ${error.message || 'Download failed.'}`
    );
  }
}

// ==================================================
// YT-DLP FALLBACK
// ==================================================

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
      throw new Error('yt-dlp is not installed on your server.');
    }

    if (error.killed) {
      throw new Error('Download timed out. Try again.');
    }

    console.error('[YTDLP]', error.stderr || error.message);

    throw new Error('YouTube download failed.');
  }

  const files = await fs.readdir(TEMP_DIR);

  const matches = files.filter(file =>
    file.startsWith(`${id}.`)
  );

  if (!matches.length) {
    throw new Error('Downloaded file was not found.');
  }

  const filepath = path.join(TEMP_DIR, matches[0]);
  const stat = await fs.stat(filepath);

  if (!stat.isFile() || !stat.size) {
    await fs.rm(filepath, { force: true });
    throw new Error('Downloaded file is empty.');
  }

  if (stat.size > MAX_SIZE) {
    await fs.rm(filepath, { force: true });

    throw new Error(
      `File exceeds ${config.maxMediaMb || 45} MB.`
    );
  }

  return {
    filepath,
    size: stat.size
  };
}

// ==================================================
// YOUTUBE DOWNLOAD ENGINE
// ==================================================

async function sendDownloaded(ctx, url, type = 'mp3') {
  let filepath;

  try {
    await ctx.reply(
      type === 'mp3'
        ? '🎵 Downloading audio...'
        : '🎬 Downloading video...'
    );

    const endpoint = type === 'mp3'
      ? '/download/ytmp3'
      : '/download/ytmp4';

    // Try EliteProTech API first.
    try {
      await sendApiMedia(
        ctx,
        endpoint,
        { url },
        '🎬 Downloaded by PRECIOUS-MD',
        type === 'mp3' ? 'audio' : 'video'
      );

      return;

    } catch (error) {
      console.warn('[ELITEPROTECH YOUTUBE]', error.message);
    }

    // Use yt-dlp if API fails.
    const result = await downloadMedia(url, type);

    filepath = result.filepath;

    const buffer = await fs.readFile(filepath);

    if (type === 'mp3') {
      await ctx.send({
        audio: buffer,
        mimetype: 'audio/mpeg',
        fileName: 'precious-audio.mp3',
        ptt: false
      });
    } else {
      if (path.extname(filepath).toLowerCase() !== '.mp4') {
        throw new Error('Could not create an MP4 file.');
      }

      await ctx.send({
        video: buffer,
        mimetype: 'video/mp4',
        fileName: 'precious-video.mp4',
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

// ==================================================
// PLUGINS
// ==================================================

export default [

  // ----------------------------------------------
  // TIKTOK
  // ----------------------------------------------

  {
    command: 'tiktok',
    aliases: ['tt', 'ttdl'],
    category: 'media',
    description: 'Download TikTok videos',
    cooldown: 12,
    run: ctx => runSocialDownload(ctx, 'tiktok')
  },

  // ----------------------------------------------
  // INSTAGRAM
  // ----------------------------------------------

  {
    command: 'instagram',
    aliases: ['ig', 'igdl', 'insta'],
    category: 'media',
    description: 'Download Instagram media',
    cooldown: 12,
    run: ctx => runSocialDownload(ctx, 'instagram')
  },

  // ----------------------------------------------
  // FACEBOOK
  // ----------------------------------------------

  {
    command: 'facebook',
    aliases: ['fb', 'fbdl'],
    category: 'media',
    description: 'Download Facebook videos',
    cooldown: 12,
    run: ctx => runSocialDownload(ctx, 'facebook')
  },

  // ----------------------------------------------
  // MEDIAFIRE
  // ----------------------------------------------

  {
    command: 'mediafire',
    aliases: ['mf', 'mfdl'],
    category: 'media',
    description: 'Download MediaFire files',
    cooldown: 15,
    run: ctx => runSocialDownload(ctx, 'mediafire')
  },

  // ----------------------------------------------
  // LYRICS
  // ----------------------------------------------

  {
    command: 'lyrics',
    aliases: ['lyric', 'ly'],
    category: 'media',
    description: 'Search song lyrics',
    cooldown: 8,

    run: async ctx => {
      const query = getQuery(ctx);

      if (!query) {
        return ctx.reply('🎼 Usage: .lyrics song name');
      }

      try {
        const response = await apiFetch(
          '/search/lyrics',
          {
            query,
            q: query,
            song: query
          }
        );

        const lyrics = response.kind === 'json'
          ? findLyrics(response.data)
          : String(response.data || '');

        if (!lyrics.trim()) {
          throw new Error('No lyrics found.');
        }

        await ctx.reply(
          `🎼 *LYRICS SEARCH*\n\n${lyrics.slice(0, 12000)}`
        );

      } catch (error) {
        console.error('[LYRICS API]', error);

        await ctx.reply(
          `❌ ${error.message || 'Lyrics search failed.'}`
        );
      }
    }
  },

  // ----------------------------------------------
  // YTDOWN
  // ----------------------------------------------

  {
    command: 'ytdown',
    aliases: ['ytdl', 'youtubeaudio'],
    category: 'media',
    description: 'Download YouTube MP3',
    cooldown: 12,

    run: async ctx => {
      const input = getQuery(ctx);

      if (!input) {
        return ctx.reply(
          '🎵 Usage: .ytdown YouTube URL or song name'
        );
      }

      try {
        const video = await resolveVideo(input);

        await ctx.reply('🎵 Downloading YouTube audio...');

        try {
          await sendApiMedia(
            ctx,
            '/download/ytdown',
            {
              format: 'mp3',
              url: video.url
            },
            '🎵 YouTube audio | PRECIOUS-MD',
            'audio'
          );

        } catch (error) {
          console.warn('[YTDOWN API]', error.message);

          await sendDownloaded(
            ctx,
            video.url,
            'mp3'
          );
        }

      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  // ----------------------------------------------
  // PLAY
  // ----------------------------------------------

  {
    command: 'play',
    aliases: ['song', 'music'],
    category: 'media',
    description: 'Search and download music',
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
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  // ----------------------------------------------
  // YOUTUBE SEARCH
  // ----------------------------------------------

  {
    command: 'ytsearch',
    aliases: ['yts', 'youtube'],
    category: 'media',
    description: 'Search YouTube videos',
    cooldown: 5,

    run: async ctx => {
      const query = getQuery(ctx);

      if (!query) {
        return ctx.reply('Usage: .ytsearch video name');
      }

      try {
        const videos = await searchYouTube(query);
        const results = videos.slice(0, 5);

        let message = '╭━━〔 *YOUTUBE SEARCH* 〕━━╮\n┃\n';

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
        await ctx.reply(`❌ Search failed: ${error.message}`);
      }
    }
  },

  // ----------------------------------------------
  // YTMP3
  // ----------------------------------------------

  {
    command: 'ytmp3',
    aliases: ['yta', 'ytaudio'],
    category: 'media',
    description: 'Download YouTube MP3',
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

        await sendDownloaded(ctx, video.url, 'mp3');

      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  // ----------------------------------------------
  // YTMP4
  // ----------------------------------------------

  {
    command: 'ytmp4',
    aliases: ['ytv', 'ytvideo'],
    category: 'media',
    description: 'Download YouTube MP4',
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

        await sendDownloaded(ctx, video.url, 'mp4');

      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  // ----------------------------------------------
  // MEDIA HELP
  // ----------------------------------------------

  {
    command: 'mediahelp',
    aliases: ['media'],
    category: 'media',
    description: 'Show media commands',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD MEDIA CENTER* 〕━━╮\n` +
        `┃\n` +
        `┃ 🎵 .play <song>\n` +
        `┃ 🔎 .ytsearch <query>\n` +
        `┃ 🎧 .ytmp3 <name/URL>\n` +
        `┃ 🎬 .ytmp4 <name/URL>\n` +
        `┃ 🎼 .lyrics <song>\n` +
        `┃ 📥 .ytdown <URL>\n` +
        `┃ 📱 .tiktok <URL>\n` +
        `┃ 📸 .instagram <URL>\n` +
        `┃ 📘 .facebook <URL>\n` +
        `┃ 📁 .mediafire <URL>\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `*Maximum file size:* ${config.maxMediaMb || 45} MB`
      );
    }
  }

];