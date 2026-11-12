const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once('clientReady', async () => {
  console.log(`[BOT] Conectado como ${client.user.tag} (ID: ${client.user.id})`);

  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    if (!guild) {
      console.error(`[ERRO] Guild ${process.env.GUILD_ID} não encontrada.`);
      process.exit(1);
    }

    console.log(`[GUILD] Conectado na guilda: "${guild.name}" (ID: ${guild.id})`);

    // Listar cargos relevantes
    const roles = await guild.roles.fetch();
    console.log(`\n--- Cargos na Guilda ---`);
    roles.forEach(r => {
      if (r.name !== '@everyone') {
        console.log(`Cargo: ${r.name} | ID: ${r.id} | Admin: ${r.permissions.has(PermissionFlagsBits.Administrator)}`);
      }
    });

    // Encontrar cargos de staff ou admin
    const staffRoles = roles.filter(r => 
      r.permissions.has(PermissionFlagsBits.Administrator) ||
      r.permissions.has(PermissionFlagsBits.ManageGuild) ||
      r.name.toLowerCase().includes('staff') ||
      r.name.toLowerCase().includes('lider') ||
      r.name.toLowerCase().includes('oficial')
    );

    console.log(`\n[STAFF] Cargos identificados com acesso à Staff:`, staffRoles.map(r => r.name).join(', '));

    // Permission overwrites para a categoria de teste:
    // Oculto para @everyone (ViewChannel: false)
    // Visível para o bot e cargos de Staff/Admin
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ];

    // Adiciona os cargos de staff identificados
    staffRoles.forEach(r => {
      permissionOverwrites.push({
        id: r.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    });

    console.log('\n[CRIANDO CANAIS] Criando categoria oculta de testes...');

    // Cria a categoria no final
    const category = await guild.channels.create({
      name: '🔒 TESTES NOOMERCY DKP',
      type: ChannelType.GuildCategory,
      permissionOverwrites
    });

    console.log(`[OK] Categoria criada: ${category.name} (ID: ${category.id})`);

    const channelDefs = [
      { name: 'painel-membros', type: ChannelType.GuildText, topic: 'Painel interativo de membros (Consultas, Simulação, Ranks)' },
      { name: 'atualizacao-cp', type: ChannelType.GuildText, topic: 'Envio semanal de CP, Nível, Classe e Print' },
      { name: 'auditoria-cp', type: ChannelType.GuildText, topic: 'Validação da Staff para envios de CP semanal' },
      { name: 'justificar-ausencia', type: ChannelType.GuildText, topic: 'Registro e justificativa de ausência em eventos' },
      { name: 'contestacao-presenca', type: ChannelType.GuildText, topic: 'Pedidos de revisão de presença com print de prova' },
      { name: 'auditoria-presencas', type: ChannelType.GuildText, topic: 'Validação da Staff para presenças contestadas' },
      { name: 'leilao-drops', type: ChannelType.GuildText, topic: 'Leilões de DKP abertos com sistema de DKP Lock' },
      { name: 'comando-staff', type: ChannelType.GuildText, topic: 'Painel de controle para a liderança e oficiais' },
      { name: 'logs-dkp', type: ChannelType.GuildText, topic: 'Histórico de transações, lances, créditos e reset mensal' },
      { name: '🔊-boss-auditorio', type: ChannelType.GuildVoice }
    ];

    const createdChannels = {};

    for (const def of channelDefs) {
      const ch = await guild.channels.create({
        name: def.name,
        type: def.type,
        parent: category.id,
        topic: def.topic || undefined
      });
      createdChannels[def.name] = ch.id;
      console.log(` - Canal criado: #${ch.name} (ID: ${ch.id})`);
    }

    // Salvar configuração dos canais criados
    const fs = require('fs');
    const configPath = './discord_channels.json';
    const configData = {
      guildId: guild.id,
      guildName: guild.name,
      categoryId: category.id,
      channels: createdChannels,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

    console.log(`\n[SUCESSO] Todos os canais foram criados e salvos em ${configPath}!`);
    process.exit(0);
  } catch (error) {
    console.error('[ERRO FATAL]', error);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
