/**
 * Multi-Store Free Games Bot für Cloudflare Workers (TypeScript)
 * Unterstützt: Epic Games, Steam, GOG, Ubisoft Connect
 * Mit erweiterten Discord Bot Features und Multi-Language Support
 */

import { verifyKey } from 'discord-interactions';

interface Env {
  POSTED_GAMES: KVNamespace;
  GUILD_CONFIGS: KVNamespace;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

interface GuildConfig {
  guildId: string;
  channelId: string;
  threadId?: string;
  enabled: boolean;
  language: string;
  enabledStores: Store[];
  storeChannels: Record<Store, string>; // Separate Channels pro Store
  mentionRoles: string[]; // Role IDs zum Pingen
  notifyOnlyMajorGames: boolean;
}

type Store = 'epic' | 'steam' | 'gog' | 'ubisoft';

interface Game {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  url: string;
  image: string | null;
  store: Store;
  originalPrice?: string;
  currentPrice: string;
  rating?: number;
  reviewCount?: number;
  tags?: string[];
}

// Discord Interaction Types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
};

// Übersetzungen
const translations: Record<string, Record<string, string>> = {
  en: {
    setup_success: '✅ Bot configured! Free games will be posted in',
    disabled: '❌ Bot disabled. Use `/setup` to enable it again.',
    status_active: '✅ Bot is active and posting in',
    status_inactive: '❌ Bot is not configured. Use `/setup` to set it up.',
    checking: '🔍 Checking for new games... (may take up to 30 seconds)',
    unknown_command: '❌ Unknown command',
    free: 'FREE',
    available_until: '⏰ Available until',
    original_price: '💰 Original Price',
    rating: '⭐ Rating',
    get_now: '🔗 Get Now',
    store_page: 'Store Page',
    launcher: 'Launcher',
    footer: 'Free to Keep',
    stores_updated: '✅ Enabled stores updated:',
    language_updated: '✅ Language changed to English',
    role_added: '✅ Role will be mentioned for new games',
    role_removed: '❌ Role removed from mentions',
    thread_set: '✅ Games will be posted in the specified thread',
    channel_set: '✅ Channel set for',
  },
  de: {
    setup_success: '✅ Bot eingerichtet! Kostenlose Spiele werden gepostet in',
    disabled: '❌ Bot deaktiviert. Nutze `/setup` um ihn wieder zu aktivieren.',
    status_active: '✅ Bot ist aktiv und postet in',
    status_inactive: '❌ Bot ist nicht konfiguriert. Nutze `/setup` um ihn einzurichten.',
    checking: '🔍 Prüfe auf neue Spiele... (kann bis zu 30 Sekunden dauern)',
    unknown_command: '❌ Unbekannter Befehl',
    free: 'KOSTENLOS',
    available_until: '⏰ Verfügbar bis',
    original_price: '💰 Originalpreis',
    rating: '⭐ Bewertung',
    get_now: '🔗 Jetzt holen',
    store_page: 'Store-Seite',
    launcher: 'Launcher',
    footer: 'Kostenlos erhältlich',
    stores_updated: '✅ Aktivierte Stores aktualisiert:',
    language_updated: '✅ Sprache auf Deutsch geändert',
    role_added: '✅ Rolle wird bei neuen Spielen erwähnt',
    role_removed: '❌ Rolle von Erwähnungen entfernt',
    thread_set: '✅ Spiele werden im angegebenen Thread gepostet',
    channel_set: '✅ Channel gesetzt für',
  },
  es: {
    setup_success: '✅ ¡Bot configurado! Los juegos gratis se publicarán en',
    disabled: '❌ Bot desactivado. Usa `/setup` para activarlo de nuevo.',
    status_active: '✅ El bot está activo y publicando en',
    status_inactive: '❌ El bot no está configurado. Usa `/setup` para configurarlo.',
    checking: '🔍 Buscando nuevos juegos... (puede tardar hasta 30 segundos)',
    unknown_command: '❌ Comando desconocido',
    free: 'GRATIS',
    available_until: '⏰ Disponible hasta',
    original_price: '💰 Precio Original',
    rating: '⭐ Calificación',
    get_now: '🔗 Obtener Ahora',
    store_page: 'Página de la Tienda',
    launcher: 'Lanzador',
    footer: 'Gratis para Siempre',
    stores_updated: '✅ Tiendas activadas actualizadas:',
    language_updated: '✅ Idioma cambiado a Español',
    role_added: '✅ El rol será mencionado para nuevos juegos',
    role_removed: '❌ Rol eliminado de las menciones',
    thread_set: '✅ Los juegos se publicarán en el hilo especificado',
    channel_set: '✅ Canal establecido para',
  },
  fr: {
    setup_success: '✅ Bot configuré ! Les jeux gratuits seront publiés dans',
    disabled: '❌ Bot désactivé. Utilisez `/setup` pour le réactiver.',
    status_active: '✅ Le bot est actif et publie dans',
    status_inactive: '❌ Le bot n\'est pas configuré. Utilisez `/setup` pour le configurer.',
    checking: '🔍 Recherche de nouveaux jeux... (peut prendre jusqu\'à 30 secondes)',
    unknown_command: '❌ Commande inconnue',
    free: 'GRATUIT',
    available_until: '⏰ Disponible jusqu\'au',
    original_price: '💰 Prix Original',
    rating: '⭐ Note',
    get_now: '🔗 Obtenir Maintenant',
    store_page: 'Page du Store',
    launcher: 'Lanceur',
    footer: 'Gratuit à Conserver',
    stores_updated: '✅ Magasins activés mis à jour :',
    language_updated: '✅ Langue changée en Français',
    role_added: '✅ Le rôle sera mentionné pour les nouveaux jeux',
    role_removed: '❌ Rôle retiré des mentions',
    thread_set: '✅ Les jeux seront publiés dans le fil spécifié',
    channel_set: '✅ Canal défini pour',
  }
};

