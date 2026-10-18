/* =====================================================================
 *  SYSTEM BOT  (single file)
 *  Modules:
 *    [1] Tickets      ✅ (Components V2, fully customizable)
 *    [2] Profile      ✅ /banner /server-banner /badges
 *    [3] AFK          ✅ /afk
 *    [4] Top          ✅ /top /rank (text + voice, periods, pagination)
 *    [5] Broadcast    ✅ opt-in: /panel-bc /add-owner /remove-owner, bc / nbc
 *    [6] Roles        ✅ #up #down #rar #transfer #rt #backup-restore, انعاش, /panel-roles
 *  Add a new module = push one object to `modules`.
 * ===================================================================== */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  ButtonStyle,
  ButtonBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  RoleSelectMenuBuilder,
  MediaGalleryItemBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID, CATEGORY_ID } = process.env;

/* ============================== CONFIG ============================== */
const CONFIG = {
  // Replace the IDs with your own custom emojis
  emoji: {
    info: '<:info:000000000000000000>',
    ticket: '<:ticket:000000000000000000>',
    timer: '<a:timer:000000000000000000>',
    moderator: '<:moderator:000000000000000000>',
  },
  tickets: {
    defaultPanelText: 'Choose a ticket type below to open a ticket.',
    defaultWelcome: 'Please explain your request and wait for staff to respond.',
    closeDelayMs: 5000,
  },
  top: {
    utcOffsetHours: 3, // day boundary (3 = Saudi time)
    perPage: 10,
    messageCooldownMs: 3000, // anti-spam: max 1 counted message per 3s per user
    ignoredChannels: [], // channel IDs not counted
    keepDays: 35,
  },
  afk: { noticeDeleteMs: 10000 },
  roles: {
    prefix: '#',
    refreshWord: 'انعاش', // no-prefix keyword (owners only)
    backupHistory: 5, // snapshots kept per member
  },
  broadcast: {
    prefix: '', // '' => "bc message" / "nbc message"; set '!' for "!bc message"
    delayMs: 1200, // wait between DMs (keep >= 1000 to respect Discord limits)
  },
  // [label, emoji] -> replace emojis with your custom ones
  badges: {
    Staff: ['Discord Staff', '🛡️'],
    Partner: ['Partnered Server Owner', '🤝'],
    Hypesquad: ['HypeSquad Events', '🎉'],
    BugHunterLevel1: ['Bug Hunter', '🐛'],
    BugHunterLevel2: ['Bug Hunter Gold', '🏆'],
    HypeSquadOnlineHouse1: ['HypeSquad Bravery', '🟣'],
    HypeSquadOnlineHouse2: ['HypeSquad Brilliance', '🟠'],
    HypeSquadOnlineHouse3: ['HypeSquad Balance', '🟢'],
    PremiumEarlySupporter: ['Early Supporter', '⭐'],
    VerifiedBot: ['Verified Bot', '🤖'],
    VerifiedDeveloper: ['Early Verified Bot Developer', '🧑‍💻'],
    CertifiedModerator: ['Certified Moderator', '⚖️'],
    ActiveDeveloper: ['Active Developer', '🛠️'],
    Booster: ['Server Booster', '🚀'],
  },
};

/* ============================== STORAGE ============================= */
const DATA_FILE = path.join(__dirname, 'data.json');
const DEFAULTS = () => ({
  tickets: { counter: 0, panels: {} },
  afk: {},
  top: { users: {} },
  broadcast: { owners: [], roleId: null },
  roles: { ladder: [], team: [], refreshMessage: null, backups: {} },
});
const DB = (() => {
  try { return { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; }
  catch { return DEFAULTS(); }
})();
const saveDB = () => fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2));

