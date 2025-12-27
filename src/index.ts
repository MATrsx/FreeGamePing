/**
 * PixelPost - Multi-Store Free Games Discord Bot
 * Vollständig refaktoriert mit allen Funktionen
 */

import { verifyKey } from 'discord-interactions';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Env {
  POSTED_GAMES: KVNamespace;
  GUILD_CONFIGS: KVNamespace;
  COMMAND_COOLDOWNS: KVNamespace;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

type StoreType = 'epic' | 'steam' | 'gog' | 'itchio';
type Language = 'en' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'ru' | 'pl';
type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'CHF' | 'CNY' | 'RUB' | 'BRL';

interface GuildConfig {
  guildId: string;
  channelId: string;
  threadId?: string;
  enabled: boolean;
  language: Language;
  stores: StoreType[];
  mentionRoles: string[];
  storeRoles?: { [key in StoreType]?: string };
  separateThreads: boolean;
  storeThreads?: { [key in StoreType]?: string };
  reactions: boolean;
  currency: Currency;
  includeDLCs: boolean;
}

interface Game {
  id: string;
  store: StoreType;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  url: string;
  image: string | null;
  price?: { original: number; discount: number; currency: string };
  instructions?: string;
  isDLC?: boolean;
}

interface GamerPowerGame {
  id: number;
  title: string;
  worth: string;
  thumbnail: string;
  image: string;
  description: string;
  instructions: string;
  open_giveaway_url: string;
  published_date: string;
  type: string;
  platforms: string;
  end_date: string;
  users: number;
  status: string;
  gamerpower_url: string;
  open_giveaway: string;
}

interface ExchangeRateCache {
  rates: Record<string, number>;
  timestamp: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  UPDATE_MESSAGE: 7,
} as const;

const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  SELECT_MENU: 3,
} as const;

const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

const STORE_CONFIG: Record<StoreType, { 
  name: string; 
  color: number; 
  platform: string; 
  emoji: string;
  icon: string;
}> = {
  epic: {
    name: 'Epic Games Store',
    color: 0x2B2D31,
    platform: 'epic-games-store',
    emoji: '🎮',
    icon: 'https://cdn.brandfetch.io/idjxHPThVp/w/800/h/929/theme/dark/logo.png?c=1bxid64Mup7aczewSAYMX&t=1667655482104',
  },
  steam: {
    name: 'Steam',
    color: 0x66C0F4,
    platform: 'steam',
    emoji: '🎯',
    icon: 'https://cdn.brandfetch.io/idMpZmhn_O/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1726566655121',
  },
  gog: {
    name: 'GOG',
    color: 0xC10DE4,
    platform: 'gog',
    emoji: '🐉',
    icon: 'https://cdn.brandfetch.io/idKvjVxYV6/w/128/h/128/theme/dark/logo.png?c=1bxid64Mup7aczewSAYMX&t=1761868104778',
  },
  itchio: {
    name: 'Itch.io',
    color: 0xDE425C,
    platform: 'itchio',
    emoji: '🎨',
    icon: 'https://cdn.brandfetch.io/idHwxBm5XT/w/316/h/316/theme/dark/icon.png?c=1bxid64Mup7aczewSAYMX&t=1765065158087',
  },
};

const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 hour
const ADMIN_COMMANDS = ['setup', 'check', 'settings'];
const DLC_KEYWORDS = ['dlc', 'expansion', 'add-on', 'addon', 'content pack', 'season pass', 'downloadable content'];

// ============================================================================
// UTILITY CLASSES
// ============================================================================

class Logger {
  static error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    console.error(`❌ [ERROR] ${message}`, {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      ...context,
    });
  }

  static warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`⚠️ [WARN] ${message}`, context);
  }

  static info(message: string, context?: Record<string, unknown>): void {
    console.log(`ℹ️ [INFO] ${message}`, context);
  }

  static debug(message: string, context?: Record<string, unknown>): void {
    console.log(`🔍 [DEBUG] ${message}`, context);
  }
}

class DiscordAPI {
  private baseURL = 'https://discord.com/api/v10';

  constructor(private botToken: string) {}

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Authorization': `Bot ${this.botToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, { ...options, headers });
      
