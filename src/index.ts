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

  // Permission check
  const hasAdminPermission = member?.permissions && 
    (BigInt(member.permissions) & BigInt(0x8)) === BigInt(0x8);

  const adminCommands = ['setup', 'check', 'settings'];
  
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
      
    case 'settings':
      return handleSettingsCommand(interaction, config, lang);
      
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
          ? config.stores.map(s => `${getStoreEmoji(s)} ${storeNames[s]}`).join('\n')
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

async function handleSettingsComponent(
  interaction: any,
  env: Env,
  settingType: string,
  guildId: string
): Promise<Response> {
  const config = await getGuildConfig(env, guildId);
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  
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

async function handleSettingUpdate(interaction: any, env: Env, parts: string[]): Promise<Response> {
  const action = parts[0]; // 'set' or 'toggle'
  const setting = parts[1];
  const value = parts[2];
  const guildId = parts[3] || parts[2];
  
  const config = await getGuildConfig(env, guildId);
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  const t = translations[config.language];
  
  // Handle different setting updates
  if (setting === 'currency') {
    config.currency = value as Currency;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
    return handleGeneralSettings(interaction, config, t, guildId);
  }
  
  if (setting === 'dlcs') {
    config.includeDLCs = !config.includeDLCs;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
    return handleGeneralSettings(interaction, config, t, guildId);
  }
  
  if (setting === 'store') {
    const store = value as StoreType;
    if (config.stores.includes(store)) {
      config.stores = config.stores.filter(s => s !== store);
    } else {
      config.stores.push(store);
    }
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
    return handleStoresSettings(interaction, config, t, guildId);
  }
  
  if (setting === 'lang') {
    config.language = value as Language;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
    const newT = translations[config.language];
    return handleLanguageSettings(interaction, config, newT, guildId);
  }
  
  if (setting === 'reactions') {
    config.reactions = !config.reactions;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
    return handleReactionsSettings(interaction, config, t, guildId, env);
  }
  
  return respondWithEmbed({
    title: '❌ Error',
    description: 'Unknown setting',
    color: 0xff5555
  }, true);
}

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
  const config = await getGuildConfig(env, guildId);
  
  if (!config) {
    return respondWithEmbed({
      title: '❌ Error',
      description: 'Configuration not found',
      color: 0xff5555
    }, true);
  }
  
  config.channelId = channelId;
  await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  
  const t = translations[config.language];
  return handleChannelSettings(interaction, config, t, guildId, env);
}

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
          ? config.stores.map(s => `${getStoreEmoji(s)} ${storeNames[s]}`).join('\n')
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

  // Add store-specific roles if configured
  if (config.storeRoles && Object.keys(config.storeRoles).length > 0) {
    const storeRolesText = Object.entries(config.storeRoles)
      .map(([store, roleId]) => `${getStoreEmoji(store as StoreType)} ${storeNames[store as StoreType]}: <@&${roleId}>`)
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

async function handleChannelSettings(
  interaction: any,
  config: GuildConfig,
  t: any,
  guildId: string,
  env: Env
): Promise<Response> {
  const channels = await fetchGuildChannels(env, guildId);
  
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
  
  // Dropdown for Channel selection
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

async function handleComponent(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const customId = interaction.data.custom_id;
  const parts = customId.split('_');
  
  // Settings handlers
  if (parts[0] === 'settings') {
    const settingType = parts[1];
    const guildId = parts[2];
    
    if (settingType === 'back') {
      const config = await getGuildConfig(env, guildId);
      if (!config) {
        return respondWithEmbed({
          title: '❌ Error',
          description: 'Configuration not found',
          color: 0xff5555
        }, true);
      }
      return handleSettingsCommand(interaction, config, config.language);
    }
    
    return handleSettingsComponent(interaction, env, settingType, guildId);
  }
  
  // Setting value updates
  if (parts[0] === 'set' || parts[0] === 'toggle') {
    return handleSettingUpdate(interaction, env, parts);
  }
  
  // Setup wizard handlers
  if (parts.includes('setup')) {
    return handleSetupComponent(interaction, env, parts[0], parts[1], parts[2]);
  }
  
  // Channel selection
  if (parts[0] === 'select' && parts[1] === 'channel') {
    return handleChannelSelection(interaction, env, parts[2]);
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
    
    // Hole alle verfügbaren Kanäle vom Server
    const channels = await fetchGuildChannels(env, guildId);
    
    // Nächster Schritt: Kanal auswählen mit Dropdown
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
    
    // Dropdown für Channel-Auswahl
    if (channels && channels.length > 0) {
      const channelOptions = channels
        .filter(ch => 
          ch.type === 0 || // Text Channel
          ch.type === 5 || // Announcement Channel
          ch.type === 15   // Forum Channel
        )
        .slice(0, 25) // Discord limit: max 25 options
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
    
    // Buttons für Quick-Actions
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
  
  // Handler für Channel-Auswahl aus Dropdown
  if (action === 'select' && param === 'channel') {
    const selectedValue = interaction.data.values?.[0];
    if (!selectedValue) {
      return respondWithEmbed({
        title: '❌ Error',
        description: 'No channel selected',
        color: 0xff5555
      }, true);
    }
    
    // Extrahiere Channel-ID aus dem Value
    const channelId = selectedValue.replace('channel_', '');
    
    const tempConfig = await env.GUILD_CONFIGS.get(`temp_${guildId}`, 'json') as GuildConfig;
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
    const tempConfig = await env.GUILD_CONFIGS.get(`temp_${guildId}`, 'json') as GuildConfig;
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
  
  // [Rest des Codes bleibt gleich - store, finish, cancel actions...]
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
      footer: { text: 'PixelPost' },
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
    footer: { text: 'PixelPost' },
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
    footer: { text: 'PixelPost' },
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
          // Skip DLCs if not included in config
          if (game.isDLC && !guild.includeDLCs) {
            console.log(`⏭️ Skipping DLC: ${game.title} (DLCs disabled)`);
            continue;
          }

          const gameKey = `${store}-${game.id}`;
          
          if (!postedGames.includes(gameKey)) {
            console.log(`🆕 New free game: ${game.title} (${store})`);
            
            const embed = createGameEmbed(game, t, guild.language, guild.currency);
            
            // Get mentions based on config
            let mentions = '';
            
            // Check for store-specific role first
            if (guild.storeRoles && guild.storeRoles[store]) {
              mentions = `<@&${guild.storeRoles[store]}>`;
            } 
            // Otherwise use general roles
            else if (guild.mentionRoles.length > 0) {
              mentions = guild.mentionRoles.map(r => `<@&${r}>`).join(' ');
            }
            
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

function createGameEmbed(game: Game, t: any, lang: Language, currency: Currency): any {
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
  
  // Add DLC badge if applicable
  if (game.isDLC) {
    embed.title = `🎁 ${game.title} - DLC - ${t.free_title}`;
  }
  
  embed.fields.push({
    name: t.available_until,
    value: `<t:${endTimestamp}:F> (<t:${endTimestamp}:R>)`,
    inline: false
  });
  
  if (game.price && game.price.original > 0) {
    // Use the guild's preferred currency
    const priceFormatted = new Intl.NumberFormat(getLocaleForLanguage(lang), {
      style: 'currency',
      currency: currency
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

/**
 * Sendet eine Nachricht an einen Channel oder erstellt einen Forum-Post
 * @param env - Cloudflare Worker Environment
 * @param channelId - ID des Ziel-Channels
 * @param embed - Discord Embed Objekt
 * @param mentions - Optional: Rollen-Mentions
 * @returns Promise<boolean> - true bei Erfolg
 */
async function sendToChannel(env: Env, channelId: string, embed: any, mentions?: string): Promise<boolean> {
  try {
    // Prüfe ob es ein Forum-Channel ist
    const channelInfo = await getChannelInfo(env, channelId);
    
    if (channelInfo && channelInfo.type === 15) {
      // Forum Channel - erstelle neuen Thread/Post
      return await createForumPost(env, channelId, embed, mentions);
    } else {
      // Normaler Channel - sende normale Nachricht
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
    }
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
}

/**
 * Erstellt einen neuen Post in einem Forum-Channel
 * @param env - Cloudflare Worker Environment
 * @param forumChannelId - ID des Forum-Channels
 * @param embed - Discord Embed Objekt
 * @param mentions - Optional: Rollen-Mentions
 * @returns Promise<boolean> - true bei Erfolg
 */
async function createForumPost(env: Env, forumChannelId: string, embed: any, mentions?: string): Promise<boolean> {
  try {
    // Extrahiere Spiel-Titel aus dem Embed für den Thread-Namen
    const gameTitle = embed.title.replace('🎁 ', '').split(' - ')[0];
    
    // Kürze Titel falls zu lang (max 100 Zeichen für Thread-Namen)
    const threadName = gameTitle.length > 100 
      ? gameTitle.substring(0, 97) + '...'
      : gameTitle;
    
    const payload: any = {
      name: threadName,
      message: {
        embeds: [embed]
      },
      auto_archive_duration: 1440 // 24 Stunden
    };
    
    if (mentions) {
      payload.message.content = mentions;
    }
    
    const response = await fetch(`https://discord.com/api/v10/channels/${forumChannelId}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error creating forum post in ${forumChannelId}:`, errorText);
      return false;
    }
    
    const thread = await response.json();
    console.log(`✅ Created forum post: ${threadName} (ID: ${thread.id})`);
    
    return true;
  } catch (error) {
    console.error('Error creating forum post:', error);
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
    
    type GamerPowerResponse = GamerPowerGame[] | { status: number; message?: string };
    const data: GamerPowerResponse = await response.json();

    if (!Array.isArray(data)) {
        // Hier ist data das Status-Objekt
        if (data.status === 0) {
            return null;
        }
    }

    const games = data as GamerPowerGame[];
    
    // For Epic Games, also fetch from Epic's official API for enhanced data
    if (store === 'epic') {
      const epicGames = await getEpicGamesOfficial();
      if (epicGames && epicGames.length > 0) {
        return mergeEpicGames(parseGamerPowerGames(games, store), epicGames);
      }
    }
    
    return parseGamerPowerGames(games, store);
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
    storeThreads: existing?.storeThreads || {},
    reactions: existing?.reactions !== undefined ? existing.reactions : true,
    currency: existing?.currency || 'USD',
    includeDLCs: existing?.includeDLCs !== undefined ? existing.includeDLCs : true,
    storeRoles: existing?.storeRoles || {}
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

async function updateCurrency(env: Env, guildId: string, currency: Currency): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.currency = currency;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function toggleDLCs(env: Env, guildId: string): Promise<boolean> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.includeDLCs = !config.includeDLCs;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
    return config.includeDLCs;
  }
  return false;
}

async function toggleReactions(env: Env, guildId: string): Promise<boolean> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.reactions = !config.reactions;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
    return config.reactions;
  }
  return false;
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

async function clearMentionRoles(env: Env, guildId: string): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.mentionRoles = [];
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function setStoreRole(env: Env, guildId: string, store: StoreType, roleId: string): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    if (!config.storeRoles) {
      config.storeRoles = {};
    }
    config.storeRoles[store] = roleId;
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function removeStoreRole(env: Env, guildId: string, store: StoreType): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config && config.storeRoles) {
    delete config.storeRoles[store];
    await env.GUILD_CONFIGS.put(guildId, JSON.stringify(config));
  }
}

async function updateChannel(env: Env, guildId: string, channelId: string): Promise<void> {
  const config = await getGuildConfig(env, guildId);
  if (config) {
    config.channelId = channelId;
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
// HELPER FUNCTIONS FÜR CHANNEL-AUSWAHL
// ============================================================================

/**
 * Ruft alle Channels eines Servers ab
 * @param env - Cloudflare Worker Environment
 * @param guildId - ID des Servers
 * @returns Promise<any[]> - Array von Channel-Objekten
 */
async function fetchGuildChannels(env: Env, guildId: string): Promise<any[]> {
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`
      }
    });
    
    if (!response.ok) {
      console.error('Error fetching guild channels:', await response.text());
      return [];
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching channels:', error);
    return [];
  }
}

/**
 * Ruft Informationen über einen Channel ab
 * @param env - Cloudflare Worker Environment
 * @param channelId - ID des Channels
 * @returns Promise<any> - Channel-Objekt oder null
 */
async function getChannelInfo(env: Env, channelId: string): Promise<any> {
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`
      }
    });
    
    if (!response.ok) {
      console.error('Error fetching channel info:', await response.text());
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting channel info:', error);
    return null;
  }
}

/**
 * Formatiert den Channel-Namen für die Anzeige im Dropdown
 * @param channel - Discord Channel Objekt
 * @returns string - Formatierter Label
 */
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

/**
 * Erstellt eine Beschreibung für den Channel im Dropdown
 * @param channel - Discord Channel Objekt
 * @returns string - Beschreibungstext
 */
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

/**
 * Gibt das passende Emoji für einen Channel-Typ zurück
 * @param channel - Discord Channel Objekt
 * @returns object - Emoji-Objekt für Discord
 */
function getChannelEmoji(channel: any): { name: string } {
  const emojis: Record<number, string> = {
    0: '💬',     // Text Channel
    5: '📢',     // Announcement Channel
    15: '💭'     // Forum Channel
  };
  
  return { name: emojis[channel.type] || '📝' };
}

async function proceedToStoreSelection(tempConfig: GuildConfig, env: Env, guildId: string): Promise<Response> {
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

// ============================================================================
// COOLDOWN MANAGEMENT
// ============================================================================

const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

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
 * Multi-Store PixelPost für Cloudflare Workers (TypeScript)
 * Vollständig überarbeitete Version mit verbesserter UX
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
  mentionRoles: string[]; // General notification role
  storeRoles?: { [key in StoreType]?: string }; // Store-specific roles
  separateThreads: boolean;
  storeThreads?: { [key in StoreType]?: string };
  reactions: boolean; // Enable/disable reaction voting
  currency: Currency;
  includeDLCs: boolean; // Include DLCs or only games
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
    
    return new Response('🎮 PixelPost is running!', { status: 200 });
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
  epic: 0x2B2D31,
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
    help_description: 'Here are all available commands for the PixelPost:',
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
    check_running_title: 'Checking for Games',
    check_running: 'Searching for new free games... This may take up to 30 seconds.',
    check_complete: '✅ Check complete! New games have been posted if available.',
    
    // Other
    unknown_command: '❌ Unknown command',
    error_occurred: 'An error occurred',

    // Settings Main
    settings_title: 'Bot Settings',
    settings_description: 'Configure all bot settings from here. Click a button below to customize a specific setting.',
    settings_currency: 'Currency',
    settings_notification_roles: 'Notification Roles',
    settings_reactions: 'Reaction Voting',
    settings_dlcs: 'DLC Posts',
    settings_include_dlcs: 'Include DLCs',
    settings_games_only: 'Games Only',
    
    // Settings Buttons
    settings_btn_general: 'General',
    settings_btn_stores: 'Stores',
    settings_btn_language: 'Language',
    settings_btn_roles: 'Roles',
    settings_btn_channel: 'Channel',
    settings_btn_reactions: 'Reactions',
    
    // General Settings
    settings_general_title: 'General Settings',
    settings_general_desc: 'Configure currency display and content preferences.',
    settings_toggle_dlcs: 'Toggle DLC Posts',
    
    // Store Settings
    settings_stores_title: 'Store Configuration',
    settings_stores_desc: 'Select which game stores to monitor for free games.',
    
    // Language Settings
    settings_language_title: 'Language Settings',
    settings_language_desc: 'Choose your preferred language for bot messages.',
    current_language: 'Current Language',
    
    // Role Settings
    settings_roles_title: 'Notification Roles',
    settings_roles_desc: 'Configure which roles to mention when posting free games.',
    settings_general_role: 'General Notification Role',
    settings_store_roles: 'Store-Specific Roles',
    settings_add_general_role: 'Add General Role',
    settings_clear_general_roles: 'Clear All Roles',
    settings_configure_store_roles: 'Configure Store Roles',
    
    // Channel Settings
    settings_channel_title: 'Channel Configuration',
    settings_channel_desc: 'Select where the bot should post free game announcements.',
    current_channel: 'Current Channel',
    
    // Reaction Settings
    settings_reactions_title: 'Reaction Voting',
    settings_reactions_desc: 'Enable or disable reaction voting on game posts.',
    settings_reactions_info: 'When enabled, the bot will add 🔥 (hot deal) and ❄️ (not interested) reactions to each post, allowing users to vote.',
    current_status: 'Current Status',
    
    // Common
    back: 'Back',
    enabled: 'Enabled',
    disabled: 'Disabled',
    enable: 'Enable',
    disable: 'Disable',
    info: 'Information',
    
    // Check Command
    check_cooldown_title: 'Command on Cooldown',
    check_cooldown_desc: 'This command can only be used once per hour. Please try again in: ',
  },
  
  de: {
    // Setup Wizard
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
    help_description: 'Hier sind alle verfügbaren Befehle für den PixelPost:',
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
    check_running_title: 'Prüfe auf Spiele',
    check_running: 'Suche nach neuen kostenlosen Spielen... Dies kann bis zu 30 Sekunden dauern.',
    check_complete: '✅ Prüfung abgeschlossen! Neue Spiele wurden gepostet, falls verfügbar.',
    
    // Other
    unknown_command: '❌ Unbekannter Befehl',
    error_occurred: 'Ein Fehler ist aufgetreten',

    // Settings Main
    settings_title: 'Bot-Einstellungen',
    settings_description: 'Konfiguriere alle Bot-Einstellungen von hier aus. Klicke auf eine Schaltfläche unten, um eine bestimmte Einstellung anzupassen.',
    settings_currency: 'Währung',
    settings_notification_roles: 'Benachrichtigungsrollen',
    settings_reactions: 'Reaktions-Abstimmung',
    settings_dlcs: 'DLC-Beiträge',
    settings_include_dlcs: 'DLCs einschließen',
    settings_games_only: 'Nur Spiele',
    
    // Settings Buttons
    settings_btn_general: 'Allgemein',
    settings_btn_stores: 'Stores',
    settings_btn_language: 'Sprache',
    settings_btn_roles: 'Rollen',
    settings_btn_channel: 'Kanal',
    settings_btn_reactions: 'Reaktionen',
    
    // General Settings
    settings_general_title: 'Allgemeine Einstellungen',
    settings_general_desc: 'Konfiguriere Währungsanzeige und Inhaltseinstellungen.',
    settings_toggle_dlcs: 'DLC-Beiträge umschalten',
    
    // Store Settings
    settings_stores_title: 'Store-Konfiguration',
    settings_stores_desc: 'Wähle aus, welche Game-Stores auf kostenlose Spiele überwacht werden sollen.',
    
    // Language Settings
    settings_language_title: 'Spracheinstellungen',
    settings_language_desc: 'Wähle deine bevorzugte Sprache für Bot-Nachrichten.',
    current_language: 'Aktuelle Sprache',
    
    // Role Settings
    settings_roles_title: 'Benachrichtigungsrollen',
    settings_roles_desc: 'Konfiguriere, welche Rollen beim Posten kostenloser Spiele erwähnt werden sollen.',
    settings_general_role: 'Allgemeine Benachrichtigungsrolle',
    settings_store_roles: 'Store-spezifische Rollen',
    settings_add_general_role: 'Allgemeine Rolle hinzufügen',
    settings_clear_general_roles: 'Alle Rollen löschen',
    settings_configure_store_roles: 'Store-Rollen konfigurieren',
    
    // Channel Settings
    settings_channel_title: 'Kanal-Konfiguration',
    settings_channel_desc: 'Wähle aus, wo der Bot kostenlose Spiele ankündigen soll.',
    current_channel: 'Aktueller Kanal',
    
    // Reaction Settings
    settings_reactions_title: 'Reaktions-Abstimmung',
    settings_reactions_desc: 'Aktiviere oder deaktiviere Reaktions-Abstimmungen bei Spiele-Posts.',
    settings_reactions_info: 'Wenn aktiviert, fügt der Bot 🔥 (heißes Angebot) und ❄️ (nicht interessiert) Reaktionen zu jedem Beitrag hinzu, damit Nutzer abstimmen können.',
    current_status: 'Aktueller Status',
    
    // Common
    back: 'Zurück',
    enabled: 'Aktiviert',
    disabled: 'Deaktiviert',
    enable: 'Aktivieren',
    disable: 'Deaktivieren',
    info: 'Information',
    
    // Check Command
    check_cooldown_title: 'Befehl im Cooldown',
    check_cooldown_desc: 'Dieser Befehl kann nur einmal pro Stunde verwendet werden. Bitte versuche es erneut in: ',
  },
  
  fr: {
    setup_wizard_title: 'Assistant de configuration',
    setup_wizard_desc: 'Bienvenue sur PixelPost! Configurons tout en quelques étapes.',
    setup_step_language: 'Veuillez sélectionner votre langue préférée:',
    setup_step_channel: 'Sélectionner le canal',
    select_channel_placeholder: 'Choisir un canal...',
    setup_channel_instructions: 'Où dois-je publier les jeux gratuits? Sélectionnez un canal dans le menu déroulant ou utilisez le canal actuel.',
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
    help_description: 'Voici toutes les commandes disponibles pour PixelPost:',
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
    check_running_title: 'Vérification des jeux',
    check_running: 'Recherche de nouveaux jeux gratuits... Cela peut prendre jusqu\'à 30 secondes.',
    check_complete: '✅ Vérification terminée! De nouveaux jeux ont été publiés s\'ils sont disponibles.',
    unknown_command: '❌ Commande inconnue',
    error_occurred: 'Une erreur s\'est produite',
    settings_title: 'Paramètres du bot',
    settings_description: 'Configurez tous les paramètres du bot à partir d\'ici. Cliquez sur un bouton ci-dessous pour personnaliser un paramètre spécifique.',
    settings_currency: 'Devise',
    settings_notification_roles: 'Rôles de notification',
    settings_reactions: 'Vote par réactions',
    settings_dlcs: 'Publications DLC',
    settings_include_dlcs: 'Inclure les DLC',
    settings_games_only: 'Jeux uniquement',
    settings_btn_general: 'Général',
    settings_btn_stores: 'Magasins',
    settings_btn_language: 'Langue',
    settings_btn_roles: 'Rôles',
    settings_btn_channel: 'Canal',
    settings_btn_reactions: 'Réactions',
    settings_general_title: 'Paramètres généraux',
    settings_general_desc: 'Configurez l\'affichage de la devise et les préférences de contenu.',
    settings_toggle_dlcs: 'Basculer les publications DLC',
    settings_stores_title: 'Configuration des magasins',
    settings_stores_desc: 'Sélectionnez les magasins de jeux à surveiller pour les jeux gratuits.',
    settings_language_title: 'Paramètres de langue',
    settings_language_desc: 'Choisissez votre langue préférée pour les messages du bot.',
    current_language: 'Langue actuelle',
    settings_roles_title: 'Rôles de notification',
    settings_roles_desc: 'Configurez les rôles à mentionner lors de la publication de jeux gratuits.',
    settings_general_role: 'Rôle de notification général',
    settings_store_roles: 'Rôles spécifiques aux magasins',
    settings_add_general_role: 'Ajouter un rôle général',
    settings_clear_general_roles: 'Effacer tous les rôles',
    settings_configure_store_roles: 'Configurer les rôles de magasin',
    settings_channel_title: 'Configuration du canal',
    settings_channel_desc: 'Sélectionnez où le bot doit publier les annonces de jeux gratuits.',
    current_channel: 'Canal actuel',
    settings_reactions_title: 'Vote par réactions',
    settings_reactions_desc: 'Activer ou désactiver le vote par réactions sur les publications de jeux.',
    settings_reactions_info: 'Lorsqu\'il est activé, le bot ajoutera des réactions 🔥 (bonne affaire) et ❄️ (pas intéressé) à chaque publication, permettant aux utilisateurs de voter.',
    current_status: 'Statut actuel',
    back: 'Retour',
    enabled: 'Activé',
    disabled: 'Désactivé',
    enable: 'Activer',
    disable: 'Désactiver',
    info: 'Information',
    check_cooldown_title: 'Commande en temps de recharge',
    check_cooldown_desc: 'Cette commande ne peut être utilisée qu\'une fois par heure. Réessayez dans : ',
  },
  
  es: {
    setup_wizard_title: 'Asistente de configuración',
    setup_wizard_desc: '¡Bienvenido a PixelPost! Configuremos todo en pocos pasos.',
    setup_step_language: 'Por favor, selecciona tu idioma preferido:',
    setup_step_channel: 'Seleccionar canal',
    select_channel_placeholder: 'Elegir un canal...',
    setup_channel_instructions: '¿Dónde debo publicar juegos gratis? Selecciona un canal del menú desplegable o usa el canal actual.',
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
    help_description: 'Aquí están todos los comandos disponibles para PixelPost:',
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
    check_running_title: 'Buscando juegos',
    check_running: 'Buscando nuevos juegos gratis... Esto puede tardar hasta 30 segundos.',
    check_complete: '✅ ¡Verificación completa! Se han publicado nuevos juegos si están disponibles.',
    unknown_command: '❌ Comando desconocido',
    error_occurred: 'Ocurrió un error',
    settings_title: 'Configuración del bot',
    settings_description: 'Configure todos los ajustes del bot desde aquí. Haga clic en un botón a continuación para personalizar un ajuste específico.',
    settings_currency: 'Moneda',
    settings_notification_roles: 'Roles de notificación',
    settings_reactions: 'Votación por reacciones',
    settings_dlcs: 'Publicaciones de DLC',
    settings_include_dlcs: 'Incluir DLCs',
    settings_games_only: 'Solo juegos',
    settings_btn_general: 'General',
    settings_btn_stores: 'Tiendas',
    settings_btn_language: 'Idioma',
    settings_btn_roles: 'Roles',
    settings_btn_channel: 'Canal',
    settings_btn_reactions: 'Reacciones',
    settings_general_title: 'Configuración general',
    settings_general_desc: 'Configure la visualización de moneda y las preferencias de contenido.',
    settings_toggle_dlcs: 'Alternar publicaciones de DLC',
    settings_stores_title: 'Configuración de tiendas',
    settings_stores_desc: 'Seleccione qué tiendas de juegos monitorear para juegos gratis.',
    settings_language_title: 'Configuración de idioma',
    settings_language_desc: 'Elija su idioma preferido para los mensajes del bot.',
    current_language: 'Idioma actual',
    settings_roles_title: 'Roles de notificación',
    settings_roles_desc: 'Configure qué roles mencionar al publicar juegos gratis.',
    settings_general_role: 'Rol de notificación general',
    settings_store_roles: 'Roles específicos de tienda',
    settings_add_general_role: 'Agregar rol general',
    settings_clear_general_roles: 'Borrar todos los roles',
    settings_configure_store_roles: 'Configurar roles de tienda',
    settings_channel_title: 'Configuración de canal',
    settings_channel_desc: 'Seleccione dónde el bot debe publicar anuncios de juegos gratis.',
    current_channel: 'Canal actual',
    settings_reactions_title: 'Votación por reacciones',
    settings_reactions_desc: 'Activar o desactivar votación por reacciones en publicaciones de juegos.',
    settings_reactions_info: 'Cuando está activado, el bot agregará reacciones 🔥 (buena oferta) y ❄️ (no interesado) a cada publicación, permitiendo a los usuarios votar.',
    current_status: 'Estado actual',
    back: 'Atrás',
    enabled: 'Activado',
    disabled: 'Desactivado',
    enable: 'Activar',
    disable: 'Desactivar',
    info: 'Información',
    check_cooldown_title: 'Comando en tiempo de espera',
    check_cooldown_desc: 'Este comando solo se puede usar una vez por hora. Inténtelo de nuevo en: ',
  },
  
  it: {
    setup_wizard_title: 'Assistente di configurazione',
    setup_wizard_desc: 'Benvenuto in PixelPost! Configuriamo tutto in pochi passaggi.',
    setup_step_language: 'Seleziona la tua lingua preferita:',
    setup_step_channel: 'Seleziona canale',
    select_channel_placeholder: 'Scegli un canale...',
    setup_channel_instructions: 'Dove devo pubblicare i giochi gratis? Seleziona un canale dal menu a tendina o usa il canale attuale.',
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
    help_description: 'Ecco tutti i comandi disponibili per PixelPost:',
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
    check_running_title: 'Ricerca giochi',
    check_running: 'Ricerca di nuovi giochi gratis... Potrebbe richiedere fino a 30 secondi.',
    check_complete: '✅ Verifica completata! Nuovi giochi sono stati pubblicati se disponibili.',
    unknown_command: '❌ Comando sconosciuto',
    error_occurred: 'Si è verificato un errore',
    settings_title: 'Impostazioni Bot',
    settings_description: 'Configura tutte le impostazioni del bot da qui. Fai clic su un pulsante qui sotto per personalizzare un\'impostazione specifica.',
    settings_currency: 'Valuta',
    settings_notification_roles: 'Ruoli di notifica',
    settings_reactions: 'Votazione con reazioni',
    settings_dlcs: 'Post DLC',
    settings_include_dlcs: 'Includi DLC',
    settings_games_only: 'Solo giochi',
    settings_btn_general: 'Generale',
    settings_btn_stores: 'Negozi',
    settings_btn_language: 'Lingua',
    settings_btn_roles: 'Ruoli',
    settings_btn_channel: 'Canale',
    settings_btn_reactions: 'Reazioni',
    settings_general_title: 'Impostazioni generali',
    settings_general_desc: 'Configura la visualizzazione della valuta e le preferenze dei contenuti.',
    settings_toggle_dlcs: 'Attiva/disattiva post DLC',
    settings_stores_title: 'Configurazione negozi',
    settings_stores_desc: 'Seleziona quali negozi di giochi monitorare per i giochi gratis.',
    settings_language_title: 'Impostazioni lingua',
    settings_language_desc: 'Scegli la tua lingua preferita per i messaggi del bot.',
    current_language: 'Lingua attuale',
    settings_roles_title: 'Ruoli di notifica',
    settings_roles_desc: 'Configura quali ruoli menzionare quando si pubblicano giochi gratis.',
    settings_general_role: 'Ruolo di notifica generale',
    settings_store_roles: 'Ruoli specifici per negozio',
    settings_add_general_role: 'Aggiungi ruolo generale',
    settings_clear_general_roles: 'Cancella tutti i ruoli',
    settings_configure_store_roles: 'Configura ruoli negozio',
    settings_channel_title: 'Configurazione canale',
    settings_channel_desc: 'Seleziona dove il bot deve pubblicare gli annunci di giochi gratis.',
    current_channel: 'Canale attuale',
    settings_reactions_title: 'Votazione con reazioni',
    settings_reactions_desc: 'Abilita o disabilita la votazione con reazioni sui post dei giochi.',
    settings_reactions_info: 'Quando abilitato, il bot aggiungerà reazioni 🔥 (offerta interessante) e ❄️ (non interessato) a ogni post, permettendo agli utenti di votare.',
    current_status: 'Stato attuale',
    back: 'Indietro',
    enabled: 'Abilitato',
    disabled: 'Disabilitato',
    enable: 'Abilita',
    disable: 'Disabilita',
    info: 'Informazioni',
    check_cooldown_title: 'Comando in cooldown',
    check_cooldown_desc: 'Questo comando può essere utilizzato solo una volta all\'ora. Riprova tra: ',
  },
  
  pt: {
    setup_wizard_title: 'Assistente de configuração',
    setup_wizard_desc: 'Bem-vindo ao PixelPost! Vamos configurar tudo em poucos passos.',
    setup_step_language: 'Por favor, selecione seu idioma preferido:',
    setup_step_channel: 'Selecionar canal',
    select_channel_placeholder: 'Escolher um canal...',
    setup_channel_instructions: 'Onde devo postar jogos grátis? Selecione um canal no menu suspenso ou use o canal atual.',
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
    help_description: 'Aqui estão todos os comandos disponíveis para o PixelPost:',
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
    check_running_title: 'Procurando jogos',
    check_running: 'Procurando por novos jogos grátis... Isso pode levar até 30 segundos.',
    check_complete: '✅ Verificação concluída! Novos jogos foram postados se disponíveis.',
    unknown_command: '❌ Comando desconhecido',
    error_occurred: 'Ocorreu um erro',
    settings_title: 'Configurações do Bot',
    settings_description: 'Configure todas as configurações do bot aqui. Clique em um botão abaixo para personalizar uma configuração específica.',
    settings_currency: 'Moeda',
    settings_notification_roles: 'Cargos de notificação',
    settings_reactions: 'Votação por reações',
    settings_dlcs: 'Posts de DLC',
    settings_include_dlcs: 'Incluir DLCs',
    settings_games_only: 'Apenas jogos',
    settings_btn_general: 'Geral',
    settings_btn_stores: 'Lojas',
    settings_btn_language: 'Idioma',
    settings_btn_roles: 'Cargos',
    settings_btn_channel: 'Canal',
    settings_btn_reactions: 'Reações',
    settings_general_title: 'Configurações gerais',
    settings_general_desc: 'Configure a exibição de moeda e preferências de conteúdo.',
    settings_toggle_dlcs: 'Alternar posts de DLC',
    settings_stores_title: 'Configuração de lojas',
    settings_stores_desc: 'Selecione quais lojas de jogos monitorar para jogos grátis.',
    settings_language_title: 'Configurações de idioma',
    settings_language_desc: 'Escolha seu idioma preferido para mensagens do bot.',
    current_language: 'Idioma atual',
    settings_roles_title: 'Cargos de notificação',
    settings_roles_desc: 'Configure quais cargos mencionar ao postar jogos grátis.',
    settings_general_role: 'Cargo de notificação geral',
    settings_store_roles: 'Cargos específicos de loja',
    settings_add_general_role: 'Adicionar cargo geral',
    settings_clear_general_roles: 'Limpar todos os cargos',
    settings_configure_store_roles: 'Configurar cargos de loja',
    settings_channel_title: 'Configuração de canal',
    settings_channel_desc: 'Selecione onde o bot deve postar anúncios de jogos grátis.',
    current_channel: 'Canal atual',
    settings_reactions_title: 'Votação por reações',
    settings_reactions_desc: 'Ativar ou desativar votação por reações em posts de jogos.',
    settings_reactions_info: 'Quando ativado, o bot adicionará reações 🔥 (ótima oferta) e ❄️ (não interessado) a cada post, permitindo que os usuários votem.',
    current_status: 'Status atual',
    back: 'Voltar',
    enabled: 'Ativado',
    disabled: 'Desativado',
    enable: 'Ativar',
    disable: 'Desativar',
    info: 'Informação',
    check_cooldown_title: 'Comando em cooldown',
    check_cooldown_desc: 'Este comando só pode ser usado uma vez por hora. Tente novamente em: ',
  },
  
  ru: {
    setup_wizard_title: 'Мастер настройки',
    setup_wizard_desc: 'Добро пожаловать в PixelPost! Давайте все настроим за несколько шагов.',
    setup_step_language: 'Пожалуйста, выберите предпочитаемый язык:',
    setup_step_channel: 'Выбрать канал',
    select_channel_placeholder: 'Выбрать канал...',
    setup_channel_instructions: 'Где мне публиковать бесплатные игры? Выберите канал из выпадающего меню или используйте текущий канал.',
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
    help_description: 'Вот все доступные команды для PixelPost:',
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
    check_running_title: 'Проверка игр',
    check_running: 'Поиск новых бесплатных игр... Это может занять до 30 секунд.',
    check_complete: '✅ Проверка завершена! Новые игры были опубликованы, если доступны.',
    unknown_command: '❌ Неизвестная команда',
    error_occurred: 'Произошла ошибка',
    settings_title: 'Настройки бота',
    settings_description: 'Настройте все параметры бота отсюда. Нажмите на кнопку ниже, чтобы настроить определенный параметр.',
    settings_currency: 'Валюта',
    settings_notification_roles: 'Роли уведомлений',
    settings_reactions: 'Голосование реакциями',
    settings_dlcs: 'Посты DLC',
    settings_include_dlcs: 'Включить DLC',
    settings_games_only: 'Только игры',
    settings_btn_general: 'Общие',
    settings_btn_stores: 'Магазины',
    settings_btn_language: 'Язык',
    settings_btn_roles: 'Роли',
    settings_btn_channel: 'Канал',
    settings_btn_reactions: 'Реакции',
    settings_general_title: 'Общие настройки',
    settings_general_desc: 'Настройте отображение валюты и предпочтения контента.',
    settings_toggle_dlcs: 'Переключить посты DLC',
    settings_stores_title: 'Конфигурация магазинов',
    settings_stores_desc: 'Выберите, какие игровые магазины отслеживать для бесплатных игр.',
    settings_language_title: 'Настройки языка',
    settings_language_desc: 'Выберите предпочитаемый язык для сообщений бота.',
    current_language: 'Текущий язык',
    settings_roles_title: 'Роли уведомлений',
    settings_roles_desc: 'Настройте, какие роли упоминать при публикации бесплатных игр.',
    settings_general_role: 'Общая роль уведомлений',
    settings_store_roles: 'Роли для конкретных магазинов',
    settings_add_general_role: 'Добавить общую роль',
    settings_clear_general_roles: 'Очистить все роли',
    settings_configure_store_roles: 'Настроить роли магазинов',
    settings_channel_title: 'Конфигурация канала',
    settings_channel_desc: 'Выберите, где бот должен публиковать объявления о бесплатных играх.',
    current_channel: 'Текущий канал',
    settings_reactions_title: 'Голосование реакциями',
    settings_reactions_desc: 'Включить или отключить голосование реакциями на постах с играми.',
    settings_reactions_info: 'Когда включено, бот добавит реакции 🔥 (горячее предложение) и ❄️ (не интересно) к каждому посту, позволяя пользователям голосовать.',
    current_status: 'Текущий статус',
    back: 'Назад',
    enabled: 'Включено',
    disabled: 'Отключено',
    enable: 'Включить',
    disable: 'Отключить',
    info: 'Информация',
    check_cooldown_title: 'Команда на перезарядке',
    check_cooldown_desc: 'Эту команду можно использовать только один раз в час. Попробуйте снова через: ',
  },
  
  pl: {
    setup_wizard_title: 'Kreator konfiguracji',
    setup_wizard_desc: 'Witaj w PixelPost! Skonfigurujmy wszystko w kilku krokach.',
    setup_step_language: 'Wybierz preferowany język:',
    setup_step_channel: 'Wybierz kanał',
    select_channel_placeholder: 'Wybierz kanał...',
    setup_channel_instructions: 'Gdzie mam publikować darmowe gry? Wybierz kanał z menu rozwijanego lub użyj bieżącego kanału.',
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
    help_description: 'Oto wszystkie dostępne komendy dla PixelPost:',
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
    check_running_title: 'Sprawdzanie gier',
    check_running: 'Wyszukiwanie nowych darmowych gier... Może to potrwać do 30 sekund.',
    check_complete: '✅ Sprawdzanie zakończone! Nowe gry zostały opublikowane, jeśli są dostępne.',
    unknown_command: '❌ Nieznana komenda',
    error_occurred: 'Wystąpił błąd',
    settings_title: 'Ustawienia bota',
    settings_description: 'Skonfiguruj wszystkie ustawienia bota stąd. Kliknij przycisk poniżej, aby dostosować określone ustawienie.',
    settings_currency: 'Waluta',
    settings_notification_roles: 'Role powiadomień',
    settings_reactions: 'Głosowanie reakcjami',
    settings_dlcs: 'Posty DLC',
    settings_include_dlcs: 'Uwzględnij DLC',
    settings_games_only: 'Tylko gry',
    settings_btn_general: 'Ogólne',
    settings_btn_stores: 'Sklepy',
    settings_btn_language: 'Język',
    settings_btn_roles: 'Role',
    settings_btn_channel: 'Kanał',
    settings_btn_reactions: 'Reakcje',
    settings_general_title: 'Ustawienia ogólne',
    settings_general_desc: 'Skonfiguruj wyświetlanie waluty i preferencje treści.',
    settings_toggle_dlcs: 'Przełącz posty DLC',
    settings_stores_title: 'Konfiguracja sklepów',
    settings_stores_desc: 'Wybierz, które sklepy z grami monitorować w poszukiwaniu darmowych gier.',
    settings_language_title: 'Ustawienia języka',
    settings_language_desc: 'Wybierz preferowany język dla wiadomości bota.',
    current_language: 'Bieżący język',
    settings_roles_title: 'Role powiadomień',
    settings_roles_desc: 'Skonfiguruj, które role wspominać podczas publikowania darmowych gier.',
    settings_general_role: 'Ogólna rola powiadomień',
    settings_store_roles: 'Role specyficzne dla sklepu',
    settings_add_general_role: 'Dodaj ogólną rolę',
    settings_clear_general_roles: 'Wyczyść wszystkie role',
    settings_configure_store_roles: 'Skonfiguruj role sklepów',
    settings_channel_title: 'Konfiguracja kanału',
    settings_channel_desc: 'Wybierz, gdzie bot powinien publikować ogłoszenia o darmowych grach.',
    current_channel: 'Bieżący kanał',
    settings_reactions_title: 'Głosowanie reakcjami',
    settings_reactions_desc: 'Włącz lub wyłącz głosowanie reakcjami na postach z grami.',
    settings_reactions_info: 'Gdy włączone, bot doda reakcje 🔥 (gorąca oferta) i ❄️ (nie zainteresowany) do każdego postu, pozwalając użytkownikom głosować.',
    current_status: 'Bieżący status',
    back: 'Wstecz',
    enabled: 'Włączone',
    disabled: 'Wyłączone',
    enable: 'Włącz',
    disable: 'Wyłącz',
    info: 'Informacja',
    check_cooldown_title: 'Komenda w czasie odnowienia',
    check_cooldown_desc: 'Tej komendy można użyć tylko raz na godzinę. Spróbuj ponownie za: ',
  },
};