/* ============================== HELPERS ============================= */
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const text = (c) => new TextDisplayBuilder().setContent(c);
// Every text reply is a Components V2 container
const card = (content) => new ContainerBuilder().addTextDisplayComponents(text(content));
const v2 = (content, extra = {}) => ({
  components: [card(content)],
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: { parse: [] },
  ...extra,
});
const ephemeral = (content) => v2(content, { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
const btn = (id, label, style, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const slug = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
const validEmoji = (e) => /^<a?:\w+:\d+>$/.test(e) || /\p{Extended_Pictographic}/u.test(e);

const modules = [];

/* ===================================================================
 *  MODULE 1: TICKETS
 * =================================================================== */
const STYLES = {
  blue: ButtonStyle.Primary,
  gray: ButtonStyle.Secondary,
  green: ButtonStyle.Success,
  red: ButtonStyle.Danger,
};

const ticketMeta = (channel) => ({
  owner: channel.topic?.match(/owner:(\d+)/)?.[1],
  role: channel.topic?.match(/role:(\d+)/)?.[1],
});
const isTicketStaff = (member, channel) => {
  const { role } = ticketMeta(channel);
  return (role && member.roles.cache.has(role)) || member.permissions.has(PermissionFlagsBits.ManageChannels);
};

function buildPanel(panel) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`## 🎫 ${panel.name}`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      text(panel.types.length ? panel.description || CONFIG.tickets.defaultPanelText : 'No ticket types yet. Use /ticket-button to add one.'),
    );

  if (panel.types.length) {
    container.addSeparatorComponents(sep());
    if (panel.mode === 'buttons') {
      for (let n = 0; n < panel.types.length; n += 5) {
        const row = new ActionRowBuilder();
        for (const t of panel.types.slice(n, n + 5)) {
          row.addComponents(btn(`ticket_open:${panel.id}:${t.id}`, t.label, STYLES[t.style] ?? ButtonStyle.Secondary, t.emoji));
        }
        container.addActionRowComponents(row);
      }
    } else {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`ticket_menu:${panel.id}`)
        .setPlaceholder('Select a ticket type')
        .addOptions(
          panel.types.map((t) => {
            const o = new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(t.id);
            if (t.description) o.setDescription(t.description);
            if (t.emoji) o.setEmoji(t.emoji);
            return o;
          }),
        );
      container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    }
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

async function refreshPanel(guild, panel) {
  const ch = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!ch) return false;
  const payload = buildPanel(panel);
  const msg = panel.messageId ? await ch.messages.fetch(panel.messageId).catch(() => null) : null;
  if (msg) await msg.edit(payload);
  else panel.messageId = (await ch.send(payload)).id;
  return true;
}

function buildTicketMessage({ type, number, timestamp, roleId, welcome }) {
  const E = CONFIG.emoji;
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`## ✅ Your ${type} ticket has been successfully opened`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(text(welcome || CONFIG.tickets.defaultWelcome))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      text(
        [
          `> ${E.info} **Type:** ${type}`,
          `> ${E.ticket} **Ticket:** #${number}`,
          `> ${E.timer} **Opened:** <t:${timestamp}:R>`,
          `> ${E.moderator} **Staff:** <@&${roleId}>`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(sep())
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        btn('ticket_add', 'Add Member', ButtonStyle.Secondary, '➕'),
        btn('ticket_remove', 'Remove Member', ButtonStyle.Secondary, '➖'),
        btn('ticket_rename', 'Rename', ButtonStyle.Secondary, '✏️'),
        btn('ticket_lock', 'Lock', ButtonStyle.Secondary, '🔒'),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(btn('ticket_close', 'Close Ticket', ButtonStyle.Danger)),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { roles: [roleId] } };
}

function buildClaimMessage(claimedBy = null) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(claimedBy ? `Claimed by <@${claimedBy}>` : 'Staff: press the button below to claim this ticket.'))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        btn('ticket_claim', claimedBy ? 'Claimed' : 'Claim', ButtonStyle.Success, '🙋').setDisabled(!!claimedBy),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function openTicket(i, panel, type) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  DB.tickets.counter += 1;
  const number = DB.tickets.counter;
  saveDB();

  const channel = await i.guild.channels.create({
    name: `${slug(type.label)}-${String(number).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent: type.categoryId || CATEGORY_ID || null,
    topic: `owner:${i.user.id} role:${type.roleId}`,
    permissionOverwrites: [
      { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: i.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      },
      {
        id: type.roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
      },
      {
        id: i.client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
      },
    ],
  });

  await channel.send(
    buildTicketMessage({
      type: type.label,
      number,
      timestamp: Math.floor(Date.now() / 1000),
      roleId: type.roleId,
      welcome: type.welcome,
    }),
  );
  await channel.send(buildClaimMessage());
  await i.editReply(v2(`✅ Ticket opened: ${channel}`));

  // Re-render the panel so the select menu returns to its default state
  if (panel.mode === 'menu') refreshPanel(i.guild, panel).catch(() => {});
}

const ticketModal = (id, title, label, placeholder) =>
  new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );

modules.push({
  name: 'tickets',
  commands: [
    new SlashCommandBuilder()
      .setName('ticket-setup')
      .setDescription('Create a ticket panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o.setName('mode').setDescription('Buttons or select menu').setRequired(true).addChoices(
          { name: 'Buttons', value: 'buttons' },
          { name: 'Select Menu', value: 'menu' },
        ),
      )
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Channel to send the panel in').addChannelTypes(ChannelType.GuildText).setRequired(true),
      )
      .addStringOption((o) => o.setName('name').setDescription('Panel / ticket name').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('description').setDescription('Panel text (optional)').setMaxLength(1000))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-button')
      .setDescription('Add a button / menu option to a panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) => o.setName('panel').setDescription('Panel name').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('label').setDescription('Button / option label').setRequired(true).setMaxLength(80))
      .addRoleOption((o) => o.setName('role').setDescription('Support role for this ticket type').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji (optional)'))
      .addStringOption((o) =>
        o.setName('style').setDescription('Button color (buttons mode only)').addChoices(
          { name: 'Blue', value: 'blue' },
          { name: 'Gray', value: 'gray' },
          { name: 'Green', value: 'green' },
          { name: 'Red', value: 'red' },
        ),
      )
      .addStringOption((o) => o.setName('description').setDescription('Option description (menu mode only)').setMaxLength(100))
      .addStringOption((o) => o.setName('welcome').setDescription('Welcome message inside the ticket (optional)').setMaxLength(1000))
      .addChannelOption((o) =>
        o.setName('category').setDescription('Category for these tickets (optional)').addChannelTypes(ChannelType.GuildCategory),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('ticket-remove')
      .setDescription('Remove a type from a panel, or the whole panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) => o.setName('panel').setDescription('Panel name').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('type').setDescription('Type to remove (empty = delete panel)').setAutocomplete(true))
      .toJSON(),
  ],

  async handle(i) {
    // ---- Autocomplete ----
    if (i.isAutocomplete() && ['ticket-button', 'ticket-remove'].includes(i.commandName)) {
      const focused = i.options.getFocused(true);
      const q = focused.value.toLowerCase();
      if (focused.name === 'panel') {
        await i.respond(
          Object.values(DB.tickets.panels)
            .filter((p) => p.name.toLowerCase().includes(q))
            .slice(0, 25)
            .map((p) => ({ name: `${p.name} (${p.mode})`, value: p.id })),
        );
      } else if (focused.name === 'type') {
        const panel = DB.tickets.panels[i.options.getString('panel')];
        await i.respond(
          (panel?.types ?? [])
            .filter((t) => t.label.toLowerCase().includes(q))
            .slice(0, 25)
            .map((t) => ({ name: t.label, value: t.id })),
        );
      }
      return true;
    }

    // ---- /ticket-setup ----
    if (i.isChatInputCommand() && i.commandName === 'ticket-setup') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const name = i.options.getString('name');
      const id = slug(name);
      if (DB.tickets.panels[id]) return void (await i.editReply(v2('❌ A panel with this name already exists.')));

      const channel = i.options.getChannel('channel');
      const panel = {
        id,
        name,
        mode: i.options.getString('mode'),
        description: i.options.getString('description'),
        channelId: channel.id,
        messageId: null,
        types: [],
      };
      const ok = await refreshPanel(i.guild, panel).catch(() => false);
      if (!ok) return void (await i.editReply(v2('❌ I cannot send messages in that channel.')));

      DB.tickets.panels[id] = panel;
      saveDB();
      await i.editReply(v2(`✅ Panel **${name}** created in ${channel}. Add types with /ticket-button.`));
      return true;
    }

    // ---- /ticket-button ----
    if (i.isChatInputCommand() && i.commandName === 'ticket-button') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const panel = DB.tickets.panels[i.options.getString('panel')];
      if (!panel) return void (await i.editReply(v2('❌ Panel not found.')));
      if (panel.types.length >= 25) return void (await i.editReply(v2('❌ Maximum 25 types per panel.')));

      const emoji = i.options.getString('emoji')?.trim() || null;
      if (emoji && !validEmoji(emoji)) return void (await i.editReply(v2('❌ Invalid emoji.')));

      panel.types.push({
        id: Date.now().toString(36),
        label: i.options.getString('label'),
        roleId: i.options.getRole('role').id,
        emoji,
        style: i.options.getString('style') ?? 'gray',
        description: i.options.getString('description'),
        welcome: i.options.getString('welcome'),
        categoryId: i.options.getChannel('category')?.id ?? null,
      });
      const ok = await refreshPanel(i.guild, panel).catch(() => false);
      saveDB();
      await i.editReply(v2(ok ? `✅ Added to **${panel.name}**.` : '⚠️ Saved, but I could not update the panel message.'));
      return true;
    }

    // ---- /ticket-remove ----
    if (i.isChatInputCommand() && i.commandName === 'ticket-remove') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const panel = DB.tickets.panels[i.options.getString('panel')];
      if (!panel) return void (await i.editReply(v2('❌ Panel not found.')));
      const typeId = i.options.getString('type');

      if (!typeId) {
        const ch = await i.guild.channels.fetch(panel.channelId).catch(() => null);
        const msg = await ch?.messages.fetch(panel.messageId).catch(() => null);
        await msg?.delete().catch(() => {});
        delete DB.tickets.panels[panel.id];
        saveDB();
        await i.editReply(v2('✅ Panel deleted.'));
        return true;
      }
      panel.types = panel.types.filter((t) => t.id !== typeId);
      await refreshPanel(i.guild, panel).catch(() => {});
      saveDB();
      await i.editReply(v2('✅ Type removed.'));
      return true;
    }

    // ---- Open ticket (button / menu) ----
    if ((i.isButton() && i.customId.startsWith('ticket_open:')) || (i.isStringSelectMenu() && i.customId.startsWith('ticket_menu:'))) {
      const parts = i.customId.split(':');
      const panel = DB.tickets.panels[parts[1]];
      const typeId = i.isButton() ? parts[2] : i.values[0];
      const type = panel?.types.find((t) => t.id === typeId);
      if (!panel || !type) {
        await i.reply(ephemeral('❌ This ticket type no longer exists.'));
        return true;
      }
      await openTicket(i, panel, type);
      return true;
    }

    // ---- Ticket buttons ----
    if (i.isButton() && i.customId.startsWith('ticket_')) {
      const id = i.customId;
      const staff = isTicketStaff(i.member, i.channel);

      if (id === 'ticket_claim') {
        if (!staff) await i.reply(ephemeral('❌ Staff only.'));
        else await i.update(buildClaimMessage(i.user.id));
        return true;
      }
      if (id === 'ticket_close') {
        if (!staff && i.user.id !== ticketMeta(i.channel).owner) {
          await i.reply(ephemeral('❌ You cannot close this ticket.'));
          return true;
        }
        await i.reply(ephemeral('🗑️ Closing in 5 seconds...'));
        setTimeout(() => i.channel.delete().catch(() => {}), CONFIG.tickets.closeDelayMs);
        return true;
      }
      if (!staff) {
        await i.reply(ephemeral('❌ Staff only.'));
        return true;
      }

      if (id === 'ticket_add') await i.showModal(ticketModal('ticket_add_modal', 'Add Member', 'User ID or mention', '123456789012345678'));
      else if (id === 'ticket_remove') await i.showModal(ticketModal('ticket_remove_modal', 'Remove Member', 'User ID or mention', '123456789012345678'));
      else if (id === 'ticket_rename') await i.showModal(ticketModal('ticket_rename_modal', 'Rename Ticket', 'New name', 'new-name'));
      else if (id === 'ticket_lock') {
        const { owner } = ticketMeta(i.channel);
        if (!owner) return void (await i.reply(ephemeral('❌ Owner not found.')));
        const locked = i.channel.permissionOverwrites.cache.get(owner)?.deny.has(PermissionFlagsBits.SendMessages);
        await i.channel.permissionOverwrites.edit(owner, { SendMessages: !!locked });
        await i.reply(ephemeral(locked ? '🔓 Ticket unlocked.' : '🔒 Ticket locked.'));
      } else return false;
      return true;
    }

    // ---- Ticket modals ----
    if (i.isModalSubmit() && i.customId.startsWith('ticket_')) {
      const value = i.fields.getTextInputValue('value').trim();

      if (i.customId === 'ticket_add_modal' || i.customId === 'ticket_remove_modal') {
        const member = await i.guild.members.fetch(value.replace(/\D/g, '')).catch(() => null);
        if (!member) return void (await i.reply(ephemeral('❌ Member not found.')));

        if (i.customId === 'ticket_add_modal') {
          await i.channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
          await i.reply(ephemeral(`✅ Added ${member}.`));
        } else if (member.id === ticketMeta(i.channel).owner) {
          await i.reply(ephemeral('❌ You cannot remove the ticket owner.'));
        } else {
          await i.channel.permissionOverwrites.delete(member.id);
          await i.reply(ephemeral(`✅ Removed ${member}.`));
        }
        return true;
      }
      if (i.customId === 'ticket_rename_modal') {
        await i.channel.setName(value.slice(0, 100));
        await i.reply(ephemeral('✅ Renamed.'));
        return true;
      }
    }
    return false;
  },
});

/* ===================================================================
 *  MODULE 2: PROFILE COMMANDS (Banner / Badges)
 * =================================================================== */
const unixTs = (ms) => Math.floor(ms / 1000);

const mediaCard = (title, url) => ({
  components: [
    new ContainerBuilder()
      .addTextDisplayComponents(text(title))
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)))
      .addTextDisplayComponents(text(`[Open original](${url})`)),
  ],
  flags: MessageFlags.IsComponentsV2,
});

modules.push({
  name: 'profile',
  commands: [
    new SlashCommandBuilder()
      .setName('banner')
      .setDescription("Show a user's banner")
      .addUserOption((o) => o.setName('user').setDescription('User (default: you)'))
      .toJSON(),
    new SlashCommandBuilder().setName('server-banner').setDescription('Show the server banner').toJSON(),
    new SlashCommandBuilder()
      .setName('badges')
      .setDescription("Show a user's badges")
      .addUserOption((o) => o.setName('user').setDescription('User (default: you)'))
      .toJSON(),
  ],

  async handle(i) {
    if (!i.isChatInputCommand()) return false;

    if (i.commandName === 'banner') {
      await i.deferReply();
      const user = await (i.options.getUser('user') ?? i.user).fetch(true);
      const url = user.bannerURL({ size: 1024 });
      if (!url) await i.editReply(v2(`❌ **${user.displayName}** has no banner.`));
      else await i.editReply(mediaCard(`## 🖼️ ${user.displayName}'s Banner`, url));
      return true;
    }

    if (i.commandName === 'server-banner') {
      await i.deferReply();
      const guild = await i.guild.fetch();
      const url = guild.bannerURL({ size: 1024 });
      if (!url) await i.editReply(v2('❌ This server has no banner.'));
      else await i.editReply(mediaCard(`## 🖼️ ${guild.name}'s Banner`, url));
      return true;
    }

    if (i.commandName === 'badges') {
      const user = i.options.getUser('user') ?? i.user;
      const member = i.options.getMember('user') ?? (user.id === i.user.id ? i.member : null);
      const B = CONFIG.badges;

      const lines = (user.flags?.toArray() ?? []).filter((n) => B[n]).map((n) => `> ${B[n][1]} **${B[n][0]}**`);
      const boost = member?.premiumSinceTimestamp ?? (member?.premium_since ? Date.parse(member.premium_since) : null);
      if (boost) lines.push(`> ${B.Booster[1]} **${B.Booster[0]}** since <t:${unixTs(boost)}:R>`);

      const container = new ContainerBuilder()
        .addTextDisplayComponents(text(`## 🏅 ${user.displayName}'s Badges`))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(lines.length ? lines.join('\n') : 'No badges.'))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(`-# Account created <t:${unixTs(user.createdTimestamp)}:D>`));
      await i.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return true;
    }
    return false;
  },
});

