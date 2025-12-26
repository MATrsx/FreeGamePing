/**
 * Epic Games Free Games Bot für Cloudflare Workers (TypeScript)
 */

interface Env {
  POSTED_GAMES: KVNamespace;
  DISCORD_WEBHOOK_URL: string;
  DISCORD_PUBLIC_KEY: string;
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

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  url: string;
  fields: Array<{
    name: string;
    value: string;
    inline: boolean;
  }>;
  footer: {
    text: string;
  };
  timestamp: string;
  image?: {
    url: string;
  };
}

import { verifyKey } from 'discord-interactions';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    const body = await request.text();

    const isValid = verifyKey(
      body,
      signature,
      timestamp,
      env.DISCORD_PUBLIC_KEY
    );

    if (!isValid) {
      return new Response("invalid request signature", { status: 401 });
    }

    const json = JSON.parse(body);

    // PING → PONG
    if (json.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    await checkAndPostFreeGames(env);

    return new Response("ok");
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAndPostFreeGames(env));
  },
};

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
    
    let newGamesCount = 0;
    
    for (const game of freeGames) {
      if (!postedGames.includes(game.id)) {
        console.log(`🆕 Neues kostenloses Spiel: ${game.title}`);
        
        const embed = createEmbed(game);
        const success = await sendToDiscord(env.DISCORD_WEBHOOK_URL, embed);
        
        if (success) {
          console.log(`✅ Erfolgreich gepostet: ${game.title}`);
          postedGames.push(game.id);
          newGamesCount++;
        } else {
          console.log(`❌ Fehler beim Posten: ${game.title}`);
        }
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
 * Holt kostenlose Spiele von Epic Games API
 */
async function getFreeGames(): Promise<Game[] | null> {
  const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=de&country=DE&allowCountries=DE';
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
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
      
      freeGames.push({
        id: game.id,
        title: game.title,
        description: game.description || 'Keine Beschreibung verfügbar',
        startDate: offer.startDate,
        endDate: offer.endDate,
        url: `https://store.epicgames.com/de/p/${game.productSlug || game.urlSlug || ''}`,
        image: imageUrl
      });
    }
  }
  
  return freeGames;
}

/**
 * Erstellt Discord Embed
 */
function createEmbed(game: Game): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: `🎮 ${game.title} - KOSTENLOS!`,
    description: game.description.substring(0, 500) + (game.description.length > 500 ? '...' : ''),
    color: 3447003,
    url: game.url,
    fields: [],
    footer: {
      text: 'Epic Games Store • Kostenlos erhältlich'
    },
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

/**
 * Sendet Embed an Discord via Webhook
 */
async function sendToDiscord(webhookUrl: string, embed: DiscordEmbed): Promise<boolean> {
  if (!webhookUrl) {
    console.error('❌ DISCORD_WEBHOOK_URL nicht gesetzt!');
    return false;
  }
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ embeds: [embed] })
    });
    
    return response.status === 204 || response.ok;
    
  } catch (error) {
    console.error('Fehler beim Senden an Discord:', error);
    return false;
  }
}

/**
 * Lädt gepostete Spiele aus KV Storage
 */
async function loadPostedGames(env: Env): Promise<string[]> {
  try {
    const data = await env.POSTED_GAMES.get('games', 'json');
    return (data as string[]) || [];
  } catch (error) {
    console.error('Fehler beim Laden:', error);
    return [];
  }
}

/**
 * Speichert gepostete Spiele in KV Storage
 */
async function savePostedGames(env: Env, games: string[]): Promise<void> {
  try {
    const gamesToStore = games.slice(-100);
    await env.POSTED_GAMES.put('games', JSON.stringify(gamesToStore));
  } catch (error) {
    console.error('Fehler beim Speichern:', error);
  }
}