      if (!response.ok) {
        const errorText = await response.text();
        Logger.error(`Discord API error: ${response.status}`, new Error(errorText), { endpoint });
        throw new Error(`Discord API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      Logger.error(`Discord API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  async sendMessage(channelId: string, payload: any): Promise<any> {
    return this.request(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async createForumPost(channelId: string, payload: any): Promise<any> {
    return this.request(`/channels/${channelId}/threads`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.request(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      { method: 'PUT' }
    );
  }

  async getChannel(channelId: string): Promise<any> {
    return this.request(`/channels/${channelId}`);
  }

  async getGuildChannels(guildId: string): Promise<any[]> {
    return this.request(`/guilds/${guildId}/channels`);
  }

  async getGuildRoles(guildId: string): Promise<any[]> {
    return this.request(`/guilds/${guildId}/roles`);
  }

  async updateInteraction(applicationId: string, token: string, content: string): Promise<void> {
    try {
      await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch (error) {
      Logger.error('Failed to update interaction', error);
    }
  }
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

function respondWithEmbed(embed: any, ephemeral: boolean = false): Response {
  const data: any = {};
  
  if (typeof embed === 'object' && !Array.isArray(embed) && !embed.embeds) {
    data.embeds = [embed];
  } else {
    data.embeds = embed.embeds || [embed];
  }
  
  if (ephemeral) {
    data.flags = 64;
  }
  
  return new Response(JSON.stringify({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function updateMessage(data: any): Response {
  return new Response(JSON.stringify({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

class ConfigManager {
  constructor(private kv: KVNamespace) {}

  async get(guildId: string): Promise<GuildConfig | null> {
    try {
      const data = await this.kv.get(guildId, 'json');
      return data as GuildConfig | null;
    } catch (error) {
      Logger.error(`Failed to get config for guild ${guildId}`, error);
      return null;
    }
  }

  async save(config: GuildConfig): Promise<void> {
    try {
      await this.kv.put(config.guildId, JSON.stringify(config));
    } catch (error) {
      Logger.error(`Failed to save config for guild ${config.guildId}`, error);
      throw error;
    }
  }

  async delete(guildId: string): Promise<void> {
    try {
      await this.kv.delete(guildId);
    } catch (error) {
      Logger.error(`Failed to delete config for guild ${guildId}`, error);
    }
  }

  async getAll(): Promise<GuildConfig[]> {
    try {
      const list = await this.kv.list();
      const configs: GuildConfig[] = [];
      
      for (const key of list.keys) {
        if (key.name.startsWith('temp_')) continue;
        
        const config = await this.get(key.name);
        if (config) configs.push(config);
      }
      
      return configs;
    } catch (error) {
      Logger.error('Failed to get all configs', error);
      return [];
    }
  }
}

// ============================================================================
// MAIN HANDLERS
// ============================================================================

async function handleDiscordInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  const body = await request.text();
  
  if (!signature || !timestamp) {
    return new Response('Invalid request signature', { status: 401 });
  }
  
  const isValid = verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
  if (!isValid) {
    return new Response('Invalid request signature', { status: 401 });
  }
  
  const interaction = JSON.parse(body);
  
  if (interaction.type === InteractionType.PING) {
    return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    return handleCommand(interaction, env, ctx);
  }
  
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    return handleComponent(interaction, env, ctx);
  }
  
  return new Response('Unknown interaction type', { status: 400 });
}

async function handleCommand(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const { name } = interaction.data;
    const guildId = interaction.guild_id;
    const member = interaction.member;
    
    const configManager = new ConfigManager(env.GUILD_CONFIGS);
    const config = await configManager.get(guildId);
    const lang = config?.language || 'en';
    const t = translations[lang];

    // Permission check
    const hasAdminPermission = member?.permissions && 
      (BigInt(member.permissions) & BigInt(0x8)) === BigInt(0x8);

    if (ADMIN_COMMANDS.includes(name) && !hasAdminPermission) {
      return respondWithEmbed({
        title: '🔒 ' + t.no_permission_title,
        description: t.no_permission_desc,
        color: 0xff5555
      }, true);
    }

    switch (name) {
      case 'setup':
        return handleSetupCommand(interaction, env, config);
      case 'help':
        return handleHelpCommand(interaction, hasAdminPermission, lang);
      case 'status':
        return handleStatusCommand(interaction, config, lang);
      case 'check':
        return handleCheckCommand(interaction, env, ctx, config, lang);
      case 'settings':
        return handleSettingsCommand(interaction, config, lang);
      default:
        return respondWithEmbed({
          title: '❌ ' + t.unknown_command,
          description: 'Command not found',
          color: 0xff5555
        }, true);
    }
  } catch (error) {
    Logger.error('Command handling failed', error, { command: interaction.data.name });
    return respondWithEmbed({
      title: '❌ Error',
      description: 'An error occurred while processing your command',
      color: 0xff5555
    }, true);
  }
}

async function handleSetupCommand(interaction: any, env: Env, existingConfig: GuildConfig | null): Promise<Response> {
  const guildId = interaction.guild_id;
  const lang = existingConfig?.language || 'en';
  const t = translations[lang];
  
  const embed = {
    title: '🚀 ' + t.setup_wizard_title,
    description: t.setup_wizard_desc,
    color: 0x5865F2,
    fields: [
      {
        name: '📍 ' + t.step + ' 1',
        value: t.setup_step_language,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Setup Wizard' },
    timestamp: new Date().toISOString()
  };

  const languageButtons = [
    { id: 'en', label: 'English', emoji: '🇬🇧' },
    { id: 'de', label: 'Deutsch', emoji: '🇩🇪' },
    { id: 'fr', label: 'Français', emoji: '🇫🇷' },
    { id: 'es', label: 'Español', emoji: '🇪🇸' },
  ];

  const languageButtons2 = [
    { id: 'it', label: 'Italiano', emoji: '🇮🇹' },
    { id: 'pt', label: 'Português', emoji: '🇵🇹' },
    { id: 'ru', label: 'Русский', emoji: '🇷🇺' },
    { id: 'pl', label: 'Polski', emoji: '🇵🇱' },
  ];

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: languageButtons.map(btn => ({
        type: ComponentType.BUTTON,
        style: ButtonStyle.PRIMARY,
        label: btn.label,
        emoji: { name: btn.emoji },
        custom_id: `lang_${btn.id}_${guildId}_setup`
      }))
    },
    {
      type: ComponentType.ACTION_ROW,
      components: languageButtons2.map(btn => ({
        type: ComponentType.BUTTON,
        style: ButtonStyle.PRIMARY,
        label: btn.label,
        emoji: { name: btn.emoji },
        custom_id: `lang_${btn.id}_${guildId}_setup`
      }))
    }
  ];

  return new Response(JSON.stringify({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [embed],
      components,
      flags: 64
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleSettingsCommand(
  interaction: any,
  config: GuildConfig | null,
  lang: Language
): Promise<Response> {
  const t = translations[lang];
  
  if (!config || !config.enabled) {
    return respondWithEmbed({
      title: '❌ ' + t.status_inactive,
      description: t.setup_required,
      color: 0xff5555
    }, true);
  }
  
  const guildId = interaction.guild_id;
  
  const embed = {
    title: '⚙️ ' + t.settings_title,
    description: t.settings_description,
    color: 0x5865F2,
    fields: [
      {
        name: '🌍 ' + t.status_language,
        value: `\`${config.language.toUpperCase()}\``,
        inline: true
      },
      {
        name: '💱 ' + t.settings_currency,
        value: `\`${config.currency}\``,
        inline: true
      },
      {
        name: '📦 ' + t.status_stores,
        value: config.stores.length > 0
          ? config.stores.map(s => `${STORE_CONFIG[s].emoji} ${STORE_CONFIG[s].name}`).join('\n')
          : t.none,
        inline: true
      },
      {
        name: '📢 ' + t.status_channel,
        value: `<#${config.channelId}>`,
        inline: true
      },
      {
        name: '👥 ' + t.settings_notification_roles,
        value: config.mentionRoles.length > 0
          ? config.mentionRoles.map(r => `<@&${r}>`).join(', ')
          : t.none,
        inline: true
      },
      {
        name: '🔥 ' + t.settings_reactions,
        value: config.reactions ? '✅ ' + t.enabled : '❌ ' + t.disabled,
        inline: true
      },
      {
        name: '🎮 ' + t.settings_dlcs,
        value: config.includeDLCs ? '✅ ' + t.settings_include_dlcs : '❌ ' + t.settings_games_only,
        inline: true
      }
    ],
    footer: { text: 'PixelPost • Settings' },
    timestamp: new Date().toISOString()
  };

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.PRIMARY,
          label: t.settings_btn_general,
          emoji: { name: '⚙️' },
          custom_id: `settings_general_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.PRIMARY,
          label: t.settings_btn_stores,
          emoji: { name: '📦' },
          custom_id: `settings_stores_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.PRIMARY,
          label: t.settings_btn_language,
          emoji: { name: '🌍' },
          custom_id: `settings_language_${guildId}`
        }
      ]
    },
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.PRIMARY,
          label: t.settings_btn_roles,
          emoji: { name: '👥' },
          custom_id: `settings_roles_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.PRIMARY,
          label: t.settings_btn_channel,
          emoji: { name: '📢' },
          custom_id: `settings_channel_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.PRIMARY,
          label: t.settings_btn_reactions,
          emoji: { name: '🔥' },
          custom_id: `settings_reactions_${guildId}`
        }
      ]
    }
  ];

  return new Response(JSON.stringify({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [embed],
      components,
      flags: 64
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleHelpCommand(interaction: any, hasAdmin: boolean, lang: Language): Promise<Response> {
  const t = translations[lang];
  
  const embed = {
    title: '📖 ' + t.help_title,
    description: t.help_description,
    color: 0x5865F2,
    fields: [],
    footer: { text: 'PixelPost' },
    timestamp: new Date().toISOString()
  };

  embed.fields.push({
    name: '👥 ' + t.help_user_commands,
    value: [
      `\`/help\` - ${t.help_cmd_help}`,
      `\`/status\` - ${t.help_cmd_status}`,
    ].join('\n'),
    inline: false
  });

  if (hasAdmin) {
    embed.fields.push({
      name: '⚙️ ' + t.help_admin_commands,
      value: [
        `\`/setup\` - ${t.help_cmd_setup}`,
        `\`/check\` - ${t.help_cmd_check}`,
        `\`/settings\` - ${t.help_cmd_settings}`,
      ].join('\n'),
      inline: false
    });
  }

  embed.fields.push({
    name: '🔗 ' + t.help_links,
    value: t.help_links_text,
    inline: false
  });

  return respondWithEmbed(embed);
}

async function handleStatusCommand(interaction: any, config: GuildConfig | null, lang: Language): Promise<Response> {
  const t = translations[lang];
  
  if (!config || !config.enabled) {
    return respondWithEmbed({
      title: '❌ ' + t.status_inactive,
      description: t.setup_required,
      color: 0xff5555
    }, true);
  }

  const channelMention = config.threadId
    ? `<#${config.threadId}>`
    : `<#${config.channelId}>`;

  const embed = {
    title: '📊 ' + t.status_title,
    description: `${t.status_active} ${channelMention}`,
    color: 0x00ff99,
    fields: [
      {
        name: '🌍 ' + t.status_language,
        value: '`' + config.language + '`',
        inline: true
      },
      {
        name: '📦 ' + t.status_stores,
        value: config.stores
          .map(s => `${STORE_CONFIG[s].emoji} ${STORE_CONFIG[s].name}`)
          .join('\n'),
        inline: true
      },
      {
        name: '👥 ' + t.status_roles,
        value: config.mentionRoles.length > 0
          ? config.mentionRoles.map(r => `<@&${r}>`).join(', ')
          : t.none,
        inline: false
      }
    ],
    footer: { text: 'PixelPost' },
    timestamp: new Date().toISOString()
  };

  if (config.separateThreads && config.storeThreads) {
    embed.fields.push({
      name: '🧵 ' + t.store_threads,
      value: Object.entries(config.storeThreads)
        .map(([store, thread]) => `${STORE_CONFIG[store as StoreType].emoji} <#${thread}>`)
        .join('\n') || t.none,
      inline: false
    });
  }

  return respondWithEmbed(embed);
}

async function handleCheckCommand(
  interaction: any, 
  env: Env, 
  ctx: ExecutionContext,
  config: GuildConfig | null,
  lang: Language
): Promise<Response> {
  const t = translations[lang];
  const guildId = interaction.guild_id;
  
  if (!config || !config.enabled) {
    return respondWithEmbed({
      title: '❌ ' + t.status_inactive,
      description: t.setup_required,
      color: 0xff5555
    }, true);
  }

  // Check cooldown
  const cooldownCheck = await checkCooldown(env, guildId);
  
  if (cooldownCheck.onCooldown && cooldownCheck.remainingTime) {
    const timeString = formatCooldownTime(cooldownCheck.remainingTime);
    return respondWithEmbed({
      title: '⏰ ' + t.check_cooldown_title,
      description: t.check_cooldown_desc + timeString,
      color: 0xff9900
    }, true);
  }

  await setCooldown(env, guildId);

  // Run check in background
  ctx.waitUntil(
    (async () => {
      try {
        const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
        await discord.updateInteraction(
          env.DISCORD_APPLICATION_ID, 
          interaction.token,
          `🔍 ${t.check_running}\n${t.check_running}`
        );

        await checkAndPostFreeGames(env);
        
        await discord.updateInteraction(
          env.DISCORD_APPLICATION_ID, 
          interaction.token, 
          t.check_complete
        );
      } catch (error) {
        Logger.error('Error during check', error);
        const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
        await discord.updateInteraction(
          env.DISCORD_APPLICATION_ID,
          interaction.token,
          `❌ ${t.error_occurred}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    })()
  );

  return respondWithEmbed({
    title: '🔍 ' + t.check_running_title,
    description: t.check_running,
    color: 0x5865F2
  }, true);
}

// ============================================================================
// COMPONENT HANDLER
// ============================================================================

async function handleComponent(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const customId = interaction.data.custom_id;
    const parts = customId.split('_');
    
    // Settings handlers
    if (parts[0] === 'settings') {
      return handleSettingsComponent(interaction, env, parts[1], parts[2]);
    }
    
    // Setting value updates
    if (parts[0] === 'set' || parts[0] === 'toggle') {
      return handleSettingUpdate(interaction, env, parts);
    }
    
    // Role management
    if (parts[0] === 'add' && parts[1] === 'general' && parts[2] === 'role') {
      return handleAddGeneralRole(interaction, env, parts[3]);
    }
    
    if (parts[0] === 'clear' && parts[1] === 'general' && parts[2] === 'roles') {
      return handleClearGeneralRoles(interaction, env, parts[3]);
    }
    
    if (parts[0] === 'configure' && parts[1] === 'store' && parts[2] === 'roles') {
      return handleConfigureStoreRoles(interaction, env, parts[3]);
    }
    
    if (parts[0] === 'select' && parts[1] === 'general' && parts[2] === 'role') {
      return handleGeneralRoleSelection(interaction, env, parts[3]);
    }

    if (parts[0] === 'select' && parts[1] === 'store' && parts[2] === 'role' && parts[3] === 'menu') {
      return showStoreRoleMenu(interaction, env, parts[5], parts[4] as StoreType);
    }
    
    if (parts[0] === 'select' && parts[1] === 'store' && parts[2] === 'role' && parts[3] !== 'menu' && parts.length === 5) {
      return handleStoreRoleSelection(interaction, env, parts[3] as StoreType, parts[4]);
    }
    
    if (parts[0] === 'remove' && parts[1] === 'store' && parts[2] === 'role') {
      return handleRemoveStoreRole(interaction, env, parts[3] as StoreType, parts[4]);
    }
    
    // Setup wizard
    if (parts.includes('setup')) {
      return handleSetupComponent(interaction, env, parts[0], parts[1], parts[2]);
    }
    
    // Channel selection
    if (parts[0] === 'select' && parts[1] === 'channel') {
      return handleChannelSelection(interaction, env, parts[2]);
    }
    
    return updateMessage({ content: 'Unknown interaction' });
  } catch (error) {
    Logger.error('Component handling failed', error, { customId: interaction.data.custom_id });
    return respondWithEmbed({
      title: '❌ Error',
      description: 'An error occurred',
      color: 0xff5555
    }, true);
  }
}

async function handleSettingsComponent(
  interaction: any,
  env: Env,
  settingType: string,
  guildId: string
): Promise<Response> {
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  
  if (settingType === 'back') {
    return handleSettingsCommand(interaction, config, config.language);
  }
  
  switch (settingType) {
    case 'general':
      return handleGeneralSettings(interaction, config, t, guildId);
    case 'stores':
      return handleStoresSettings(interaction, config, t, guildId);
    case 'language':
      return handleLanguageSettings(interaction, config, t, guildId);
    case 'roles':
      return handleRolesSettings(interaction, config, t, guildId);
    case 'channel':
      return handleChannelSettings(interaction, config, t, guildId, env);
    case 'reactions':
      return handleReactionsSettings(interaction, config, t, guildId, env);
    default:
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Unknown setting type',
        color: 0xff5555
      }, true);
  }
}

// Die restlichen Settings-Handler folgen im nächsten Teil...
// Weiter gehts mit Teil 2

async function handleGeneralSettings(
  interaction: any,
  config: GuildConfig,
  t: any,
  guildId: string
): Promise<Response> {
  const embed = {
    title: '⚙️ ' + t.settings_general_title,
    description: t.settings_general_desc,
    color: 0x5865F2,
    fields: [
      {
        name: '💱 ' + t.settings_currency,
        value: `Current: \`${config.currency}\``,
        inline: false
      },
      {
        name: '🎮 ' + t.settings_dlcs,
        value: config.includeDLCs ? '✅ ' + t.settings_include_dlcs : '❌ ' + t.settings_games_only,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • General Settings' }
  };

  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY'];
  const currencyButtons = currencies.map(curr => ({
    type: ComponentType.BUTTON,
    style: config.currency === curr ? ButtonStyle.SUCCESS : ButtonStyle.SECONDARY,
    label: curr,
    custom_id: `set_currency_${curr}_${guildId}`
  }));

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: currencyButtons.slice(0, 5)
    },
    {
      type: ComponentType.ACTION_ROW,
      components: currencyButtons.slice(5)
    },
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: config.includeDLCs ? ButtonStyle.SUCCESS : ButtonStyle.SECONDARY,
          label: t.settings_toggle_dlcs,
          emoji: { name: '🎮' },
          custom_id: `toggle_dlcs_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SECONDARY,
          label: t.back,
          emoji: { name: '◀️' },
          custom_id: `settings_back_${guildId}`
        }
      ]
    }
  ];

  return updateMessage({ embeds: [embed], components });
}

async function handleStoresSettings(
  interaction: any,
  config: GuildConfig,
  t: any,
  guildId: string
): Promise<Response> {
  const embed = {
    title: '📦 ' + t.settings_stores_title,
    description: t.settings_stores_desc,
    color: 0x5865F2,
    fields: [
      {
        name: '📦 ' + t.selected,
        value: config.stores.length > 0
          ? config.stores.map(s => `${STORE_CONFIG[s].emoji} ${STORE_CONFIG[s].name}`).join('\n')
          : t.none,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Store Settings' }
  };

  const storeButtons = [
    { id: 'epic', name: 'Epic Games', emoji: '🎮' },
    { id: 'steam', name: 'Steam', emoji: '🎯' },
    { id: 'gog', name: 'GOG', emoji: '🐉' },
    { id: 'itchio', name: 'Itch.io', emoji: '🎨' }
  ];

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: storeButtons.map(s => ({
        type: ComponentType.BUTTON,
        style: config.stores.includes(s.id as StoreType) ? ButtonStyle.SUCCESS : ButtonStyle.SECONDARY,
        label: s.name,
        emoji: { name: s.emoji },
        custom_id: `toggle_store_${s.id}_${guildId}`
      }))
    },
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SECONDARY,
          label: t.back,
          emoji: { name: '◀️' },
          custom_id: `settings_back_${guildId}`
        }
      ]
    }
  ];

  return updateMessage({ embeds: [embed], components });
}

async function handleLanguageSettings(
  interaction: any,
  config: GuildConfig,
  t: any,
  guildId: string
): Promise<Response> {
  const embed = {
    title: '🌍 ' + t.settings_language_title,
    description: t.settings_language_desc,
    color: 0x5865F2,
    fields: [
      {
        name: t.current_language,
        value: `\`${config.language.toUpperCase()}\``,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Language Settings' }
  };

  const languageButtons = [
    { id: 'en', label: 'English', emoji: '🇬🇧' },
    { id: 'de', label: 'Deutsch', emoji: '🇩🇪' },
    { id: 'fr', label: 'Français', emoji: '🇫🇷' },
    { id: 'es', label: 'Español', emoji: '🇪🇸' },
  ];

  const languageButtons2 = [
    { id: 'it', label: 'Italiano', emoji: '🇮🇹' },
    { id: 'pt', label: 'Português', emoji: '🇵🇹' },
    { id: 'ru', label: 'Русский', emoji: '🇷🇺' },
    { id: 'pl', label: 'Polski', emoji: '🇵🇱' },
  ];

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: languageButtons.map(btn => ({
        type: ComponentType.BUTTON,
        style: config.language === btn.id ? ButtonStyle.SUCCESS : ButtonStyle.PRIMARY,
        label: btn.label,
        emoji: { name: btn.emoji },
        custom_id: `set_lang_${btn.id}_${guildId}`
      }))
    },
    {
      type: ComponentType.ACTION_ROW,
      components: languageButtons2.map(btn => ({
        type: ComponentType.BUTTON,
        style: config.language === btn.id ? ButtonStyle.SUCCESS : ButtonStyle.PRIMARY,
        label: btn.label,
        emoji: { name: btn.emoji },
        custom_id: `set_lang_${btn.id}_${guildId}`
      }))
    },
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SECONDARY,
          label: t.back,
          emoji: { name: '◀️' },
          custom_id: `settings_back_${guildId}`
        }
      ]
    }
  ];

  return updateMessage({ embeds: [embed], components });
}

async function handleRolesSettings(
  interaction: any,
  config: GuildConfig,
  t: any,
  guildId: string
): Promise<Response> {
  const embed = {
    title: '👥 ' + t.settings_roles_title,
    description: t.settings_roles_desc,
    color: 0x5865F2,
    fields: [
      {
        name: '👥 ' + t.settings_general_role,
        value: config.mentionRoles.length > 0
          ? config.mentionRoles.map(r => `<@&${r}>`).join(', ')
          : t.none,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Role Settings' }
  };

  if (config.storeRoles && Object.keys(config.storeRoles).length > 0) {
    const storeRolesText = Object.entries(config.storeRoles)
      .map(([store, roleId]) => `${STORE_CONFIG[store as StoreType].emoji} ${STORE_CONFIG[store as StoreType].name}: <@&${roleId}>`)
      .join('\n');
    
    embed.fields.push({
      name: '📦 ' + t.settings_store_roles,
      value: storeRolesText,
      inline: false
    });
  }

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SUCCESS,
          label: t.settings_add_general_role,
          emoji: { name: '➕' },
          custom_id: `add_general_role_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.DANGER,
          label: t.settings_clear_general_roles,
          emoji: { name: '🗑️' },
          custom_id: `clear_general_roles_${guildId}`,
          disabled: config.mentionRoles.length === 0
        }
      ]
    },
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.PRIMARY,
          label: t.settings_configure_store_roles,
          emoji: { name: '📦' },
          custom_id: `configure_store_roles_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SECONDARY,
          label: t.back,
          emoji: { name: '◀️' },
          custom_id: `settings_back_${guildId}`
        }
      ]
    }
  ];

  return updateMessage({ embeds: [embed], components });
}

async function handleChannelSettings(
  interaction: any,
  config: GuildConfig,
  t: any,
  guildId: string,
  env: Env
): Promise<Response> {
  const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
  const channels = await discord.getGuildChannels(guildId);
  
  const embed = {
    title: '📢 ' + t.settings_channel_title,
    description: t.settings_channel_desc,
    color: 0x5865F2,
    fields: [
      {
        name: t.current_channel,
        value: `<#${config.channelId}>`,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Channel Settings' }
  };

  const components = [];
  
  if (channels && channels.length > 0) {
    const channelOptions = channels
      .filter(ch => ch.type === 0 || ch.type === 5 || ch.type === 15)
      .slice(0, 25)
      .map(ch => ({
        label: getChannelLabel(ch),
        value: `channel_${ch.id}`,
        description: getChannelDescription(ch),
        emoji: getChannelEmoji(ch),
        default: ch.id === config.channelId
      }));

    if (channelOptions.length > 0) {
      components.push({
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.SELECT_MENU,
            custom_id: `select_channel_${guildId}`,
            placeholder: t.select_channel_placeholder || 'Choose a channel...',
            min_values: 1,
            max_values: 1,
            options: channelOptions
          }
        ]
      });
    }
  }
  
  components.push({
    type: ComponentType.ACTION_ROW,
    components: [
      {
        type: ComponentType.BUTTON,
        style: ButtonStyle.SECONDARY,
        label: t.back,
        emoji: { name: '◀️' },
        custom_id: `settings_back_${guildId}`
      }
    ]
  });

  return updateMessage({ embeds: [embed], components });
}

async function handleReactionsSettings(
  interaction: any,
  config: GuildConfig,
  t: any,
  guildId: string,
  env: Env
): Promise<Response> {
  const embed = {
    title: '🔥 ' + t.settings_reactions_title,
    description: t.settings_reactions_desc,
    color: 0x5865F2,
    fields: [
      {
        name: t.current_status,
        value: config.reactions ? '✅ ' + t.enabled : '❌ ' + t.disabled,
        inline: false
      },
      {
        name: 'ℹ️ ' + t.info,
        value: t.settings_reactions_info,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Reaction Settings' }
  };

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: config.reactions ? ButtonStyle.DANGER : ButtonStyle.SUCCESS,
          label: config.reactions ? t.disable : t.enable,
          emoji: { name: config.reactions ? '❌' : '✅' },
          custom_id: `toggle_reactions_${guildId}`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SECONDARY,
          label: t.back,
          emoji: { name: '◀️' },
          custom_id: `settings_back_${guildId}`
        }
      ]
    }
  ];

  return updateMessage({ embeds: [embed], components });
}

// Role Management Handlers
async function handleAddGeneralRole(
  interaction: any,
  env: Env,
  guildId: string
): Promise<Response> {
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
  const roles = await discord.getGuildRoles(guildId);
  
  const embed = {
    title: '👥 ' + t.settings_add_general_role,
    description: 'Select a role to add to general notifications. This role will be mentioned for all free game posts.',
    color: 0x5865F2,
    fields: [
      {
        name: '📋 ' + t.info,
        value: 'Choose a role from the dropdown below. This role will be mentioned when posting free games from any store.',
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Role Settings' }
  };

  const components = [];
  
  if (roles && roles.length > 0) {
    const roleOptions = roles
      .filter(role => role.name !== '@everyone' && !role.managed)
      .slice(0, 25)
      .map(role => ({
        label: role.name.length > 100 ? role.name.substring(0, 97) + '...' : role.name,
        value: `role_${role.id}`,
        description: `Role ID: ${role.id}`,
        emoji: { name: '👥' },
        default: config.mentionRoles.includes(role.id)
      }));

    if (roleOptions.length > 0) {
      components.push({
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.SELECT_MENU,
            custom_id: `select_general_role_${guildId}`,
            placeholder: 'Choose a role...',
            min_values: 1,
            max_values: 1,
            options: roleOptions
          }
        ]
      });
    }
  }
  
  components.push({
    type: ComponentType.ACTION_ROW,
    components: [
      {
        type: ComponentType.BUTTON,
        style: ButtonStyle.SECONDARY,
        label: t.back,
        emoji: { name: '◀️' },
        custom_id: `settings_roles_${guildId}`
      }
    ]
  });

  return updateMessage({ embeds: [embed], components });
}

async function handleGeneralRoleSelection(
  interaction: any,
  env: Env,
  guildId: string
): Promise<Response> {
  const selectedValue = interaction.data.values?.[0];
  if (!selectedValue) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'No role selected',
      color: 0xff5555
    }, true);
  }
  
  const roleId = selectedValue.replace('role_', '');
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  if (!config.mentionRoles.includes(roleId)) {
    config.mentionRoles.push(roleId);
    await configManager.save(config);
  }
  
  const t = translations[config.language];
  return handleRolesSettings(interaction, config, t, guildId);
}

async function handleClearGeneralRoles(
  interaction: any,
  env: Env,
  guildId: string
): Promise<Response> {
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  config.mentionRoles = [];
  await configManager.save(config);
  
  const t = translations[config.language];
  return handleRolesSettings(interaction, config, t, guildId);
}

async function handleConfigureStoreRoles(
  interaction: any,
  env: Env,
  guildId: string
): Promise<Response> {
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  
  const embed = {
    title: '📦 ' + t.settings_store_roles,
    description: 'Configure store-specific notification roles. These roles will be mentioned only for their respective stores.',
    color: 0x5865F2,
    fields: config.stores.map(store => ({
      name: `${STORE_CONFIG[store].emoji} ${STORE_CONFIG[store].name}`,
      value: config.storeRoles?.[store] 
        ? `<@&${config.storeRoles[store]}>` 
        : t.none,
      inline: true
    })),
    footer: { text: 'PixelPost • Store Role Settings' }
  };

  const storeButtons = config.stores.map(store => ({
    type: ComponentType.BUTTON,
    style: config.storeRoles?.[store] ? ButtonStyle.SUCCESS : ButtonStyle.PRIMARY,
    label: STORE_CONFIG[store].name,
    emoji: { name: STORE_CONFIG[store].emoji },
    custom_id: `select_store_role_menu_${store}_${guildId}`
  }));

  const components = [];
  
  for (let i = 0; i < storeButtons.length; i += 5) {
    components.push({
      type: ComponentType.ACTION_ROW,
      components: storeButtons.slice(i, i + 5)
    });
  }
  
  components.push({
    type: ComponentType.ACTION_ROW,
    components: [
      {
        type: ComponentType.BUTTON,
        style: ButtonStyle.SECONDARY,
        label: t.back,
        emoji: { name: '◀️' },
        custom_id: `settings_roles_${guildId}`
      }
    ]
  });

  return updateMessage({ embeds: [embed], components });
}

async function showStoreRoleMenu(
  interaction: any,
  env: Env,
  guildId: string,
  store: StoreType
): Promise<Response> {
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
  const roles = await discord.getGuildRoles(guildId);
  
  const embed = {
    title: `${STORE_CONFIG[store].emoji} ${STORE_CONFIG[store].name} - ${t.settings_store_roles}`,
    description: `Select a role to be mentioned for ${STORE_CONFIG[store].name} free games.`,
    color: STORE_CONFIG[store].color,
    fields: [
      {
        name: '📋 ' + t.current_status,
        value: config.storeRoles?.[store] 
          ? `<@&${config.storeRoles[store]}>` 
          : t.none,
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Store Role Settings' }
  };

  const components = [];
  
  if (roles && roles.length > 0) {
    const roleOptions = roles
      .filter(role => role.name !== '@everyone' && !role.managed)
      .slice(0, 25)
      .map(role => ({
        label: role.name.length > 100 ? role.name.substring(0, 97) + '...' : role.name,
        value: `role_${role.id}`,
        description: `Role ID: ${role.id}`,
        emoji: { name: '👥' },
        default: config.storeRoles?.[store] === role.id
      }));

    if (roleOptions.length > 0) {
      components.push({
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.SELECT_MENU,
            custom_id: `select_store_role_${store}_${guildId}`,
            placeholder: 'Choose a role...',
            min_values: 1,
            max_values: 1,
            options: roleOptions
          }
        ]
      });
    }
  }
  
  components.push({
    type: ComponentType.ACTION_ROW,
    components: [
      {
        type: ComponentType.BUTTON,
        style: ButtonStyle.DANGER,
        label: 'Remove Role',
        emoji: { name: '🗑️' },
        custom_id: `remove_store_role_${store}_${guildId}`,
        disabled: !config.storeRoles?.[store]
      },
      {
        type: ComponentType.BUTTON,
        style: ButtonStyle.SECONDARY,
        label: t.back,
        emoji: { name: '◀️' },
        custom_id: `configure_store_roles_${guildId}`
      }
    ]
  });

  return updateMessage({ embeds: [embed], components });
}

async function handleStoreRoleSelection(
  interaction: any,
  env: Env,
  store: StoreType,
  guildId: string
): Promise<Response> {
  const selectedValue = interaction.data.values?.[0];
  if (!selectedValue) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'No role selected',
      color: 0xff5555
    }, true);
  }
  