/* ===================================================================
 *  MODULE 3: AFK
 * =================================================================== */
modules.push({
  name: 'afk',
  commands: [
    new SlashCommandBuilder()
      .setName('afk')
      .setDescription('Set yourself as AFK')
      .addStringOption((o) => o.setName('reason').setDescription('Reason (optional)').setMaxLength(100))
      .toJSON(),
  ],

  async handle(i) {
    if (!i.isChatInputCommand() || i.commandName !== 'afk') return false;
    const reason = i.options.getString('reason') || 'AFK';
    DB.afk[i.user.id] = { reason, since: Date.now() };
    saveDB();
    await i.reply(v2(`😴 ${i.user} is now AFK — ${reason}`));
    return true;
  },

  init(client) {
    client.on('messageCreate', async (msg) => {
      if (msg.author.bot || !msg.guild) return;

      const notify = async (content) => {
        const m = await msg.reply(v2(content, { allowedMentions: { parse: [], repliedUser: false } })).catch(() => null);
        if (m) setTimeout(() => m.delete().catch(() => {}), CONFIG.afk.noticeDeleteMs);
      };

      if (DB.afk[msg.author.id]) {
        delete DB.afk[msg.author.id];
        saveDB();
        await notify(`👋 Welcome back ${msg.author}, your AFK was removed.`);
      }

      const lines = [...msg.mentions.users.values()]
        .filter((u) => !u.bot && u.id !== msg.author.id && DB.afk[u.id])
        .map((u) => `💤 **${u.displayName}** is AFK: ${DB.afk[u.id].reason} (<t:${unixTs(DB.afk[u.id].since)}:R>)`);
      if (lines.length) await notify(lines.join('\n'));
    });
  },
});

