const { Client, GatewayIntentBits } = require('discord.js');
const { channels } = require('./config/channels');
const {
  createMemberPanelEmbed,
  createMemberPanelButtons,
  createCpUpdatePanelEmbed,
  createCpUpdatePanelButtons,
  createAbsencePanelEmbed,
  createAbsencePanelButtons,
  createDisputePanelEmbed,
  createDisputePanelButtons,
  createStaffPanelEmbed,
  createStaffPanelButtons
} = require('./ui/panels');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('clientReady', async () => {
  console.log('[PUBLISH] Conectado como ' + client.user.tag);

  try {
    // 1. Painel de Membros
    if (channels['painel-membros']) {
      const ch = await client.channels.fetch(channels['painel-membros']);
      if (ch) {
        await ch.send({
          embeds: [createMemberPanelEmbed()],
          components: createMemberPanelButtons()
        });
        console.log('[OK] Painel de Membros postado!');
      }
    }

    // 2. Painel Atualização CP
    if (channels['atualizacao-cp']) {
      const ch = await client.channels.fetch(channels['atualizacao-cp']);
      if (ch) {
        await ch.send({
          embeds: [createCpUpdatePanelEmbed()],
          components: createCpUpdatePanelButtons()
        });
        console.log('[OK] Painel de Atualização CP postado!');
      }
    }

    // 3. Painel Ausências
    if (channels['justificar-ausencia']) {
      const ch = await client.channels.fetch(channels['justificar-ausencia']);
      if (ch) {
        await ch.send({
          embeds: [createAbsencePanelEmbed()],
          components: createAbsencePanelButtons()
        });
        console.log('[OK] Painel de Ausências postado!');
      }
    }

    // 4. Painel Contestação de Presença
    if (channels['contestacao-presenca']) {
      const ch = await client.channels.fetch(channels['contestacao-presenca']);
      if (ch) {
        await ch.send({
          embeds: [createDisputePanelEmbed()],
          components: createDisputePanelButtons()
        });
        console.log('[OK] Painel de Contestação de Presença postado!');
      }
    }

    // 5. Painel Staff
    if (channels['comando-staff']) {
      const ch = await client.channels.fetch(channels['comando-staff']);
      if (ch) {
        await ch.send({
          embeds: [createStaffPanelEmbed()],
          components: createStaffPanelButtons()
        });
        console.log('[OK] Painel Staff postado!');
      }
    }

    console.log('[PUBLISH] Todos os painéis foram postados!');
    client.destroy();
  } catch (err) {
    console.error('[ERRO PUBLISH]', err);
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
