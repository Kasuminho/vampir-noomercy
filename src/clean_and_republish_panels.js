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
const { saveMembers, saveDkp, savePresencas, saveAusencias, saveLeiloes } = require('./database/db');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

async function clearChannel(channel) {
  if (!channel || !channel.isTextBased()) return;
  try {
    let fetched;
    do {
      fetched = await channel.messages.fetch({ limit: 100 });
      if (fetched.size > 0) {
        await channel.bulkDelete(fetched, true).catch(async () => {
          for (const m of fetched.values()) {
            await m.delete().catch(() => {});
          }
        });
      }
    } while (fetched.size >= 2);
    console.log(`[LIMPEZA] Canal #${channel.name} zerado com sucesso.`);
  } catch (err) {
    console.error(`Erro ao limpar #${channel.name}:`, err.message);
  }
}

client.once('clientReady', async () => {
  console.log('[CLEAN] Conectado como ' + client.user.tag);

  try {
    // 1. Zerar banco de dados para iniciar limpo
    saveMembers({});
    saveDkp({ balances: {}, history: [] });
    savePresencas({ events: {}, disputes: {} });
    saveAusencias({ list: [] });
    saveLeiloes({ active: {}, history: [] });
    console.log('[BANCO] Dados de testes anteriores zerados!');

    // 2. Limpar canais de logs e auditoria
    const auditChannels = [
      channels['auditoria-cp'],
      channels['auditoria-presencas'],
      channels['leilao-drops'],
      channels['logs-dkp']
    ];

    for (const chId of auditChannels) {
      if (!chId) continue;
      const ch = await client.channels.fetch(chId).catch(() => null);
      if (ch) await clearChannel(ch);
    }

    // 3. Limpar e republicar canais de painéis (EXATAMENTE 1 PAINEL EM CADA)
    const panelConfigs = [
      {
        id: channels['painel-membros'],
        embed: createMemberPanelEmbed,
        buttons: createMemberPanelButtons
      },
      {
        id: channels['atualizacao-cp'],
        embed: createCpUpdatePanelEmbed,
        buttons: createCpUpdatePanelButtons
      },
      {
        id: channels['justificar-ausencia'],
        embed: createAbsencePanelEmbed,
        buttons: createAbsencePanelButtons
      },
      {
        id: channels['contestacao-presenca'],
        embed: createDisputePanelEmbed,
        buttons: createDisputePanelButtons
      },
      {
        id: channels['comando-staff'],
        embed: createStaffPanelEmbed,
        buttons: createStaffPanelButtons
      }
    ];

    for (const p of panelConfigs) {
      if (!p.id) continue;
      const ch = await client.channels.fetch(p.id).catch(() => null);
      if (ch) {
        await clearChannel(ch);
        await ch.send({
          embeds: [p.embed()],
          components: p.buttons()
        });
        console.log(`[PAINEL] Postado painel único e oficial em #${ch.name}!`);
      }
    }

    console.log('[CONCLUÍDO] Todos os canais foram zerados e os painéis estão únicos!');
    client.destroy();
    process.exit(0);
  } catch (e) {
    console.error('[ERRO LIMPEZA]', e);
    client.destroy();
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
