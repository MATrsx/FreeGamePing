/**
 * Multi-Store Free Games Bot für Cloudflare Workers (TypeScript)
 * Unterstützt: Epic Games, Steam, GOG, Ubisoft Connect
 * Mit erweiterten Discord Features und Multi-Language Support
 */

import { verifyKey } from 'discord-interactions';

interface Env {
  POSTED_GAMES: KVNamespace;
  GUILD_CONFIGS: KVNamespace;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

type StoreType = 'epic' | 'steam' | 'gog' | 'ubisoft';
type Language = 'en' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'ru' | 'pl';

interface GuildConfig {
  guildId: string;
  channelId: string;
  threadId?: string;
  enabled: boolean;
  language: Language;
  stores: StoreType[];
  mentionRoles: string[];
  separateThreads: boolean;
  storeThreads?: {
    [key in StoreType]?: string;
  };
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
  rating?: {
    score: number;
    count: number;
  };
}

// Discord Interaction Types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
};

// Translations
const translations: Record<Language, any> = {
  en: {
    setup_success: '✅ Bot configured! Free games will be posted in',
    setup_thread_success: '✅ Bot configured! Free games will be posted in the thread',
    disabled: '❌ Bot disabled. Use `/setup` to enable it again.',
    status_active: '✅ Bot is active and posting in',
    status_inactive: '❌ Bot is not configured. Use `/setup` to set it up.',
    status_stores: '📦 Active stores',
    status_language: '🌍 Language',
    status_roles: '👥 Mention roles',
    check_running: '🔍 Checking for new games... (may take up to 30 seconds)',
    unknown_command: '❌ Unknown command',
    free_title: 'FREE!',
    available_until: '⏰ Available until',
    get_now: '🔗 Get now',
    original_price: '💰 Original price',
    rating: '⭐ Rating',
    store_footer: 'Free to keep',
    language_changed: '✅ Language changed to',
    stores_updated: '✅ Store configuration updated',
    role_added: '✅ Role added to mentions',
    role_removed: '✅ Role removed from mentions',
    separate_threads_enabled: '✅ Separate threads enabled. Configure threads with `/thread`',
    separate_threads_disabled: '✅ Separate threads disabled',
    thread_configured: '✅ Thread configured for',
    no_games: 'ℹ️ No free games found',
  },
  de: {
    setup_success: '✅ Bot eingerichtet! Kostenlose Spiele werden gepostet in',
    setup_thread_success: '✅ Bot eingerichtet! Kostenlose Spiele werden im Thread gepostet',
    disabled: '❌ Bot deaktiviert. Nutze `/setup` um ihn wieder zu aktivieren.',
    status_active: '✅ Bot ist aktiv und postet in',
    status_inactive: '❌ Bot ist nicht konfiguriert. Nutze `/setup` um ihn einzurichten.',
    status_stores: '📦 Aktive Stores',
    status_language: '🌍 Sprache',
    status_roles: '👥 Erwähnte Rollen',
    check_running: '🔍 Prüfe auf neue Spiele... (kann bis zu 30 Sekunden dauern)',
    unknown_command: '❌ Unbekannter Befehl',
    free_title: 'KOSTENLOS!',
    available_until: '⏰ Verfügbar bis',
    get_now: '🔗 Jetzt holen',
    original_price: '💰 Originalpreis',
    rating: '⭐ Bewertung',
    store_footer: 'Kostenlos erhältlich',
    language_changed: '✅ Sprache geändert zu',
    stores_updated: '✅ Store-Konfiguration aktualisiert',
    role_added: '✅ Rolle zu Erwähnungen hinzugefügt',
    role_removed: '✅ Rolle von Erwähnungen entfernt',
    separate_threads_enabled: '✅ Separate Threads aktiviert. Konfiguriere Threads mit `/thread`',
    separate_threads_disabled: '✅ Separate Threads deaktiviert',
    thread_configured: '✅ Thread konfiguriert für',
    no_games: 'ℹ️ Keine kostenlosen Spiele gefunden',
  },
  fr: {
    setup_success: '✅ Bot configuré! Les jeux gratuits seront postés dans',
    setup_thread_success: '✅ Bot configuré! Les jeux gratuits seront postés dans le fil',
    disabled: '❌ Bot désactivé. Utilisez `/setup` pour le réactiver.',
    status_active: '✅ Le bot est actif et poste dans',
    status_inactive: '❌ Le bot n\'est pas configuré. Utilisez `/setup` pour le configurer.',
    status_stores: '📦 Magasins actifs',
    status_language: '🌍 Langue',
    status_roles: '👥 Rôles mentionnés',
    check_running: '🔍 Vérification des nouveaux jeux... (peut prendre jusqu\'à 30 secondes)',
    unknown_command: '❌ Commande inconnue',
    free_title: 'GRATUIT!',
    available_until: '⏰ Disponible jusqu\'au',
    get_now: '🔗 Obtenir maintenant',
    original_price: '💰 Prix d\'origine',
    rating: '⭐ Note',
    store_footer: 'Gratuit à conserver',
    language_changed: '✅ Langue changée en',
    stores_updated: '✅ Configuration des magasins mise à jour',
    role_added: '✅ Rôle ajouté aux mentions',
    role_removed: '✅ Rôle retiré des mentions',
    separate_threads_enabled: '✅ Fils séparés activés. Configurez les fils avec `/thread`',
    separate_threads_disabled: '✅ Fils séparés désactivés',
    thread_configured: '✅ Fil configuré pour',
    no_games: 'ℹ️ Aucun jeu gratuit trouvé',
  },
  es: {
    setup_success: '✅ Bot configurado! Los juegos gratis se publicarán en',
    setup_thread_success: '✅ Bot configurado! Los juegos gratis se publicarán en el hilo',
    disabled: '❌ Bot desactivado. Usa `/setup` para activarlo de nuevo.',
    status_active: '✅ El bot está activo y publicando en',
    status_inactive: '❌ El bot no está configurado. Usa `/setup` para configurarlo.',
    status_stores: '📦 Tiendas activas',
    status_language: '🌍 Idioma',
    status_roles: '👥 Roles mencionados',
    check_running: '🔍 Buscando nuevos juegos... (puede tardar hasta 30 segundos)',
    unknown_command: '❌ Comando desconocido',
    free_title: '¡GRATIS!',
    available_until: '⏰ Disponible hasta',
    get_now: '🔗 Obtener ahora',
    original_price: '💰 Precio original',
    rating: '⭐ Valoración',
    store_footer: 'Gratis para siempre',
    language_changed: '✅ Idioma cambiado a',
    stores_updated: '✅ Configuración de tiendas actualizada',
    role_added: '✅ Rol añadido a las menciones',
    role_removed: '✅ Rol eliminado de las menciones',
    separate_threads_enabled: '✅ Hilos separados activados. Configura hilos con `/thread`',
    separate_threads_disabled: '✅ Hilos separados desactivados',
    thread_configured: '✅ Hilo configurado para',
    no_games: 'ℹ️ No se encontraron juegos gratis',
  },
  it: {
    setup_success: '✅ Bot configurato! I giochi gratis saranno pubblicati in',
    setup_thread_success: '✅ Bot configurato! I giochi gratis saranno pubblicati nel thread',
    disabled: '❌ Bot disabilitato. Usa `/setup` per riattivarlo.',
    status_active: '✅ Il bot è attivo e pubblica in',
    status_inactive: '❌ Il bot non è configurato. Usa `/setup` per configurarlo.',
    status_stores: '📦 Store attivi',
    status_language: '🌍 Lingua',
    status_roles: '👥 Ruoli menzionati',
    check_running: '🔍 Controllo nuovi giochi... (può richiedere fino a 30 secondi)',
    unknown_command: '❌ Comando sconosciuto',
    free_title: 'GRATIS!',
    available_until: '⏰ Disponibile fino a',
    get_now: '🔗 Ottieni ora',
    original_price: '💰 Prezzo originale',
    rating: '⭐ Valutazione',
    store_footer: 'Gratis per sempre',
    language_changed: '✅ Lingua cambiata in',
    stores_updated: '✅ Configurazione store aggiornata',
    role_added: '✅ Ruolo aggiunto alle menzioni',
    role_removed: '✅ Ruolo rimosso dalle menzioni',
    separate_threads_enabled: '✅ Thread separati abilitati. Configura i thread con `/thread`',
    separate_threads_disabled: '✅ Thread separati disabilitati',
    thread_configured: '✅ Thread configurato per',
    no_games: 'ℹ️ Nessun gioco gratuito trovato',
  },
  pt: {
    setup_success: '✅ Bot configurado! Jogos grátis serão postados em',
    setup_thread_success: '✅ Bot configurado! Jogos grátis serão postados no tópico',
    disabled: '❌ Bot desativado. Use `/setup` para reativá-lo.',
    status_active: '✅ O bot está ativo e postando em',
    status_inactive: '❌ O bot não está configurado. Use `/setup` para configurá-lo.',
    status_stores: '📦 Lojas ativas',
    status_language: '🌍 Idioma',
    status_roles: '👥 Cargos mencionados',
    check_running: '🔍 Verificando novos jogos... (pode levar até 30 segundos)',
    unknown_command: '❌ Comando desconhecido',
    free_title: 'GRÁTIS!',
    available_until: '⏰ Disponível até',
    get_now: '🔗 Obter agora',
    original_price: '💰 Preço original',
    rating: '⭐ Avaliação',
    store_footer: 'Grátis para sempre',
    language_changed: '✅ Idioma alterado para',
    stores_updated: '✅ Configuração de lojas atualizada',
    role_added: '✅ Cargo adicionado às menções',
    role_removed: '✅ Cargo removido das menções',
    separate_threads_enabled: '✅ Tópicos separados ativados. Configure tópicos com `/thread`',
    separate_threads_disabled: '✅ Tópicos separados desativados',
    thread_configured: '✅ Tópico configurado para',
    no_games: 'ℹ️ Nenhum jogo grátis encontrado',
  },
  ru: {
    setup_success: '✅ Бот настроен! Бесплатные игры будут публиковаться в',
    setup_thread_success: '✅ Бот настроен! Бесплатные игры будут публиковаться в треде',
    disabled: '❌ Бот отключен. Используйте `/setup` для повторной активации.',
    status_active: '✅ Бот активен и публикует в',
    status_inactive: '❌ Бот не настроен. Используйте `/setup` для настройки.',
    status_stores: '📦 Активные магазины',
    status_language: '🌍 Язык',
    status_roles: '👥 Упоминаемые роли',
    check_running: '🔍 Проверка новых игр... (может занять до 30 секунд)',
    unknown_command: '❌ Неизвестная команда',
    free_title: 'БЕСПЛАТНО!',
    available_until: '⏰ Доступно до',
    get_now: '🔗 Получить сейчас',
    original_price: '💰 Исходная цена',
    rating: '⭐ Рейтинг',
    store_footer: 'Бесплатно навсегда',
    language_changed: '✅ Язык изменен на',
    stores_updated: '✅ Конфигурация магазинов обновлена',
    role_added: '✅ Роль добавлена к упоминаниям',
    role_removed: '✅ Роль удалена из упоминаний',
    separate_threads_enabled: '✅ Отдельные треды включены. Настройте треды с помощью `/thread`',
    separate_threads_disabled: '✅ Отдельные треды отключены',
    thread_configured: '✅ Тред настроен для',
    no_games: 'ℹ️ Бесплатные игры не найдены',
  },
  pl: {
    setup_success: '✅ Bot skonfigurowany! Darmowe gry będą publikowane w',
    setup_thread_success: '✅ Bot skonfigurowany! Darmowe gry będą publikowane w wątku',
    disabled: '❌ Bot wyłączony. Użyj `/setup` aby go włączyć ponownie.',
    status_active: '✅ Bot jest aktywny i publikuje w',
    status_inactive: '❌ Bot nie jest skonfigurowany. Użyj `/setup` aby go skonfigurować.',
    status_stores: '📦 Aktywne sklepy',
    status_language: '🌍 Język',
    status_roles: '👥 Wspominane role',
    check_running: '🔍 Sprawdzanie nowych gier... (może potrwać do 30 sekund)',
    unknown_command: '❌ Nieznana komenda',
    free_title: 'ZA DARMO!',
    available_until: '⏰ Dostępne do',
    get_now: '🔗 Pobierz teraz',
    original_price: '💰 Cena oryginalna',
    rating: '⭐ Ocena',
    store_footer: 'Darmowe na zawsze',
    language_changed: '✅ Język zmieniony na',
    stores_updated: '✅ Konfiguracja sklepów zaktualizowana',
    role_added: '✅ Rola dodana do wzmianek',
    role_removed: '✅ Rola usunięta ze wzmianek',
    separate_threads_enabled: '✅ Osobne wątki włączone. Skonfiguruj wątki za pomocą `/thread`',
    separate_threads_disabled: '✅ Osobne wątki wyłączone',
    thread_configured: '✅ Wątek skonfigurowany dla',
    no_games: 'ℹ️ Nie znaleziono darmowych gier',
  },
};

