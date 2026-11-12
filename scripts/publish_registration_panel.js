const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const {
  createRegistrationPanelEmbed,
  createRegistrationPanelButtons
} = require('../src/ui/panels');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const REGISTRO_CHANNEL_ID = '1561700298362462238';

client.on('ready', async () => {
  try {
    const guild = await client.guilds.fetch('1561462359124480042');
    const ch = await guild.channels.fetch(REGISTRO_CHANNEL_ID).catch(() => null);

    if (!ch) {
      console.error('Canal de registro não encontrado!');
      process.exit(1);
    }

    console.log('[REGISTRO] Configurando permissões de #📄registro...');
    const everyoneRole = guild.roles.everyone;

    // Garante que everyone veja o canal, leia histórico, não envie msg no chat raiz, mas envie em threads
    await ch.permissionOverwrites.edit(everyoneRole, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
      SendMessagesInThreads: true
    });

    console.log('[REGISTRO] Limpando mensagens antigas...');
    await ch.bulkDelete(100, true).catch(() => {});
    const remaining = await ch.messages.fetch({ limit: 10 });
    for (const msg of remaining.values()) {
      await msg.delete().catch(() => {});
    }

    console.log('[REGISTRO] Enviando Painel Oficial de Alistamento...');
    await ch.send({
      embeds: [createRegistrationPanelEmbed()],
      components: createRegistrationPanelButtons()
    });

    console.log('[SUCESSO] Painel de Alistamento publicado em #📄registro!');
  } catch (err) {
    console.error('Erro:', err);
  }
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