/* ===================================================================
 *  MODULE 4: TOP SYSTEM (Text + Voice, Today / Week / Month / All)
 *  - daily buckets, anti-spam cooldown, pagination, per-user rank
 * =================================================================== */
const T = CONFIG.top;
const TOP_TYPES = { text: ['Text', '💬', 'm'], voice: ['Voice', '🎙️', 'v'] };
const TOP_PERIODS = { today: 'Today', week: 'This Week', month: 'This Month', all: 'All Time' };

const voiceJoined = new Map(); // userId -> start timestamp
const lastMsg = new Map(); // userId -> last counted message timestamp
let topDirty = false;

const dayKey = (ts = Date.now()) => new Date(ts + T.utcOffsetHours * 3600000).toISOString().slice(0, 10);
const inVoice = (s) => s.channelId && s.channelId !== s.guild.afkChannelId;

function bump(id, field, amount) {
  const u = (DB.top.users[id] ??= { m: 0, v: 0, days: {} });
  u[field] += amount;
  const d = (u.days[dayKey()] ??= { m: 0, v: 0 });
  d[field] += amount;
  topDirty = true;
}

function flushVoice(id, remove = false) {
  const since = voiceJoined.get(id);
  if (since == null) return;
  const secs = Math.floor((Date.now() - since) / 1000);
  if (secs > 0) bump(id, 'v', secs);
  if (remove) voiceJoined.delete(id);
  else voiceJoined.set(id, since + secs * 1000);
}

function prune() {
  const cutoff = dayKey(Date.now() - T.keepDays * 86400000);
  for (const u of Object.values(DB.top.users)) for (const k of Object.keys(u.days)) if (k < cutoff) delete u.days[k];
}

function leaderboard(field, period) {
  const days = { today: 1, week: 7, month: 30 }[period];
  const keys = days ? Array.from({ length: days }, (_, n) => dayKey(Date.now() - n * 86400000)) : null;
  return Object.entries(DB.top.users)
    .map(([id, u]) => [id, keys ? keys.reduce((s, k) => s + (u.days[k]?.[field] || 0), 0) : u[field]])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
}

const fmtDuration = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtValue = (field, v) => (field === 'm' ? `${v.toLocaleString('en-US')} msgs` : fmtDuration(v));
const topId = (type, period, page, uid) => `top:${type}:${period}:${page}:${uid}`;