function t(config: GuildConfig | null, key: string): string {
  const lang = config?.language || 'en';
  return translations[lang]?.[key] || translations['en'][key] || key;
}

// Store Icons und Farben
const storeInfo: Record<Store, { icon: string; color: number; name: string }> = {
  epic: { icon: '🎮', color: 0x2A2A2A, name: 'Epic Games' },
  steam: { icon: '🎯', color: 0x1B2838, name: 'Steam' },
  gog: { icon: '🎪', color: 0x86328A, name: 'GOG' },
  ubisoft: { icon: '🎨', color: 0x0082CA, name: 'Ubisoft Connect' }
};

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAndPostFreeGames(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Discord Interactions Endpoint
    if (request.method === 'POST' && url.pathname === '/interactions') {
      return handleDiscordInteraction(request, env, ctx);
    }
    
    // Manueller Check Endpoint
    if (request.method === 'POST' && url.pathname === '/check') {
      ctx.waitUntil(checkAndPostFreeGames(env));
      return new Response('Check initiated', { status: 200 });
    }
    
    // Status Endpoint
    if (request.method === 'GET' && url.pathname === '/status') {
      const guilds = await getAllGuildConfigs(env);
      return new Response(JSON.stringify({
        status: 'running',
        guilds: guilds.length,
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Multi-Store Free Games Bot 🎮', { status: 200 });
  }
};

/**
 * Verarbeitet Discord Interactions (Slash Commands)
 */
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
  
  return new Response('Unknown interaction type', { status: 400 });
}

/**
 * Verarbeitet Slash Commands
 */
async function handleCommand(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { name, options } = interaction.data;
  const guildId = interaction.guild_id;
  const config = await getGuildConfig(env, guildId);
  
  let responseContent = '';
  
  switch (name) {
    case 'setup':
      const channelId = options?.[0]?.value || interaction.channel_id;
      await saveGuildConfig(env, {
        guildId,
        channelId,
        enabled: true,
        language: 'en',
        enabledStores: ['epic', 'steam', 'gog', 'ubisoft'],
        storeChannels: {} as Record<Store, string>,
        mentionRoles: [],
        notifyOnlyMajorGames: false
      });
      responseContent = `${t(config, 'setup_success')} <#${channelId}>`;
      break;
      
    case 'disable':
      await disableGuild(env, guildId);
      responseContent = t(config, 'disabled');
      break;
      
    case 'status':
      if (config && config.enabled) {
        const stores = config.enabledStores.map(s => storeInfo[s].name).join(', ');
        responseContent = `${t(config, 'status_active')} <#${config.channelId}>\n📦 **Stores:** ${stores}\n🌐 **Language:** ${config.language.toUpperCase()}`;
        
        if (config.mentionRoles.length > 0) {
          responseContent += `\n👥 **Roles:** ${config.mentionRoles.map(r => `<@&${r}>`).join(', ')}`;
        }
      } else {
        responseContent = t(config, 'status_inactive');
      }
      break;
      
    case 'stores':
      const selectedStores = options?.map((opt: any) => opt.value) || [];
      if (config && selectedStores.length > 0) {
        config.enabledStores = selectedStores;
        await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
        const storeNames = selectedStores.map((s: Store) => storeInfo[s].name).join(', ');
        responseContent = `${t(config, 'stores_updated')} ${storeNames}`;
      }
      break;
      
    case 'language':
      const lang = options?.[0]?.value || 'en';
      if (config) {
        config.language = lang;
        await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
        responseContent = t(config, 'language_updated');
      }
      break;
      
    case 'role':
      const action = options?.[0]?.name;
      const roleId = options?.[0]?.options?.[0]?.value;
      
      if (config && roleId) {
        if (action === 'add') {
          if (!config.mentionRoles.includes(roleId)) {
            config.mentionRoles.push(roleId);
            await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
          }
          responseContent = `${t(config, 'role_added')} <@&${roleId}>`;
        } else if (action === 'remove') {
          config.mentionRoles = config.mentionRoles.filter(r => r !== roleId);
          await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
          responseContent = `${t(config, 'role_removed')} <@&${roleId}>`;
        }
      }
      break;
      
    case 'thread':
      const threadId = options?.[0]?.value;
      if (config && threadId) {
        config.threadId = threadId;
        await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
        responseContent = t(config, 'thread_set');
      }
      break;
      
    case 'store-channel':
      const store = options?.[0]?.value as Store;
      const storeChannelId = options?.[1]?.value;
      
      if (config && store && storeChannelId) {
        config.storeChannels[store] = storeChannelId;
        await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
        responseContent = `${t(config, 'channel_set')} ${storeInfo[store].name}: <#${storeChannelId}>`;
      }
      break;
      
    case 'check':
      responseContent = t(config, 'checking');
      ctx.waitUntil(checkAndPostFreeGames(env).catch(console.error));
      break;
      
    default:
      responseContent = t(config, 'unknown_command');
  }
  
  return new Response(JSON.stringify({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: responseContent,
      flags: 64
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Hauptfunktion: Prüft alle Stores auf kostenlose Spiele
 */
async function checkAndPostFreeGames(env: Env): Promise<void> {
  console.log(`🔍 Checking for free games... (${new Date().toISOString()})`);
  
  try {
    const postedGames = await loadPostedGames(env);
    const guilds = await getAllGuildConfigs(env);
    
    // Hole Spiele von allen Stores parallel
    const [epicGames, steamGames, gogGames, ubisoftGames] = await Promise.all([
      getEpicGames(),
      getSteamGames(),
      getGOGGames(),
      getUbisoftGames()
    ]);
    
    const allGames = [
      ...(epicGames || []),
      ...(steamGames || []),
      ...(gogGames || []),
      ...(ubisoftGames || [])
    ];
    
    console.log(`📋 Found ${allGames.length} free games across all stores`);
    
    let newGamesCount = 0;
    
    for (const game of allGames) {
      const gameKey = `${game.store}:${game.id}`;
      
      if (!postedGames.includes(gameKey)) {
        console.log(`🆕 New free game: ${game.title} (${game.store})`);
        
        // Poste in relevante Guilds
        for (const guild of guilds.filter(g => g.enabled && g.enabledStores.includes(game.store))) {
          const embed = createEmbed(game, guild);
          const targetChannel = guild.storeChannels[game.store] || guild.channelId;
          const threadId = guild.threadId;
          const mentionRoles = guild.mentionRoles.map(r => `<@&${r}>`).join(' ');
          
          await sendToChannel(env, targetChannel, embed, threadId, mentionRoles);
        }
        
        postedGames.push(gameKey);
        newGamesCount++;
      }
    }
    
    if (newGamesCount > 0) {
      await savePostedGames(env, postedGames);
      console.log(`💾 ${newGamesCount} new games saved`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Sendet Embed in einen Discord Channel oder Thread
 */
async function sendToChannel(env: Env, channelId: string, embed: any, threadId?: string, mention?: string): Promise<boolean> {
  try {
    const targetId = threadId || channelId;
    const content = mention || undefined;
    
    const response = await fetch(`https://discord.com/api/v10/channels/${targetId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        content,
        embeds: [embed],
        allowed_mentions: { parse: ['roles'] }
      })
    });
    
    if (!response.ok) {
      console.error(`Error sending to channel ${targetId}:`, await response.text());
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Send error:', error);
    return false;
  }
}

/**
 * Epic Games Store
 */
async function getEpicGames(): Promise<Game[] | null> {
  const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en&country=US&allowCountries=US,DE';
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const games: Game[] = [];
    
    if (!data?.data?.Catalog?.searchStore?.elements) return games;
    
    for (const game of data.data.Catalog.searchStore.elements) {
      const isFree = game.price?.totalPrice?.discountPrice === 0;
      const hasPromotion = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      
      if (isFree && hasPromotion) {
        const offer = game.promotions.promotionalOffers[0].promotionalOffers[0];
        const originalPrice = game.price?.totalPrice?.originalPrice;
        
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
        
        games.push({
          id: game.id,
          title: game.title,
          description: game.description || 'No description available',
          startDate: offer.startDate,
          endDate: offer.endDate,
          url: `https://store.epicgames.com/en-US/p/${slug}`,
          image: imageUrl,
          store: 'epic',
          originalPrice: originalPrice ? `$${(originalPrice / 100).toFixed(2)}` : undefined,
          currentPrice: 'FREE'
        });
      }
    }
    
    return games;
  } catch (error) {
    console.error('Epic Games error:', error);
    return null;
  }
}

/**
 * Steam Store (via SteamDB API oder eigenes Scraping)
 */
async function getSteamGames(): Promise<Game[] | null> {
  try {
    // Hinweis: SteamDB hat keine offizielle API. Alternative: Steam Web API + Curated List
    // Hier ein vereinfachtes Beispiel - in Produktion würde man eine dedizierte Quelle nutzen
    const response = await fetch('https://steamdb.info/upcoming/free/', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    
    // Parsing würde hier erfolgen - als Platzhalter:
    const games: Game[] = [];
    
    // TODO: Implementiere Steam Web API Integration oder SteamDB Scraping
    
    return games;
  } catch (error) {
    console.error('Steam error:', error);
    return null;
  }
}

/**
 * GOG Store
 */
async function getGOGGames(): Promise<Game[] | null> {
  try {
    const response = await fetch('https://www.gog.com/games/ajax/filtered?mediaType=game&price=free', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const games: Game[] = [];
    
    // Parse GOG free games
    if (data.products) {
      for (const product of data.products) {
        if (product.price.isFree) {
          games.push({
            id: product.id.toString(),
            title: product.title,
            description: product.description || 'No description available',
            startDate: new Date().toISOString(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            url: `https://www.gog.com${product.url}`,
            image: product.image || null,
            store: 'gog',
            originalPrice: product.price.baseAmount || undefined,
            currentPrice: 'FREE',
            rating: product.rating || undefined
          });
        }
      }
    }
    
    return games;
  } catch (error) {
    console.error('GOG error:', error);
    return null;
  }
}

/**
 * Ubisoft Connect
 */
async function getUbisoftGames(): Promise<Game[] | null> {
  try {
    // Ubisoft hat keine öffentliche API - würde Scraping oder Newsletter-Parsing erfordern
    const games: Game[] = [];
    
    // TODO: Implementiere Ubisoft Connect Integration
    
    return games;
  } catch (error) {
    console.error('Ubisoft error:', error);
    return null;
  }
}

/**
 * Erstellt Discord Embed mit allen Details
 */
function createEmbed(game: Game, config: GuildConfig): any {
  const store = storeInfo[game.store];
  const endTimestamp = Math.floor(new Date(game.endDate).getTime() / 1000);
  
  const embed: any = {
    title: `${store.icon} ${game.title} - ${t(config, 'free').toUpperCase()}!`,
    description: game.description.substring(0, 400) + (game.description.length > 400 ? '...' : ''),
    color: store.color,
    url: game.url,
    fields: [],
    footer: { 
      text: `${store.name} • ${t(config, 'footer')}`,
      icon_url: getStoreIconUrl(game.store)
    },
    timestamp: new Date().toISOString()
  };
  
  if (game.image) {
    embed.image = { url: game.image };
  }
  
  // Verfügbar bis (als Discord Timestamp)
  embed.fields.push({
    name: t(config, 'available_until'),
    value: `<t:${endTimestamp}:F> (<t:${endTimestamp}:R>)`,
    inline: false
  });
  
  // Originalpreis
  if (game.originalPrice) {
    embed.fields.push({
      name: t(config, 'original_price'),
      value: `~~${game.originalPrice}~~ → **FREE**`,
      inline: true
    });
  }
  
  // Bewertung
  if (game.rating) {
    const stars = '⭐'.repeat(Math.round(game.rating / 20));
    embed.fields.push({
      name: t(config, 'rating'),
      value: `${stars} ${game.rating}%${game.reviewCount ? ` (${game.reviewCount.toLocaleString()})` : ''}`,
      inline: true
    });
  }
  
  // Tags
  if (game.tags && game.tags.length > 0) {
    embed.fields.push({
      name: '🏷️ Tags',
      value: game.tags.slice(0, 5).join(', '),
      inline: false
    });
  }
  
  // Links
  const launcherUrl = game.url.replace('/web/', '/app/');
  embed.fields.push({
    name: t(config, 'get_now'),
    value: `[${t(config, 'store_page')}](${game.url})${launcherUrl !== game.url ? ` • [${t(config, 'launcher')}](${launcherUrl})` : ''}`,
    inline: false
  });
  
  return embed;
}

function getStoreIconUrl(store: Store): string {
  const icons: Record<Store, string> = {
    epic: 'https://cdn2.unrealengine.com/Epic+Games+Node%2Fxlarge_whitetext_blackback_epiclogo_504x512_1529964470588-503x512-ac795e81c54b27aaa2e196456dd307bfe4ca3ca4.jpg',
    steam: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/avatars/1b/1b21ae81ba6e44e5c564c7044b95f4c3f3e81a18_full.jpg',
    gog: 'https://images.gog-statics.com/5c09a2b0f55e4f4eea260ec77a5bb48f8f5dbe2e8f77e3a6f2e09e9b61e0eadb_256.png',
    ubisoft: 'https://staticctf.akamaized.net/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/5Y6vBNTBiWm1TJfxZvW9O4/e7c66e9f0c3e0d3c4c0c0a3e3d0e3c0e/ubi_logo.png'
  };
  return icons[store];
}

// KV Storage Funktionen
async function saveGuildConfig(env: Env, config: GuildConfig): Promise<void> {
  await env.GUILD_CONFIGS.put(config.guildId, JSON.stringify(config));
}

async function getGuildConfig(env: Env, guildId: string): Promise<GuildConfig | null> {
  const data = await env.GUILD_CONFIGS.get(guildId, 'json');
  return data as GuildConfig | null;
}

async function disableGuild(env: Env, guildId: string): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.enabled = false;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function getAllGuildConfigs(env: Env): Promise<GuildConfig[]> {
  const list = await env.GUILD_CONFIGS.list();
  const configs: GuildConfig[] = [];
  
  for (const key of list.keys) {
    const config = await env.GUILD_CONFIGS.get(key.name, 'json');
    if (config) {
      configs.push(config as GuildConfig);
    }
  }
  
  return configs;
}

async function loadPostedGames(env: Env): Promise<string[]> {
  try {
    const data = await env.POSTED_GAMES.get('games', 'json');
    return (data as string[]) || [];
  } catch (error) {
    console.error('Load error:', error);
    return [];
  }
}

async function savePostedGames(env: Env, games: string[]): Promise<void> {
  try {
    // Behalte nur die letzten 500 Spiele
    const gamesToStore = games.slice(-500);
    await env.POSTED_GAMES.put('games', JSON.stringify(gamesToStore));
  } catch (error) {
    console.error('Save error:', error);
  }
}