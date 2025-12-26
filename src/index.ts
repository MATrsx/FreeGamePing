/**
 * Epic Games Free Games Bot für Cloudflare Workers (TypeScript)
 * Mit Discord Bot Integration und Slash Commands
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
  enabled: boolean;
}

interface Game {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  url: string;
  image: string | null;
}

// Discord Interaction Types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
};

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAndPostFreeGames(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Discord Interactions Endpoint
    if (request.method === 'POST' && new URL(request.url).pathname === '/interactions') {
      return handleDiscordInteraction(request, env, ctx);
    }
    
    // Manueller Check Endpoint
    if (request.method === 'POST' && new URL(request.url).pathname === '/check') {
      await checkAndPostFreeGames(env);
      return new Response('Check durchgeführt', { status: 200 });
    }
    
    return new Response('Epic Games Bot läuft! 🎮', { status: 200 });
  }
};

/**
 * Verarbeitet Discord Interactions (Slash Commands)
 */
async function handleDiscordInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  const body = await request.text();
  
  // Verify Discord signature
  if (!signature || !timestamp) {
    return new Response('Invalid request signature', { status: 401 });
  }
  
  const isValid = verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
  if (!isValid) {
    return new Response('Invalid request signature', { status: 401 });
  }
  
  const interaction = JSON.parse(body);
  
  // Respond to Discord PING
  if (interaction.type === InteractionType.PING) {
    return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Handle Slash Commands
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
  
  let responseContent = '';
  
  switch (name) {
    case 'setup':
      const channelId = options?.[0]?.value || interaction.channel_id;
      await saveGuildConfig(env, guildId, channelId);
      responseContent = `✅ Bot eingerichtet! Kostenlose Spiele werden in <#${channelId}> gepostet.`;
      break;
      
    case 'disable':
      await disableGuild(env, guildId);
      responseContent = '❌ Bot deaktiviert. Nutze `/setup` um ihn wieder zu aktivieren.';
      break;
      
    case 'status':
      const config = await getGuildConfig(env, guildId);
      if (config && config.enabled) {
        responseContent = `✅ Bot ist aktiv und postet in <#${config.channelId}>`;
      } else {
        responseContent = '❌ Bot ist nicht konfiguriert. Nutze `/setup` um ihn einzurichten.';
      }
      break;
      
    case 'check':
      // Nur für Testing - prüft sofort auf neue Spiele
      responseContent = '🔍 Prüfe auf neue Spiele... (kann bis zu 30 Sekunden dauern)';
      // Führe Check im Hintergrund aus
      ctx.waitUntil(checkAndPostFreeGames(env).catch(console.error));
      break;
      
    default:
      responseContent = '❌ Unbekannter Befehl';
  }
  
  return new Response(JSON.stringify({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: responseContent,
      flags: 64 // Ephemeral (nur für den User sichtbar)
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Hauptfunktion: Prüft auf kostenlose Spiele und postet neue
 */
async function checkAndPostFreeGames(env: Env): Promise<void> {
  console.log(`🔍 Prüfe auf neue kostenlose Spiele... (${new Date().toISOString()})`);
  
  try {
    const postedGames = await loadPostedGames(env);
    const freeGames = await getFreeGames();
    
    if (!freeGames || freeGames.length === 0) {
      console.log('ℹ️ Keine kostenlosen Spiele gefunden');
      return;
    }
    
    console.log(`📋 ${freeGames.length} kostenlose Spiele gefunden`);
    
    // Hole alle konfigurierten Guilds
    const guilds = await getAllGuildConfigs(env);
    console.log(`📊 ${guilds.length} Server konfiguriert`);
    
    let newGamesCount = 0;
    
    for (const game of freeGames) {
      if (!postedGames.includes(game.id)) {
        console.log(`🆕 Neues kostenloses Spiel: ${game.title}`);
        
        const embed = createEmbed(game);
        
        // Poste in alle konfigurierten Channels
        await Promise.all(
          guilds
            .filter(g => g.enabled)
            .map(g => sendToChannel(env, g.channelId, embed))
        );

        
        postedGames.push(game.id);
        newGamesCount++;
      }
    }
    
    if (newGamesCount > 0) {
      await savePostedGames(env, postedGames);
      console.log(`💾 ${newGamesCount} neue Spiele gespeichert`);
    } else {
      console.log('ℹ️ Keine neuen Spiele zum Posten');
    }
    
  } catch (error) {
    console.error('❌ Fehler:', error);
  }
}

/**
 * Sendet Embed in einen Discord Channel
 */
async function sendToChannel(env: Env, channelId: string, embed: any): Promise<boolean> {
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ embeds: [embed] })
    });
    
    if (!response.ok) {
      console.error(`Fehler beim Senden in Channel ${channelId}:`, await response.text());
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Fehler beim Senden:', error);
    return false;
  }
}