const storeNames: Record<StoreType, string> = {
  epic: 'Epic Games Store',
  steam: 'Steam',
  gog: 'GOG',
  ubisoft: 'Ubisoft Connect'
};

const storeColors: Record<StoreType, number> = {
  epic: 0x0078F2,
  steam: 0x171A21,
  gog: 0x86328A,
  ubisoft: 0x0080FF
};

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkAndPostFreeGames(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Discord Interactions Endpoint
    if (request.method === 'POST' && url.pathname === '/interactions') {
      return handleDiscordInteraction(request, env, ctx);
    }
    
    // Manual check endpoint
    if (request.method === 'POST' && url.pathname === '/check') {
      await checkAndPostFreeGames(env);
      return new Response('Check completed', { status: 200 });
    }
    
    return new Response('Free Games Bot is running! 🎮', { status: 200 });
  }
};

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

async function handleCommand(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { name, options } = interaction.data;
  const guildId = interaction.guild_id;
  
  // Get current config for language
  const config = await getGuildConfig(env, guildId);
  const lang = config?.language || 'en';
  const t = translations[lang];

  // Commands that require setup
  const requiresSetup = ['status', 'check', 'stores', 'language', 'role', 'separate-threads', 'thread'];
  
  let responseContent = '';
  let deferred = false;
  
  if (requiresSetup.includes(name) && (!config || !config.enabled)) {
    return new Response(JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "❌ Der Bot ist auf diesem Server nicht aktiviert. Nutze zuerst `/setup`.",
        flags: 64
      }
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  switch (name) {
    case 'setup': {
      const channelOption = options?.find((o: any) => o.name === 'channel');
      const threadOption = options?.find((o: any) => o.name === 'thread');
      const channelId = channelOption?.value || interaction.channel_id;
      const threadId = threadOption?.value;
    
      await saveGuildConfig(env, guildId, channelId, threadId);
    
      const embed = {
        title: "🚀 " + t.setup_success,
        description: threadId
          ? `${t.setup_thread_success} <#${threadId}>`
          : `${t.setup_success} <#${channelId}>`,
        color: 0x00ff99,
        fields: [
          {
            name: "📦 " + t.status_stores,
            value: "`epic`",
            inline: true
          },
          {
            name: "🌍 " + t.status_language,
            value: "`" + (config?.language ?? "en") + "`",
            inline: true
          },
          {
            name: "🧵 Threads",
            value: threadId ? `<#${threadId}>` : "—",
            inline: true
          }
        ],
        footer: { text: "Free Games Bot" },
        timestamp: new Date().toISOString()
      };
    
      return new Response(JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [embed], flags: 64 }
      }), { headers: { "Content-Type": "application/json" } });
    }
      
    case 'disable':
      await disableGuild(env, guildId);
      responseContent = t.disabled;
      break;
    
    case 'status': {
      if (!config || !config.enabled) {
        const embed = {
          title: "❌ " + t.status_inactive,
          description: t.status_inactive,
          color: 0xff5555,
          footer: { text: "Free Games Bot" }
        };
    
        return new Response(JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { embeds: [embed], flags: 64 }
        }), { headers: { "Content-Type": "application/json" } });
      }
    
      const channelMention = config.threadId
        ? `<#${config.threadId}>`
        : `<#${config.channelId}>`;
    
      const embed = {
        title: "📊 " + t.status_active,
        description: `${t.status_active} ${channelMention}`,
        color: 0x0099ff,
        fields: [
          {
            name: "🌍 " + t.status_language,
            value: "`" + config.language + "`",
            inline: true
          },
          {
            name: "📦 " + t.status_stores,
            value: config.stores
              .map(s => `${getStoreIcon(s)} ${storeNames[s]}`)
              .join("\n"),
            inline: true
          },
          {
            name: "👥 " + t.status_roles,
            value: config.mentionRoles.length > 0
              ? config.mentionRoles.map(r => `<@&${r}>`).join(", ")
              : "—",
            inline: false
          },
          {
            name: "🧵 Threads",
            value: config.separateThreads
              ? Object.entries(config.storeThreads)
                  .map(([store, thread]) => `${getStoreIcon(store as StoreType)} <#${thread}>`)
                  .join("\n") || "—"
              : "—",
            inline: false
          }
        ],
        footer: { text: "Free Games Bot" },
        timestamp: new Date().toISOString()
      };
    
      return new Response(JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { embeds: [embed], flags: 64 }
      }), { headers: { "Content-Type": "application/json" } });
    }
      
    case 'language':
      const newLang = options?.[0]?.value as Language;
      await updateLanguage(env, guildId, newLang);
      responseContent = `${translations[newLang].language_changed} ${newLang}`;
      break;
      
    case 'stores':
      const stores = options?.[0]?.value?.split(',').map((s: string) => s.trim() as StoreType) || [];
      await updateStores(env, guildId, stores);
      responseContent = `${t.stores_updated}: ${stores.map(s => getStoreIcon(s) + ' ' + storeNames[s]).join(', ')}`;
      break;
      
    case 'role':
      const action = options?.find((o: any) => o.name === 'action')?.value;
      const roleId = options?.find((o: any) => o.name === 'role')?.value;
      
      if (action === 'add') {
        await addMentionRole(env, guildId, roleId);
        responseContent = `${t.role_added}: <@&${roleId}>`;
      } else if (action === 'remove') {
        await removeMentionRole(env, guildId, roleId);
        responseContent = `${t.role_removed}: <@&${roleId}>`;
      }
      break;
      
    case 'separate-threads':
      const enabled = options?.[0]?.value;
      await setSeparateThreads(env, guildId, enabled);
      responseContent = enabled ? t.separate_threads_enabled : t.separate_threads_disabled;
      break;
      
    case 'thread':
      const store = options?.find((o: any) => o.name === 'store')?.value as StoreType;
      const thread = options?.find((o: any) => o.name === 'thread')?.value;
      await setStoreThread(env, guildId, store, thread);
      responseContent = `${t.thread_configured} ${getStoreIcon(store)} ${storeNames[store]}: <#${thread}>`;
      break;
      
    case 'check':
      deferred = true;
    
      ctx.waitUntil(
        (async () => {
          await checkAndPostFreeGames(env);
          await updateInteractionResponse(env, interaction.token, "🔍 Prüfung abgeschlossen! Neue Spiele wurden gepostet, falls verfügbar.");
        })()
      );
    
      responseContent = t.check_running;
      break;
      
    default:
      responseContent = t.unknown_command;
  }
  
  const response: any = {
    type: deferred ? InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE : InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: responseContent,
      flags: 64 // Ephemeral
    }
  };
  
  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function updateInteractionResponse(env: Env, token: string, content: string): Promise<void> {
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content })
    });
  } catch (error) {
    console.error('Error updating interaction:', error);
  }
}