  const roleId = selectedValue.replace('role_', '');
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  if (!config.storeRoles) {
    config.storeRoles = {};
  }
  
  config.storeRoles[store] = roleId;
  await configManager.save(config);
  
  return handleConfigureStoreRoles(interaction, env, guildId);
}

async function handleRemoveStoreRole(
  interaction: any,
  env: Env,
  store: StoreType,
  guildId: string
): Promise<Response> {
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  if (config.storeRoles && config.storeRoles[store]) {
    delete config.storeRoles[store];
    await configManager.save(config);
  }
  
  return handleConfigureStoreRoles(interaction, env, guildId);
}

// Setting Update Handler
async function handleSettingUpdate(interaction: any, env: Env, parts: string[]): Promise<Response> {
  const action = parts[0]; // 'set' or 'toggle'
  const setting = parts[1];
  const value = parts[2];
  const guildId = parts[3] || parts[2];
  
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  
  if (setting === 'currency') {
    config.currency = value as Currency;
    await configManager.save(config);
    return handleGeneralSettings(interaction, config, t, guildId);
  }
  
  if (setting === 'dlcs') {
    config.includeDLCs = !config.includeDLCs;
    await configManager.save(config);
    return handleGeneralSettings(interaction, config, t, guildId);
  }
  
  if (setting === 'store') {
    const store = value as StoreType;
    if (config.stores.includes(store)) {
      config.stores = config.stores.filter(s => s !== store);
    } else {
      config.stores.push(store);
    }
    await configManager.save(config);
    return handleStoresSettings(interaction, config, t, guildId);
  }
  
  if (setting === 'lang') {
    config.language = value as Language;
    await configManager.save(config);
    const newT = translations[config.language];
    return handleLanguageSettings(interaction, config, newT, guildId);
  }
  
  if (setting === 'reactions') {
    config.reactions = !config.reactions;
    await configManager.save(config);
    return handleReactionsSettings(interaction, config, t, guildId, env);
  }
  
  return respondWithEmbed({
    title: '❌ Error',
    description: 'Unknown setting',
    color: 0xff5555
  }, true);
}

