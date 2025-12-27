/**
 * PixelPost - Multi-Store Free Games Bot for Discord
 * Refactored for production with improved error handling, design patterns, and maintainability
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
  storeRoles?: Record<StoreType, string>;
  separateThreads: boolean;
  storeThreads?: Record<StoreType, string>;
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
  price?: {
    original: number;
    discount: number;
    currency: string;
  };
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

interface DiscordChannel {
  id: string;
  type: number;
  name: string;
  parent_id?: string;
  topic?: string;
}

interface DiscordRole {
  id: string;
  name: string;
  managed: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DISCORD_CONSTANTS = {
  InteractionType: {
    PING: 1,
    APPLICATION_COMMAND: 2,
    MESSAGE_COMPONENT: 3,
  } as const,
  
  InteractionResponseType: {
    PONG: 1,
    CHANNEL_MESSAGE_WITH_SOURCE: 4,
    DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
    UPDATE_MESSAGE: 7,
  } as const,
  
  ComponentType: {
    ACTION_ROW: 1,
    BUTTON: 2,
    SELECT_MENU: 3,
  } as const,
  
  ButtonStyle: {
    PRIMARY: 1,
    SECONDARY: 2,
    SUCCESS: 3,
    DANGER: 4,
    LINK: 5,
  } as const,
  
  ChannelType: {
    TEXT: 0,
    ANNOUNCEMENT: 5,
    FORUM: 15,
  } as const,
};

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
// ERROR HANDLING
// ============================================================================

class PixelPostError extends Error {
  constructor(
    message: string,
    public code: string,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = 'PixelPostError';
  }
}

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

// ============================================================================
// DISCORD API CLIENT (Singleton Pattern)
// ============================================================================

class DiscordAPIClient {
  private static instance: DiscordAPIClient;
  private baseURL = 'https://discord.com/api/v10';
  private botToken: string;

  private constructor(botToken: string) {
    this.botToken = botToken;
  }

  static getInstance(botToken: string): DiscordAPIClient {
    if (!DiscordAPIClient.instance) {
      DiscordAPIClient.instance = new DiscordAPIClient(botToken);
    }
    return DiscordAPIClient.instance;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
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
        throw new PixelPostError(
          `Discord API error: ${response.status} ${errorText}`,
          'DISCORD_API_ERROR'
        );
      }

      return await response.json();
    } catch (error) {
      Logger.error(`Discord API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  async sendMessage(channelId: string, payload: Record<string, unknown>): Promise<any> {
    return this.request(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async createForumPost(channelId: string, payload: Record<string, unknown>): Promise<any> {
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

  async getGuildChannels(guildId: string): Promise<DiscordChannel[]> {
    return this.request(`/guilds/${guildId}/channels`);
  }

  async getGuildRoles(guildId: string): Promise<DiscordRole[]> {
    return this.request(`/guilds/${guildId}/roles`);
  }

  async updateInteraction(applicationId: string, token: string, content: string): Promise<void> {
    await fetch(
      `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );
  }
}

// ============================================================================
// CONFIGURATION REPOSITORY (Repository Pattern)
// ============================================================================

class ConfigRepository {
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
      throw new PixelPostError('Failed to save configuration', 'CONFIG_SAVE_ERROR');
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

  async update(guildId: string, updates: Partial<GuildConfig>): Promise<GuildConfig | null> {
    const config = await this.get(guildId);
    if (!config) return null;

    const updated = { ...config, ...updates };
    await this.save(updated);
    return updated;
  }
}

// ============================================================================
// GAME DATA SERVICE
// ============================================================================

class GameDataService {
  private gamerPowerBaseURL = 'https://www.gamerpower.com/api/giveaways';
  private epicGamesURL = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en&country=US&allowCountries=US';

  async fetchGamesForStore(store: StoreType): Promise<Game[]> {
    try {
      const platform = STORE_CONFIG[store].platform;
      const url = `${this.gamerPowerBaseURL}?platform=${platform}&type=game`;
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        Logger.warn(`Failed to fetch games for ${store}`, { status: response.status });
        return [];
      }

      const data = await response.json();
      
      if (!Array.isArray(data)) {
        return data.status === 0 ? [] : [];
      }

      const games = this.parseGamerPowerGames(data, store);

      // Enhance Epic Games data with official API
      if (store === 'epic') {
        const epicGames = await this.fetchEpicGamesOfficial();
        if (epicGames.length > 0) {
          return this.mergeEpicGames(games, epicGames);
        }
      }

      return games;
    } catch (error) {
      Logger.error(`Error fetching games for ${store}`, error);
      return [];
    }
  }

  private parseGamerPowerGames(data: GamerPowerGame[], store: StoreType): Game[] {
    return data
      .filter(item => item.type === 'Game' && item.status !== 'Expired')
      .map(item => ({
        id: item.id.toString(),
        store,
        title: item.title,
        description: item.description || 'No description available',
        startDate: item.published_date,
        endDate: this.parseEndDate(item.end_date),
        url: item.open_giveaway_url || item.gamerpower_url,
        image: item.image || item.thumbnail,
        price: this.parsePrice(item.worth),
        instructions: item.instructions,
        isDLC: this.detectDLC(item.title, item.description),
      }));
  }

  private async fetchEpicGamesOfficial(): Promise<Game[]> {
    try {
      const response = await fetch(this.epicGamesURL, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) return [];

      const data = await response.json();
      return this.parseEpicGamesOfficial(data);
    } catch (error) {
      Logger.error('Error fetching Epic official games', error);
      return [];
    }
  }

  private parseEpicGamesOfficial(data: any): Game[] {
    const games: Game[] = [];
    const elements = data?.data?.Catalog?.searchStore?.elements || [];

    for (const game of elements) {
      const isFree = game.price?.totalPrice?.discountPrice === 0;
      const hasPromotion = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];

      if (!isFree || !hasPromotion) continue;

      const offer = game.promotions.promotionalOffers[0].promotionalOffers[0];
      const slug = game.productSlug || game.urlSlug;
      if (!slug) continue;

      const imageUrl = this.findBestImage(game.keyImages);

      games.push({
        id: game.id,
        store: 'epic',
        title: game.title,
        description: game.description || 'No description available',
        startDate: offer.startDate,
        endDate: offer.endDate,
        url: `https://store.epicgames.com/p/${slug}`,
        image: imageUrl,
        price: {
          original: (game.price?.totalPrice?.originalPrice || 0) / 100,
          discount: 100,
          currency: 'USD',
        },
        isDLC: this.detectDLC(game.title, game.description || ''),
      });
    }

    return games;
  }

  private mergeEpicGames(gamerPowerGames: Game[], officialGames: Game[]): Game[] {
    const merged: Game[] = [];
    const processedTitles = new Set<string>();

    // Prioritize official Epic Games API data
    for (const official of officialGames) {
      const titleKey = official.title.toLowerCase().trim();
      const gp = gamerPowerGames.find(g => 
        g.title.toLowerCase().trim() === titleKey ||
        g.title.toLowerCase().includes(titleKey) ||
        titleKey.includes(g.title.toLowerCase().trim())
      );

      if (gp?.instructions && gp.instructions !== 'N/A') {
        official.instructions = gp.instructions;
      }

      merged.push(official);
      processedTitles.add(titleKey);
    }

    return merged;
  }

  private detectDLC(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    
    if (DLC_KEYWORDS.some(keyword => text.includes(keyword))) {
      return true;
    }

    return description.toLowerCase().includes('requires the base game') ||
           description.toLowerCase().includes('requires base game') ||
           description.toLowerCase().includes('expansion for');
  }

  private parsePrice(worth: string): Game['price'] | undefined {
    if (!worth || worth === 'N/A') return undefined;

    const match = worth.match(/[\d.]+/);
    if (!match) return undefined;

    return {
      original: parseFloat(match[0]),
      discount: 100,
      currency: 'USD',
    };
  }

  private parseEndDate(endDate: string): string {
    if (!endDate || endDate === 'N/A') {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      return new Date(endDate).toISOString();
    } catch {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  private findBestImage(images: any[]): string | null {
    if (!images) return null;

    for (const img of images) {
      if (img.type === 'DieselStoreFrontWide' || img.type === 'OfferImageWide') {
        return img.url;
      }
    }

    return null;
  }
}

// ============================================================================
// CURRENCY CONVERSION SERVICE
// ============================================================================

class CurrencyService {
  private cacheKey = 'exchange_rates';
  private apiURL = 'https://open.exchangerate-api.com/v6/latest';
  
  private static readonly FALLBACK_RATES: Record<string, number> = {
    'USD': 1.0, 'EUR': 0.92, 'GBP': 0.79, 'JPY': 149.50,
    'AUD': 1.53, 'CAD': 1.36, 'CHF': 0.88, 'CNY': 7.24,
    'RUB': 92.50, 'BRL': 4.97,
  };

  constructor(private kv: KVNamespace) {}

  async convert(amount: number, from: string, to: Currency): Promise<number> {
    if (from === to) return amount;

    try {
      const rates = await this.getRates(from);
      const rate = rates[to];

      if (!rate) {
        Logger.warn(`No rate found for ${to}, using fallback`);
        return this.fallbackConvert(amount, from, to);
      }

      return Math.round(amount * rate * 100) / 100;
    } catch (error) {
      Logger.error('Currency conversion failed', error);
      return this.fallbackConvert(amount, from, to);
    }
  }

  private async getRates(baseCurrency: string): Promise<Record<string, number>> {
    const cacheKey = `${this.cacheKey}_${baseCurrency}`;
    const cached = await this.kv.get(cacheKey, 'json') as ExchangeRateCache | null;

    // Use cached rates if valid (< 24 hours old)
    if (cached && cached.timestamp > Date.now() - 24 * 60 * 60 * 1000) {
      return cached.rates;
    }

    // Fetch fresh rates
    const rates = await this.fetchRates(baseCurrency);
    
    if (rates) {
      const cacheData: ExchangeRateCache = {
        rates,
        timestamp: Date.now(),
      };
      await this.kv.put(cacheKey, JSON.stringify(cacheData), {
        expirationTtl: 86400, // 24 hours
      });
      return rates;
    }

    // Fallback to cached rates even if expired
    if (cached) return cached.rates;

    throw new PixelPostError('Failed to get exchange rates', 'EXCHANGE_RATE_ERROR');
  }

  private async fetchRates(baseCurrency: string): Promise<Record<string, number> | null> {
    try {
      const response = await fetch(`${this.apiURL}/${baseCurrency.toUpperCase()}`, {
        headers: { 'User-Agent': 'PixelPost-Discord-Bot/1.0' }
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data.result === 'success' ? data.rates : null;
    } catch (error) {
      Logger.error('Failed to fetch exchange rates', error);
      return null;
    }
  }

  private fallbackConvert(amount: number, from: string, to: Currency): number {
    const fromRate = CurrencyService.FALLBACK_RATES[from.toUpperCase()] || 1.0;
    const toRate = CurrencyService.FALLBACK_RATES[to] || 1.0;
    const amountInUSD = amount / fromRate;
    return Math.round(amountInUSD * toRate * 100) / 100;
  }
}

// ============================================================================
// EMBED BUILDER (Builder Pattern)
// ============================================================================

class EmbedBuilder {
  private embed: Record<string, any> = {};

  setTitle(title: string): this {
    this.embed.title = title;
    return this;
  }

  setDescription(description: string): this {
    this.embed.description = description;
    return this;
  }

  setColor(color: number): this {
    this.embed.color = color;
    return this;
  }

  setURL(url: string): this {
    this.embed.url = url;
    return this;
  }

  setImage(url: string): this {
    this.embed.image = { url };
    return this;
  }

  setFooter(text: string, iconURL?: string): this {
    this.embed.footer = { text, icon_url: iconURL };
    return this;
  }

  setTimestamp(timestamp?: string): this {
    this.embed.timestamp = timestamp || new Date().toISOString();
    return this;
  }

  addField(name: string, value: string, inline: boolean = false): this {
    if (!this.embed.fields) this.embed.fields = [];
    this.embed.fields.push({ name, value, inline });
    return this;
  }

  build(): Record<string, any> {
    return this.embed;
  }
}

// ============================================================================
// RESPONSE BUILDER (Fluent Interface)
// ============================================================================

class ResponseBuilder {
  private response: Record<string, any> = {};

  static embed(embed: Record<string, any>, ephemeral: boolean = false): Response {
    return new ResponseBuilder()
      .addEmbed(embed)
      .setEphemeral(ephemeral)
      .build();
  }

  static updateMessage(embed: Record<string, any>, components?: any[]): Response {
    const data: any = { embeds: [embed] };
    if (components) data.components = components;

    return new Response(JSON.stringify({
      type: DISCORD_CONSTANTS.InteractionResponseType.UPDATE_MESSAGE,
      data,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  addEmbed(embed: Record<string, any>): this {
    if (!this.response.embeds) this.response.embeds = [];
    this.response.embeds.push(embed);
    return this;
  }

  addComponents(components: any[]): this {
    this.response.components = components;
    return this;
  }

  setEphemeral(ephemeral: boolean): this {
    if (ephemeral) this.response.flags = 64;
    return this;
  }

  setContent(content: string): this {
    this.response.content = content;
    return this;
  }

  build(): Response {
    return new Response(JSON.stringify({
      type: DISCORD_CONSTANTS.InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: this.response,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================================================
// INTERACTION HANDLER (Strategy Pattern)
// ============================================================================

interface InteractionHandler {
  canHandle(interaction: any): boolean;
  handle(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response>;
}

class PingHandler implements InteractionHandler {
  canHandle(interaction: any): boolean {
    return interaction.type === DISCORD_CONSTANTS.InteractionType.PING;
  }

  async handle(): Promise<Response> {
    return new Response(JSON.stringify({
      type: DISCORD_CONSTANTS.InteractionResponseType.PONG
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

class CommandHandler implements InteractionHandler {
  private configRepo: ConfigRepository;
  private discord: DiscordAPIClient;

  constructor(private env: Env) {
    this.configRepo = new ConfigRepository(env.GUILD_CONFIGS);
    this.discord = DiscordAPIClient.getInstance(env.DISCORD_BOT_TOKEN);
  }

  canHandle(interaction: any): boolean {
    return interaction.type === DISCORD_CONSTANTS.InteractionType.APPLICATION_COMMAND;
  }

  async handle(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { name } = interaction.data;
    const guildId = interaction.guild_id;
    const member = interaction.member;

    const config = await this.configRepo.get(guildId);
    const hasAdminPermission = this.checkAdminPermission(member);

    if (ADMIN_COMMANDS.includes(name) && !hasAdminPermission) {
      return this.noPermissionResponse(config?.language || 'en');
    }

    const commandMap: Record<string, () => Promise<Response>> = {
      'setup': () => this.handleSetup(interaction, config),
      'help': () => this.handleHelp(interaction, hasAdminPermission, config?.language || 'en'),
      'status': () => this.handleStatus(interaction, config),
      'check': () => this.handleCheck(interaction, env, ctx, config),
      'settings': () => this.handleSettings(interaction, config),
    };

    const handler = commandMap[name];
    if (!handler) {
      return this.unknownCommandResponse(config?.language || 'en');
    }

    try {
      return await handler();
    } catch (error) {
      Logger.error(`Command ${name} failed`, error, { guildId });
      return this.errorResponse(config?.language || 'en');
    }
  }

  private checkAdminPermission(member: any): boolean {
    return member?.permissions && (BigInt(member.permissions) & BigInt(0x8)) === BigInt(0x8);
  }

  private noPermissionResponse(lang: Language): Response {
    const t = translations[lang];
    return ResponseBuilder.embed(
      new EmbedBuilder()
        .setTitle('🔒 ' + t.no_permission_title)
        .setDescription(t.no_permission_desc)
        .setColor(0xff5555)
        .build(),
      true
    );
  }

  private unknownCommandResponse(lang: Language): Response {
    const t = translations[lang];
    return ResponseBuilder.embed(
      new EmbedBuilder()
        .setTitle('❌ ' + t.unknown_command)
        .setDescription('Command not found')
        .setColor(0xff5555)
        .build(),
      true
    );
  }

  private errorResponse(lang: Language): Response {
    const t = translations[lang];
    return ResponseBuilder.embed(
      new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription(t.error_occurred)
        .setColor(0xff5555)
        .build(),
      true
    );
  }

  private async handleSetup(interaction: any, config: GuildConfig | null): Promise<Response> {
    // Implementation continues...
    const lang = config?.language || 'en';
    const t = translations[lang];
    
    const embed = new EmbedBuilder()
      .setTitle('🚀 ' + t.setup_wizard_title)
      .setDescription(t.setup_wizard_desc)
      .setColor(0x5865F2)
      .addField('📍 ' + t.step + ' 1', t.setup_step_language)
      .setFooter('PixelPost • Setup Wizard')
      .setTimestamp()
      .build();

    // Language selection buttons (simplified for brevity)
    const components = this.createLanguageButtons(interaction.guild_id);

    return new Response(JSON.stringify({
      type: DISCORD_CONSTANTS.InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { embeds: [embed], components, flags: 64 }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private createLanguageButtons(guildId: string): any[] {
    const languages = [
      { id: 'en', label: 'English', emoji: '🇬🇧' },
      { id: 'de', label: 'Deutsch', emoji: '🇩🇪' },
      { id: 'fr', label: 'Français', emoji: '🇫🇷' },
      { id: 'es', label: 'Español', emoji: '🇪🇸' },
    ];

    return [{
      type: DISCORD_CONSTANTS.ComponentType.ACTION_ROW,
      components: languages.map(lang => ({
        type: DISCORD_CONSTANTS.ComponentType.BUTTON,
        style: DISCORD_CONSTANTS.ButtonStyle.PRIMARY,
        label: lang.label,
        emoji: { name: lang.emoji },
        custom_id: `lang_${lang.id}_${guildId}_setup`,
      })),
    }];
  }

  private async handleHelp(interaction: any, hasAdmin: boolean, lang: Language): Promise<Response> {
    const t = translations[lang];
    
    const embed = new EmbedBuilder()
      .setTitle('📖 ' + t.help_title)
      .setDescription(t.help_description)
      .setColor(0x5865F2)
      .addField('👥 ' + t.help_user_commands, [
        `\`/help\` - ${t.help_cmd_help}`,
        `\`/status\` - ${t.help_cmd_status}`,
      ].join('\n'))
      .setFooter('PixelPost')
      .setTimestamp()
      .build();

    if (hasAdmin) {
      embed.fields.push({
        name: '⚙️ ' + t.help_admin_commands,
        value: [
          `\`/setup\` - ${t.help_cmd_setup}`,
          `\`/check\` - ${t.help_cmd_check}`,
          `\`/settings\` - ${t.help_cmd_settings}`,
        ].join('\n'),
        inline: false,
      });
    }

    return ResponseBuilder.embed(embed);
  }

  private async handleStatus(interaction: any, config: GuildConfig | null): Promise<Response> {
    const lang = config?.language || 'en';
    const t = translations[lang];

    if (!config || !config.enabled) {
      return ResponseBuilder.embed(
        new EmbedBuilder()
          .setTitle('❌ ' + t.status_inactive)
          .setDescription(t.setup_required)
          .setColor(0xff5555)
          .build(),
        true
      );
    }

    const channelMention = config.threadId 
      ? `<#${config.threadId}>` 
      : `<#${config.channelId}>`;

    const embed = new EmbedBuilder()
      .setTitle('📊 ' + t.status_title)
      .setDescription(`${t.status_active} ${channelMention}`)
      .setColor(0x00ff99)
      .addField('🌍 ' + t.status_language, '`' + config.language + '`', true)
      .addField(
        '📦 ' + t.status_stores,
        config.stores.map(s => `${STORE_CONFIG[s].emoji} ${STORE_CONFIG[s].name}`).join('\n'),
        true
      )
      .addField(
        '👥 ' + t.status_roles,
        config.mentionRoles.length > 0 
          ? config.mentionRoles.map(r => `<@&${r}>`).join(', ') 
          : t.none,
        false
      )
      .setFooter('PixelPost')
      .setTimestamp()
      .build();

    return ResponseBuilder.embed(embed);
  }

  private async handleCheck(
    interaction: any,
    env: Env,
    ctx: ExecutionContext,
    config: GuildConfig | null
  ): Promise<Response> {
    const lang = config?.language || 'en';
    const t = translations[lang];
    const guildId = interaction.guild_id;

    if (!config || !config.enabled) {
      return ResponseBuilder.embed(
        new EmbedBuilder()
          .setTitle('❌ ' + t.status_inactive)
          .setDescription(t.setup_required)
          .setColor(0xff5555)
          .build(),
        true
      );
    }

    // Check cooldown
    const cooldown = new CooldownService(env.COMMAND_COOLDOWNS);
    const cooldownCheck = await cooldown.check(guildId);

    if (cooldownCheck.onCooldown && cooldownCheck.remainingTime) {
      return ResponseBuilder.embed(
        new EmbedBuilder()
          .setTitle('⏰ ' + t.check_cooldown_title)
          .setDescription(t.check_cooldown_desc + cooldown.formatTime(cooldownCheck.remainingTime))
          .setColor(0xff9900)
          .build(),
        true
      );
    }

    await cooldown.set(guildId);

    // Defer response and run check in background
    ctx.waitUntil(this.runGameCheck(env, interaction.token));

    return ResponseBuilder.embed(
      new EmbedBuilder()
        .setTitle('🔍 ' + t.check_running_title)
        .setDescription(t.check_running)
        .setColor(0x5865F2)
        .build(),
      true
    );
  }

  private async runGameCheck(env: Env, token: string): Promise<void> {
    try {
      await this.discord.updateInteraction(
        env.DISCORD_APPLICATION_ID,
        token,
        '🔍 Checking for free games...'
      );

      const checker = new GameChecker(env);
      await checker.checkAndPost();

      await this.discord.updateInteraction(
        env.DISCORD_APPLICATION_ID,
        token,
        '✅ Check complete!'
      );
    } catch (error) {
      Logger.error('Game check failed', error);
      await this.discord.updateInteraction(
        env.DISCORD_APPLICATION_ID,
        token,
        '❌ An error occurred'
      );
    }
  }

  private async handleSettings(interaction: any, config: GuildConfig | null): Promise<Response> {
    // Settings implementation would go here
    // For brevity, returning a placeholder
    const lang = config?.language || 'en';
    const t = translations[lang];

    if (!config || !config.enabled) {
      return ResponseBuilder.embed(
        new EmbedBuilder()
          .setTitle('❌ ' + t.status_inactive)
          .setDescription(t.setup_required)
          .setColor(0xff5555)
          .build(),
        true
      );
    }

    const embed = new EmbedBuilder()
      .setTitle('⚙️ ' + t.settings_title)
      .setDescription(t.settings_description)
      .setColor(0x5865F2)
      .setFooter('PixelPost • Settings')
      .setTimestamp()
      .build();

    return ResponseBuilder.embed(embed, true);
  }
}

// ============================================================================
// COOLDOWN SERVICE
// ============================================================================

class CooldownService {
  constructor(private kv: KVNamespace) {}

  async check(guildId: string): Promise<{ onCooldown: boolean; remainingTime?: number }> {
    const key = `check_${guildId}`;
    const lastCheck = await this.kv.get(key);

    if (!lastCheck) return { onCooldown: false };

    const lastCheckTime = parseInt(lastCheck);
    const timePassed = Date.now() - lastCheckTime;

    if (timePassed < COOLDOWN_DURATION) {
      return {
        onCooldown: true,
        remainingTime: COOLDOWN_DURATION - timePassed,
      };
    }

    return { onCooldown: false };
  }

  async set(guildId: string): Promise<void> {
    const key = `check_${guildId}`;
    await this.kv.put(key, Date.now().toString(), {
      expirationTtl: Math.ceil(COOLDOWN_DURATION / 1000),
    });
  }

  formatTime(ms: number): string {
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
}

// ============================================================================
// GAME CHECKER SERVICE
// ============================================================================

class GameChecker {
  private configRepo: ConfigRepository;
  private gameService: GameDataService;
  private currencyService: CurrencyService;
  private discord: DiscordAPIClient;

  constructor(private env: Env) {
    this.configRepo = new ConfigRepository(env.GUILD_CONFIGS);
    this.gameService = new GameDataService();
    this.currencyService = new CurrencyService(env.POSTED_GAMES);
    this.discord = DiscordAPIClient.getInstance(env.DISCORD_BOT_TOKEN);
  }

  async checkAndPost(): Promise<void> {
    Logger.info('Starting game check', { timestamp: new Date().toISOString() });

    try {
      const guilds = await this.configRepo.getAll();
      const activeGuilds = guilds.filter(g => g.enabled);
      
      if (activeGuilds.length === 0) {
        Logger.info('No active guilds to check');
        return;
      }

      const postedGames = await this.loadPostedGames();
      let newGamesCount = 0;

      for (const guild of activeGuilds) {
        const count = await this.checkGuildGames(guild, postedGames);
        newGamesCount += count;
      }

      if (postedGames.length > 0) {
        await this.savePostedGames(postedGames);
      }

      Logger.info('Game check complete', { newGamesCount, guildsChecked: activeGuilds.length });
    } catch (error) {
      Logger.error('Game check failed', error);
      throw error;
    }
  }

  private async checkGuildGames(guild: GuildConfig, postedGames: string[]): Promise<number> {
    const t = translations[guild.language];
    let count = 0;

    for (const store of guild.stores) {
      try {
        const games = await this.gameService.fetchGamesForStore(store);
        
        for (const game of games) {
          if (game.isDLC && !guild.includeDLCs) {
            Logger.debug('Skipping DLC', { game: game.title });
            continue;
          }

          const gameKey = `${store}-${game.id}`;
          
          if (!postedGames.includes(gameKey)) {
            await this.postGame(game, guild, t);
            postedGames.push(gameKey);
            count++;
            Logger.info('Posted new game', { game: game.title, store, guild: guild.guildId });
          }
        }
      } catch (error) {
        Logger.error(`Failed to check ${store} for guild ${guild.guildId}`, error);
      }
    }

    return count;
  }

  private async postGame(game: Game, config: GuildConfig, t: any): Promise<void> {
    const embed = await this.createGameEmbed(game, t, config);
    const mentions = this.getMentions(game.store, config);
    const targetId = this.getTargetChannel(game.store, config);

    try {
      const channelInfo = await this.discord.getChannel(targetId);
      
      if (channelInfo?.type === DISCORD_CONSTANTS.ChannelType.FORUM) {
        await this.postToForum(targetId, embed, mentions, config, game);
      } else {
        await this.postToChannel(targetId, embed, mentions, config);
      }
    } catch (error) {
      Logger.error('Failed to post game', error, { game: game.title, guild: config.guildId });
    }
  }

  private async createGameEmbed(game: Game, t: any, config: GuildConfig): Promise<any> {
    const endTimestamp = Math.floor(new Date(game.endDate).getTime() / 1000);
    
    const builder = new EmbedBuilder()
      .setTitle(`🎁 ${game.title}${game.isDLC ? ' - DLC' : ''} - ${t.free_title}`)
      .setDescription(game.description.substring(0, 500) + (game.description.length > 500 ? '...' : ''))
      .setColor(STORE_CONFIG[game.store].color)
      .setURL(game.url)
      .addField(t.available_until, `<t:${endTimestamp}:F> (<t:${endTimestamp}:R>)`, false)
      .setFooter(`${STORE_CONFIG[game.store].name} • ${t.store_footer}`, STORE_CONFIG[game.store].icon)
      .setTimestamp();

    if (game.image) {
      builder.setImage(game.image);
    }

    if (game.price && game.price.original > 0) {
      const convertedPrice = await this.currencyService.convert(
        game.price.original,
        game.price.currency,
        config.currency
      );

      const priceFormatted = new Intl.NumberFormat(this.getLocaleForLanguage(config.language), {
        style: 'currency',
        currency: config.currency,
      }).format(convertedPrice);

      builder.addField(
        t.original_price,
        `~~${priceFormatted}~~ **FREE** (-${game.price.discount}%)`,
        true
      );
    }

    if (game.instructions && game.instructions !== 'N/A') {
      const instructions = game.instructions.substring(0, 200) + 
        (game.instructions.length > 200 ? '...' : '');
      builder.addField(t.how_to_claim, instructions, false);
    }

    builder.addField(t.get_now, `[${STORE_CONFIG[game.store].name}](${game.url})`, false);

    return builder.build();
  }

  private getMentions(store: StoreType, config: GuildConfig): string {
    if (config.storeRoles?.[store]) {
      return `<@&${config.storeRoles[store]}>`;
    }
    
    if (config.mentionRoles.length > 0) {
      return config.mentionRoles.map(r => `<@&${r}>`).join(' ');
    }

    return '';
  }

  private getTargetChannel(store: StoreType, config: GuildConfig): string {
    if (config.separateThreads && config.storeThreads?.[store]) {
      return config.storeThreads[store]!;
    }
    
    if (config.threadId) {
      return config.threadId;
    }

    return config.channelId;
  }

  private async postToChannel(
    channelId: string,
    embed: any,
    mentions: string,
    config: GuildConfig
  ): Promise<void> {
    const payload: any = { embeds: [embed] };
    if (mentions) payload.content = mentions;

    const message = await this.discord.sendMessage(channelId, payload);

    if (config.reactions) {
      await this.addReactions(channelId, message.id);
    }
  }

  private async postToForum(
    forumId: string,
    embed: any,
    mentions: string,
    config: GuildConfig,
    game: Game
  ): Promise<void> {
    const threadName = game.title.length > 100 
      ? game.title.substring(0, 97) + '...' 
      : game.title;

    const payload: any = {
      name: threadName,
      message: { embeds: [embed] },
      auto_archive_duration: 1440,
    };

    if (mentions) payload.message.content = mentions;

    const thread = await this.discord.createForumPost(forumId, payload);

    if (config.reactions && thread.message?.id) {
      await this.addReactions(thread.id, thread.message.id);
    }
  }

  private async addReactions(channelId: string, messageId: string): Promise<void> {
    const reactions = ['🔥', '❄️'];
    
    for (const emoji of reactions) {
      try {
        await this.discord.addReaction(channelId, messageId, emoji);
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        Logger.error('Failed to add reaction', error);
      }
    }
  }

  private async loadPostedGames(): Promise<string[]> {
    try {
      const data = await this.env.POSTED_GAMES.get('games', 'json');
      return (data as string[]) || [];
    } catch (error) {
      Logger.error('Failed to load posted games', error);
      return [];
    }
  }

  private async savePostedGames(games: string[]): Promise<void> {
    try {
      const gamesToStore = games.slice(-1000); // Keep last 1000
      await this.env.POSTED_GAMES.put('games', JSON.stringify(gamesToStore));
    } catch (error) {
      Logger.error('Failed to save posted games', error);
    }
  }

  private getLocaleForLanguage(lang: Language): string {
    const locales: Record<Language, string> = {
      en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES',
      it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU', pl: 'pl-PL',
    };
    return locales[lang];
  }
}

// ============================================================================
// MAIN WORKER EXPORT
// ============================================================================

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const checker = new GameChecker(env);
    await checker.checkAndPost();
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('🎮 PixelPost is running!', { status: 200 });
    }

    // Manual trigger
    if (request.method === 'POST' && url.pathname === '/check') {
      ctx.waitUntil(new GameChecker(env).checkAndPost());
      return new Response('Check started', { status: 200 });
    }

    // Discord interactions
    if (request.method === 'POST' && url.pathname === '/interactions') {
      return await handleDiscordInteraction(request, env, ctx);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleDiscordInteraction(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
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

    // Use Strategy Pattern for handling different interaction types
    const handlers: InteractionHandler[] = [
      new PingHandler(),
      new CommandHandler(env),
      // ComponentHandler would go here
    ];

    for (const handler of handlers) {
      if (handler.canHandle(interaction)) {
        return await handler.handle(interaction, env, ctx);
      }
    }

    return new Response('Unknown interaction type', { status: 400 });
  } catch (error) {
    Logger.error('Interaction handling failed', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// ============================================================================
// TRANSLATIONS (Abbreviated for space - include full version in production)
// ============================================================================

const translations: Record<Language, Record<string, string>> = {
  en: {
    setup_wizard_title: 'Setup Wizard',
    setup_wizard_desc: 'Welcome to PixelPost! Let\'s set everything up.',
    no_permission_title: 'No Permission',
    no_permission_desc: 'You need Administrator permissions.',
    unknown_command: 'Unknown command',
    error_occurred: 'An error occurred',
    help_title: 'Help & Commands',
    help_description: 'Available commands for PixelPost',
    help_user_commands: 'User Commands',
    help_admin_commands: 'Admin Commands',
    help_cmd_help: 'Show this help message',
    help_cmd_status: 'Check bot status',
    help_cmd_setup: 'Start setup wizard',
    help_cmd_check: 'Check for free games',
    help_cmd_settings: 'Configure settings',
    status_title: 'Bot Status',
    status_active: 'Bot is active',
    status_inactive: 'Bot is not configured',
    setup_required: 'Please run /setup first',
    status_language: 'Language',
    status_stores: 'Active Stores',
    status_roles: 'Mention Roles',
    none: 'None',
    check_running_title: 'Checking for Games',
    check_running: 'Searching for new free games...',
    check_cooldown_title: 'Command on Cooldown',
    check_cooldown_desc: 'Please try again in: ',
    settings_title: 'Bot Settings',
    settings_description: 'Configure all bot settings',
    free_title: 'FREE!',
    available_until: 'Available until',
    get_now: 'Get now',
    original_price: 'Original price',
    store_footer: 'Free to keep',
    how_to_claim: 'How to claim',
    step: 'Step',
    setup_step_language: 'Select your language',
  },
  // Other languages would follow...
  de: {
    // German translations...
  },
  // ... etc
};
