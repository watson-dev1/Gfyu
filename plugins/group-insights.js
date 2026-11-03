export default [
  {
    command: 'admins', aliases: ['listadmins'], category: 'group', group: true,
    description: 'List group administrators',
    run: async ctx => {
      const meta = await ctx.sock.groupMetadata(ctx.chat);
      const admins = (meta.participants || []).filter(p => p.admin);
      if (!admins.length) return ctx.reply('No group administrators were found.');
      const mentions = admins.map(p => p.id);
      await ctx.send({ text: `🛡️ *GROUP ADMINS (${admins.length})*\n\n${admins.map((p,i)=>`${i+1}. @${p.id.split('@')[0]}${p.admin==='superadmin'?' 👑':''}`).join('\n')}`, mentions });
    }
  },
  {
    command: 'membercount', aliases: ['memberscount'], category: 'group', group: true,
    description: 'Count group members and administrators',
    run: async ctx => {
      const meta = await ctx.sock.groupMetadata(ctx.chat);
      const total = meta.participants?.length || 0;
      const admins = (meta.participants || []).filter(p => p.admin).length;
      await ctx.reply(`👥 Members: *${total}*\n🛡️ Admins: *${admins}*\n🙋 Other members: *${total-admins}*`);
    }
  }
];