async function checkAndPostFreeGames(env: Env): Promise<void> {
  console.log(`🔍 Checking for free games... (${new Date().toISOString()})`);
  
  try {
    const guilds = await getAllGuildConfigs(env);
    const postedGames = await loadPostedGames(env);
    
    for (const guild of guilds.filter(g => g.enabled)) {
      const t = translations[guild.language];
      let newGamesCount = 0;
      
      for (const store of guild.stores) {
        const games = await getFreeGamesForStore(store);
        
        if (!games || games.length === 0) continue;
        
        for (const game of games) {
          const gameKey = `${store}-${game.id}`;
          
          if (!postedGames.includes(gameKey)) {
            console.log(`🆕 New free game: ${game.title} (${store})`);
            
            const embed = createEmbed(game, t, guild.language);
            const mentions = guild.mentionRoles.map(r => `<@&${r}>`).join(' ');
            
            // Determine target
            let targetId = guild.channelId;
            if (guild.separateThreads && guild.storeThreads?.[store]) {
              targetId = guild.storeThreads[store]!;
            } else if (guild.threadId) {
              targetId = guild.threadId;
            }
            
            await sendToChannel(env, targetId, embed, mentions);
            postedGames.push(gameKey);
            newGamesCount++;
          }
        }
      }
      
      if (newGamesCount > 0) {
        console.log(`📤 Posted ${newGamesCount} new games to guild ${guild.guildId}`);
      } else {
        console.log(`💤 No new games found for guild ${guild.guildId}`);
      }
    }
    
    if (postedGames.length > 0) {
      await savePostedGames(env, postedGames);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function sendToChannel(env: Env, channelId: string, embed: any, mentions?: string): Promise<boolean> {
  try {
    const payload: any = { embeds: [embed] };
    if (mentions) {
      payload.content = mentions;
    }
    
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error(`Error sending to channel ${channelId}:`, await response.text());
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
}

async function getFreeGamesForStore(store: StoreType): Promise<Game[] | null> {
  switch (store) {
    case 'epic':
      return getEpicGames();
    case 'steam':
      return getSteamGames();
    case 'gog':
      return getGOGGames();
    case 'ubisoft':
      return getUbisoftGames();
    default:
      return null;
  }
}

async function getEpicGames(): Promise<Game[] | null> {
  const url = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en&country=US&allowCountries=US';
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    return parseEpicGames(data);
  } catch (error) {
    console.error('Error fetching Epic games:', error);
    return null;
  }
}

function parseEpicGames(data: any): Game[] {
  const freeGames: Game[] = [];
  
  if (!data?.data?.Catalog?.searchStore?.elements) return freeGames;
  
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
      if (!slug) continue;
      
      const originalPrice = game.price?.totalPrice?.originalPrice || 0;
      
      freeGames.push({
        id: game.id,
        store: 'epic',
        title: game.title,
        description: game.description || 'No description available',
        startDate: offer.startDate,
        endDate: offer.endDate,
        url: `https://store.epicgames.com/en-US/p/${slug}`,
        image: imageUrl,
        price: {
          original: originalPrice / 100,
          discount: 100,
          currency: 'USD'
        }
      });
    }
  }
  
  return freeGames;
}

async function getSteamGames(): Promise<Game[] | null> {
  // Using SteamDB's free promotions API (unofficial)
  try {
    const response = await fetch('https://steamdb.info/api/GetFreebies/', {
      headers: { 
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      // Fallback: Check Steam's own API for common free games
      return getSteamFallback();
    }
    
    const data = await response.json();
    return parseSteamGames(data);
  } catch (error) {
    console.error('Error fetching Steam games:', error);
    return getSteamFallback();
  }
}

async function getSteamFallback(): Promise<Game[] | null> {
  // Fallback method: Check specific app IDs that are known to have promotions
  // This would need to be expanded with a proper Steam API implementation
  const freeGames: Game[] = [];
  
  try {
    // Check Steam's featured items
    const response = await fetch('https://store.steampowered.com/api/featured/');
    if (!response.ok) return null;
    
    const data = await response.json();
    
    // Look for free games in featured categories
    if (data.specials?.items) {
      for (const item of data.specials.items) {
        if (item.discount_percent === 100) {
          const details = await getSteamAppDetails(item.id);
          if (details) {
            freeGames.push(details);
          }
        }
      }
    }
  } catch (error) {
    console.error('Steam fallback error:', error);
  }
  
  return freeGames.length > 0 ? freeGames : null;
}

async function getSteamAppDetails(appId: number): Promise<Game | null> {
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const gameData = data[appId]?.data;
    
    if (!gameData) return null;
    
    // Only return if it's truly free to keep (not F2P)
    if (gameData.is_free && gameData.type === 'game') {
      return {
        id: appId.toString(),
        store: 'steam',
        title: gameData.name,
        description: gameData.short_description || 'No description available',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Default 7 days
        url: `https://store.steampowered.com/app/${appId}`,
        image: gameData.header_image,
        price: {
          original: gameData.price_overview?.initial || 0,
          discount: 100,
          currency: gameData.price_overview?.currency || 'USD'
        },
        rating: gameData.metacritic?.score ? {
          score: gameData.metacritic.score,
          count: 0
        } : undefined
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching Steam app ${appId}:`, error);
    return null;
  }
}

function parseSteamGames(data: any): Game[] {
  const freeGames: Game[] = [];
  
  if (!data?.data) return freeGames;
  
  for (const item of data.data) {
    if (item.type === 'game' && item.discount === 100) {
      freeGames.push({
        id: item.appid.toString(),
        store: 'steam',
        title: item.name,
        description: item.description || 'No description available',
        startDate: new Date(item.start * 1000).toISOString(),
        endDate: new Date(item.end * 1000).toISOString(),
        url: `https://store.steampowered.com/app/${item.appid}`,
        image: item.image,
        price: {
          original: item.original_price || 0,
          discount: 100,
          currency: 'USD'
        }
      });
    }
  }
  
  return freeGames;
}

async function getGOGGames(): Promise<Game[] | null> {
  try {
    const response = await fetch('https://www.gog.com/games/ajax/filtered?mediaType=game&price=free&sort=popularity', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    return parseGOGGames(data);
  } catch (error) {
    console.error('Error fetching GOG games:', error);
    return null;
  }
}

function parseGOGGames(data: any): Game[] {
  const freeGames: Game[] = [];
  
  if (!data?.products) return freeGames;
  
  const now = Date.now();
  
  for (const game of data.products) {
    // Check if it's a promotional free game (not permanently free)
    if (game.price?.isFree && game.price?.discount > 0) {
      freeGames.push({
        id: game.id.toString(),
        store: 'gog',
        title: game.title,
        description: game.description || 'No description available',
        startDate: new Date(now).toISOString(),
        endDate: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
        url: `https://www.gog.com${game.url}`,
        image: game.image ? `https:${game.image}_product_card_v2_mobile_slider_639.jpg` : null,
        price: {
          original: game.price?.baseAmount || 0,
          discount: game.price?.discount || 100,
          currency: 'USD'
        },
        rating: game.rating ? {
          score: Math.round(game.rating * 10),
          count: game.votesCount || 0
        } : undefined
      });
    }
  }
  
  return freeGames;
}

async function getUbisoftGames(): Promise<Game[] | null> {
  // Ubisoft doesn't have a public API for free games
  // This would require web scraping or manual tracking
  // For now, returning null - can be implemented with scraping
  return null;
}

function createEmbed(game: Game, t: any, lang: Language): any {
  const endTimestamp = Math.floor(new Date(game.endDate).getTime() / 1000);
  
  const embed: any = {
    title: `${getStoreIcon(game.store)} ${game.title} - ${t.free_title}`,
    description: game.description.substring(0, 500) + (game.description.length > 500 ? '...' : ''),
    color: storeColors[game.store],
    url: game.url,
    fields: [],
    footer: { 
      text: `${storeNames[game.store]} • ${t.store_footer}`,
      icon_url: getStoreIcon(game.store)
    },
    timestamp: new Date().toISOString()
  };
  
  if (game.image) {
    embed.image = { url: game.image };
  }
  
  // Available until (Discord timestamp)
  embed.fields.push({
    name: t.available_until,
    value: `<t:${endTimestamp}:F> (<t:${endTimestamp}:R>)`,
    inline: false
  });
  
  // Original price
  if (game.price && game.price.original > 0) {
    const priceFormatted = new Intl.NumberFormat(getLocaleForLanguage(lang), {
      style: 'currency',
      currency: game.price.currency
    }).format(game.price.original);
    
    embed.fields.push({
      name: t.original_price,
      value: `~~${priceFormatted}~~ **FREE** (-${game.price.discount}%)`,
      inline: true
    });
  }
  
  // Rating
  if (game.rating) {
    const stars = '⭐'.repeat(Math.round(game.rating.score / 20));
    const ratingText = `${stars} ${game.rating.score}/100`;
    const countText = game.rating.count > 0 ? ` (${game.rating.count.toLocaleString()} ${lang === 'de' ? 'Bewertungen' : 'reviews'})` : '';
    
    embed.fields.push({
      name: t.rating,
      value: ratingText + countText,
      inline: true
    });
  }
  
  // Get now links
  const links = getStoreLinks(game);
  embed.fields.push({
    name: t.get_now,
    value: links,
    inline: false
  });
  
  return embed;
}

function getStoreIcon(store: StoreType): string {
  const icons: Record<StoreType, string> = {
    epic: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Epic_Games_Store_logo_2023_vertical_white.svg',
    steam: 'https://upload.wikimedia.org/wikipedia/commons/8/83/Steam_icon_logo.svg',
    gog: 'https://upload.wikimedia.org/wikipedia/commons/2/2e/GOG.com_logo.svg',
    ubisoft: 'https://upload.wikimedia.org/wikipedia/commons/7/78/Ubisoft_logo.svg'
  };
  return icons[store];
}

function getStoreLinks(game: Game): string {
  switch (game.store) {
    case 'epic':
      return `[Website](${game.url}) • [Launcher](${game.url.split('/p/')[0] + '/app/' + game.id})`;
    case 'steam':
      return `[Website](${game.url}) • [Client](steam://store/${game.url.match(/\/app\/(\d+)/)?.[1]})`;
    case 'gog':
      return `[Website](${game.url}) • [Galaxy](goggalaxy://openGameView/${game.url.match(/\/game\/([^\/]+)/)?.[1]})`;
    case 'ubisoft':
      return `[Website](${game.url})`;
    default:
      return `[Website](${game.url})`;
  }
}

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

// Guild Config Management
async function saveGuildConfig(env: Env, guildId: string, channelId: string, threadId?: string): Promise<void> {
  const existing = await getGuildConfig(env, guildId);
  const config: GuildConfig = {
    guildId,
    channelId,
    threadId,
    enabled: true,
    language: existing?.language || 'en',
    stores: existing?.stores || ['epic', 'steam'],
    mentionRoles: existing?.mentionRoles || [],
    separateThreads: existing?.separateThreads || false,
    storeThreads: existing?.storeThreads || {}
  };
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

async function updateLanguage(env: Env, guildId: string, language: Language): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.language = language;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function updateStores(env: Env, guildId: string, stores: StoreType[]): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.stores = stores;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function addMentionRole(env: Env, guildId: string, roleId: string): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config && !config.mentionRoles.includes(roleId)) {
    config.mentionRoles.push(roleId);
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function removeMentionRole(env: Env, guildId: string, roleId: string): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.mentionRoles = config.mentionRoles.filter(r => r !== roleId);
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function setSeparateThreads(env: Env, guildId: string, enabled: boolean): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.separateThreads = enabled;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function setStoreThread(env: Env, guildId: string, store: StoreType, threadId: string): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    if (!config.storeThreads) config.storeThreads = {};
    config.storeThreads[store] = threadId;
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

// Posted Games Management
async function loadPostedGames(env: Env): Promise<string[]> {
  try {
    const data = await env.POSTED_GAMES.get('games', 'json');
    return (data as string[]) || [];
  } catch (error) {
    console.error('Error loading posted games:', error);
    return [];
  }
}

async function savePostedGames(env: Env, games: string[]): Promise<void> {
  try {
    // Keep last 500 games to prevent unlimited growth
    const gamesToStore = games.slice(-500);
    await env.POSTED_GAMES.put('games', JSON.stringify(gamesToStore));
  } catch (error) {
    console.error('Error saving posted games:', error);
  }
}