// Channel Selection Handler
async function handleChannelSelection(interaction: any, env: Env, guildId: string): Promise<Response> {
  const selectedValue = interaction.data.values?.[0];
  if (!selectedValue) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'No channel selected',
      color: 0xff5555
    }, true);
  }
  
  const channelId = selectedValue.replace('channel_', '');
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  const config = await configManager.get(guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  config.channelId = channelId;
  await configManager.save(config);
  
  const t = translations[config.language];
  return handleChannelSettings(interaction, config, t, guildId, env);
}

// Setup Component Handler
async function handleSetupComponent(
  interaction: any, 
  env: Env, 
  action: string, 
  param: string, 
  guildId: string
): Promise<Response> {
  const configManager = new ConfigManager(env.GUILD_CONFIGS);
  
  if (action === 'lang') {
    const language = param as Language;
    const t = translations[language];
    
    let tempConfig = await configManager.get(`temp_${guildId}`);
    
    if (!tempConfig) {
      tempConfig = {
        guildId,
        channelId: interaction.channel_id,
        enabled: false,
        language,
        stores: ['epic', 'steam', 'gog', 'itchio'],
        mentionRoles: [],
        separateThreads: false,
        reactions: true,
        currency: 'USD',
        includeDLCs: true,
        storeRoles: {}
      };
    } else {
      tempConfig.language = language;
    }
    
    await env.GUILD_CONFIGS.put(`temp_${guildId}`, JSON.stringify(tempConfig));
    
    const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
    const channels = await discord.getGuildChannels(guildId);
    
    const embed = {
      title: '✅ ' + t.language_selected,
      description: t.setup_step_channel,
      color: 0x00ff99,
      fields: [
        {
          name: '📍 ' + t.step + ' 2',
          value: t.setup_channel_instructions,
          inline: false
        }
      ],
      footer: { text: 'PixelPost • Setup Wizard' },
      timestamp: new Date().toISOString()
    };

    const components = [];
    
    if (channels && channels.length > 0) {
      const channelOptions = channels
        .filter(ch => ch.type === 0 || ch.type === 5 || ch.type === 15)
        .slice(0, 25)
        .map(ch => ({
          label: getChannelLabel(ch),
          value: `channel_${ch.id}`,
          description: getChannelDescription(ch),
          emoji: getChannelEmoji(ch)
        }));

      if (channelOptions.length > 0) {
        components.push({
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.SELECT_MENU,
              custom_id: `select_channel_${guildId}_setup`,
              placeholder: t.select_channel_placeholder || 'Choose a channel...',
              min_values: 1,
              max_values: 1,
              options: channelOptions
            }
          ]
        });
      }
    }
    
    components.push({
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SUCCESS,
          label: t.use_current_channel,
          custom_id: `channel_current_${guildId}_setup`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SECONDARY,
          label: t.cancel,
          custom_id: `cancel_setup_${guildId}_setup`
        }
      ]
    });

    return updateMessage({ embeds: [embed], components });
  }
  
  if (action === 'select' && param === 'channel') {
    const selectedValue = interaction.data.values?.[0];
    if (!selectedValue) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'No channel selected',
        color: 0xff5555
      }, true);
    }
    
    const channelId = selectedValue.replace('channel_', '');
    const tempConfig = await configManager.get(`temp_${guildId}`);
    
    if (!tempConfig) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Setup session expired. Please start again with /setup',
        color: 0xff5555
      }, true);
    }
    
    tempConfig.channelId = channelId;
    await env.GUILD_CONFIGS.put(`temp_${guildId}`, JSON.stringify(tempConfig));
    
    return proceedToStoreSelection(tempConfig, env, guildId);
  }
  
  if (action === 'channel') {
    const tempConfig = await configManager.get(`temp_${guildId}`);
    
    if (!tempConfig) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Setup session expired. Please start again with /setup',
        color: 0xff5555
      }, true);
    }
    
    tempConfig.channelId = interaction.channel_id;
    await env.GUILD_CONFIGS.put(`temp_${guildId}`, JSON.stringify(tempConfig));
    
    return proceedToStoreSelection(tempConfig, env, guildId);
  }
  
  if (action === 'store') {
    const store = param as StoreType;
    const tempConfig = await configManager.get(`temp_${guildId}`);
    
    if (!tempConfig) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Setup session expired',
        color: 0xff5555
      }, true);
    }
    
    const t = translations[tempConfig.language];
    
    if (tempConfig.stores.includes(store)) {
      tempConfig.stores = tempConfig.stores.filter(s => s !== store);
    } else {
      tempConfig.stores.push(store);
    }
    
    await env.GUILD_CONFIGS.put(`temp_${guildId}`, JSON.stringify(tempConfig));
    
    const embed = {
      title: '✅ ' + t.store_toggled,
      description: t.setup_step_stores,
      color: 0x00ff99,
      fields: [
        {
          name: '📍 ' + t.step + ' 3',
          value: t.setup_stores_instructions,
          inline: false
        },
        {
          name: '📦 ' + t.selected,
          value: tempConfig.stores.length > 0 
            ? tempConfig.stores.map(s => `${STORE_CONFIG[s].emoji} ${STORE_CONFIG[s].name}`).join('\n')
            : t.none,
          inline: false
        }
      ],
      footer: { text: 'PixelPost • Setup Wizard' },
      timestamp: new Date().toISOString()
    };

    const storeButtons = [
      { id: 'epic', name: 'Epic Games', emoji: '🎮' },
      { id: 'steam', name: 'Steam', emoji: '🎯' },
      { id: 'gog', name: 'GOG', emoji: '🐉' },
      { id: 'itchio', name: 'Itch.io', emoji: '🎨' }
    ];

    const components = [
      {
        type: ComponentType.ACTION_ROW,
        components: storeButtons.map(s => ({
          type: ComponentType.BUTTON,
          style: tempConfig.stores.includes(s.id as StoreType) ? ButtonStyle.SUCCESS : ButtonStyle.SECONDARY,
          label: s.name,
          emoji: { name: s.emoji },
          custom_id: `store_${s.id}_${guildId}_setup`
        }))
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.SUCCESS,
            label: t.finish_setup,
            custom_id: `finish_setup_${guildId}_setup`,
            disabled: tempConfig.stores.length === 0
          },
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.SECONDARY,
            label: t.cancel,
            custom_id: `cancel_setup_${guildId}_setup`
          }
        ]
      }
    ];

    return updateMessage({ embeds: [embed], components });
  }
  
  if (action === 'finish') {
    const tempConfig = await configManager.get(`temp_${guildId}`);
    
    if (!tempConfig) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Setup session expired',
        color: 0xff5555
      }, true);
    }
    
    tempConfig.enabled = true;
    await configManager.save(tempConfig);
    await env.GUILD_CONFIGS.delete(`temp_${guildId}`);
    
    const t = translations[tempConfig.language];
    
    const embed = {
      title: '🎉 ' + t.setup_complete_title,
      description: t.setup_complete_desc,
      color: 0x00ff99,
      fields: [
        {
          name: '🌍 ' + t.status_language,
          value: '`' + tempConfig.language + '`',
          inline: true
        },
        {
          name: '📦 ' + t.status_stores,
          value: tempConfig.stores.map(s => `${STORE_CONFIG[s].emoji} ${STORE_CONFIG[s].name}`).join('\n'),
          inline: true
        },
        {
          name: '📢 ' + t.status_channel,
          value: `<#${tempConfig.channelId}>`,
          inline: true
        }
      ],
      footer: { text: 'PixelPost' },
      timestamp: new Date().toISOString()
    };

    return updateMessage({ embeds: [embed], components: [] });
  }
  
  if (action === 'cancel') {
    await env.GUILD_CONFIGS.delete(`temp_${guildId}`);
    
    return updateMessage({
      content: '❌ Setup cancelled.',
      embeds: [],
      components: []
    });
  }
  
  return respondWithEmbed({
    title: '❌ Error',
    description: 'Unknown setup action',
    color: 0xff5555
  }, true);
}

