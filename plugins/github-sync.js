const REPOSITORY = 'watson-dev1/PRECIOUS-MD';

export default [
  {
    command: 'githubsync', aliases: ['checkupdate', 'update'], category: 'owner', owner: true,
    description: 'Check the latest GitHub commit for PRECIOUS-MD',
    run: async ctx => {
      if (!ctx.isOwnerOrSudo) return ctx.reply('Owner only.');
      await ctx.reply('🔄 Checking GitHub for updates...');
      try {
        const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits?per_page=1`, {
          headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'PRECIOUS-MD-Updater' },
          signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
        const commits = await response.json();
        const latest = commits?.[0];
        if (!latest?.sha) throw new Error('No public commit information was returned.');
        const shortSha = latest.sha.slice(0, 7);
        const message = String(latest.commit?.message || 'No commit message').split('\n')[0].slice(0, 180);
        const date = latest.commit?.committer?.date || latest.commit?.author?.date;
        await ctx.reply(`📦 *PRECIOUS-MD GITHUB STATUS*\nRepository: ${REPOSITORY}\nLatest commit: ${shortSha}\nMessage: ${message}\nDate: ${date ? new Date(date).toLocaleString() : 'Unknown'}\n\nDownload source: https://github.com/${REPOSITORY}/archive/refs/heads/main.zip\n\nThis command checks for updates only; it does not overwrite live files or restart your bot.`);
      } catch (error) {
        await ctx.reply(`❌ GitHub check failed: ${error.message}`);
      }
    }
  }
];
