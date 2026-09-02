import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client, EmbedBuilder, Events, GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const textShortcutsEnabled = process.env.ENABLE_TEXT_SHORTCUTS === 'true';
const inviteTrackingEnabled = process.env.ENABLE_INVITE_TRACKING === 'true';
const configPath = join(process.cwd(), 'data/config.json');
let config = { guilds: {} };
const inviteCache = new Map();
const cooldowns = new Map();
const spamTracker = new Map();
const saveConfig = () => writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
const loadConfig = async () => {
  try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch { config = { guilds: {} }; }
};
const shortcutCommands = [
  { name: 'say', value: 'say' },
  { name: 'announce', value: 'announce' },
  { name: 'embed', value: 'embed' },
  { name: 'serverstats', value: 'serverstats' },
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
  say: PermissionFlagsBits.ManageMessages,
  announce: PermissionFlagsBits.ManageMessages,
  embed: PermissionFlagsBits.ManageMessages,
  serverstats: PermissionFlagsBits.ManageGuild,
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
  say: `استخدم: !${name} النص`,
  announce: `استخدم: !${name} النص`,
  embed: `استخدم: !${name} النص`,
  serverstats: `استخدم: !${name}`,
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
const getGuildData = (guildId) => {
  config.guilds[guildId] ||= { shortcuts: {}, settings: {}, users: {}, logs: {} };
  return config.guilds[guildId];
};
const getUserData = (guildId, userId) => {
  const guild = getGuildData(guildId);
  guild.users[userId] ||= { xp: 0, coins: 0, streak: 0, lastDaily: null, quest: { date: null, progress: 0, claimed: false }, achievements: [], title: '', activity: 0, mysteryClaimedAt: null };
  return guild.users[userId];
};
const levelForXp = (xp) => Math.floor(xp / 100) + 1;
const checkAchievements = (user) => {
  const unlocked = [];
  const achievements = [['first-xp', '🌱 بداية الطريق', user.xp >= 5], ['level-10', '⭐ مستوى 10', levelForXp(user.xp) >= 10], ['rich', '💰 أول 1000 Coins', user.coins >= 1000]];
  for (const [id, title, condition] of achievements) if (condition && !user.achievements.includes(id)) { user.achievements.push(id); unlocked.push(title); }
  return unlocked;
};
const onCooldown = (key, milliseconds) => {
  const previous = cooldowns.get(key) || 0;
  if (Date.now() - previous < milliseconds) return true;
  cooldowns.set(key, Date.now());
  return false;
};
const shopItems = [
  { name: 'حزمة XP', value: 'xp', price: 500 },
  { name: 'لقب Active', value: 'active', price: 750 },
  { name: 'حزمة Coins', value: 'coins', price: 900 },
  { name: 'لقب Veteran', value: 'veteran', price: 1200 },
  { name: 'Mystery Box', value: 'mystery', price: 1000 },
];
const lumeraEmbed = (title, description, color = 0x3568e5) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
const logAction = async (guild, type, title, fields) => {
  const channelId = getGuildData(guild.id).logs?.[type];
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [lumeraEmbed(title, '', 0x758090).addFields(fields)] }).catch(() => {});
};

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exitCode = 1;
} else if (!/^\d{17,20}$/.test(clientId)) {
  console.error('DISCORD_CLIENT_ID must be the numeric Application ID from Discord Developer Portal.');
  process.exitCode = 1;
} else {
  const commands = [
    new SlashCommandBuilder().setName('help').setDescription('عرض مركز مساعدة Lumera'),
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
    new SlashCommandBuilder().setName('profile').setDescription('عرض ملفك في Lumera'),
    new SlashCommandBuilder().setName('balance').setDescription('عرض رصيدك من Lumera Coins'),
    new SlashCommandBuilder().setName('daily').setDescription('استلام المكافأة اليومية'),
    new SlashCommandBuilder().setName('quest').setDescription('عرض مهمتك اليومية'),
    new SlashCommandBuilder().setName('leaderboard').setDescription('عرض المتصدرين').addStringOption((option) => option.setName('type').setDescription('نوع الترتيب').addChoices({ name: 'XP', value: 'xp' }, { name: 'Coins', value: 'coins' }, { name: 'Streak', value: 'streak' })),
    new SlashCommandBuilder().setName('pay').setDescription('تحويل Coins لعضو').addUserOption((option) => option.setName('user').setDescription('المستلم').setRequired(true)).addIntegerOption((option) => option.setName('amount').setDescription('المبلغ').setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName('shop').setDescription('متجر Lumera').addSubcommand((command) => command.setName('list').setDescription('عرض المتجر')).addSubcommand((command) => command.setName('buy').setDescription('شراء عنصر').addStringOption((option) => option.setName('item').setDescription('العنصر').addChoices(...shopItems.map(({ name, value }) => ({ name, value }))).setRequired(true))),
    new SlashCommandBuilder().setName('coinflip').setDescription('لعبة العملة').addIntegerOption((option) => option.setName('amount').setDescription('المبلغ').setMinValue(1).setRequired(true)),
    new SlashCommandBuilder().setName('rps').setDescription('حجر ورق مقص').addStringOption((option) => option.setName('choice').setDescription('اختيارك').addChoices({ name: 'حجر', value: 'rock' }, { name: 'ورق', value: 'paper' }, { name: 'مقص', value: 'scissors' }).setRequired(true)),
    new SlashCommandBuilder().setName('guess').setDescription('خمن الرقم من 1 إلى 5').addIntegerOption((option) => option.setName('number').setDescription('تخمينك').setMinValue(1).setMaxValue(5).setRequired(true)),
    new SlashCommandBuilder().setName('achievement').setDescription('عرض إنجازاتك'),
    new SlashCommandBuilder().setName('title').setDescription('اختيار لقب').addStringOption((option) => option.setName('name').setDescription('اللقب').setRequired(true)),
    new SlashCommandBuilder().setName('mystery').setDescription('فتح Mystery Reward واحدة'),
    new SlashCommandBuilder().setName('redeem').setDescription('استخدام كود مكافأة').addStringOption((option) => option.setName('code').setDescription('الكود').setRequired(true)),
    new SlashCommandBuilder().setName('redeem-create').setDescription('إنشاء كود مكافأة').addStringOption((option) => option.setName('code').setDescription('الكود').setRequired(true)).addIntegerOption((option) => option.setName('coins').setDescription('Coins').setMinValue(0).setRequired(true)).addIntegerOption((option) => option.setName('uses').setDescription('عدد الاستخدامات').setMinValue(1).setMaxValue(10000).setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('level-role').setDescription('ربط رتبة بمستوى').addSubcommand((command) => command.setName('add').setDescription('إضافة رتبة مستوى').addIntegerOption((option) => option.setName('level').setDescription('المستوى').setMinValue(1).setRequired(true)).addRoleOption((option) => option.setName('role').setDescription('الرتبة').setRequired(true))).addSubcommand((command) => command.setName('remove').setDescription('حذف الربط').addIntegerOption((option) => option.setName('level').setDescription('المستوى').setMinValue(1).setRequired(true))).setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder().setName('event').setDescription('إدارة الفعاليات').addSubcommand((command) => command.setName('create').setDescription('إنشاء فعالية').addStringOption((option) => option.setName('name').setDescription('الاسم').setRequired(true)).addStringOption((option) => option.setName('description').setDescription('الوصف').setRequired(true)).addIntegerOption((option) => option.setName('minutes').setDescription('مدة التسجيل بالدقائق').setMinValue(1).setMaxValue(10080).setRequired(true))).addSubcommand((command) => command.setName('list').setDescription('عرض الفعاليات')).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('welcome').setDescription('إعداد رسالة الترحيب').addStringOption((option) => option.setName('channel').setDescription('معرف الروم').setRequired(true)).addStringOption((option) => option.setName('message').setDescription('الرسالة واستخدم {user} و {server}').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('challenge').setDescription('إدارة التحديات').addSubcommand((command) => command.setName('create').setDescription('إنشاء تحدي XP').addStringOption((option) => option.setName('name').setDescription('اسم التحدي').setRequired(true)).addIntegerOption((option) => option.setName('minutes').setDescription('المدة بالدقائق').setMinValue(1).setMaxValue(10080).setRequired(true))).addSubcommand((command) => command.setName('leaderboard').setDescription('ترتيب التحدي')).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('season').setDescription('تفعيل موسم').addStringOption((option) => option.setName('name').setDescription('اسم الموسم').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('custom-reply').setDescription('إضافة رد تلقائي').addStringOption((option) => option.setName('trigger').setDescription('الكلمة المحفزة').setRequired(true).setMaxLength(40)).addStringOption((option) => option.setName('response').setDescription('الرد').setRequired(true).setMaxLength(1000)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('automod').setDescription('إعداد الحماية').addBooleanOption((option) => option.setName('links').setDescription('منع الروابط')).addBooleanOption((option) => option.setName('caps').setDescription('منع الأحرف الكبيرة')).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('say').setDescription('إرسال رسالة باسم البوت').addStringOption((option) => option.setName('text').setDescription('النص').setRequired(true).setMaxLength(2000)).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('announce').setDescription('إرسال إعلان منسق').addStringOption((option) => option.setName('title').setDescription('العنوان').setRequired(true).setMaxLength(256)).addStringOption((option) => option.setName('text').setDescription('المحتوى').setRequired(true).setMaxLength(4000)).addStringOption((option) => option.setName('image').setDescription('رابط صورة اختياري')).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('embed').setDescription('إرسال Embed مخصص').addStringOption((option) => option.setName('title').setDescription('العنوان').setRequired(true).setMaxLength(256)).addStringOption((option) => option.setName('description').setDescription('الوصف').setRequired(true).setMaxLength(4000)).addStringOption((option) => option.setName('color').setDescription('لون HEX مثل #3568e5')).setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder().setName('serverstats').setDescription('عرض إحصاءات السيرفر').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('suggest').setDescription('إرسال اقتراح').addStringOption((option) => option.setName('text').setDescription('الاقتراح').setRequired(true).setMaxLength(1000)),
    new SlashCommandBuilder().setName('create-role').setDescription('إنشاء رتبة Lumera عشوائية').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder().setName('setup-logs').setDescription('إنشاء قنوات اللوق').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
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
      if (interaction.isButton() && interaction.customId.startsWith('suggest:')) {
        const [, action, suggestionId] = interaction.customId.split(':');
        const guild = getGuildData(interaction.guild.id);
        const suggestion = guild.suggestions?.[suggestionId];
        if (!suggestion) return interaction.reply({ content: 'هذا الاقتراح غير موجود.', ephemeral: true });
        suggestion.voters ||= {};
        if (suggestion.voters[interaction.user.id]) return interaction.reply({ content: 'صوّت لهذا الاقتراح مسبقًا.', ephemeral: true });
        suggestion.voters[interaction.user.id] = action;
        suggestion[action === 'up' ? 'upvotes' : 'downvotes'] += 1;
        await saveConfig();
        return interaction.update({ embeds: [lumeraEmbed('💡 اقتراح Lumera', `${suggestion.text}\n\nالحالة: 🟡 قيد المراجعة`, 0xf2b84b).addFields({ name: 'صاحب الاقتراح', value: `<@${suggestion.authorId}>`, inline: true }, { name: '👍 مؤيد', value: String(suggestion.upvotes), inline: true }, { name: '👎 معارض', value: String(suggestion.downvotes), inline: true })], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`suggest:up:${suggestionId}`).setLabel(`👍 ${suggestion.upvotes}`).setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`suggest:down:${suggestionId}`).setLabel(`👎 ${suggestion.downvotes}`).setStyle(ButtonStyle.Danger))] });
      }
      if (interaction.isButton() && interaction.customId.startsWith('event:join:')) {
        const eventId = interaction.customId.slice('event:join:'.length);
        const event = getGuildData(interaction.guild.id).events?.[eventId];
        if (!event || Date.now() > event.endsAt) return interaction.reply({ content: 'انتهت الفعالية.', ephemeral: true });
        event.participants ||= [];
        if (!event.participants.includes(interaction.user.id)) event.participants.push(interaction.user.id);
        await saveConfig();
        return interaction.reply({ content: `تم تسجيلك في فعالية ${event.name}.`, ephemeral: true });
      }
      if (interaction.isChatInputCommand()) {
        if (!commandEnabled(interaction.guild.id, interaction.commandName) && interaction.commandName !== 'shortcut') return;
        const guildData = getGuildData(interaction.guild.id);
        logAction(interaction.guild, 'command', '⚡ استخدام أمر', [{ name: 'المستخدم', value: `${interaction.user.tag} (${interaction.user.id})` }, { name: 'الأمر', value: `/${interaction.commandName}` }, { name: 'الروم', value: `<#${interaction.channelId}>` }]);
        if (interaction.commandName === 'help') return interaction.reply({ embeds: [lumeraEmbed('✨ مركز Lumera', 'كل أنظمة السيرفر في مكان واحد.').addFields({ name: '🛡️ الإدارة', value: '`/clear` `/kick` `/ban` `/timeout` `/lock` `/role` `/say` `/announce` `/embed`' }, { name: '⭐ المجتمع', value: '`/profile` `/balance` `/daily` `/quest` `/leaderboard` `/achievement` `/title` `/mystery`' }, { name: '💰 الاقتصاد والألعاب', value: '`/pay` `/shop` `/coinflip` `/rps` `/guess` `/redeem`' }, { name: '🎪 الفعاليات', value: '`/event create` `/event list` `/challenge` `/season`' }, { name: '⚙️ النظام', value: '`/shortcut` `/setup-logs` `/create-role` `/welcome` `/custom-reply` `/automod` `/serverstats`' })] });
        if (interaction.commandName === 'profile' || interaction.commandName === 'balance') {
          const user = getUserData(interaction.guild.id, interaction.user.id);
          return interaction.reply({ embeds: [lumeraEmbed(`👤 ${interaction.user.globalName || interaction.user.username}`, `مستوى **${levelForXp(user.xp)}**\nXP: **${user.xp}**\nCoins: **${user.coins}**\nStreak: **${user.streak}**\nاللقب: **${user.title || 'بدون لقب'}**\nالإنجازات: **${user.achievements.length}**`, 0x8f79e8).setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))] });
        }
        if (interaction.commandName === 'daily') {
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const today = new Date().toISOString().slice(0, 10);
          if (user.lastDaily === today) return interaction.reply({ content: 'استلمت مكافأتك اليومية بالفعل.', ephemeral: true });
          user.lastDaily = today;
          user.streak += 1;
          user.coins += 100 + Math.min(user.streak * 10, 200);
          user.xp += 25;
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('🎁 مكافأة يومية', `حصلت على **${100 + Math.min(user.streak * 10, 200)} Coins** و **25 XP**.\n🔥 Streak: **${user.streak}**`, 0xf2b84b)] });
        }
        if (interaction.commandName === 'quest') {
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const today = new Date().toISOString().slice(0, 10);
          if (user.quest.date !== today) user.quest = { date: today, progress: 0, claimed: false };
          if (user.quest.progress >= 30 && !user.quest.claimed) {
            user.quest.claimed = true;
            user.xp += 100;
            user.coins += 50;
            await saveConfig();
            return interaction.reply({ embeds: [lumeraEmbed('🎉 اكتملت المهمة', '+100 XP و +50 Coins', 0x55b6a8)] });
          }
          return interaction.reply({ embeds: [lumeraEmbed('🎯 مهمة اليوم', `أرسل 30 رسالة\nالتقدم: **${user.quest.progress} / 30**\nالمكافأة: **150 XP + 75 Coins**`, 0x3568e5)] });
        }
        if (interaction.commandName === 'leaderboard') {
          const type = interaction.options.getString('type') || 'xp';
          const users = Object.entries(guildData.users || {}).sort(([, left], [, right]) => (right[type] || 0) - (left[type] || 0)).slice(0, 10);
          const labels = { xp: 'XP', coins: 'Coins', streak: 'Streak' };
          return interaction.reply({ embeds: [lumeraEmbed(`🏆 المتصدرون: ${labels[type]}`, users.map(([id, user], index) => `${index + 1}. <@${id}> — **${user[type] || 0}**`).join('\n') || 'لا توجد بيانات بعد.', 0xf2b84b)] });
        }
        if (interaction.commandName === 'pay') {
          const recipient = interaction.options.getUser('user');
          const amount = interaction.options.getInteger('amount');
          const sender = getUserData(interaction.guild.id, interaction.user.id);
          if (recipient.bot || recipient.id === interaction.user.id || sender.coins < amount) return interaction.reply({ content: 'التحويل غير ممكن. تحقق من العضو ورصيدك.', ephemeral: true });
          sender.coins -= amount;
          getUserData(interaction.guild.id, recipient.id).coins += amount;
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('💸 تم التحويل', `تم تحويل **${amount} Coins** إلى ${recipient}.`, 0x55b6a8)] });
        }
        if (interaction.commandName === 'shop') {
          const item = interaction.options.getString('item');
          if (interaction.options.getSubcommand() === 'list') return interaction.reply({ embeds: [lumeraEmbed('🛍️ متجر Lumera', shopItems.map(({ name, price }) => `${name} — ${price} Coins`).join('\n'), 0x8f79e8)] });
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const prices = Object.fromEntries(shopItems.map(({ value, price }) => [value, price]));
          if (!prices[item] || user.coins < prices[item] || (['active', 'veteran'].includes(item) && user.title.toLowerCase() === item)) return interaction.reply({ content: 'رصيدك غير كافٍ أو تملك هذا العنصر مسبقًا.', ephemeral: true });
          user.coins -= prices[item];
          if (item === 'xp') user.xp += 250;
          if (item === 'coins') user.coins += 600;
          if (item === 'active' || item === 'veteran') user.title = item[0].toUpperCase() + item.slice(1);
          if (item === 'mystery') user.mysteryClaimedAt = null;
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('✅ تمت عملية الشراء', item === 'xp' ? 'حصلت على **250 XP**.' : 'حصلت على لقب **Active**.', 0x55b6a8)] });
        }
        if (interaction.commandName === 'coinflip') {
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const amount = interaction.options.getInteger('amount');
          if (user.coins < amount || onCooldown(`coinflip:${interaction.guild.id}:${interaction.user.id}`, 10000)) return interaction.reply({ content: 'رصيدك غير كافٍ أو انتظر قليلًا قبل المحاولة التالية.', ephemeral: true });
          const won = randomInt(2) === 1;
          if (won) user.coins += amount; else user.coins -= amount;
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed(won ? '🪙 ربحت!' : '🪙 خسرت', `${won ? '+' : '-'}${amount} Coins\nرصيدك: **${user.coins}**`, won ? 0x55b6a8 : 0xe05d5d)] });
        }
        if (interaction.commandName === 'rps' || interaction.commandName === 'guess') {
          if (onCooldown(`${interaction.commandName}:${interaction.guild.id}:${interaction.user.id}`, 15000)) return interaction.reply({ content: 'انتظر قليلًا قبل لعب اللعبة مرة أخرى.', ephemeral: true });
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const result = interaction.commandName === 'rps' ? (() => {
            const botChoice = ['rock', 'paper', 'scissors'][randomInt(3)];
            const playerChoice = interaction.options.getString('choice');
            const won = (playerChoice === 'rock' && botChoice === 'scissors') || (playerChoice === 'paper' && botChoice === 'rock') || (playerChoice === 'scissors' && botChoice === 'paper');
            return { won, draw: playerChoice === botChoice, botChoice };
          })() : { won: randomInt(5) + 1 === interaction.options.getInteger('number'), draw: false, botChoice: null };
          const won = result.won;
          if (result.draw) return interaction.reply({ embeds: [lumeraEmbed('🤝 تعادل', `اختيار البوت: **${result.botChoice}**`, 0xf2b84b)] });
          if (won) { user.coins += 40; user.xp += 15; }
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed(won ? '🎉 فزت!' : '🎲 حظًا أوفر', won ? '+40 Coins و +15 XP' : 'لم تفز هذه المرة.', won ? 0x55b6a8 : 0xe05d5d)] });
        }
        if (interaction.commandName === 'achievement') {
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const labels = { 'first-xp': '🌱 بداية الطريق', 'level-10': '⭐ مستوى 10', rich: '💰 أول 1000 Coins' };
          return interaction.reply({ embeds: [lumeraEmbed('🏆 إنجازاتك', user.achievements.map((id) => labels[id] || id).join('\n') || 'لم تفتح أي إنجاز بعد.', 0xf2b84b)] });
        }
        if (interaction.commandName === 'title') {
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const titles = { Veteran: 'level-10', Active: 'first-xp', 'Lumera Legend': 'rich' };
          const name = interaction.options.getString('name');
          if (!titles[name] || !user.achievements.includes(titles[name])) return interaction.reply({ content: 'هذا اللقب غير متاح لك بعد.', ephemeral: true });
          user.title = name;
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('👑 تم اختيار اللقب', `لقبك الآن: **${name}**`, 0x8f79e8)] });
        }
        if (interaction.commandName === 'mystery') {
          const user = getUserData(interaction.guild.id, interaction.user.id);
          const today = new Date().toISOString().slice(0, 10);
          if (user.mysteryClaimedAt === today) return interaction.reply({ content: 'فتحت Mystery Reward اليوم. عد غدًا.', ephemeral: true });
          user.mysteryClaimedAt = today;
          const rewardType = randomInt(3);
          const reward = rewardType === 0 ? { text: '+250 XP', apply: () => { user.xp += 250; } } : rewardType === 1 ? { text: '+300 Coins', apply: () => { user.coins += 300; } } : { text: 'لقب Active', apply: () => { if (!user.achievements.includes('first-xp')) user.achievements.push('first-xp'); user.title = 'Active'; } };
          reward.apply();
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('📦 Mystery Reward', `حصلت على: **${reward.text}**`, 0xf2b84b)] });
        }
        if (interaction.commandName === 'redeem') {
          const code = interaction.options.getString('code').toUpperCase();
          const reward = guildData.redeemCodes?.[code];
          const user = getUserData(interaction.guild.id, interaction.user.id);
          if (!reward || reward.expiresAt < Date.now() || reward.uses <= 0 || reward.claimed?.includes(interaction.user.id)) return interaction.reply({ content: 'الكود غير صالح أو منتهي.', ephemeral: true });
          reward.uses -= 1;
          reward.claimed ||= [];
          reward.claimed.push(interaction.user.id);
          user.coins += reward.coins;
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('🎁 تم استرداد الكود', `حصلت على **${reward.coins} Coins**.`, 0x55b6a8)] });
        }
        if (interaction.commandName === 'redeem-create') {
          const code = interaction.options.getString('code').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
          const guild = getGuildData(interaction.guild.id);
          guild.redeemCodes ||= {};
          guild.redeemCodes[code] = { coins: interaction.options.getInteger('coins'), uses: interaction.options.getInteger('uses'), expiresAt: Date.now() + 30 * 86400000, claimed: [] };
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('🎟️ تم إنشاء الكود', `الكود: **${code}**\nينتهي خلال 30 يومًا.`, 0x55b6a8)] });
        }
        if (interaction.commandName === 'level-role') {
          const guild = getGuildData(interaction.guild.id);
          guild.levelRoles ||= {};
          const level = interaction.options.getInteger('level');
          if (interaction.options.getSubcommand() === 'remove') delete guild.levelRoles[level];
          else guild.levelRoles[level] = interaction.options.getRole('role').id;
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('⭐ تم تحديث رتب المستويات', 'تم حفظ إعدادات الرتب.', 0x8f79e8)] });
        }
        if (interaction.commandName === 'event') {
          const guild = getGuildData(interaction.guild.id);
          guild.events ||= {};
          if (interaction.options.getSubcommand() === 'list') {
            const events = Object.values(guild.events).filter((event) => event.endsAt > Date.now()).map((event) => `🎪 **${event.name}** — ${event.participants?.length || 0} مشارك`).join('\n');
            return interaction.reply({ embeds: [lumeraEmbed('🎪 الفعاليات الحالية', events || 'لا توجد فعاليات.', 0x55b6a8)] });
          }
          const id = `${Date.now()}-${interaction.user.id}`;
          const event = { name: interaction.options.getString('name'), description: interaction.options.getString('description'), endsAt: Date.now() + interaction.options.getInteger('minutes') * 60000, participants: [] };
          guild.events[id] = event;
          await saveConfig();
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`event:join:${id}`).setLabel('تسجيل المشاركة').setStyle(ButtonStyle.Success));
          return interaction.reply({ embeds: [lumeraEmbed(`🎪 ${event.name}`, event.description, 0x55b6a8)], components: [row] });
        }
        if (interaction.commandName === 'welcome') {
          const guild = getGuildData(interaction.guild.id);
          guild.settings.welcome = { channelId: interaction.options.getString('channel'), message: interaction.options.getString('message') };
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('👋 تم إعداد الترحيب', 'سيتم استخدام الرسالة عند دخول عضو جديد.', 0x55b6a8)] });
        }
        if (interaction.commandName === 'challenge') {
          if (interaction.options.getSubcommand() === 'leaderboard') {
            const challenge = guildData.challenge;
            const rows = Object.entries(challenge?.scores || {}).sort(([, left], [, right]) => right - left).slice(0, 10).map(([id, score], index) => `${index + 1}. <@${id}> — **${score} XP**`).join('\n');
            return interaction.reply({ embeds: [lumeraEmbed('🏆 ترتيب التحدي', rows || 'لا توجد مشاركات بعد.', 0xf2b84b)] });
          }
          guildData.challenge = { name: interaction.options.getString('name'), endsAt: Date.now() + interaction.options.getInteger('minutes') * 60000, scores: {} };
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('⚔️ بدأ التحدي', `**${guildData.challenge.name}**\nاجمع أكبر عدد من XP قبل انتهاء الوقت.`, 0xf2b84b)] });
        }
        if (interaction.commandName === 'season') {
          guildData.season = { name: interaction.options.getString('name'), startedAt: new Date().toISOString() };
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('🌟 موسم جديد', `تم تفعيل **${guildData.season.name}**.`, 0x8f79e8)] });
        }
        if (interaction.commandName === 'custom-reply') {
          guildData.replies ||= {};
          guildData.replies[interaction.options.getString('trigger').toLowerCase()] = interaction.options.getString('response');
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('💬 تم حفظ الرد التلقائي', `سيتم الرد عند كتابة: **${interaction.options.getString('trigger')}**`, 0x55b6a8)] });
        }
        if (interaction.commandName === 'automod') {
          guildData.automod = { links: interaction.options.getBoolean('links') ?? guildData.automod?.links ?? false, caps: interaction.options.getBoolean('caps') ?? guildData.automod?.caps ?? false };
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('🛡️ تم تحديث الحماية', `الروابط: ${guildData.automod.links ? 'ممنوعة' : 'مسموحة'}\nالأحرف الكبيرة: ${guildData.automod.caps ? 'ممنوعة' : 'مسموحة'}`, 0x55b6a8)] });
        }
        if (interaction.commandName === 'say') {
          await interaction.channel.send(interaction.options.getString('text'));
          return interaction.reply({ content: 'تم إرسال الرسالة.', ephemeral: true });
        }
        if (interaction.commandName === 'announce') {
          const announcement = lumeraEmbed(interaction.options.getString('title'), interaction.options.getString('text'), 0x3568e5).setAuthor({ name: interaction.user.globalName || interaction.user.username, iconURL: interaction.user.displayAvatarURL() });
          const image = interaction.options.getString('image');
          if (image) announcement.setImage(image);
          await interaction.channel.send({ embeds: [announcement] });
          return interaction.reply({ content: 'تم نشر الإعلان.', ephemeral: true });
        }
        if (interaction.commandName === 'embed') {
          const color = interaction.options.getString('color') || '#3568e5';
          if (!/^#?[0-9a-f]{6}$/i.test(color)) return interaction.reply({ content: 'لون HEX غير صحيح.', ephemeral: true });
          await interaction.channel.send({ embeds: [lumeraEmbed(interaction.options.getString('title'), interaction.options.getString('description'), Number.parseInt(color.replace('#', ''), 16))] });
          return interaction.reply({ content: 'تم نشر الـEmbed.', ephemeral: true });
        }
        if (interaction.commandName === 'serverstats') {
          const guild = getGuildData(interaction.guild.id);
          const users = Object.values(guild.users || {});
          const totalXp = users.reduce((sum, user) => sum + user.xp, 0);
          const totalCoins = users.reduce((sum, user) => sum + user.coins, 0);
          return interaction.reply({ embeds: [lumeraEmbed('📊 إحصاءات السيرفر', `الأعضاء: **${interaction.guild.memberCount}**\nالقنوات: **${interaction.guild.channels.cache.size}**\nمستخدمو النظام: **${users.length}**\nإجمالي XP: **${totalXp}**\nإجمالي Coins: **${totalCoins}**`, 0x55b6a8)] });
        }
        if (interaction.commandName === 'suggest') {
          guildData.suggestions ||= {};
          const id = `${Date.now()}-${interaction.user.id}`;
          guildData.suggestions[id] = { authorId: interaction.user.id, text: interaction.options.getString('text'), upvotes: 0, downvotes: 0, voters: {} };
          await saveConfig();
          const suggestion = guildData.suggestions[id];
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`suggest:up:${id}`).setLabel('👍 0').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`suggest:down:${id}`).setLabel('👎 0').setStyle(ButtonStyle.Danger));
          await interaction.reply({ embeds: [lumeraEmbed('💡 اقتراح Lumera', suggestion.text, 0xf2b84b).addFields({ name: 'صاحب الاقتراح', value: `<@${interaction.user.id}>`, inline: true }, { name: 'الحالة', value: '🟡 قيد المراجعة', inline: true })], components: [row] });
          return logAction(interaction.guild, 'suggestion', 'اقتراح جديد', [{ name: 'المستخدم', value: interaction.user.tag }, { name: 'النص', value: suggestion.text.slice(0, 1024) }]);
        }
        if (interaction.commandName === 'create-role') {
          const names = ['Lumera Elite', 'Lumera Guardian', 'Lumera Star', 'Lumera Prime'];
          const colors = [0x3568e5, 0x55b6a8, 0xf29b4b, 0x8f79e8];
          const index = randomInt(names.length);
          const baseName = names[index];
          const duplicateCount = interaction.guild.roles.cache.filter((role) => role.name === baseName || role.name.startsWith(`${baseName} `)).size;
          const role = await interaction.guild.roles.create({ name: duplicateCount ? `${baseName} ${duplicateCount + 1}` : baseName, colors: { primaryColor: colors[index] }, reason: `Created by ${interaction.user.tag}` });
          return interaction.reply({ embeds: [lumeraEmbed('🎭 تم إنشاء رتبة', `تم إنشاء ${role} بأمان بدون صلاحيات إدارية.`, colors[index]) ] });
        }
        if (interaction.commandName === 'setup-logs') {
          const logTypes = ['command', 'mod', 'role', 'security', 'member', 'message', 'suggestion', 'economy', 'quest', 'system'];
          const categoryName = '📋・LUMERA LOGS';
          let category = interaction.guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === categoryName);
          if (!category) category = await interaction.guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, permissionOverwrites: [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }] });
          guildData.logs ||= {};
          for (const type of logTypes) {
            let channel = interaction.guild.channels.cache.find((item) => item.parentId === category.id && item.name === `${type}-logs`);
            if (!channel) channel = await interaction.guild.channels.create({ name: `${type}-logs`, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: [{ id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }] });
            guildData.logs[type] = channel.id;
          }
          await saveConfig();
          return interaction.reply({ embeds: [lumeraEmbed('📋 تم إعداد اللوق', `تم تجهيز **${logTypes.length}** قنوات بدون تكرار.`, 0x55b6a8)] });
        }
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
    if (message.author.bot || !message.guild) return;
    const guildData = getGuildData(message.guild.id);
    const automod = guildData.automod || {};
    const recentMessages = spamTracker.get(`${message.guild.id}:${message.author.id}`) || [];
    const now = Date.now();
    recentMessages.push(now);
    spamTracker.set(`${message.guild.id}:${message.author.id}`, recentMessages.filter((time) => now - time < 10000));
    if (automod.links && /https?:\/\/|discord\.gg\//i.test(message.content)) return message.delete().catch(() => {});
    if (automod.caps && message.content.length > 12 && message.content === message.content.toUpperCase() && message.content !== message.content.toLowerCase()) return message.delete().catch(() => {});
    if (recentMessages.length >= 6) return message.delete().catch(() => {});
    const customResponse = Object.entries(guildData.replies || {}).find(([trigger]) => message.content.toLowerCase().includes(trigger))?.[1];
    if (customResponse) await message.reply(customResponse).catch(() => {});
    const user = getUserData(message.guild.id, message.author.id);
    const today = new Date().toISOString().slice(0, 10);
    if (user.quest.date !== today) user.quest = { date: today, progress: 0, claimed: false };
    if (!onCooldown(`xp:${message.guild.id}:${message.author.id}`, 60000)) {
      user.xp += 5;
      if (user.quest.progress < 30) user.quest.progress += 1;
      if (guildData.challenge?.endsAt > Date.now()) {
        guildData.challenge.scores[message.author.id] = (guildData.challenge.scores[message.author.id] || 0) + 5;
      }
      await saveConfig();
      const levelRoleId = Object.entries(getGuildData(message.guild.id).levelRoles || {}).filter(([level]) => Number(level) <= levelForXp(user.xp)).sort(([left], [right]) => Number(right) - Number(left))[0]?.[1];
      if (levelRoleId && !message.member.roles.cache.has(levelRoleId)) await message.member.roles.add(levelRoleId).catch(() => {});
    }
    if (!message.content.startsWith('!')) return;
    const [shortcutName, ...argumentsList] = message.content.slice(1).trim().split(/\s+/);
    if (!shortcutName) return;
    const command = config.guilds[message.guild.id]?.shortcuts?.[shortcutName.toLowerCase()];
    if (!command) return;
    if (!commandEnabled(message.guild.id, command)) return;
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
      if (command === 'say') return message.channel.send(argumentsList.join(' ') || shortcutUsage(shortcutName, command));
      if (command === 'announce' || command === 'embed') return message.channel.send({ embeds: [lumeraEmbed(command === 'announce' ? '📢 إعلان' : '✨ Lumera', argumentsList.join(' ') || shortcutUsage(shortcutName, command), command === 'announce' ? 0x3568e5 : 0x8f79e8)] });
      if (command === 'serverstats') {
        const users = Object.values(getGuildData(message.guild.id).users || {});
        return message.reply(`📊 الأعضاء: ${message.guild.memberCount}\nمستخدمو النظام: ${users.length}\nإجمالي XP: ${users.reduce((sum, user) => sum + user.xp, 0)}\nإجمالي Coins: ${users.reduce((sum, user) => sum + user.coins, 0)}`);
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
