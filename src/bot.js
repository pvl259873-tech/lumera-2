import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client, EmbedBuilder, Events, GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const textShortcutsEnabled = process.env.ENABLE_TEXT_SHORTCUTS === 'true';
const inviteTrackingEnabled = process.env.ENABLE_INVITE_TRACKING === 'true';
const configPath = join(process.cwd(), 'data/config.json');
let config = { guilds: {} };
const inviteCache = new Map();
const saveConfig = () => writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
const loadConfig = async () => {
  try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch { config = { guilds: {} }; }
};
const shortcutCommands = [
  { name: 'invite', value: 'invite' },
  { name: 'clear', value: 'clear' },
  { name: 'kick', value: 'kick' },
  { name: 'ban', value: 'ban' },
  { name: 'timeout', value: 'timeout' },
  { name: 'untimeout', value: 'untimeout' },
  { name: 'lock', value: 'lock' },
  { name: 'unlock', value: 'unlock' },
  { name: 'slowmode', value: 'slowmode' },
  { name: 'warn', value: 'warn' },
  { name: 'role add', value: 'role_add' },
  { name: 'role remove', value: 'role_remove' },
];
const requiredPermissions = {
  invite: null,
  clear: PermissionFlagsBits.ManageMessages,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  untimeout: PermissionFlagsBits.ModerateMembers,
  lock: PermissionFlagsBits.ManageChannels,
  unlock: PermissionFlagsBits.ManageChannels,
  slowmode: PermissionFlagsBits.ManageChannels,
  warn: PermissionFlagsBits.ModerateMembers,
  role_add: PermissionFlagsBits.ManageRoles,
  role_remove: PermissionFlagsBits.ManageRoles,
};
const commandEnabled = (guildId, command) => config.guilds[guildId]?.settings?.enabledCommands?.[command] !== false;
const applyGuildSettings = (guild) => {
  if (!guild) return;
  const activity = config.guilds[guild.id]?.settings?.activity;
  const activityTypes = { Playing: 0, Watching: 3, Listening: 2, Competing: 5 };
  if (activity?.text) guild.client.user.setPresence({ activities: [{ name: activity.text, type: activityTypes[activity.type] ?? 3 }], status: 'online' });
};
const shortcutUsage = (name, command) => ({
  invite: `استخدم: !${name}`,
  clear: `استخدم: !${name} العدد`,
  kick: `استخدم: !${name} @العضو السبب`,
  ban: `استخدم: !${name} @العضو السبب`,
  timeout: `استخدم: !${name} @العضو المدة_بالدقائق السبب`,
  untimeout: `استخدم: !${name} @العضو`,
  lock: `استخدم: !${name}`,
  unlock: `استخدم: !${name}`,
  slowmode: `استخدم: !${name} عدد_الثواني`,
  warn: `استخدم: !${name} @العضو السبب`,
  role_add: `استخدم: !${name} @العضو @الرتبة`,
  role_remove: `استخدم: !${name} @العضو @الرتبة`,
}[command] || `استخدم: !${name}`);
const canKickMember = (member, guild) => !member.permissions.has(PermissionFlagsBits.Administrator) && member.id !== guild.ownerId;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exitCode = 1;
} else if (!/^\d{17,20}$/.test(clientId)) {
  console.error('DISCORD_CLIENT_ID must be the numeric Application ID from Discord Developer Portal.');
  process.exitCode = 1;
} else {
  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('عرض سرعة استجابة البوت'),
    new SlashCommandBuilder().setName('server').setDescription('عرض معلومات السيرفر'),
    new SlashCommandBuilder().setName('invite').setDescription('عرض إحصاءات الدعوات الخاصة بك'),
    new SlashCommandBuilder().setName('shortcut').setDescription('إدارة اختصارات الأوامر الإدارية')
      .addSubcommand((command) => command.setName('add').setDescription('إضافة اختصار إداري')
        .addStringOption((option) => option.setName('name').setDescription('اسم الاختصار بدون !').setRequired(true))
        .addStringOption((option) => option.setName('command').setDescription('الأمر الإداري').addChoices(...shortcutCommands).setRequired(true)))
      .addSubcommand((command) => command.setName('remove').setDescription('حذف اختصار').addStringOption((option) => option.setName('name').setDescription('اسم الاختصار').setRequired(true)))
      .addSubcommand((command) => command.setName('list').setDescription('عرض الاختصارات')),
    new SlashCommandBuilder().setName('clear').setDescription('حذف رسائل من القناة')
      .addIntegerOption((option) => option.setName('amount').setDescription('عدد الرسائل من 1 إلى 100').setMinValue(1).setMaxValue(100).setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('kick').setDescription('طرد عضو')
      .addUserOption((option) => option.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('السبب'))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    new SlashCommandBuilder().setName('ban').setDescription('حظر عضو')
      .addUserOption((option) => option.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('السبب'))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder().setName('timeout').setDescription('إعطاء عضو تايم أوت')
      .addUserOption((option) => option.setName('user').setDescription('العضو').setRequired(true))
      .addIntegerOption((option) => option.setName('minutes').setDescription('المدة بالدقائق').setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('السبب'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('untimeout').setDescription('إزالة التايم أوت عن عضو')
      .addUserOption((option) => option.setName('user').setDescription('العضو').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('lock').setDescription('قفل الشات الحالي')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('unlock').setDescription('فتح الشات الحالي')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('slowmode').setDescription('تفعيل السلو مود')
      .addIntegerOption((option) => option.setName('seconds').setDescription('الثواني من 0 إلى 21600').setMinValue(0).setMaxValue(21600).setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder().setName('warn').setDescription('تحذير عضو')
      .addUserOption((option) => option.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('السبب').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder().setName('role').setDescription('إعطاء أو سحب رتبة')
      .addSubcommand((command) => command.setName('add').setDescription('إعطاء رتبة لعضو').addUserOption((option) => option.setName('user').setDescription('العضو').setRequired(true)).addRoleOption((option) => option.setName('role').setDescription('الرتبة').setRequired(true)))
      .addSubcommand((command) => command.setName('remove').setDescription('سحب رتبة من عضو').addUserOption((option) => option.setName('user').setDescription('العضو').setRequired(true)).addRoleOption((option) => option.setName('role').setDescription('الرتبة').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildInvites];
  if (textShortcutsEnabled) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  if (inviteTrackingEnabled) intents.push(GatewayIntentBits.GuildMembers);
  const client = new Client({ intents });

  async function registerCommands() {
    const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    if (guildId) await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log(`Registered ${commands.length} admin commands ${guildId ? 'for the configured server' : 'globally'}`);
  }

  client.once(Events.ClientReady, async (readyClient) => {
    await loadConfig();
    applyGuildSettings(readyClient.guilds.cache.first());
    if (inviteTrackingEnabled) {
      for (const guild of readyClient.guilds.cache.values()) inviteCache.set(guild.id, await guild.invites.fetch());
    }
    await registerCommands();
    console.log(`Lumera online as ${readyClient.user.tag}`);
    if (!textShortcutsEnabled) console.log('Text shortcuts disabled: enable Message Content Intent and set ENABLE_TEXT_SHORTCUTS=true to use shortcut names without !.');
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (!commandEnabled(interaction.guild.id, interaction.commandName) && interaction.commandName !== 'shortcut') return;
        if (interaction.commandName === 'ping') return interaction.reply(`🏓 ${client.ws.ping}ms`);
        if (interaction.commandName === 'server') return interaction.reply(`السيرفر: ${interaction.guild.name}\nالأعضاء: ${interaction.guild.memberCount}`);
        if (interaction.commandName === 'invite') {
          const invites = await interaction.guild.invites.fetch();
          const mine = invites.filter((invite) => invite.inviter?.id === interaction.user.id);
          const total = mine.reduce((sum, invite) => sum + (invite.uses ?? 0), 0);
          const inviteUsers = Object.values(config.guilds[interaction.guild.id]?.inviteUsers || {}).filter((entry) => entry.inviterId === interaction.user.id);
          const active = inviteUsers.filter((entry) => !entry.leftAt).length;
          const left = inviteUsers.filter((entry) => entry.leftAt).length;
          const suspicious = inviteUsers.filter((entry) => entry.accountAgeDays < 7).length;
          const embed = new EmbedBuilder()
            .setColor(0x55b6a8)
            .setAuthor({ name: interaction.user.globalName || interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
            .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
            .setTitle('تقرير الدعوات')
            .setDescription('إحصاءات دعواتك في هذا السيرفر بشكل واضح.')
            .addFields(
              { name: 'الدعوات المستخدمة', value: `**${total}**`, inline: true },
              { name: 'مستمرون', value: `**${active}**`, inline: true },
              { name: 'غادروا', value: `**${left}**`, inline: true },
              { name: 'حسابات مشتبه بها', value: `**${suspicious}**`, inline: true },
              { name: 'الحالة', value: inviteTrackingEnabled ? '✅ التتبع مفعل' : '⚪ التتبع غير مفعل', inline: false },
            )
            .setFooter({ text: inviteTrackingEnabled ? 'المستمر = ما زال في السيرفر، والمشتبه = عمر الحساب أقل من 7 أيام.' : 'فعّل Server Members Intent لمعرفة حالة دخول وخروج الأعضاء.' });
          return interaction.reply({ embeds: [embed] });
        }
        if (interaction.commandName === 'shortcut') {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return;
          const subcommand = interaction.options.getSubcommand();
          const guildShortcuts = new Map(Object.entries(config.guilds[interaction.guild.id]?.shortcuts || {}));
          if (subcommand === 'add') {
            const name = interaction.options.getString('name').toLowerCase().replace(/^!+/, '').trim();
            const command = interaction.options.getString('command');
            if (!/^[\p{L}\p{N}_-]{1,20}$/u.test(name)) return interaction.reply({ content: 'اسم الاختصار يجب أن يكون من حرف أو رقم أو _ أو - وبحد أقصى 20.', ephemeral: true });
            guildShortcuts.set(name, command);
            config.guilds[interaction.guild.id] ||= { shortcuts: {} };
            config.guilds[interaction.guild.id].shortcuts[name] = command;
            await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
            return interaction.reply({ content: `تمت إضافة الاختصار **${name}** للأمر **/${command}**.\n\n${shortcutUsage(name, command)}`, ephemeral: false });
          }
          if (subcommand === 'remove') {
            const name = interaction.options.getString('name').toLowerCase().replace(/^!+/, '').trim();
            const removed = guildShortcuts.delete(name);
            if (config.guilds[interaction.guild.id]?.shortcuts) delete config.guilds[interaction.guild.id].shortcuts[name];
            await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
            return interaction.reply({ content: removed ? `تم حذف **${name}**.` : 'هذا الاختصار غير موجود.', ephemeral: true });
          }
          const list = [...guildShortcuts.entries()].map(([name, command]) => `**${name}** → /${command}`);
          return interaction.reply({ content: list.length ? list.join('\n') : 'لا توجد اختصارات مضافة بعد.', ephemeral: true });
        }
        if (interaction.commandName === 'clear') {
          const deleted = await interaction.channel.bulkDelete(interaction.options.getInteger('amount'), true);
          return interaction.reply({ content: `تم حذف ${deleted.size} رسالة.`, ephemeral: true });
        }
        if (interaction.commandName === 'kick' || interaction.commandName === 'ban') {
          const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id);
          const reason = interaction.options.getString('reason') || 'بدون سبب';
          if (interaction.commandName === 'kick') {
            if (!canKickMember(member, interaction.guild)) return interaction.reply({ content: 'لا يمكن طرد مالك السيرفر أو عضو يملك صلاحية Administrator.', ephemeral: true });
            if (interaction.guild.members.me.roles.highest.comparePositionTo(member.roles.highest) <= 0) return interaction.reply({ content: 'لا يمكن طرد عضو رتبته أعلى من رتبة البوت أو مساوية لها.', ephemeral: true });
            await member.kick(reason);
          } else await member.ban(reason);
          return interaction.reply(`تم تنفيذ الأمر على ${member.user.tag}.`);
        }
        if (interaction.commandName === 'timeout' || interaction.commandName === 'untimeout') {
          const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id);
          if (interaction.commandName === 'timeout') {
            const minutes = interaction.options.getInteger('minutes');
            const reason = interaction.options.getString('reason') || 'بدون سبب';
            await member.timeout(minutes * 60 * 1000, reason);
            return interaction.reply(`تم إعطاء ${member.user.tag} تايم أوت لمدة ${minutes} دقيقة.`);
          }
          await member.timeout(null, 'إزالة التايم أوت');
          return interaction.reply(`تمت إزالة التايم أوت عن ${member.user.tag}.`);
        }
        if (interaction.commandName === 'lock' || interaction.commandName === 'unlock') {
          const everyoneRole = interaction.guild.roles.everyone;
          await interaction.channel.permissionOverwrites.edit(everyoneRole, { SendMessages: interaction.commandName === 'unlock' ? null : false });
          return interaction.reply(interaction.commandName === 'lock' ? 'تم قفل الشات.' : 'تم فتح الشات.');
        }
        if (interaction.commandName === 'slowmode') {
          const seconds = interaction.options.getInteger('seconds');
          await interaction.channel.setRateLimitPerUser(seconds);
          return interaction.reply(seconds ? `تم تفعيل السلو مود: ${seconds} ثانية.` : 'تم إلغاء السلو مود.');
        }
        if (interaction.commandName === 'warn') {
          const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id);
          const reason = interaction.options.getString('reason');
          return interaction.reply(`⚠️ تم تحذير ${member.user.tag}. السبب: ${reason}`);
        }
        if (interaction.commandName === 'role') {
          const member = await interaction.guild.members.fetch(interaction.options.getUser('user').id);
          const role = interaction.options.getRole('role');
          const action = interaction.options.getSubcommand();
          if (action === 'add') await member.roles.add(role);
          else await member.roles.remove(role);
          return interaction.reply(action === 'add' ? `تم إعطاء رتبة ${role} إلى ${member.user.tag}.` : `تم سحب رتبة ${role} من ${member.user.tag}.`);
        }
      }

    } catch (error) {
      if (error.code === 10062) return;
      console.error(error);
      if (!interaction.replied && !interaction.deferred) {
        try {
          await interaction.reply({ content: 'حدث خطأ غير متوقع.', ephemeral: true });
        } catch (replyError) {
          if (replyError.code !== 10062) console.error(replyError);
        }
      }
    }
  });

  client.on(Events.InviteCreate, async (invite) => {
    if (inviteTrackingEnabled) inviteCache.get(invite.guild.id)?.set(invite.code, invite);
  });

  client.on(Events.InviteDelete, async (invite) => {
    if (inviteTrackingEnabled) inviteCache.get(invite.guild.id)?.delete(invite.code);
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    if (!inviteTrackingEnabled) return;
    const before = inviteCache.get(member.guild.id) || new Map();
    const after = await member.guild.invites.fetch();
    const usedInvite = after.find((invite) => (invite.uses ?? 0) > (before.get(invite.code)?.uses ?? 0));
    inviteCache.set(member.guild.id, after);
    if (!usedInvite?.inviter) return;
    config.guilds[member.guild.id] ||= {};
    config.guilds[member.guild.id].inviteUsers ||= {};
    const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
    config.guilds[member.guild.id].inviteUsers[member.id] = { inviterId: usedInvite.inviter.id, joinedAt: new Date().toISOString(), leftAt: null, accountAgeDays };
    await saveConfig();
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const entry = config.guilds[member.guild.id]?.inviteUsers?.[member.id];
    if (!entry || entry.leftAt) return;
    entry.leftAt = new Date().toISOString();
    await saveConfig();
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!textShortcutsEnabled) return;
    if (message.author.bot || !message.guild || !message.content.startsWith('!')) return;
    const [shortcutName, ...argumentsList] = message.content.slice(1).trim().split(/\s+/);
    if (!shortcutName) return;
    const command = config.guilds[message.guild.id]?.shortcuts?.[shortcutName.toLowerCase()];
    if (!command) return;
    const requiredPermission = requiredPermissions[command];
    if (requiredPermission && !message.member.permissions.has(requiredPermission)) return;
    try {
      if (command === 'invite') {
        const invites = await message.guild.invites.fetch();
        const mine = invites.filter((invite) => invite.inviter?.id === message.author.id);
        const total = mine.reduce((sum, invite) => sum + (invite.uses ?? 0), 0);
        return message.reply(`تقرير دعواتك\nالدعوات المستخدمة: ${total}`);
      }
      if (command === 'clear') {
        const amount = Number(argumentsList[0]);
        if (!Number.isInteger(amount) || amount < 1 || amount > 100) return message.reply(shortcutUsage(shortcutName, command));
        const deleted = await message.channel.bulkDelete(amount, true);
        return message.channel.send(`تم حذف ${deleted.size} رسالة.`).then((reply) => setTimeout(() => reply.delete().catch(() => {}), 3000));
      }
      if (command === 'lock' || command === 'unlock') {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: command === 'unlock' ? null : false });
        return message.reply(command === 'lock' ? 'تم قفل الشات.' : 'تم فتح الشات.');
      }
      if (command === 'slowmode') {
        const seconds = Number(argumentsList[0]);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) return message.reply(shortcutUsage(shortcutName, command));
        await message.channel.setRateLimitPerUser(seconds);
        return message.reply(seconds ? `تم تفعيل السلو مود ${seconds} ثانية.` : 'تم إلغاء السلو مود.');
      }
      const mentionedTarget = message.mentions.members.first();
      const targetId = argumentsList.find((argument) => /^\d{17,20}$/.test(argument));
      if (!mentionedTarget && !targetId) return message.reply(shortcutUsage(shortcutName, command));
      const target = mentionedTarget || await message.guild.members.fetch(targetId).catch(() => null);
      if (!target) return message.reply(shortcutUsage(shortcutName, command));
      if (command === 'timeout' || command === 'untimeout') {
        const minutes = command === 'timeout' ? Number(argumentsList[1] || argumentsList[0]) : 0;
        if (command === 'timeout' && (!Number.isInteger(minutes) || minutes < 1 || minutes > 40320)) return message.reply(shortcutUsage(shortcutName, command));
        const reason = command === 'timeout' ? argumentsList.slice(2).join(' ') || 'بدون سبب' : argumentsList.slice(1).join(' ') || 'إزالة التايم أوت';
        await target.timeout(command === 'timeout' ? minutes * 60000 : null, reason);
        return message.reply(command === 'timeout' ? `تم إعطاء ${target.user.tag} تايم أوت.` : `تمت إزالة التايم أوت عن ${target.user.tag}.`);
      }
      const reason = argumentsList.slice(1).join(' ') || 'بدون سبب';
      if (command === 'warn') return message.reply(`تم تحذير ${target.user.tag}. السبب: ${reason}`);
      if (command === 'role_add' || command === 'role_remove') {
        const role = message.mentions.roles.first() || message.guild.roles.cache.get(argumentsList[0]);
        if (!role) return message.reply(shortcutUsage(shortcutName, command));
        if (command === 'role_add') await target.roles.add(role); else await target.roles.remove(role);
        return message.reply(command === 'role_add' ? `تم إعطاء رتبة ${role.name}.` : `تم سحب رتبة ${role.name}.`);
      }
      if (command === 'kick') {
        if (!canKickMember(target, message.guild)) return message.reply('لا يمكن طرد مالك السيرفر أو عضو يملك صلاحية Administrator.');
        if (message.guild.members.me.roles.highest.comparePositionTo(target.roles.highest) <= 0) return message.reply('لا يمكن طرد عضو رتبته أعلى من رتبة البوت أو مساوية لها.');
        await target.kick(reason);
      } else if (command === 'ban') await target.ban({ reason });
      return message.reply(`تم تنفيذ ${command} على ${target.user.tag}.`);
    } catch (error) {
      console.error(error);
      return message.reply('تعذر تنفيذ الاختصار. تأكد من صلاحيات البوت ورتبته.');
    }
  });

  client.on('error', (error) => console.error('Discord client error:', error));

  setInterval(async () => {
    await loadConfig();
    for (const guild of client.guilds.cache.values()) applyGuildSettings(guild);
  }, 2000);

  client.login(token);
}
