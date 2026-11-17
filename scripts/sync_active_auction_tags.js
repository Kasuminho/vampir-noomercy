const { Client, GatewayIntentBits } = require('discord.js');
const { initDatabase, getLeiloes } = require('../src/database/db');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('[SYNC TAGS] Conectando ao Discord e Postgres...');
  await initDatabase();

  const leiloes = getLeiloes();
  const activeList = Object.values(leiloes.active || {});
  console.log(`[SYNC TAGS] Encontrados ${activeList.length} leilões ativos no banco.`);

  const TAG_ATIVO = '1572020984838365235';
  const TAG_COM_LANCE = '1572030359955050608';
  const TAG_SEM_LANCE = '1572030359955050609';

  let comLanceCount = 0;
  let semLanceCount = 0;
  let errorCount = 0;

  for (let i = 0; i < activeList.length; i++) {
    const a = activeList[i];
    if (!a.channelId) continue;

    try {
      const thread = await client.channels.fetch(a.channelId).catch(() => null);
      if (!thread || !thread.isThread()) {
        console.warn(`Thread não encontrada para o item: ${a.itemName} (ID: ${a.id})`);
        continue;
      }

      const hasBid = (a.currentBid > 0) || (a.bidsHistory && a.bidsHistory.length > 0);
      let curTags = (thread.appliedTags || []).slice();

      // Garante Ativo
      if (!curTags.includes(TAG_ATIVO)) {
        curTags.push(TAG_ATIVO);
      }

      if (hasBid) {
        // Remove Sem Lance, adiciona Com Lance
        curTags = curTags.filter(id => id !== TAG_SEM_LANCE);
        if (!curTags.includes(TAG_COM_LANCE)) {
          curTags.push(TAG_COM_LANCE);
        }
        comLanceCount++;
        console.log(`[${i + 1}/${activeList.length}] 🔥 COM LANCE: ${a.itemName} (${a.currentBid} DKP por @${a.highestBidderTag})`);
      } else {
        // Remove Com Lance, adiciona Sem Lance
        curTags = curTags.filter(id => id !== TAG_COM_LANCE);
        if (!curTags.includes(TAG_SEM_LANCE)) {
          curTags.push(TAG_SEM_LANCE);
        }
        semLanceCount++;
        console.log(`[${i + 1}/${activeList.length}] 💤 SEM LANCE: ${a.itemName}`);
      }

      await thread.setAppliedTags(curTags).catch(err => {
        console.error(`Erro ao aplicar tags em "${a.itemName}":`, err.message);
        errorCount++;
      });

      // Pausa leve para não bater no ratelimit do Discord
      await sleep(350);
    } catch (err) {
      console.error(`Erro no item ${a.itemName}:`, err.message);
      errorCount++;
    }
  }

  console.log('\n======================================================');
  console.log('✅ SINCRONIZAÇÃO DE TAGS DOS LEILÕES CONCLUÍDA!');
  console.log(`🔥 Itens com Lance (Marcados com "🔥 Com Lance"): ${comLanceCount}`);
  console.log(`💤 Itens sem Lance (Marcados com "💤 Sem Lance"): ${semLanceCount}`);
  console.log(`⚠️ Erros: ${errorCount}`);
  console.log('======================================================\n');

  process.exit(0);
}

client.once('clientReady', main);
client.login(process.env.DISCORD_TOKEN);