async function proceedToStoreSelection(tempConfig: GuildConfig, env: Env, guildId: string): Promise<Response> {
  const t = translations[tempConfig.language];
  
  const embed = {
    title: '✅ ' + t.channel_selected,
    description: t.setup_step_stores,
    color: 0x00ff99,
    fields: [
      {
        name: '📍 ' + t.step + ' 3',
        value: t.setup_stores_instructions,
        inline: false
      },
      {
        name: '📦 ' + t.selected,
        value: tempConfig.stores.map(s => `${STORE_CONFIG[s].emoji} ${STORE_CONFIG[s].name}`).join('\n'),
        inline: false
      }
    ],
    footer: { text: 'PixelPost • Setup Wizard' },
    timestamp: new Date().toISOString()
  };

  const storeButtons = [
    { id: 'epic', name: 'Epic Games', emoji: '🎮' },
    { id: 'steam', name: 'Steam', emoji: '🎯' },
    { id: 'gog', name: 'GOG', emoji: '🐉' },
    { id: 'itchio', name: 'Itch.io', emoji: '🎨' }
  ];

  const components = [
    {
      type: ComponentType.ACTION_ROW,
      components: storeButtons.map(store => ({
        type: ComponentType.BUTTON,
        style: tempConfig.stores.includes(store.id as StoreType) ? ButtonStyle.SUCCESS : ButtonStyle.SECONDARY,
        label: store.name,
        emoji: { name: store.emoji },
        custom_id: `store_${store.id}_${guildId}_setup`
      }))
    },
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SUCCESS,
          label: t.finish_setup,
          custom_id: `finish_setup_${guildId}_setup`
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SECONDARY,
          label: t.cancel,
          custom_id: `cancel_setup_${guildId}_setup`
        }
      ]
    }
  ];

  await env.GUILD_CONFIGS.put(`temp_${guildId}`, JSON.stringify(tempConfig));

  return updateMessage({ embeds: [embed], components });
}

// Channel Helper Functions
function getChannelLabel(channel: any): string {
  let label = channel.name;
  if (channel.parent_id) {
    label = `📁 ${label}`;
  }
  if (label.length > 100) {
    label = label.substring(0, 97) + '...';
  }
  return label;
}

function getChannelDescription(channel: any): string {
  const types: Record<number, string> = {
    0: 'Text Channel',
    5: 'Announcement Channel',
    15: 'Forum Channel'
  };
  
  let desc = types[channel.type] || 'Channel';
  
  if (channel.topic && channel.topic.length > 0) {
    const topic = channel.topic.substring(0, 50);
    desc += ` • ${topic}${channel.topic.length > 50 ? '...' : ''}`;
  }
  
  return desc;
}