function buildTop({ type, period, page, userId }) {
  const field = TOP_TYPES[type][2];
  const list = leaderboard(field, period);
  const pages = Math.max(1, Math.ceil(list.length / T.perPage));
  page = Math.min(Math.max(page, 0), pages - 1);

  const medals = ['🥇', '🥈', '🥉'];
  const body = list.length
    ? list
        .slice(page * T.perPage, page * T.perPage + T.perPage)
        .map(([id, v], n) => {
          const rank = page * T.perPage + n + 1;
          return `${medals[rank - 1] ?? `**${rank}.**`} <@${id}> — **${fmtValue(field, v)}**`;
        })
        .join('\n')
    : 'No data yet.';

  const mine = list.findIndex(([id]) => id === userId);
  const footer = `-# ${mine >= 0 ? `Your rank: #${mine + 1} • ` : ''}Page ${page + 1}/${pages}`;

  const typeRow = new ActionRowBuilder().addComponents(
    Object.entries(TOP_TYPES).map(([k, [label, emoji]]) =>
      btn(topId(k, period, 0, userId), label, k === type ? ButtonStyle.Primary : ButtonStyle.Secondary, emoji).setDisabled(k === type),
    ),
  );
  const periodRow = new ActionRowBuilder().addComponents(
    Object.entries(TOP_PERIODS).map(([k, label]) =>
      btn(topId(type, k, 0, userId), label, k === period ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(k === period),
    ),
  );
  const navRow = new ActionRowBuilder().addComponents(
    btn(topId(type, period, page - 1, userId), 'Previous', ButtonStyle.Secondary, '⬅️').setDisabled(page <= 0),
    btn('top_page', `${page + 1}/${pages}`, ButtonStyle.Secondary).setDisabled(true),
    btn(topId(type, period, page + 1, userId), 'Next', ButtonStyle.Secondary, '➡️').setDisabled(page >= pages - 1),
  );

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`## 🏆 Top ${TOP_TYPES[type][0]} — ${TOP_PERIODS[period]}`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(text(body))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(text(footer))
    .addSeparatorComponents(sep())
    .addActionRowComponents(typeRow)
    .addActionRowComponents(periodRow)
    .addActionRowComponents(navRow);

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

modules.push({
  name: 'top',
  commands: [
    new SlashCommandBuilder()
      .setName('top')
      .setDescription('Leaderboard for text and voice activity')
      .addStringOption((o) =>
        o.setName('type').setDescription('Text or voice (default: text)').addChoices(
          { name: 'Text', value: 'text' },
          { name: 'Voice', value: 'voice' },
        ),
      )
      .addStringOption((o) =>
        o.setName('period').setDescription('Period (default: week)').addChoices(
          { name: 'Today', value: 'today' },
          { name: 'This Week', value: 'week' },
          { name: 'This Month', value: 'month' },
          { name: 'All Time', value: 'all' },
        ),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Show your (or another user\'s) activity and rank')
      .addUserOption((o) => o.setName('user').setDescription('User (default: you)'))
      .toJSON(),
  ],

  async handle(i) {
    if (i.isChatInputCommand() && i.commandName === 'top') {
      await i.reply(
        buildTop({
          type: i.options.getString('type') ?? 'text',
          period: i.options.getString('period') ?? 'week',
          page: 0,
          userId: i.user.id,
        }),
      );
      return true;
    }

    if (i.isChatInputCommand() && i.commandName === 'rank') {
      const user = i.options.getUser('user') ?? i.user;
      const sections = Object.entries(TOP_TYPES).map(([, [label, emoji, field]]) => {
        const rows = Object.entries(TOP_PERIODS).map(([period, plabel]) => {
          const list = leaderboard(field, period);
          const idx = list.findIndex(([id]) => id === user.id);
          return idx >= 0 ? `> **${plabel}:** ${fmtValue(field, list[idx][1])} (#${idx + 1})` : `> **${plabel}:** —`;
        });
        return `### ${emoji} ${label}\n${rows.join('\n')}`;
      });
      const container = new ContainerBuilder()
        .addTextDisplayComponents(text(`## 📊 ${user.displayName}'s Activity`))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(sections.join('\n')));
      await i.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
      return true;
    }

    if (i.isButton() && i.customId.startsWith('top:')) {
      const [, type, period, page, uid] = i.customId.split(':');
      if (i.user.id !== uid) {
        await i.reply(ephemeral('❌ Run /top yourself to use these buttons.'));
        return true;
      }
      await i.update(buildTop({ type, period, page: Number(page), userId: uid }));
      return true;
    }
    return false;
  },

  init(client) {
    client.on('messageCreate', (msg) => {
      if (msg.author.bot || !msg.guild || T.ignoredChannels.includes(msg.channelId)) return;
      const now = Date.now();
      if (now - (lastMsg.get(msg.author.id) ?? 0) < T.messageCooldownMs) return;
      lastMsg.set(msg.author.id, now);
      bump(msg.author.id, 'm', 1);
    });

    client.on('voiceStateUpdate', (oldS, newS) => {
      if (newS.member?.user.bot) return;
      if (!inVoice(oldS) && inVoice(newS)) voiceJoined.set(newS.id, Date.now());
      else if (inVoice(oldS) && !inVoice(newS)) flushVoice(newS.id, true);
    });

    // Seed users already in voice when the bot starts
    client.guilds.cache.get(GUILD_ID)?.voiceStates.cache.forEach((vs) => {
      if (vs.member && !vs.member.user.bot && inVoice(vs)) voiceJoined.set(vs.id, Date.now());
    });

    setInterval(() => {
      for (const id of voiceJoined.keys()) flushVoice(id);
      prune();
      if (topDirty) {
        saveDB();
        topDirty = false;
      }
    }, 60000);

    const shutdown = () => {
      for (const id of voiceJoined.keys()) flushVoice(id);
      saveDB();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },
});

/* ===================================================================
 *  MODULE 5: BROADCAST (opt-in only)
 *  - Members subscribe themselves with a button (gets the subscriber role)
 *  - Owners only: /panel-bc, /add-owner, /remove-owner, bc / nbc
 *  - One bot, sequential sending with a delay (respects Discord limits)
 * =================================================================== */
const BC = CONFIG.broadcast;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isBcOwner = (userId, guild) => userId === guild.ownerId || DB.broadcast.owners.includes(userId);
const subscriberRole = (guild) => (DB.broadcast.roleId ? guild.roles.cache.get(DB.broadcast.roleId) : null);
let bcRunning = false;

function buildBcPanel(guild, view = 'main') {
  const role = subscriberRole(guild);
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text('## 📣 Broadcast Panel'))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      text(
        [
          `> 🏷️ **Subscriber role:** ${role ? `<@&${role.id}>` : 'Not set'}`,
          `> 👥 **Subscribers:** ${role ? role.members.size : 0}`,
          `> ⏱️ **Delay:** ${(BC.delayMs / 1000).toFixed(1)}s per message`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      text(`\`${BC.prefix}bc <message>\` → all subscribers\n\`${BC.prefix}nbc <message>\` → online subscribers only`),
    )
    .addSeparatorComponents(sep());

  if (view === 'role') {
    container
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder().setCustomId('bc_role_select').setPlaceholder('Select the subscriber role').setMinValues(1).setMaxValues(1),
        ),
      )
      .addActionRowComponents(new ActionRowBuilder().addComponents(btn('bc_back', 'Back', ButtonStyle.Secondary, '⬅️')));
  } else {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        btn('bc_role', 'Role', ButtonStyle.Primary, '🏷️'),
        btn('bc_post', 'Post Subscribe Button', ButtonStyle.Success, '🔔').setDisabled(!role),
        btn('bc_refresh', 'Refresh', ButtonStyle.Secondary, '🔄'),
      ),
    );
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

const optInPost = () => ({
  components: [
    new ContainerBuilder()
      .addTextDisplayComponents(text('## 📣 Announcements by DM'))
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(
        text('Press the button to receive server announcements in your DMs. Press it again anytime to unsubscribe.\n-# Keep your DMs open for this server.'),
      )
      .addSeparatorComponents(sep())
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(btn('bc_toggle', 'Subscribe / Unsubscribe', ButtonStyle.Success, '🔔')),
      ),
  ],
  flags: MessageFlags.IsComponentsV2,
  allowedMentions: { parse: [] },
});