/**
 * Holt kostenlose Spiele von Epic Games API
 */
async function getFreeGames(): Promise<Game[] | null> {
  const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=de&country=DE&allowCountries=DE';
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    return parseFreeGames(data);
    
  } catch (error) {
    console.error('Fehler beim Abrufen der Spiele:', error);
    return null;
  }
}

/**
 * Extrahiert kostenlose Spiele aus API-Antwort
 */
function parseFreeGames(data: any): Game[] {
  const freeGames: Game[] = [];
  
  if (!data?.data?.Catalog?.searchStore?.elements) {
    return freeGames;
  }
  
  const games = data.data.Catalog.searchStore.elements;
  
  for (const game of games) {
    const isFree = game.price?.totalPrice?.discountPrice === 0;
    const hasPromotion = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
    
    if (isFree && hasPromotion) {
      const offer = game.promotions.promotionalOffers[0].promotionalOffers[0];
      
      let imageUrl: string | null = null;
      const images = game.keyImages || [];
      for (const img of images) {
        if (img.type === 'DieselStoreFrontWide' || img.type === 'OfferImageWide') {
          imageUrl = img.url;
          break;
        }
      }
      
      const slug = game.productSlug || game.urlSlug;
      if (!slug) continue; // Spiel überspringen
      freeGames.push({
        id: game.id,
        title: game.title,
        description: game.description || 'Keine Beschreibung verfügbar',
        startDate: offer.startDate,
        endDate: offer.endDate,
        url: `https://store.epicgames.com/de/p/${slug}`,
        image: imageUrl
      });
    }
  }
  
  return freeGames;
}

/**
 * Erstellt Discord Embed
 */
function createEmbed(game: Game): any {
  const embed: any = {
    title: `🎮 ${game.title} - KOSTENLOS!`,
    description: game.description.substring(0, 500) + (game.description.length > 500 ? '...' : ''),
    color: 3447003,
    url: game.url,
    fields: [],
    footer: { text: 'Epic Games Store • Kostenlos erhältlich' },
    timestamp: new Date().toISOString()
  };
  
  if (game.image) {
    embed.image = { url: game.image };
  }
  
  if (game.endDate) {
    try {
      const endDate = new Date(game.endDate);
      embed.fields.push({
        name: '⏰ Verfügbar bis',
        value: endDate.toLocaleString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Berlin'
        }) + ' Uhr',
        inline: false
      });
    } catch (e) {
      console.error('Fehler beim Formatieren des Datums:', e);
    }
  }
  
  embed.fields.push({
    name: '🔗 Jetzt holen',
    value: `[Epic Games Store](${game.url})`,
    inline: false
  });
  
  return embed;
}

// KV Storage Funktionen für Guild Configs
async function saveGuildConfig(env: Env, guildId: string, channelId: string): Promise<void> {
  const config: GuildConfig = { guildId, channelId, enabled: true };
  await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
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

// KV Storage Funktionen für Posted Games
async function loadPostedGames(env: Env): Promise<string[]> {
  try {
    const data = await env.POSTED_GAMES.get('games', 'json');
    return (data as string[]) || [];
  } catch (error) {
    console.error('Fehler beim Laden:', error);
    return [];
  }
}

async function savePostedGames(env: Env, games: string[]): Promise<void> {
  try {
    const gamesToStore = games.slice(-100);
    await env.POSTED_GAMES.put('games', JSON.stringify(gamesToStore));
  } catch (error) {
    console.error('Fehler beim Speichern:', error);
  }
}