function getChannelEmoji(channel: any): { name: string } {
  const emojis: Record<number, string> = {
    0: '💬',
    5: '📢',
    15: '💭'
  };
  
  return { name: emojis[channel.type] || '📝' };
}

// ============================================================================
// COOLDOWN MANAGEMENT
// ============================================================================

async function checkCooldown(env: Env, guildId: string): Promise<{ onCooldown: boolean; remainingTime?: number }> {
  const cooldownKey = `check_${guildId}`;
  const lastCheck = await env.COMMAND_COOLDOWNS.get(cooldownKey);
  
  if (!lastCheck) {
    return { onCooldown: false };
  }
  
  const lastCheckTime = parseInt(lastCheck);
  const now = Date.now();
  const timePassed = now - lastCheckTime;
  
  if (timePassed < COOLDOWN_DURATION) {
    const remainingTime = COOLDOWN_DURATION - timePassed;
    return { onCooldown: true, remainingTime };
  }
  
  return { onCooldown: false };
}

async function setCooldown(env: Env, guildId: string): Promise<void> {
  const cooldownKey = `check_${guildId}`;
  await env.COMMAND_COOLDOWNS.put(cooldownKey, Date.now().toString(), {
    expirationTtl: Math.ceil(COOLDOWN_DURATION / 1000)
  });
}

function formatCooldownTime(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
}

// ============================================================================
// GAME CHECKING & POSTING (Teil 2)
// ============================================================================

async function checkAndPostFreeGames(env: Env): Promise<void> {
  Logger.info('Starting game check', { timestamp: new Date().toISOString() });
  
  try {
    const configManager = new ConfigManager(env.GUILD_CONFIGS);
    const guilds = await configManager.getAll();
    const postedGames = await loadPostedGames(env);
    let newGamesCount = 0;
    
    for (const guild of guilds.filter(g => g.enabled)) {
      const t = translations[guild.language];
      
      for (const store of guild.stores) {
        try {
          const games = await getFreeGamesForStore(store);
          
          if (!games || games.length === 0) continue;
          
          for (const game of games) {
            if (game.isDLC && !guild.includeDLCs) {
              Logger.debug('Skipping DLC', { game: game.title });
              continue;
            }

            const gameKey = `${store}-${game.id}`;
            
            if (!postedGames.includes(gameKey)) {
              Logger.info('New free game found', { game: game.title, store });
              
              const embed = await createGameEmbed(game, t, guild.language, guild.currency, env);
              
              let mentions = '';
              if (guild.storeRoles && guild.storeRoles[store]) {
                mentions = `<@&${guild.storeRoles[store]}>`;
              } else if (guild.mentionRoles.length > 0) {
                mentions = guild.mentionRoles.map(r => `<@&${r}>`).join(' ');
              }
              
              let targetId = guild.channelId;
              if (guild.separateThreads && guild.storeThreads?.[store]) {
                targetId = guild.storeThreads[store]!;
              } else if (guild.threadId) {
                targetId = guild.threadId;
              }
              
              await sendToChannel(env, targetId, embed, mentions, guild);
              postedGames.push(gameKey);
              newGamesCount++;
            }
          }
        } catch (error) {
          Logger.error(`Failed to check ${store} for guild ${guild.guildId}`, error);
        }
      }
    }
    
    if (postedGames.length > 0) {
      await savePostedGames(env, postedGames);
    }
    
    Logger.info('Game check complete', { newGamesCount });
  } catch (error) {
    Logger.error('Game check failed', error);
  }
}

async function getFreeGamesForStore(store: StoreType): Promise<Game[] | null> {
  const platform = STORE_CONFIG[store].platform;
  const url = `https://www.gamerpower.com/api/giveaways?platform=${platform}&type=game`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) {
      Logger.error(`Error fetching ${store} games`, new Error(`Status: ${response.status}`));
      return null;
    }
    
    type GamerPowerResponse = GamerPowerGame[] | { status: number; message?: string };
    const data: GamerPowerResponse = await response.json();

    if (!Array.isArray(data)) {
      if (data.status === 0) {
        return null;
      }
    }

    const games = data as GamerPowerGame[];
    
    if (store === 'epic') {
      const epicGames = await getEpicGamesOfficial();
      if (epicGames && epicGames.length > 0) {
        return mergeEpicGames(parseGamerPowerGames(games, store), epicGames);
      }
    }
    
    return parseGamerPowerGames(games, store);
  } catch (error) {
    Logger.error(`Error fetching ${store} games`, error);
    return null;
  }
}

function parseGamerPowerGames(data: GamerPowerGame[], store: StoreType): Game[] {
  const games: Game[] = [];
  
  for (const item of data) {
    if (item.type !== 'Game' || item.status === 'Expired') continue;

    const isDLC = detectIfDLC(item.title, item.description);
    
    let originalPrice = 0;
    if (item.worth && item.worth !== 'N/A') {
      const priceMatch = item.worth.match(/[\d.]+/);
      if (priceMatch) {
        originalPrice = parseFloat(priceMatch[0]);
      }
    }
    
    let endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (item.end_date && item.end_date !== 'N/A') {
      try {
        endDate = new Date(item.end_date).toISOString();
      } catch (e) {
        Logger.error('Error parsing end date', e);
      }
    }
    
    games.push({
      id: item.id.toString(),
      store,
      title: item.title,
      description: item.description || 'No description available',
      startDate: item.published_date,
      endDate,
      url: item.open_giveaway_url || item.gamerpower_url,
      image: item.image || item.thumbnail,
      price: originalPrice > 0 ? {
        original: originalPrice,
        discount: 100,
        currency: 'USD'
      } : undefined,
      instructions: item.instructions,
      isDLC: isDLC
    });
  }
  
  return games;
}

async function getEpicGamesOfficial(): Promise<Game[] | null> {
  const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en&country=US&allowCountries=US';
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return parseEpicGamesOfficial(data);
  } catch (error) {
    Logger.error('Error fetching Epic official games', error);
    return null;
  }
}

function parseEpicGamesOfficial(data: any): Game[] {
  const freeGames: Game[] = [];
  
  if (!data?.data?.Catalog?.searchStore?.elements) return freeGames;
  
  const games = data.data.Catalog.searchStore.elements;
  
  for (const game of games) {
    const isFree = game.price?.totalPrice?.discountPrice === 0;
    const hasPromotion = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
    
    if (isFree && hasPromotion) {
      const offer = game.promotions.promotionalOffers[0].promotionalOffers[0];
      const isDLC = detectIfDLC(game.title, game.description || '');
      
      let imageUrl: string | null = null;
      const images = game.keyImages || [];
      for (const img of images) {
        if (img.type === 'DieselStoreFrontWide' || img.type === 'OfferImageWide') {
          imageUrl = img.url;
          break;
        }
      }
      
      const slug = game.productSlug || game.urlSlug;
      if (!slug) continue;
      
      const originalPrice = game.price?.totalPrice?.originalPrice || 0;
      
      freeGames.push({
        id: game.id,
        store: 'epic',
        title: game.title,
        description: game.description || 'No description available',
        startDate: offer.startDate,
        endDate: offer.endDate,
        url: `https://store.epicgames.com/p/${slug}`,
        image: imageUrl,
        price: {
          original: originalPrice / 100,
          discount: 100,
          currency: 'USD'
        },
        isDLC: isDLC
      });
    }
  }
  
  return freeGames;
}

function mergeEpicGames(gamerPowerGames: Game[], officialGames: Game[]): Game[] {
  const merged: Game[] = [];
  const processedTitles = new Set<string>();
  
  for (const official of officialGames) {
    const titleKey = official.title.toLowerCase().trim();
    
    const gp = gamerPowerGames.find(g => 
      g.title.toLowerCase().trim() === titleKey ||
      g.title.toLowerCase().includes(titleKey) ||
      titleKey.includes(g.title.toLowerCase().trim())
    );
    
    if (gp) {
      if (gp.instructions && gp.instructions !== 'N/A') {
        official.instructions = gp.instructions.replace('"Get Giveaway" button', '"Epic Games Store" link').trim();
      }
      
      if (gp.price && gp.price.original > 0 && (!official.price || official.price.original === 0)) {
        official.price = gp.price;
      }
      
      processedTitles.add(gp.title.toLowerCase().trim());
    }
    
    merged.push(official);
    processedTitles.add(titleKey);
  }
  
  return merged;
}

function detectIfDLC(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  
  if (DLC_KEYWORDS.some(keyword => text.includes(keyword))) {
    return true;
  }
  
  return description.toLowerCase().includes('requires the base game') ||
         description.toLowerCase().includes('requires base game') ||
         description.toLowerCase().includes('expansion for');
}

async function createGameEmbed(game: Game, t: any, lang: Language, currency: Currency, env: Env): Promise<any> {
  const endTimestamp = Math.floor(new Date(game.endDate).getTime() / 1000);
  
  const embed: any = {
    title: `🎁 ${game.title}${game.isDLC ? ' - DLC' : ''} - ${t.free_title}`,
    description: game.description.substring(0, 500) + (game.description.length > 500 ? '...' : ''),
    color: STORE_CONFIG[game.store].color,
    url: game.url,
    fields: [],
    footer: { 
      text: `${STORE_CONFIG[game.store].name} • ${t.store_footer}`,
      icon_url: STORE_CONFIG[game.store].icon
    },
    timestamp: new Date().toISOString()
  };
  
  if (game.image) {
    embed.image = { url: game.image };
  }
  
  embed.fields.push({
    name: t.available_until,
    value: `<t:${endTimestamp}:F> (<t:${endTimestamp}:R>)`,
    inline: false
  });
  
  if (game.price && game.price.original > 0) {
    const convertedPrice = await convertCurrency(game.price.original, game.price.currency, currency, env);
    
    const priceFormatted = new Intl.NumberFormat(getLocaleForLanguage(lang), {
      style: 'currency',
      currency: currency
    }).format(convertedPrice);
    
    embed.fields.push({
      name: t.original_price,
      value: `~~${priceFormatted}~~ **FREE** (-${game.price.discount}%)`,
      inline: true
    });
  }
  
  if (game.instructions && game.instructions !== 'N/A') {
    const instructions = game.instructions.substring(0, 200) + (game.instructions.length > 200 ? '...' : '');
    embed.fields.push({
      name: t.how_to_claim,
      value: instructions,
      inline: false
    });
  }
  
  embed.fields.push({
    name: t.get_now,
    value: `[${STORE_CONFIG[game.store].name}](${game.url})`,
    inline: false
  });
  
  return embed;
}

