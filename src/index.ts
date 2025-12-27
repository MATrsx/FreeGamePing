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
  const { name } = interaction.data;
  const guildId = interaction.guild_id;
  const member = interaction.member;
  
  const config = await getGuildConfig(env, guildId);
  const lang = config?.language || 'en';
  const t = translations[lang];

  // Berechtigungsprüfung
  const hasAdminPermission = member?.permissions && 
    (BigInt(member.permissions) & BigInt(0x8)) === BigInt(0x8);

  const adminCommands = ['setup', 'disable', 'stores', 'language', 'role', 'separate-threads', 'thread'];
  
  if (adminCommands.includes(name) && !hasAdminPermission) {
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
      
    case 'disable':
      await disableGuild(env, guildId);
      return respondWithEmbed({
        title: '❌ ' + t.bot_disabled,
        description: t.disabled,
        color: 0xff5555
      });
      
    case 'language':
      return handleLanguageCommand(interaction, env, guildId, config);
      
    case 'stores':
      return handleStoresCommand(interaction, env, guildId, config);
      
    case 'role':
      return handleRoleCommand(interaction, env, guildId, config);
      
    default:
      return respondWithEmbed({
        title: '❌ ' + t.unknown_command,
        description: 'Command not found',
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
    footer: { text: 'Free Games Bot • Setup Wizard' },
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

async function handleComponent(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const customId = interaction.data.custom_id;
  const parts = customId.split('_');
  const action = parts[0];
  const param = parts[1];
  const guildId = parts[2];
  const context = parts[3];
  
  if (context === 'setup') {
    return handleSetupComponent(interaction, env, action, param, guildId);
  }
  
  return new Response(JSON.stringify({
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: { content: 'Unknown interaction' }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleSetupComponent(
  interaction: any, 
  env: Env, 
  action: string, 
  param: string, 
  guildId: string
): Promise<Response> {
  if (action === 'lang') {
    const language = param as Language;
    const t = translations[language];
    
    // Erstelle oder aktualisiere temporäre Config
    let tempConfig = await env.GUILD_CONFIGS.get(`temp_${guildId}`, 'json') as GuildConfig;
    
    if (!tempConfig) {
      tempConfig = {
        guildId,
        channelId: interaction.channel_id,
        enabled: false,
        language,
        stores: ['epic', 'steam', 'gog', 'itchio'],
        mentionRoles: [],
        separateThreads: false
      };
    } else {
      tempConfig.language = language;
    }
    
    await env.GUILD_CONFIGS.put(`temp_${guildId}`, JSON.stringify(tempConfig));
    
    // Nächster Schritt: Kanal auswählen
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
      footer: { text: 'Free Games Bot • Setup Wizard' },
      timestamp: new Date().toISOString()
    };

    const components = [
      {
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
      }
    ];

    return new Response(JSON.stringify({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        embeds: [embed],
        components
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (action === 'channel') {
    const tempConfig = await env.GUILD_CONFIGS.get(`temp_${guildId}`, 'json') as GuildConfig;
    if (!tempConfig) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Setup session expired. Please start again with /setup',
        color: 0xff5555
      }, true);
    }
    
    tempConfig.channelId = interaction.channel_id;
    const t = translations[tempConfig.language];
    
    // Nächster Schritt: Stores auswählen
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
          value: tempConfig.stores.map(s => `${getStoreEmoji(s)} ${storeNames[s]}`).join('\n'),
          inline: false
        }
      ],
      footer: { text: 'Free Games Bot • Setup Wizard' },
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

    return new Response(JSON.stringify({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        embeds: [embed],
        components
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (action === 'store') {
    const store = param as StoreType;
    const tempConfig = await env.GUILD_CONFIGS.get(`temp_${guildId}`, 'json') as GuildConfig;
    if (!tempConfig) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Setup session expired',
        color: 0xff5555
      }, true);
    }
    
    const t = translations[tempConfig.language];
    
    // Toggle store
    if (tempConfig.stores.includes(store)) {
      tempConfig.stores = tempConfig.stores.filter(s => s !== store);
    } else {
      tempConfig.stores.push(store);
    }
    
    await env.GUILD_CONFIGS.put(`temp_${guildId}`, JSON.stringify(tempConfig));
    
    // Update embed
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
            ? tempConfig.stores.map(s => `${getStoreEmoji(s)} ${storeNames[s]}`).join('\n')
            : t.none,
          inline: false
        }
      ],
      footer: { text: 'Free Games Bot • Setup Wizard' },
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

    return new Response(JSON.stringify({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        embeds: [embed],
        components
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (action === 'finish') {
    const tempConfig = await env.GUILD_CONFIGS.get(`temp_${guildId}`, 'json') as GuildConfig;
    if (!tempConfig) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'Setup session expired',
        color: 0xff5555
      }, true);
    }
    
    tempConfig.enabled = true;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(tempConfig));
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
          value: tempConfig.stores.map(s => `${getStoreEmoji(s)} ${storeNames[s]}`).join('\n'),
          inline: true
        },
        {
          name: '📢 ' + t.status_channel,
          value: `<#${tempConfig.channelId}>`,
          inline: true
        }
      ],
      footer: { text: 'Free Games Bot' },
      timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        embeds: [embed],
        components: []
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (action === 'cancel') {
    await env.GUILD_CONFIGS.delete(`temp_${guildId}`);
    
    return new Response(JSON.stringify({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: '❌ Setup cancelled.',
        embeds: [],
        components: []
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return respondWithEmbed({
    title: '❌ Error',
    description: 'Unknown setup action',
    color: 0xff5555
  }, true);
}

async function handleHelpCommand(interaction: any, hasAdmin: boolean, lang: Language): Promise<Response> {
  const t = translations[lang];
  
  const embed = {
    title: '📖 ' + t.help_title,
    description: t.help_description,
    color: 0x5865F2,
    fields: [],
    footer: { text: 'Free Games Bot' },
    timestamp: new Date().toISOString()
  };

  // Basis-Befehle für alle
  embed.fields.push({
    name: '👥 ' + t.help_user_commands,
    value: [
      `\`/help\` - ${t.help_cmd_help}`,
      `\`/status\` - ${t.help_cmd_status}`,
    ].join('\n'),
    inline: false
  });

  // Admin-Befehle
  if (hasAdmin) {
    embed.fields.push({
      name: '⚙️ ' + t.help_admin_commands,
      value: [
        `\`/setup\` - ${t.help_cmd_setup}`,
        `\`/disable\` - ${t.help_cmd_disable}`,
        `\`/check\` - ${t.help_cmd_check}`,
        `\`/language\` - ${t.help_cmd_language}`,
        `\`/stores\` - ${t.help_cmd_stores}`,
        `\`/role\` - ${t.help_cmd_role}`,
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
          .map(s => `${getStoreEmoji(s)} ${storeNames[s]}`)
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
    footer: { text: 'Free Games Bot' },
    timestamp: new Date().toISOString()
  };

  if (config.separateThreads && config.storeThreads) {
    embed.fields.push({
      name: '🧵 ' + t.store_threads,
      value: Object.entries(config.storeThreads)
        .map(([store, thread]) => `${getStoreEmoji(store as StoreType)} <#${thread}>`)
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
  
  if (!config || !config.enabled) {
    return respondWithEmbed({
      title: '❌ ' + t.status_inactive,
      description: t.setup_required,
      color: 0xff5555
    }, true);
  }

  ctx.waitUntil(
    (async () => {
      await checkAndPostFreeGames(env);
      await updateInteractionResponse(
        env, 
        interaction.token, 
        t.check_complete
      );
    })()
  );

  return respondWithEmbed({
    title: '🔍 ' + t.check_running_title,
    description: t.check_running,
    color: 0x5865F2
  }, true);
}

async function handleLanguageCommand(
  interaction: any,
  env: Env,
  guildId: string,
  config: GuildConfig | null
): Promise<Response> {
  const options = interaction.data.options;
  const newLang = options?.[0]?.value as Language;
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Bot not configured',
      color: 0xff5555
    }, true);
  }
  
  await updateLanguage(env, guildId, newLang);
  const t = translations[newLang];
  
  return respondWithEmbed({
    title: '✅ ' + t.language_selected,
    description: `${t.language_selected}: ${newLang}`,
    color: 0x00ff99
  });
}

async function handleStoresCommand(
  interaction: any,
  env: Env,
  guildId: string,
  config: GuildConfig | null
): Promise<Response> {
  const options = interaction.data.options;
  const storesStr = options?.[0]?.value as string;
  const stores = storesStr.split(',').map(s => s.trim() as StoreType);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Bot not configured',
      color: 0xff5555
    }, true);
  }
  
  await updateStores(env, guildId, stores);
  const t = translations[config.language];
  
  return respondWithEmbed({
    title: '✅ ' + t.store_toggled,
    description: stores.map(s => `${getStoreEmoji(s)} ${storeNames[s]}`).join(', '),
    color: 0x00ff99
  });
}

async function handleRoleCommand(
  interaction: any,
  env: Env,
  guildId: string,
  config: GuildConfig | null
): Promise<Response> {
  const options = interaction.data.options;
  const action = options?.find((o: any) => o.name === 'action')?.value;
  const roleId = options?.find((o: any) => o.name === 'role')?.value;
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Bot not configured',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  
  if (action === 'add') {
    await addMentionRole(env, guildId, roleId);
    return respondWithEmbed({
      title: '✅ Success',
      description: `Role <@&${roleId}> added`,
      color: 0x00ff99
    });
  } else if (action === 'remove') {
    await removeMentionRole(env, guildId, roleId);
    return respondWithEmbed({
      title: '✅ Success',
      description: `Role <@&${roleId}> removed`,
      color: 0x00ff99
    });
  }
  
  return respondWithEmbed({
    title: '❌ Error',
    description: 'Invalid action',
    color: 0xff5555
  }, true);
}

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

async function updateInteractionResponse(env: Env, token: string, content: string): Promise<void> {
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (error) {
    console.error('Error updating interaction:', error);
  }
}

// ============================================================================
// GAME CHECKING & POSTING
// ============================================================================

async function checkAndPostFreeGames(env: Env): Promise<void> {
  console.log(`🔍 Checking for free games... (${new Date().toISOString()})`);
  
  try {
    const guilds = await getAllGuildConfigs(env);
    const postedGames = await loadPostedGames(env);
    let newGamesCount = 0;
    
    for (const guild of guilds.filter(g => g.enabled)) {
      const t = translations[guild.language];
      
      for (const store of guild.stores) {
        const games = await getFreeGamesForStore(store);
        
        if (!games || games.length === 0) continue;
        
        for (const game of games) {
          const gameKey = `${store}-${game.id}`;
          
          if (!postedGames.includes(gameKey)) {
            console.log(`🆕 New free game: ${game.title} (${store})`);
            
            const embed = createGameEmbed(game, t, guild.language);
            const mentions = guild.mentionRoles.map(r => `<@&${r}>`).join(' ');
            
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
    }
    
    if (postedGames.length > 0) {
      await savePostedGames(env, postedGames);
    }
    
    if (newGamesCount === 0) {
      console.log('ℹ️ No new games found.');
    } else {
      console.log(`📤 Posted ${newGamesCount} new games`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

function createGameEmbed(game: Game, t: any, lang: Language): any {
  const endTimestamp = Math.floor(new Date(game.endDate).getTime() / 1000);
  
  const embed: any = {
    title: `🎁 ${game.title} - ${t.free_title}`,
    description: game.description.substring(0, 500) + (game.description.length > 500 ? '...' : ''),
    color: storeColors[game.store],
    url: game.url,
    fields: [],
    footer: { 
      text: `${storeNames[game.store]} • ${t.store_footer}`,
      icon_url: getStoreIconUrl(game.store)
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
    value: `[${storeNames[game.store]}](${game.url})`,
    inline: false
  });
  
  return embed;
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

// ============================================================================
// GAME API FETCHERS
// ============================================================================

async function getFreeGamesForStore(store: StoreType): Promise<Game[] | null> {
  const platform = storePlatformNames[store];
  const url = `https://www.gamerpower.com/api/giveaways?platform=${platform}&type=game`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) {
      console.error(`Error fetching ${store} games:`, response.status);
      return null;
    }
    
    const data: GamerPowerGame[] = await response.json();
    
    // For Epic Games, also fetch from Epic's official API for enhanced data
    if (store === 'epic') {
      const epicGames = await getEpicGamesOfficial();
      if (epicGames && epicGames.length > 0) {
        return mergeEpicGames(parseGamerPowerGames(data, store), epicGames);
      }
    }
    
    return parseGamerPowerGames(data, store);
  } catch (error) {
    console.error(`Error fetching ${store} games:`, error);
    return null;
  }
}

function parseGamerPowerGames(data: GamerPowerGame[], store: StoreType): Game[] {
  const games: Game[] = [];
  
  for (const item of data) {
    if (item.type !== 'Game' || item.status === 'Expired') continue;
    
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
        console.error('Error parsing end date:', e);
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
      instructions: item.instructions
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
    console.error('Error fetching Epic official games:', error);
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
        }
      });
    }
  }
  
  return freeGames;
}

function mergeEpicGames(gamerPowerGames: Game[], officialGames: Game[]): Game[] {
  const merged: Game[] = [];
  const processedTitles = new Set<string>();
  
  // Prioritize official Epic Games API data
  for (const official of officialGames) {
    const titleKey = official.title.toLowerCase().trim();
    
    // Find matching GamerPower game
    const gp = gamerPowerGames.find(g => 
      g.title.toLowerCase().trim() === titleKey ||
      g.title.toLowerCase().includes(titleKey) ||
      titleKey.includes(g.title.toLowerCase().trim())
    );
    
    // Enhance official data with GamerPower data
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
  
  // Add GamerPower games that weren't in official API
  for (const game of gamerPowerGames) {
    const titleKey = game.title.toLowerCase().trim();
    
    // Check if already processed
    let alreadyExists = false;
    for (const processedTitle of processedTitles) {
      if (titleKey === processedTitle || 
          titleKey.includes(processedTitle) || 
          processedTitle.includes(titleKey)) {
        alreadyExists = true;
        break;
      }
    }
    
    if (!alreadyExists) {
      merged.push(game);
      processedTitles.add(titleKey);
    }
  }
  
  return merged;
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

async function getGuildConfig(env: Env, guildId: string): Promise<GuildConfig | null> {
  const data = await env.GUILD_CONFIGS.get(guildId, 'json');
  return data as GuildConfig | null;
}

async function saveGuildConfig(env: Env, guildId: string, channelId: string, threadId?: string): Promise<void> {
  const existing = await getGuildConfig(env, guildId);
  const config: GuildConfig = {
    guildId,
    channelId,
    threadId,
    enabled: true,
    language: existing?.language || 'en',
    stores: existing?.stores || ['epic', 'steam', 'gog', 'itchio'],
    mentionRoles: existing?.mentionRoles || [],
    separateThreads: existing?.separateThreads || false,
    storeThreads: existing?.storeThreads || {}
  };
  await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
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

async function getAllGuildConfigs(env: Env): Promise<GuildConfig[]> {
  const list = await env.GUILD_CONFIGS.list();
  const configs: GuildConfig[] = [];
  
  for (const key of list.keys) {
    // Skip temporary setup configs
    if (key.name.startsWith('temp_')) continue;
    
    const config = await env.GUILD_CONFIGS.get(key.name, 'json');
    if (config) {
      configs.push(config as GuildConfig);
    }
  }
  
  return configs;
}

// ============================================================================
// POSTED GAMES TRACKING
// ============================================================================

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
    // Keep only last 1000 games to prevent storage bloat
    const gamesToStore = games.slice(-1000);
    await env.POSTED_GAMES.put('games', JSON.stringify(gamesToStore));
  } catch (error) {
    console.error('Error saving posted games:', error);
  }
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
}/**
 * Multi-Store Free Games Bot für Cloudflare Workers (TypeScript)
 * Vollständig überarbeitete Version mit verbesserter UX
 */

import { verifyKey } from 'discord-interactions';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Env {
  POSTED_GAMES: KVNamespace;
  GUILD_CONFIGS: KVNamespace;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

type StoreType = 'epic' | 'steam' | 'gog' | 'itchio';
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
  instructions?: string;
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

// ============================================================================
// DISCORD CONSTANTS
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
    
    return new Response('🎮 Free Games Bot is running!', { status: 200 });
  }
};

// ============================================================================
// STORE CONSTANTS
// ============================================================================

const storeNames: Record<StoreType, string> = {
  epic: 'Epic Games Store',
  steam: 'Steam',
  gog: 'GOG',
  itchio: 'Itch.io'
};

const storeColors: Record<StoreType, number> = {
  epic: 0x121212,
  steam: 0x66C0F4,
  gog: 0xC10DE4,
  itchio: 0xDE425C
};

const storePlatformNames: Record<StoreType, string> = {
  epic: 'epic-games-store',
  steam: 'steam',
  gog: 'gog',
  itchio: 'itchio'
};

function getStoreEmoji(store: StoreType): string {
  const emojis: Record<StoreType, string> = {
    epic: '🎮',
    steam: '🎯',
    gog: '🐉',
    itchio: '🎨'
  };
  return emojis[store];
}

function getStoreIconUrl(store: StoreType): string {
  const icons: Record<StoreType, string> = {
    epic: 'https://cdn.brandfetch.io/idjxHPThVp/w/800/h/929/theme/dark/logo.png?c=1bxid64Mup7aczewSAYMX&t=1667655482104',
    steam: 'https://cdn.brandfetch.io/idMpZmhn_O/w/400/h/400/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1726566655121',
    gog: 'https://cdn.brandfetch.io/idKvjVxYV6/w/128/h/128/theme/dark/logo.png?c=1bxid64Mup7aczewSAYMX&t=1761868104778',
    itchio: 'https://cdn.brandfetch.io/idHwxBm5XT/w/316/h/316/theme/dark/icon.png?c=1bxid64Mup7aczewSAYMX&t=1765065158087'
  };
  return icons[store];
}

// ============================================================================
// TRANSLATIONS
// ============================================================================

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Setup Wizard
    setup_wizard_title: 'Setup Wizard',
    setup_wizard_desc: 'Welcome to the Free Games Bot! Let\'s set everything up in just a few steps.',
    setup_step_language: 'Please select your preferred language:',
    setup_step_channel: 'Select Channel',
    setup_channel_instructions: 'Where should I post free games? Click the button below to use this channel.',
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
    
    // Status & Info
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
    
    // Help Command
    help_title: 'Help & Commands',
    help_description: 'Here are all available commands for the Free Games Bot:',
    help_user_commands: 'User Commands',
    help_admin_commands: 'Admin Commands',
    help_cmd_help: 'Show this help message',
    help_cmd_status: 'Check bot configuration and status',
    help_cmd_setup: 'Start the interactive setup wizard',
    help_cmd_disable: 'Disable the bot on this server',
    help_cmd_check: 'Manually check for new free games',
    help_cmd_language: 'Change the bot language',
    help_cmd_stores: 'Configure which stores to monitor',
    help_cmd_role: 'Add or remove roles to mention',
    help_links: 'Links & Support',
    help_links_text: '[Documentation](https://github.com/yourrepo) • [Support](https://discord.gg/support)',
    
    // Permissions
    no_permission_title: 'No Permission',
    no_permission_desc: 'You need Administrator permissions to use this command.',
    
    // Game Embeds
    free_title: 'FREE!',
    available_until: '⏰ Available until',
    get_now: '🔗 Get now',
    original_price: '💰 Original price',
    store_footer: 'Free to keep',
    how_to_claim: '📋 How to claim',
    
    // Actions
    bot_disabled: 'Bot Disabled',
    disabled: 'The bot has been disabled. Use `/setup` to enable it again.',
    check_running_title: 'Checking for Games',
    check_running: 'Searching for new free games... This may take up to 30 seconds.',
    check_complete: '✅ Check complete! New games have been posted if available.',
    
    // Other
    unknown_command: '❌ Unknown command',
    error_occurred: 'An error occurred',
  },
  
  de: {
    // Setup Wizard
    setup_wizard_title: 'Einrichtungsassistent',
    setup_wizard_desc: 'Willkommen beim Free Games Bot! Lass uns alles in wenigen Schritten einrichten.',
    setup_step_language: 'Bitte wähle deine bevorzugte Sprache:',
    setup_step_channel: 'Kanal auswählen',
    setup_channel_instructions: 'Wo soll ich kostenlose Spiele posten? Klicke auf den Button um diesen Kanal zu nutzen.',
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
    
    // Status & Info
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
    
    // Help Command
    help_title: 'Hilfe & Befehle',
    help_description: 'Hier sind alle verfügbaren Befehle für den Free Games Bot:',
    help_user_commands: 'Nutzer-Befehle',
    help_admin_commands: 'Admin-Befehle',
    help_cmd_help: 'Diese Hilfenachricht anzeigen',
    help_cmd_status: 'Bot-Konfiguration und Status prüfen',
    help_cmd_setup: 'Interaktiven Einrichtungsassistenten starten',
    help_cmd_disable: 'Bot auf diesem Server deaktivieren',
    help_cmd_check: 'Manuell nach neuen kostenlosen Spielen suchen',
    help_cmd_language: 'Bot-Sprache ändern',
    help_cmd_stores: 'Konfigurieren, welche Stores überwacht werden',
    help_cmd_role: 'Rollen für Erwähnungen hinzufügen oder entfernen',
    help_links: 'Links & Support',
    help_links_text: '[Dokumentation](https://github.com/yourrepo) • [Support](https://discord.gg/support)',
    
    // Permissions
    no_permission_title: 'Keine Berechtigung',
    no_permission_desc: 'Du benötigst Administrator-Rechte, um diesen Befehl zu nutzen.',
    
    // Game Embeds
    free_title: 'KOSTENLOS!',
    available_until: '⏰ Verfügbar bis',
    get_now: '🔗 Jetzt holen',
    original_price: '💰 Originalpreis',
    store_footer: 'Kostenlos erhältlich',
    how_to_claim: '📋 So erhältst du es',
    
    // Actions
    bot_disabled: 'Bot deaktiviert',
    disabled: 'Der Bot wurde deaktiviert. Nutze `/setup` um ihn wieder zu aktivieren.',
    check_running_title: 'Prüfe auf Spiele',
    check_running: 'Suche nach neuen kostenlosen Spielen... Dies kann bis zu 30 Sekunden dauern.',
    check_complete: '✅ Prüfung abgeschlossen! Neue Spiele wurden gepostet, falls verfügbar.',
    
    // Other
    unknown_command: '❌ Unbekannter Befehl',
    error_occurred: 'Ein Fehler ist aufgetreten',
  },
  
  fr: {
    setup_wizard_title: 'Assistant de configuration',
    setup_wizard_desc: 'Bienvenue sur Free Games Bot! Configurons tout en quelques étapes.',
    setup_step_language: 'Veuillez sélectionner votre langue préférée:',
    setup_step_channel: 'Sélectionner le canal',
    setup_channel_instructions: 'Où dois-je publier les jeux gratuits? Cliquez sur le bouton ci-dessous pour utiliser ce canal.',
    use_current_channel: 'Utiliser ce canal',
    setup_step_stores: 'Sélectionner les magasins de jeux',
    setup_stores_instructions: 'Quels magasins dois-je surveiller? Cliquez sur les magasins pour les activer/désactiver, puis sur "Terminer la configuration".',
    finish_setup: 'Terminer la configuration',
    cancel: 'Annuler',
    language_selected: 'Langue sélectionnée',
    channel_selected: 'Canal sélectionné',
    store_toggled: 'Magasin mis à jour',
    setup_complete_title: 'Configuration terminée!',
    setup_complete_desc: 'Le bot est maintenant configuré et commencera à publier automatiquement les jeux gratuits.',
    step: 'Étape',
    status_title: 'Statut du bot',
    status_active: '✅ Le bot est actif et poste dans',
    status_inactive: '❌ Le bot n\'est pas configuré',
    status_channel: 'Canal',
    status_stores: 'Magasins actifs',
    status_language: 'Langue',
    status_roles: 'Rôles mentionnés',
    store_threads: 'Fils de magasin',
    setup_required: 'Veuillez d\'abord exécuter `/setup` pour configurer le bot.',
    none: 'Aucun',
    selected: 'Sélectionné',
    help_title: 'Aide et commandes',
    help_description: 'Voici toutes les commandes disponibles pour Free Games Bot:',
    help_user_commands: 'Commandes utilisateur',
    help_admin_commands: 'Commandes admin',
    help_cmd_help: 'Afficher ce message d\'aide',
    help_cmd_status: 'Vérifier la configuration et le statut du bot',
    help_cmd_setup: 'Démarrer l\'assistant de configuration interactif',
    help_cmd_disable: 'Désactiver le bot sur ce serveur',
    help_cmd_check: 'Rechercher manuellement de nouveaux jeux gratuits',
    help_cmd_language: 'Changer la langue du bot',
    help_cmd_stores: 'Configurer les magasins à surveiller',
    help_cmd_role: 'Ajouter ou supprimer des rôles à mentionner',
    help_links: 'Liens et support',
    help_links_text: '[Documentation](https://github.com/yourrepo) • [Support](https://discord.gg/support)',
    no_permission_title: 'Aucune permission',
    no_permission_desc: 'Vous avez besoin des permissions Administrateur pour utiliser cette commande.',
    free_title: 'GRATUIT!',
    available_until: '⏰ Disponible jusqu\'au',
    get_now: '🔗 Obtenir maintenant',
    original_price: '💰 Prix d\'origine',
    store_footer: 'Gratuit à conserver',
    how_to_claim: '📋 Comment réclamer',
    bot_disabled: 'Bot désactivé',
    disabled: 'Le bot a été désactivé. Utilisez `/setup` pour le réactiver.',
    check_running_title: 'Vérification des jeux',
    check_running: 'Recherche de nouveaux jeux gratuits... Cela peut prendre jusqu\'à 30 secondes.',
    check_complete: '✅ Vérification terminée! De nouveaux jeux ont été publiés s\'ils sont disponibles.',
    unknown_command: '❌ Commande inconnue',
    error_occurred: 'Une erreur s\'est produite',
  },
  
  es: {
    setup_wizard_title: 'Asistente de configuración',
    setup_wizard_desc: '¡Bienvenido a Free Games Bot! Configuremos todo en pocos pasos.',
    setup_step_language: 'Por favor, selecciona tu idioma preferido:',
    setup_step_channel: 'Seleccionar canal',
    setup_channel_instructions: '¿Dónde debo publicar juegos gratis? Haz clic en el botón a continuación para usar este canal.',
    use_current_channel: 'Usar este canal',
    setup_step_stores: 'Seleccionar tiendas de juegos',
    setup_stores_instructions: '¿Qué tiendas debo monitorear? Haz clic en las tiendas para activarlas/desactivarlas, luego en "Finalizar configuración".',
    finish_setup: 'Finalizar configuración',
    cancel: 'Cancelar',
    language_selected: 'Idioma seleccionado',
    channel_selected: 'Canal seleccionado',
    store_toggled: 'Tienda actualizada',
    setup_complete_title: '¡Configuración completa!',
    setup_complete_desc: 'El bot ahora está configurado y comenzará a publicar juegos gratis automáticamente.',
    step: 'Paso',
    status_title: 'Estado del bot',
    status_active: '✅ El bot está activo y publicando en',
    status_inactive: '❌ El bot no está configurado',
    status_channel: 'Canal',
    status_stores: 'Tiendas activas',
    status_language: 'Idioma',
    status_roles: 'Roles mencionados',
    store_threads: 'Hilos de tienda',
    setup_required: 'Por favor, ejecuta `/setup` primero para configurar el bot.',
    none: 'Ninguno',
    selected: 'Seleccionado',
    help_title: 'Ayuda y comandos',
    help_description: 'Aquí están todos los comandos disponibles para Free Games Bot:',
    help_user_commands: 'Comandos de usuario',
    help_admin_commands: 'Comandos de admin',
    help_cmd_help: 'Mostrar este mensaje de ayuda',
    help_cmd_status: 'Verificar configuración y estado del bot',
    help_cmd_setup: 'Iniciar el asistente de configuración interactivo',
    help_cmd_disable: 'Desactivar el bot en este servidor',
    help_cmd_check: 'Buscar manualmente nuevos juegos gratis',
    help_cmd_language: 'Cambiar el idioma del bot',
    help_cmd_stores: 'Configurar qué tiendas monitorear',
    help_cmd_role: 'Agregar o eliminar roles para mencionar',
    help_links: 'Enlaces y soporte',
    help_links_text: '[Documentación](https://github.com/yourrepo) • [Soporte](https://discord.gg/support)',
    no_permission_title: 'Sin permiso',
    no_permission_desc: 'Necesitas permisos de Administrador para usar este comando.',
    free_title: '¡GRATIS!',
    available_until: '⏰ Disponible hasta',
    get_now: '🔗 Obtener ahora',
    original_price: '💰 Precio original',
    store_footer: 'Gratis para siempre',
    how_to_claim: '📋 Cómo reclamar',
    bot_disabled: 'Bot desactivado',
    disabled: 'El bot ha sido desactivado. Usa `/setup` para activarlo de nuevo.',
    check_running_title: 'Buscando juegos',
    check_running: 'Buscando nuevos juegos gratis... Esto puede tardar hasta 30 segundos.',
    check_complete: '✅ ¡Verificación completa! Se han publicado nuevos juegos si están disponibles.',
    unknown_command: '❌ Comando desconocido',
    error_occurred: 'Ocurrió un error',
  },
  
  it: {
    setup_wizard_title: 'Assistente di configurazione',
    setup_wizard_desc: 'Benvenuto in Free Games Bot! Configuriamo tutto in pochi passaggi.',
    setup_step_language: 'Seleziona la tua lingua preferita:',
    setup_step_channel: 'Seleziona canale',
    setup_channel_instructions: 'Dove devo pubblicare i giochi gratis? Clicca sul pulsante qui sotto per usare questo canale.',
    use_current_channel: 'Usa questo canale',
    setup_step_stores: 'Seleziona negozi di giochi',
    setup_stores_instructions: 'Quali negozi devo monitorare? Clicca sui negozi per attivarli/disattivarli, poi su "Completa configurazione".',
    finish_setup: 'Completa configurazione',
    cancel: 'Annulla',
    language_selected: 'Lingua selezionata',
    channel_selected: 'Canale selezionato',
    store_toggled: 'Negozio aggiornato',
    setup_complete_title: 'Configurazione completata!',
    setup_complete_desc: 'Il bot è ora configurato e inizierà a pubblicare giochi gratis automaticamente.',
    step: 'Passo',
    status_title: 'Stato del bot',
    status_active: '✅ Il bot è attivo e pubblica in',
    status_inactive: '❌ Il bot non è configurato',
    status_channel: 'Canale',
    status_stores: 'Negozi attivi',
    status_language: 'Lingua',
    status_roles: 'Ruoli menzionati',
    store_threads: 'Thread negozi',
    setup_required: 'Esegui prima `/setup` per configurare il bot.',
    none: 'Nessuno',
    selected: 'Selezionato',
    help_title: 'Aiuto e comandi',
    help_description: 'Ecco tutti i comandi disponibili per Free Games Bot:',
    help_user_commands: 'Comandi utente',
    help_admin_commands: 'Comandi admin',
    help_cmd_help: 'Mostra questo messaggio di aiuto',
    help_cmd_status: 'Verifica configurazione e stato del bot',
    help_cmd_setup: 'Avvia l\'assistente di configurazione interattivo',
    help_cmd_disable: 'Disattiva il bot su questo server',
    help_cmd_check: 'Cerca manualmente nuovi giochi gratis',
    help_cmd_language: 'Cambia la lingua del bot',
    help_cmd_stores: 'Configura quali negozi monitorare',
    help_cmd_role: 'Aggiungi o rimuovi ruoli da menzionare',
    help_links: 'Link e supporto',
    help_links_text: '[Documentazione](https://github.com/yourrepo) • [Supporto](https://discord.gg/support)',
    no_permission_title: 'Nessun permesso',
    no_permission_desc: 'Hai bisogno dei permessi di Amministratore per usare questo comando.',
    free_title: 'GRATIS!',
    available_until: '⏰ Disponibile fino a',
    get_now: '🔗 Ottieni ora',
    original_price: '💰 Prezzo originale',
    store_footer: 'Gratis per sempre',
    how_to_claim: '📋 Come rivendicare',
    bot_disabled: 'Bot disabilitato',
    disabled: 'Il bot è stato disabilitato. Usa `/setup` per riattivarlo.',
    check_running_title: 'Ricerca giochi',
    check_running: 'Ricerca di nuovi giochi gratis... Potrebbe richiedere fino a 30 secondi.',
    check_complete: '✅ Verifica completata! Nuovi giochi sono stati pubblicati se disponibili.',
    unknown_command: '❌ Comando sconosciuto',
    error_occurred: 'Si è verificato un errore',
  },
  
  pt: {
    setup_wizard_title: 'Assistente de configuração',
    setup_wizard_desc: 'Bem-vindo ao Free Games Bot! Vamos configurar tudo em poucos passos.',
    setup_step_language: 'Por favor, selecione seu idioma preferido:',
    setup_step_channel: 'Selecionar canal',
    setup_channel_instructions: 'Onde devo postar jogos grátis? Clique no botão abaixo para usar este canal.',
    use_current_channel: 'Usar este canal',
    setup_step_stores: 'Selecionar lojas de jogos',
    setup_stores_instructions: 'Quais lojas devo monitorar? Clique nas lojas para ativá-las/desativá-las, depois em "Concluir configuração".',
    finish_setup: 'Concluir configuração',
    cancel: 'Cancelar',
    language_selected: 'Idioma selecionado',
    channel_selected: 'Canal selecionado',
    store_toggled: 'Loja atualizada',
    setup_complete_title: 'Configuração concluída!',
    setup_complete_desc: 'O bot agora está configurado e começará a postar jogos grátis automaticamente.',
    step: 'Passo',
    status_title: 'Status do bot',
    status_active: '✅ O bot está ativo e postando em',
    status_inactive: '❌ O bot não está configurado',
    status_channel: 'Canal',
    status_stores: 'Lojas ativas',
    status_language: 'Idioma',
    status_roles: 'Cargos mencionados',
    store_threads: 'Tópicos de loja',
    setup_required: 'Execute `/setup` primeiro para configurar o bot.',
    none: 'Nenhum',
    selected: 'Selecionado',
    help_title: 'Ajuda e comandos',
    help_description: 'Aqui estão todos os comandos disponíveis para o Free Games Bot:',
    help_user_commands: 'Comandos de usuário',
    help_admin_commands: 'Comandos admin',
    help_cmd_help: 'Mostrar esta mensagem de ajuda',
    help_cmd_status: 'Verificar configuração e status do bot',
    help_cmd_setup: 'Iniciar o assistente de configuração interativo',
    help_cmd_disable: 'Desativar o bot neste servidor',
    help_cmd_check: 'Procurar manualmente por novos jogos grátis',
    help_cmd_language: 'Mudar o idioma do bot',
    help_cmd_stores: 'Configurar quais lojas monitorar',
    help_cmd_role: 'Adicionar ou remover cargos para mencionar',
    help_links: 'Links e suporte',
    help_links_text: '[Documentação](https://github.com/yourrepo) • [Suporte](https://discord.gg/support)',
    no_permission_title: 'Sem permissão',
    no_permission_desc: 'Você precisa de permissões de Administrador para usar este comando.',
    free_title: 'GRÁTIS!',
    available_until: '⏰ Disponível até',
    get_now: '🔗 Obter agora',
    original_price: '💰 Preço original',
    store_footer: 'Grátis para sempre',
    how_to_claim: '📋 Como reivindicar',
    bot_disabled: 'Bot desativado',
    disabled: 'O bot foi desativado. Use `/setup` para reativá-lo.',
    check_running_title: 'Procurando jogos',
    check_running: 'Procurando por novos jogos grátis... Isso pode levar até 30 segundos.',
    check_complete: '✅ Verificação concluída! Novos jogos foram postados se disponíveis.',
    unknown_command: '❌ Comando desconhecido',
    error_occurred: 'Ocorreu um erro',
  },
  
  ru: {
    setup_wizard_title: 'Мастер настройки',
    setup_wizard_desc: 'Добро пожаловать в Free Games Bot! Давайте все настроим за несколько шагов.',
    setup_step_language: 'Пожалуйста, выберите предпочитаемый язык:',
    setup_step_channel: 'Выбрать канал',
    setup_channel_instructions: 'Где я должен публиковать бесплатные игры? Нажмите кнопку ниже, чтобы использовать этот канал.',
    use_current_channel: 'Использовать этот канал',
    setup_step_stores: 'Выбрать игровые магазины',
    setup_stores_instructions: 'Какие магазины мне отслеживать? Нажмите на магазины, чтобы активировать/деактивировать их, затем на "Завершить настройку".',
    finish_setup: 'Завершить настройку',
    cancel: 'Отмена',
    language_selected: 'Язык выбран',
    channel_selected: 'Канал выбран',
    store_toggled: 'Магазин обновлен',
    setup_complete_title: 'Настройка завершена!',
    setup_complete_desc: 'Бот теперь настроен и начнет автоматически публиковать бесплатные игры.',
    step: 'Шаг',
    status_title: 'Статус бота',
    status_active: '✅ Бот активен и публикует в',
    status_inactive: '❌ Бот не настроен',
    status_channel: 'Канал',
    status_stores: 'Активные магазины',
    status_language: 'Язык',
    status_roles: 'Упоминаемые роли',
    store_threads: 'Треды магазинов',
    setup_required: 'Сначала выполните `/setup` для настройки бота.',
    none: 'Нет',
    selected: 'Выбрано',
    help_title: 'Помощь и команды',
    help_description: 'Вот все доступные команды для Free Games Bot:',
    help_user_commands: 'Команды пользователя',
    help_admin_commands: 'Команды админа',
    help_cmd_help: 'Показать это сообщение помощи',
    help_cmd_status: 'Проверить конфигурацию и статус бота',
    help_cmd_setup: 'Запустить интерактивный мастер настройки',
    help_cmd_disable: 'Отключить бота на этом сервере',
    help_cmd_check: 'Вручную проверить новые бесплатные игры',
    help_cmd_language: 'Изменить язык бота',
    help_cmd_stores: 'Настроить, какие магазины отслеживать',
    help_cmd_role: 'Добавить или удалить роли для упоминания',
    help_links: 'Ссылки и поддержка',
    help_links_text: '[Документация](https://github.com/yourrepo) • [Поддержка](https://discord.gg/support)',
    no_permission_title: 'Нет разрешения',
    no_permission_desc: 'Вам нужны права Администратора для использования этой команды.',
    free_title: 'БЕСПЛАТНО!',
    available_until: '⏰ Доступно до',
    get_now: '🔗 Получить сейчас',
    original_price: '💰 Исходная цена',
    store_footer: 'Бесплатно навсегда',
    how_to_claim: '📋 Как получить',
    bot_disabled: 'Бот отключен',
    disabled: 'Бот был отключен. Используйте `/setup` для повторной активации.',
    check_running_title: 'Проверка игр',
    check_running: 'Поиск новых бесплатных игр... Это может занять до 30 секунд.',
    check_complete: '✅ Проверка завершена! Новые игры были опубликованы, если доступны.',
    unknown_command: '❌ Неизвестная команда',
    error_occurred: 'Произошла ошибка',
  },
  
  pl: {
    setup_wizard_title: 'Kreator konfiguracji',
    setup_wizard_desc: 'Witaj w Free Games Bot! Skonfigurujmy wszystko w kilku krokach.',
    setup_step_language: 'Wybierz preferowany język:',
    setup_step_channel: 'Wybierz kanał',
    setup_channel_instructions: 'Gdzie mam publikować darmowe gry? Kliknij przycisk poniżej, aby użyć tego kanału.',
    use_current_channel: 'Użyj tego kanału',
    setup_step_stores: 'Wybierz sklepy z grami',
    setup_stores_instructions: 'Które sklepy mam monitorować? Kliknij sklepy, aby je aktywować/dezaktywować, następnie "Zakończ konfigurację".',
    finish_setup: 'Zakończ konfigurację',
    cancel: 'Anuluj',
    language_selected: 'Język wybrany',
    channel_selected: 'Kanał wybrany',
    store_toggled: 'Sklep zaktualizowany',
    setup_complete_title: 'Konfiguracja zakończona!',
    setup_complete_desc: 'Bot jest teraz skonfigurowany i rozpocznie automatyczne publikowanie darmowych gier.',
    step: 'Krok',
    status_title: 'Status bota',
    status_active: '✅ Bot jest aktywny i publikuje w',
    status_inactive: '❌ Bot nie jest skonfigurowany',
    status_channel: 'Kanał',
    status_stores: 'Aktywne sklepy',
    status_language: 'Język',
    status_roles: 'Wspominane role',
    store_threads: 'Wątki sklepów',
    setup_required: 'Najpierw uruchom `/setup`, aby skonfigurować bota.',
    none: 'Brak',
    selected: 'Wybrano',
    help_title: 'Pomoc i komendy',
    help_description: 'Oto wszystkie dostępne komendy dla Free Games Bot:',
    help_user_commands: 'Komendy użytkownika',
    help_admin_commands: 'Komendy admina',
    help_cmd_help: 'Pokaż tę wiadomość pomocy',
    help_cmd_status: 'Sprawdź konfigurację i status bota',
    help_cmd_setup: 'Uruchom interaktywny kreator konfiguracji',
    help_cmd_disable: 'Wyłącz bota na tym serwerze',
    help_cmd_check: 'Ręcznie sprawdź nowe darmowe gry',
    help_cmd_language: 'Zmień język bota',
    help_cmd_stores: 'Skonfiguruj, które sklepy monitorować',
    help_cmd_role: 'Dodaj lub usuń role do wspominania',
    help_links: 'Linki i wsparcie',
    help_links_text: '[Dokumentacja](https://github.com/yourrepo) • [Wsparcie](https://discord.gg/support)',
    no_permission_title: 'Brak uprawnienia',
    no_permission_desc: 'Potrzebujesz uprawnień Administratora, aby użyć tej komendy.',
    free_title: 'ZA DARMO!',
    available_until: '⏰ Dostępne do',
    get_now: '🔗 Pobierz teraz',
    original_price: '💰 Cena oryginalna',
    store_footer: 'Darmowe na zawsze',
    how_to_claim: '📋 Jak odebrać',
    bot_disabled: 'Bot wyłączony',
    disabled: 'Bot został wyłączony. Użyj `/setup`, aby go włączyć ponownie.',
    check_running_title: 'Sprawdzanie gier',
    check_running: 'Wyszukiwanie nowych darmowych gier... Może to potrwać do 30 sekund.',
    check_complete: '✅ Sprawdzanie zakończone! Nowe gry zostały opublikowane, jeśli są dostępne.',
    unknown_command: '❌ Nieznana komenda',
    error_occurred: 'Wystąpił błąd',
  },
};