async function runBroadcast(guild, content, onlineOnly, update) {
  const role = subscriberRole(guild);
  if (!role) return update('❌ Subscriber role is not set. Use /panel-bc.');
  if (bcRunning) return update('⏳ A broadcast is already running.');

  bcRunning = true;
  try {
    await guild.members.fetch().catch(() => {});
    let members = [...role.members.values()].filter((m) => !m.user.bot);
    if (onlineOnly) members = members.filter((m) => m.presence && m.presence.status !== 'offline');
    if (!members.length) return update('❌ No subscribers to send to.');

    const payload = {
      components: [
        new ContainerBuilder()
          .addTextDisplayComponents(text(content))
          .addSeparatorComponents(sep())
          .addTextDisplayComponents(text(`-# You are receiving this because you subscribed to announcements in **${guild.name}**.`)),
      ],
      flags: MessageFlags.IsComponentsV2,
    };

    let sent = 0;
    let failed = 0;
    for (const [n, member] of members.entries()) {
      await member.send(payload).then(() => sent++).catch(() => failed++);
      if ((n + 1) % 10 === 0 && n + 1 < members.length) await update(`📤 Sending... ${n + 1}/${members.length}`);
      await sleep(BC.delayMs);
    }
    await update(`✅ Done — sent: **${sent}**, failed: **${failed}** (DMs closed) • total: **${members.length}**`);
  } finally {
    bcRunning = false;
  }
}