async function sendToChannel(env: Env, channelId: string, embed: any, mentions?: string, config?: GuildConfig): Promise<boolean> {
  try {
    const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
    const channelInfo = await discord.getChannel(channelId);
    
    if (channelInfo && channelInfo.type === 15) {
      return await createForumPost(env, channelId, embed, mentions, config);
    } else {
      const payload: any = { embeds: [embed] };
      if (mentions) {
        payload.content = mentions;
      }
      
      const message = await discord.sendMessage(channelId, payload);
      
      if (config?.reactions) {
        await addReactionsToMessage(env, channelId, message.id);
      }
      
      return true;
    }
  } catch (error) {
    Logger.error('Error sending message', error);
    return false;
  }
}

async function createForumPost(env: Env, forumChannelId: string, embed: any, mentions?: string, config?: GuildConfig): Promise<boolean> {
  try {
    const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
    const gameTitle = embed.title.replace('🎁 ', '').split(' - ')[0];
    
    const threadName = gameTitle.length > 100 
      ? gameTitle.substring(0, 97) + '...'
      : gameTitle;
    
    const payload: any = {
      name: threadName,
      message: {
        embeds: [embed]
      },
      auto_archive_duration: 1440
    };
    
    if (mentions) {
      payload.message.content = mentions;
    }
    
    const thread = await discord.createForumPost(forumChannelId, payload);
    Logger.info('Created forum post', { title: threadName, id: thread.id });
    
    if (config?.reactions && thread.message?.id) {
      await addReactionsToMessage(env, thread.id, thread.message.id);
    }
    
    return true;
  } catch (error) {
    Logger.error('Error creating forum post', error);
    return false;
  }
}

async function addReactionsToMessage(env: Env, channelId: string, messageId: string): Promise<void> {
  try {
    const discord = new DiscordAPI(env.DISCORD_BOT_TOKEN);
    const reactions = ['🔥', '❄️'];
    
    for (const emoji of reactions) {
      await discord.addReaction(channelId, messageId, emoji);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) {
    Logger.error('Error adding reactions', error);
  }
}

// ============================================================================
// POSTED GAMES TRACKING
// ============================================================================

async function loadPostedGames(env: Env): Promise<string[]> {
  try {
    const data = await env.POSTED_GAMES.get('games', 'json');
    return (data as string[]) || [];
  } catch (error) {
    Logger.error('Error loading posted games', error);
    return [];
  }
}

async function savePostedGames(env: Env, games: string[]): Promise<void> {
  try {
    const gamesToStore = games.slice(-1000);
    await env.POSTED_GAMES.put('games', JSON.stringify(gamesToStore));
  } catch (error) {
    Logger.error('Error saving posted games', error);
  }
}

// ============================================================================
// CURRENCY CONVERSION
// ============================================================================

async function convertCurrency(
  amount: number, 
  fromCurrency: string, 
  toCurrency: Currency,
  env: Env
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return amount;
  }
  
  try {
    const cacheKey = `exchange_rates_${fromCurrency}`;
    const cached = await env.POSTED_GAMES.get(cacheKey, 'json') as ExchangeRateCache | null;
    
    if (cached && cached.timestamp > Date.now() - 24 * 60 * 60 * 1000) {
      const rate = cached.rates[toCurrency];
      if (rate) {
        return Math.round(amount * rate * 100) / 100;
      }
    }
    
    const rates = await fetchExchangeRates(fromCurrency, env);
    
    if (rates && rates[toCurrency]) {
      const cacheData: ExchangeRateCache = {
        rates: rates,
        timestamp: Date.now()
      };
      await env.POSTED_GAMES.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: 86400
      });
      
      return Math.round(amount * rates[toCurrency] * 100) / 100;
    }
    
    return convertCurrencyFallback(amount, fromCurrency, toCurrency);
    
  } catch (error) {
    Logger.error('Currency conversion error', error);
    return convertCurrencyFallback(amount, fromCurrency, toCurrency);
  }
}

async function fetchExchangeRates(baseCurrency: string, env: Env): Promise<Record<string, number> | null> {
  try {
    const response = await fetch(
      `https://open.exchangerate-api.com/v6/latest/${baseCurrency.toUpperCase()}`,
      {
        headers: {
          'User-Agent': 'PixelPost-Discord-Bot/1.0'
        }
      }
    );
    
    if (!response.ok) {
      Logger.error('Exchange rate API error', new Error(`Status: ${response.status}`));
      return null;
    }
    
    const data = await response.json();
    
    if (data.result === 'success' && data.rates) {
      return data.rates;
    }
    
    return null;
  } catch (error) {
    Logger.error('Error fetching exchange rates', error);
    return null;
  }
}

function convertCurrencyFallback(amount: number, fromCurrency: string, toCurrency: Currency): number {
  const rates: Record<string, number> = {
    'USD': 1.0,
    'EUR': 0.92,
    'GBP': 0.79,
    'JPY': 149.50,
    'AUD': 1.53,
    'CAD': 1.36,
    'CHF': 0.88,
    'CNY': 7.24,
    'RUB': 92.50,
    'BRL': 4.97
  };
  
  const fromRate = rates[fromCurrency.toUpperCase()] || 1.0;
  const toRate = rates[toCurrency] || 1.0;
  
  const amountInUSD = amount / fromRate;
  const convertedAmount = amountInUSD * toRate;
  
  return Math.round(convertedAmount * 100) / 100;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getLocaleForLanguage(lang: Language): string {
  const locales: Record<Language, string> = {
    en: 'en-US',
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    it: 'it-IT',
    pt: 'pt-PT',
    ru: 'ru-RU',
    pl: 'pl-PL'
  };
  return locales[lang];
}

// ============================================================================
// WORKER EXPORT
// ============================================================================

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAndPostFreeGames(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === 'POST' && url.pathname === '/interactions') {
      return handleDiscordInteraction(request, env, ctx);
    }
    
    if (request.method === 'POST' && url.pathname === '/check') {
      await checkAndPostFreeGames(env);
      return new Response('Check completed', { status: 200 });
    }
    
    return new Response('🎮 PixelPost is running!', { status: 200 });
  }
};

// ============================================================================
// TRANSLATIONS
// ============================================================================

