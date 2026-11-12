const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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
} = require('../src/ui/panels');

const channelsConfig = require('../discord_channels.json');
const channels = channelsConfig.channels;

// 1. Reset Database Files (preserving members.json!)
console.log('[RESET] 1. Limpando bancos de dados (preservando members.json)...');

// DKP
const members = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/members.json'), 'utf8'));
const dkpBalances = {};
for (const userId of Object.keys(members)) {
  dkpBalances[userId] = {
    userId,
    totalDkp: 0,
    lockedDkp: 0,
    eventsAttended: 0,
    lastEvent: null,
    lastDate: null
  };
}
const dkpData = {
  balances: dkpBalances,
  history: []
};
fs.writeFileSync(path.join(__dirname, '../data/dkp.json'), JSON.stringify(dkpData, null, 2));

// Presenças
const presencasData = {
  events: {},
  disputes: {}
};
fs.writeFileSync(path.join(__dirname, '../data/presencas.json'), JSON.stringify(presencasData, null, 2));

// Leilões
const leiloesData = {
  active: {},
  history: []
};
fs.writeFileSync(path.join(__dirname, '../data/leiloes.json'), JSON.stringify(leiloesData, null, 2));

// Ausências
const ausenciasData = {
  requests: []
};
fs.writeFileSync(path.join(__dirname, '../data/ausencias.json'), JSON.stringify(ausenciasData, null, 2));

console.log('[RESET] Bancos DKP, Presenças, Leilões e Ausências zerados com sucesso!');

// 2. Limpeza de canais do Discord e republicação dos novos painéis bilíngues
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

async function clearChannel(ch) {
  try {
    const messages = await ch.messages.fetch({ limit: 100 });
    for (const msg of messages.values()) {
      await msg.delete().catch(() => {});
    }
  } catch (err) {
    console.error(`Erro ao limpar canal ${ch.name}:`, err);
  }
}

client.on('ready', async () => {
  console.log(`[DISCORD] Conectado como ${client.user.tag}. Limpando mensagens de teste e republicando painéis bilíngues...`);

  // Limpa #leilao-drops
  const leilaoCh = await client.channels.fetch(channels['leilao-drops']).catch(() => null);
  if (leilaoCh) {
    console.log('[DISCORD] Limpando #leilao-drops...');
    await clearChannel(leilaoCh);
  }

  // Limpa #logs-dkp
  const logsCh = await client.channels.fetch(channels['logs-dkp']).catch(() => null);
  if (logsCh) {
    console.log('[DISCORD] Limpando #logs-dkp...');
    await clearChannel(logsCh);
  }

  // Limpa #auditoria-presencas
  const auditPresCh = await client.channels.fetch(channels['auditoria-presencas']).catch(() => null);
  if (auditPresCh) {
    console.log('[DISCORD] Limpando #auditoria-presencas...');
    await clearChannel(auditPresCh);
  }

  // Republica os painéis bilíngues com visual novo
  const panelsToPublish = [
    {
      channelId: channels['painel-membros'],
      embed: createMemberPanelEmbed(),
      components: createMemberPanelButtons()
    },
    {
      channelId: channels['atualizacao-cp'],
      embed: createCpUpdatePanelEmbed(),
      components: createCpUpdatePanelButtons()
    },
    {
      channelId: channels['justificar-ausencia'],
      embed: createAbsencePanelEmbed(),
      components: createAbsencePanelButtons()
    },
    {
      channelId: channels['contestacao-presenca'],
      embed: createDisputePanelEmbed(),
      components: createDisputePanelButtons()
    },
    {
      channelId: channels['comando-staff'],
      embed: createStaffPanelEmbed(),
      components: createStaffPanelButtons()
    }
  ];

  for (const p of panelsToPublish) {
    if (!p.channelId) continue;
    const ch = await client.channels.fetch(p.channelId).catch(() => null);
    if (ch) {
      console.log(`[DISCORD] Republicando painel bilíngue em #${ch.name}...`);
      await clearChannel(ch);
      await ch.send({
        embeds: [p.embed],
        components: p.components
      });
    }
  }

  console.log('[CONCLUÍDO] Todos os painéis bilíngues foram republicados e dados de teste zerados!');
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