modules.push({
  name: 'broadcast',
  commands: [
    new SlashCommandBuilder()
      .setName('panel-bc')
      .setDescription('Broadcast panel (owners only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('add-owner')
      .setDescription('Add a broadcast owner')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('remove-owner')
      .setDescription('Remove a broadcast owner')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .toJSON(),
  ],

  async handle(i) {
    // ---- Public subscribe toggle ----
    if (i.isButton() && i.customId === 'bc_toggle') {
      const role = subscriberRole(i.guild);
      if (!role) {
        await i.reply(ephemeral('❌ Broadcasts are not configured yet.'));
        return true;
      }
      const has = i.member.roles.cache.has(role.id);
      await (has ? i.member.roles.remove(role.id) : i.member.roles.add(role.id));
      await i.reply(ephemeral(has ? '🔕 You unsubscribed from announcements.' : '🔔 You are subscribed. Keep your DMs open to receive messages.'));
      return true;
    }

    const mine = (i.isChatInputCommand() && ['panel-bc', 'add-owner', 'remove-owner'].includes(i.commandName)) ||
      ((i.isButton() || i.isRoleSelectMenu()) && i.customId.startsWith('bc_'));
    if (!mine) return false;

    if (!isBcOwner(i.user.id, i.guild)) {
      await i.reply(ephemeral('❌ Owners only.'));
      return true;
    }

    // ---- Slash commands ----
    if (i.isChatInputCommand()) {
      if (i.commandName === 'panel-bc') {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        await i.guild.members.fetch().catch(() => {});
        await i.editReply(buildBcPanel(i.guild));
        return true;
      }
      const user = i.options.getUser('user');
      if (i.commandName === 'add-owner') {
        if (user.bot) await i.reply(ephemeral('❌ You cannot add a bot.'));
        else if (DB.broadcast.owners.includes(user.id)) await i.reply(ephemeral('❌ Already an owner.'));
        else {
          DB.broadcast.owners.push(user.id);
          saveDB();
          await i.reply(ephemeral(`✅ ${user} is now a broadcast owner.`));
        }
        return true;
      }
      DB.broadcast.owners = DB.broadcast.owners.filter((id) => id !== user.id);
      saveDB();
      await i.reply(ephemeral(`✅ ${user} was removed from broadcast owners.`));
      return true;
    }

    // ---- Panel components ----
    switch (i.customId) {
      case 'bc_role':
        await i.update(buildBcPanel(i.guild, 'role'));
        break;
      case 'bc_back':
        await i.update(buildBcPanel(i.guild));
        break;
      case 'bc_refresh':
        await i.guild.members.fetch().catch(() => {});
        await i.update(buildBcPanel(i.guild));
        break;
      case 'bc_role_select': {
        const role = i.roles.first();
        if (role.id === i.guild.id || role.managed) {
          await i.reply(ephemeral('❌ Choose a normal role (not @everyone or a bot role).'));
        } else if (role.position >= i.guild.members.me.roles.highest.position) {
          await i.reply(ephemeral('❌ That role is above my highest role, so I cannot assign it.'));
        } else {
          DB.broadcast.roleId = role.id;
          saveDB();
          await i.update(buildBcPanel(i.guild));
        }
        break;
      }
      case 'bc_post':
        await i.channel.send(optInPost());
        await i.reply(ephemeral('✅ Subscribe message posted in this channel.'));
        break;
      default:
        return false;
    }
    return true;
  },

  init(client) {
    const re = new RegExp(`^${escapeRe(BC.prefix)}(bc|nbc)\\s+([\\s\\S]+)$`, 'i');
    client.on('messageCreate', async (msg) => {
      if (msg.author.bot || !msg.guild) return;
      const m = msg.content.match(re);
      if (!m || !isBcOwner(msg.author.id, msg.guild)) return;

      const status = await msg.reply(v2('📤 Preparing...')).catch(() => null);
      if (!status) return;
      const update = (c) => status.edit(v2(c)).catch(() => {});
      await runBroadcast(msg.guild, m[2].trim(), m[1].toLowerCase() === 'nbc', update);
    });
  },
});

/* ===================================================================
 *  MODULE 6: ROLES (#up #down #rar #transfer #rt #backup-restore + انعاش)
 *  Owners only (same list as /add-owner). Dashboard: /panel-roles
 * =================================================================== */
const R = CONFIG.roles;
const normAr = (s) => s.trim().replace(/[إأآ]/g, 'ا').replace(/[\u064B-\u0652\u0640]/g, '').toLowerCase();
const assignable = (guild, role) =>
  !!role && role.id !== guild.id && !role.managed && role.position < guild.members.me.roles.highest.position;
const ladderRoles = (guild) =>
  DB.roles.ladder.map((id) => guild.roles.cache.get(id)).filter(Boolean).sort((a, b) => a.position - b.position);
const teamRoles = (guild) => DB.roles.team.map((id) => guild.roles.cache.get(id)).filter(Boolean);
const rMention = (r) => `<@&${r.id}>`;

function saveSnapshot(guild, userId, roles, reason) {
  const ids = roles.filter((r) => r.id !== guild.id && !r.managed).map((r) => r.id);
  if (!ids.length) return;
  const list = DB.roles.backups[userId] ?? [];
  list.unshift({ roles: ids, at: Date.now(), reason });
  DB.roles.backups[userId] = list.slice(0, R.backupHistory);
  saveDB();
}

function buildRolesPanel(guild, view = 'main') {
  const ladder = ladderRoles(guild);
  const team = teamRoles(guild);
  const msgPreview = DB.roles.refreshMessage ? DB.roles.refreshMessage.slice(0, 120) : 'Not set';

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text('## 🛡️ Roles Panel'))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      text(
        [
          `> 🪜 **Ranks (low → high):** ${ladder.length ? ladder.map(rMention).join(' › ') : 'Not set'}`,
          `> 👥 **Support team roles:** ${team.length ? team.map(rMention).join(' ') : 'Not set'}`,
          `> 💬 **${R.refreshWord} reply:** ${msgPreview}`,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(
      text(
        [
          `\`${R.prefix}up @user\` · \`${R.prefix}down @user\` · \`${R.prefix}rar @user\``,
          `\`${R.prefix}transfer @from @to\` · \`${R.prefix}rt @user\` · \`${R.prefix}backup-restore @user\``,
        ].join('\n'),
      ),
    )
    .addSeparatorComponents(sep());

  if (view === 'ranks' || view === 'team') {
    const current = view === 'ranks' ? DB.roles.ladder : DB.roles.team;
    const select = new RoleSelectMenuBuilder()
      .setCustomId(view === 'ranks' ? 'rr_ranks_select' : 'rr_team_select')
      .setPlaceholder(view === 'ranks' ? 'Select rank roles (order = role hierarchy)' : 'Select support team roles')
      .setMinValues(1)
      .setMaxValues(25);
    const defaults = current.filter((id) => guild.roles.cache.has(id)).slice(0, 25);
    if (defaults.length) select.setDefaultRoles(defaults);
    container
      .addActionRowComponents(new ActionRowBuilder().addComponents(select))
      .addActionRowComponents(new ActionRowBuilder().addComponents(btn('rr_back', 'Back', ButtonStyle.Secondary, '⬅️')));
  } else {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        btn('rr_msg', `${R.refreshWord} Message`, ButtonStyle.Primary, '💬'),
        btn('rr_ranks', 'Ranks', ButtonStyle.Secondary, '🪜'),
        btn('rr_team', 'Team Roles', ButtonStyle.Secondary, '👥'),
      ),
    );
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function refreshModal() {
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel('Reply message')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1500)
    .setRequired(true);
  if (DB.roles.refreshMessage) input.setValue(DB.roles.refreshMessage.slice(0, 1500));
  return new ModalBuilder()
    .setCustomId('rr_msg_modal')
    .setTitle(`${R.refreshWord} reply`)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function runRoleCommand(msg, cmd, ids) {
  const guild = msg.guild;
  const reason = `${R.prefix}${cmd} by ${msg.author.tag}`;
  const say = (c) => msg.reply(v2(c, { allowedMentions: { parse: [], repliedUser: false } })).catch(() => {});
  const getMember = (id) => guild.members.fetch(id).catch(() => null);

  try {
    if (ids.length < (cmd === 'transfer' ? 2 : 1)) {
      return say(`❌ Usage: \`${R.prefix}${cmd} ${cmd === 'transfer' ? '@from @to' : '@user'}\``);
    }
    const member = await getMember(ids[0]);
    if (!member) return say('❌ Member not found in the server.');
    if (!member.manageable) return say('❌ I cannot manage this member (their top role is above mine).');

    switch (cmd) {
      case 'up': {
        const ladder = ladderRoles(guild);
        if (!ladder.length) return say('❌ Ranks are not set. Use /panel-roles.');
        const owned = ladder.filter((r) => member.roles.cache.has(r.id));
        const next = owned.length ? ladder[ladder.indexOf(owned.at(-1)) + 1] : ladder[0];
        if (!next) return say(`❌ ${member} is already at the top rank.`);
        if (!assignable(guild, next)) return say(`❌ I cannot assign ${rMention(next)} (it is above my role).`);
        await member.roles.add(next, reason);
        return say(`⬆️ ${member} was promoted to ${rMention(next)}.`);
      }

      case 'down': {
        const owned = ladderRoles(guild).filter((r) => member.roles.cache.has(r.id));
        if (!owned.length) return say(`❌ ${member} has no ranks.`);
        const top = owned.at(-1);
        if (!assignable(guild, top)) return say(`❌ I cannot remove ${rMention(top)} (it is above my role).`);
        await member.roles.remove(top, reason);
        return say(`⬇️ ${rMention(top)} was removed from ${member}.`);
      }

      case 'rar': {
        const removable = member.roles.cache.filter((r) => assignable(guild, r));
        if (!removable.size) return say('❌ Nothing to remove.');
        await member.roles.remove([...removable.keys()], reason);
        return say(`🧹 Removed **${removable.size}** roles from ${member}. Undo with \`${R.prefix}backup-restore\`.`);
      }

      case 'transfer': {
        const to = await getMember(ids[1]);
        if (!to) return say('❌ Second member not found in the server.');
        if (to.id === member.id) return say('❌ Choose two different members.');
        if (!to.manageable) return say('❌ I cannot manage the second member.');
        const moving = [...member.roles.cache.filter((r) => assignable(guild, r)).keys()];
        if (!moving.length) return say('❌ Nothing to transfer.');
        await to.roles.add(moving, reason);
        await member.roles.remove(moving, reason);
        return say(`🔁 Moved **${moving.length}** roles from ${member} to ${to}.`);
      }

      case 'rt': {
        const team = teamRoles(guild).filter((r) => assignable(guild, r));
        if (!team.length) return say('❌ Team roles are not set. Use /role-team.');
        await member.roles.add(team, reason);
        return say(`✅ ${member} received: ${team.map(rMention).join(' ')}`);
      }

      case 'backup-restore': {
        const snap = DB.roles.backups[member.id]?.[0];
        if (!snap) return say('❌ No backup found for this member.');
        const existing = snap.roles.map((id) => guild.roles.cache.get(id)).filter(Boolean);
        const restorable = existing.filter((r) => assignable(guild, r) && !member.roles.cache.has(r.id));
        const alreadyHas = existing.filter((r) => member.roles.cache.has(r.id)).length;
        const skipped = snap.roles.length - restorable.length - alreadyHas;
        if (!restorable.length) return say('ℹ️ Nothing to restore: the member already has these roles, or I cannot assign them.');
        await member.roles.add(restorable, reason);
        return say(
          `♻️ Restored **${restorable.length}** roles to ${member} (backup: ${snap.reason}, <t:${unixTs(snap.at)}:R>)` +
            (skipped > 0 ? ` • skipped ${skipped} (deleted or above my role)` : ''),
        );
      }
    }
  } catch (err) {
    console.error(err);
    return say(`❌ Failed: ${err.message}`);
  }
}

modules.push({
  name: 'roles',
  commands: [
    new SlashCommandBuilder()
      .setName('panel-roles')
      .setDescription('Roles dashboard (owners only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('role-team')
      .setDescription('Set the support team roles given by the rt command')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('role-ranks')
      .setDescription('Set the rank roles used by the up / down commands')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
  ],

  async handle(i) {
    const isCmd = i.isChatInputCommand() && ['panel-roles', 'role-team', 'role-ranks'].includes(i.commandName);
    const isComp = (i.isButton() || i.isRoleSelectMenu() || i.isModalSubmit()) && i.customId.startsWith('rr_');
    if (!isCmd && !isComp) return false;

    if (!isBcOwner(i.user.id, i.guild)) {
      await i.reply(ephemeral('❌ Owners only.'));
      return true;
    }

    if (isCmd) {
      const view = { 'panel-roles': 'main', 'role-team': 'team', 'role-ranks': 'ranks' }[i.commandName];
      await i.reply({ ...buildRolesPanel(i.guild, view), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return true;
    }

    const usable = (roles) => roles.filter((r) => r.id !== i.guild.id && !r.managed).map((r) => r.id);
    switch (i.customId) {
      case 'rr_msg':
        await i.showModal(refreshModal());
        break;
      case 'rr_ranks':
        await i.update(buildRolesPanel(i.guild, 'ranks'));
        break;
      case 'rr_team':
        await i.update(buildRolesPanel(i.guild, 'team'));
        break;
      case 'rr_back':
        await i.update(buildRolesPanel(i.guild));
        break;
      case 'rr_ranks_select':
        DB.roles.ladder = usable(i.roles);
        saveDB();
        await i.update(buildRolesPanel(i.guild));
        break;
      case 'rr_team_select':
        DB.roles.team = usable(i.roles);
        saveDB();
        await i.update(buildRolesPanel(i.guild));
        break;
      case 'rr_msg_modal':
        DB.roles.refreshMessage = i.fields.getTextInputValue('value').trim();
        saveDB();
        if (i.isFromMessage()) await i.update(buildRolesPanel(i.guild));
        else await i.reply(ephemeral('✅ Saved.'));
        break;
      default:
        return false;
    }
    return true;
  },

  init(client) {
    client.guilds.cache.get(GUILD_ID)?.members.fetch().catch(() => {});

    // Backups: snapshot roles when one is removed or the member leaves
    client.on('guildMemberUpdate', (oldM, newM) => {
      if (oldM.partial) return;
      const lost = oldM.roles.cache.some((r) => !newM.roles.cache.has(r.id));
      if (lost) saveSnapshot(newM.guild, newM.id, oldM.roles.cache, 'role removed');
    });
    client.on('guildMemberRemove', (m) => {
      if (m.partial) return;
      saveSnapshot(m.guild, m.id, m.roles.cache, 'left the server');
    });

    const cmdRe = new RegExp(`^${escapeRe(R.prefix)}(up|down|rar|transfer|rt|backup-restore)(?=\\s|$)`, 'i');
    client.on('messageCreate', async (msg) => {
      if (msg.author.bot || !msg.guild || !isBcOwner(msg.author.id, msg.guild)) return;
      const content = msg.content.trim();

      // Keyword without prefix
      if (normAr(content) === normAr(R.refreshWord)) {
        await msg
          .reply(v2(DB.roles.refreshMessage || '❌ No reply is set. Use /panel-roles.', {
            allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
          }))
          .catch(() => {});
        return;
      }

      const m = content.match(cmdRe);
      if (!m) return;
      const ids = [...new Set([...content.matchAll(/<@!?(\d{17,20})>|\b(\d{17,20})\b/g)].map((x) => x[1] ?? x[2]))];
      await runRoleCommand(msg, m[1].toLowerCase(), ids);
    });
  },
});

/* ===================================================================
 *  CORE
 * =================================================================== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers, // privileged
    GatewayIntentBits.GuildPresences, // privileged
    GatewayIntentBits.MessageContent, // privileged
  ],
});

client.once('clientReady', async () => {
  const commands = modules.flatMap((m) => m.commands ?? []);
  await new REST().setToken(TOKEN).put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  for (const m of modules) m.init?.(client);
  console.log(`Ready as ${client.user.tag} | modules: ${modules.map((m) => m.name).join(', ')}`);
});

client.on('interactionCreate', async (i) => {
  try {
    for (const m of modules) if (await m.handle?.(i)) break;
  } catch (err) {
    console.error(err);
    const msg = ephemeral('❌ Something went wrong.');
    if (i.deferred || i.replied) i.followUp(msg).catch(() => {});
    else if (i.isRepliable()) i.reply(msg).catch(() => {});
  }
});

client.login(TOKEN);