const translations: Record<Language, Record<string, string>> = {
  en: {
    setup_wizard_title: 'Setup Wizard',
    setup_wizard_desc: 'Welcome to the PixelPost! Let\'s set everything up in just a few steps.',
    setup_step_language: 'Please select your preferred language:',
    setup_step_channel: 'Select Channel',
    select_channel_placeholder: 'Choose a channel...',
    setup_channel_instructions: 'Where should I post free games? Select a channel from the dropdown below or use the current channel.',
    use_current_channel: 'Use This Channel',
    setup_step_stores: 'Select Game Stores',
    setup_stores_instructions: 'Which stores should I monitor? Click stores to toggle them, then click "Finish Setup".',
    finish_setup: 'Finish Setup',
    cancel: 'Cancel',
    language_selected: 'Language Selected',
    channel_selected: 'Channel Selected',
    store_toggled: 'Store Updated',
    setup_complete_title: 'Setup Complete!',
    setup_complete_desc: 'The bot is now configured and will start posting free games automatically.',
    step: 'Step',
    status_title: 'Bot Status',
    status_active: '✅ Bot is active and posting in',
    status_inactive: '❌ Bot is not configured',
    status_channel: 'Channel',
    status_stores: 'Active Stores',
    status_language: 'Language',
    status_roles: 'Mention Roles',
    store_threads: 'Store Threads',
    setup_required: 'Please run `/setup` first to configure the bot.',
    none: 'None',
    selected: 'Selected',
    help_title: 'Help & Commands',
    help_description: 'Here are all available commands for the PixelPost:',
    help_user_commands: 'User Commands',
    help_admin_commands: 'Admin Commands',
    help_cmd_help: 'Show this help message',
    help_cmd_status: 'Check bot configuration and status',
    help_cmd_setup: 'Start the interactive setup wizard',
    help_cmd_check: 'Manually check for new free games',
    help_cmd_settings: 'Configure all bot settings (language, stores, roles, etc.)',
    help_links: 'Links & Support',
    help_links_text: '[Documentation](https://github.com/yourrepo) • [Support](https://discord.gg/support)',
    no_permission_title: 'No Permission',
    no_permission_desc: 'You need Administrator permissions to use this command.',
    free_title: 'FREE!',
    available_until: '⏰ Available until',
    get_now: '🔗 Get now',
    original_price: '💰 Original price',
    store_footer: 'Free to keep',
    how_to_claim: '📋 How to claim',
    check_running_title: 'Checking for Games',
    check_running: 'Searching for new free games... This may take up to 30 seconds.',
    check_complete: '✅ Check complete! New games have been posted if available.',
    unknown_command: '❌ Unknown command',
    error_occurred: 'An error occurred',
    settings_title: 'Bot Settings',
    settings_description: 'Configure all bot settings from here. Click a button below to customize a specific setting.',
    settings_currency: 'Currency',
    settings_notification_roles: 'Notification Roles',
    settings_reactions: 'Reaction Voting',
    settings_dlcs: 'DLC Posts',
    settings_include_dlcs: 'Include DLCs',
    settings_games_only: 'Games Only',
    settings_btn_general: 'General',
    settings_btn_stores: 'Stores',
    settings_btn_language: 'Language',
    settings_btn_roles: 'Roles',
    settings_btn_channel: 'Channel',
    settings_btn_reactions: 'Reactions',
    settings_general_title: 'General Settings',
    settings_general_desc: 'Configure currency display and content preferences.',
    settings_toggle_dlcs: 'Toggle DLC Posts',
    settings_stores_title: 'Store Configuration',
    settings_stores_desc: 'Select which game stores to monitor for free games.',
    settings_language_title: 'Language Settings',
    settings_language_desc: 'Choose your preferred language for bot messages.',
    current_language: 'Current Language',
    settings_roles_title: 'Notification Roles',
    settings_roles_desc: 'Configure which roles to mention when posting free games.',
    settings_general_role: 'General Notification Role',
    settings_store_roles: 'Store-Specific Roles',
    settings_add_general_role: 'Add General Role',
    settings_clear_general_roles: 'Clear All Roles',
    settings_configure_store_roles: 'Configure Store Roles',
    settings_channel_title: 'Channel Configuration',
    settings_channel_desc: 'Select where the bot should post free game announcements.',
    current_channel: 'Current Channel',
    settings_reactions_title: 'Reaction Voting',
    settings_reactions_desc: 'Enable or disable reaction voting on game posts.',
    settings_reactions_info: 'When enabled, the bot will add 🔥 (hot deal) and ❄️ (not interested) reactions to each post, allowing users to vote.',
    current_status: 'Current Status',
    back: 'Back',
    enabled: 'Enabled',
    disabled: 'Disabled',
    enable: 'Enable',
    disable: 'Disable',
    info: 'Information',
    check_cooldown_title: 'Command on Cooldown',
    check_cooldown_desc: 'This command can only be used once per hour. Please try again in: ',
  },
  
  de: {
    setup_wizard_title: 'Einrichtungsassistent',
    setup_wizard_desc: 'Willkommen beim PixelPost! Lass uns alles in wenigen Schritten einrichten.',
    setup_step_language: 'Bitte wähle deine bevorzugte Sprache:',
    setup_step_channel: 'Kanal auswählen',
    select_channel_placeholder: 'Wähle einen Kanal...',
    setup_channel_instructions: 'Wo soll ich kostenlose Spiele posten? Wähle einen Kanal aus dem Dropdown-Menü oder nutze den aktuellen Kanal.',
    use_current_channel: 'Diesen Kanal nutzen',
    setup_step_stores: 'Game Stores auswählen',
    setup_stores_instructions: 'Welche Stores soll ich überwachen? Klicke auf Stores um sie zu aktivieren/deaktivieren, dann auf "Einrichtung abschließen".',
    finish_setup: 'Einrichtung abschließen',
    cancel: 'Abbrechen',
    language_selected: 'Sprache ausgewählt',
    channel_selected: 'Kanal ausgewählt',
    store_toggled: 'Store aktualisiert',
    setup_complete_title: 'Einrichtung abgeschlossen!',
    setup_complete_desc: 'Der Bot ist jetzt konfiguriert und wird automatisch kostenlose Spiele posten.',
    step: 'Schritt',
    status_title: 'Bot-Status',
    status_active: '✅ Bot ist aktiv und postet in',
    status_inactive: '❌ Bot ist nicht konfiguriert',
    status_channel: 'Kanal',
    status_stores: 'Aktive Stores',
    status_language: 'Sprache',
    status_roles: 'Erwähnte Rollen',
    store_threads: 'Store-Threads',
    setup_required: 'Bitte führe zuerst `/setup` aus, um den Bot zu konfigurieren.',
    none: 'Keine',
    selected: 'Ausgewählt',
    help_title: 'Hilfe & Befehle',
    help_description: 'Hier sind alle verfügbaren Befehle für den PixelPost:',
    help_user_commands: 'Nutzer-Befehle',
    help_admin_commands: 'Admin-Befehle',
    help_cmd_help: 'Diese Hilfenachricht anzeigen',
    help_cmd_status: 'Bot-Konfiguration und Status prüfen',
    help_cmd_setup: 'Interaktiven Einrichtungsassistenten starten',
    help_cmd_check: 'Manuell nach neuen kostenlosen Spielen suchen',
    help_cmd_settings: 'Alle Bot-Einstellungen konfigurieren (Sprache, Stores, Rollen, etc.)',
    help_links: 'Links & Support',
    help_links_text: '[Dokumentation](https://github.com/yourrepo) • [Support](https://discord.gg/support)',
    no_permission_title: 'Keine Berechtigung',
    no_permission_desc: 'Du benötigst Administrator-Rechte, um diesen Befehl zu nutzen.',
    free_title: 'KOSTENLOS!',
    available_until: '⏰ Verfügbar bis',
    get_now: '🔗 Jetzt holen',
    original_price: '💰 Originalpreis',
    store_footer: 'Kostenlos erhältlich',
    how_to_claim: '📋 So erhältst du es',
    check_running_title: 'Prüfe auf Spiele',
    check_running: 'Suche nach neuen kostenlosen Spielen... Dies kann bis zu 30 Sekunden dauern.',
    check_complete: '✅ Prüfung abgeschlossen! Neue Spiele wurden gepostet, falls verfügbar.',
    unknown_command: '❌ Unbekannter Befehl',
    error_occurred: 'Ein Fehler ist aufgetreten',
    settings_title: 'Bot-Einstellungen',
    settings_description: 'Konfiguriere alle Bot-Einstellungen von hier aus. Klicke auf eine Schaltfläche unten, um eine bestimmte Einstellung anzupassen.',
    settings_currency: 'Währung',
    settings_notification_roles: 'Benachrichtigungsrollen',
    settings_reactions: 'Reaktions-Abstimmung',
    settings_dlcs: 'DLC-Beiträge',
    settings_include_dlcs: 'DLCs einschließen',
    settings_games_only: 'Nur Spiele',
    settings_btn_general: 'Allgemein',
    settings_btn_stores: 'Stores',
    settings_btn_language: 'Sprache',
    settings_btn_roles: 'Rollen',
    settings_btn_channel: 'Kanal',
    settings_btn_reactions: 'Reaktionen',
    settings_general_title: 'Allgemeine Einstellungen',
    settings_general_desc: 'Konfiguriere Währungsanzeige und Inhaltseinstellungen.',
    settings_toggle_dlcs: 'DLC-Beiträge umschalten',
    settings_stores_title: 'Store-Konfiguration',
    settings_stores_desc: 'Wähle aus, welche Game-Stores auf kostenlose Spiele überwacht werden sollen.',
    settings_language_title: 'Spracheinstellungen',
    settings_language_desc: 'Wähle deine bevorzugte Sprache für Bot-Nachrichten.',
    current_language: 'Aktuelle Sprache',
    settings_roles_title: 'Benachrichtigungsrollen',
    settings_roles_desc: 'Konfiguriere, welche Rollen beim Posten kostenloser Spiele erwähnt werden sollen.',
    settings_general_role: 'Allgemeine Benachrichtigungsrolle',
    settings_store_roles: 'Store-spezifische Rollen',
    settings_add_general_role: 'Allgemeine Rolle hinzufügen',
    settings_clear_general_roles: 'Alle Rollen löschen',
    settings_configure_store_roles: 'Store-Rollen konfigurieren',
    settings_channel_title: 'Kanal-Konfiguration',
    settings_channel_desc: 'Wähle aus, wo der Bot kostenlose Spiele ankündigen soll.',
    current_channel: 'Aktueller Kanal',
    settings_reactions_title: 'Reaktions-Abstimmung',
    settings_reactions_desc: 'Aktiviere oder deaktiviere Reaktions-Abstimmungen bei Spiele-Posts.',
    settings_reactions_info: 'Wenn aktiviert, fügt der Bot 🔥 (heißes Angebot) und ❄️ (nicht interessiert) Reaktionen zu jedem Beitrag hinzu, damit Nutzer abstimmen können.',
    current_status: 'Aktueller Status',
    back: 'Zurück',
    enabled: 'Aktiviert',
    disabled: 'Deaktiviert',
    enable: 'Aktivieren',
    disable: 'Deaktivieren',
    info: 'Information',
    check_cooldown_title: 'Befehl im Cooldown',
    check_cooldown_desc: 'Dieser Befehl kann nur einmal pro Stunde verwendet werden. Bitte versuche es erneut in: ',
  },
  
  // Andere Sprachen aus Platzgründen verkürzt - in Produktion alle einbinden
  fr: {
    setup_wizard_title: 'Assistant de configuration',
    setup_wizard_desc: 'Bienvenue sur PixelPost! Configurons tout en quelques étapes.',
    // ... rest of translations
    back: 'Retour',
    enabled: 'Activé',
    disabled: 'Désactivé',
  },
  
  es: {
    setup_wizard_title: 'Asistente de configuración',
    setup_wizard_desc: '¡Bienvenido a PixelPost! Configuremos todo en pocos pasos.',
    // ... rest of translations
    back: 'Atrás',
    enabled: 'Activado',
    disabled: 'Desactivado',
  },
  
  it: {
    setup_wizard_title: 'Assistente di configurazione',
    setup_wizard_desc: 'Benvenuto in PixelPost! Configuriamo tutto in pochi passaggi.',
    // ... rest of translations
    back: 'Indietro',
    enabled: 'Abilitato',
    disabled: 'Disabilitato',
  },
  
  pt: {
    setup_wizard_title: 'Assistente de configuração',
    setup_wizard_desc: 'Bem-vindo ao PixelPost! Vamos configurar tudo em poucos passos.',
    // ... rest of translations
    back: 'Voltar',
    enabled: 'Ativado',
    disabled: 'Desativado',
  },
  
  ru: {
    setup_wizard_title: 'Мастер настройки',
    setup_wizard_desc: 'Добро пожаловать в PixelPost! Давайте все настроим за несколько шагов.',
    // ... rest of translations
    back: 'Назад',
    enabled: 'Включено',
    disabled: 'Отключено',
  },
  
  pl: {
    setup_wizard_title: 'Kreator konfiguracji',
    setup_wizard_desc: 'Witaj w PixelPost! Skonfigurujmy wszystko w kilku krokach.',
    // ... rest of translations
    back: 'Wstecz',
    enabled: 'Włączone',
    disabled: 'Wyłączone',
  },
};