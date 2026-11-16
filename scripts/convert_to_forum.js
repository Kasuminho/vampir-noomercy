const { 
  Client, 
  GatewayIntentBits, 
  ChannelType, 
  EmbedBuilder, 
  AttachmentBuilder, 
  PermissionFlagsBits 
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { initDatabase, getLeiloes, saveLeiloes } = require('../src/database/db');
require('dotenv').config();

const CHANNELS_FILE = path.join(__dirname, '..', 'discord_channels.json');
const OLD_CHANNEL_ID = '1569077066538942468';
const GUILD_ID = '1561462359124480042';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return resolve(null);
    }
    const clientLib = url.startsWith('https') ? https : http;
    clientLib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', err => {
      console.warn(`Erro ao baixar imagem de ${url}:`, err.message);
      resolve(null);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('[CONVERSÃO] Conectando ao Discord e Postgres...');
  await initDatabase();
  const guild = await client.guilds.fetch(GUILD_ID);
  if (!guild) {
    console.error('Guild não encontrada!');
    process.exit(1);
  }

  const oldChannel = await client.channels.fetch(OLD_CHANNEL_ID).catch(() => null);
  if (!oldChannel) {
    console.error('Canal antigo não encontrado!');
    process.exit(1);
  }

  console.log(`[CONVERSÃO] Canal antigo encontrado: #${oldChannel.name} (ID: ${oldChannel.id})`);
  const parentId = oldChannel.parentId;
  const position = oldChannel.position;

  // 1. Coleta mensagens do canal antigo para mapear imagens do CDN
  console.log('[CONVERSÃO] Coletando histórico de mensagens antigas...');
  const oldMessages = await oldChannel.messages.fetch({ limit: 100 });
  const msgImageMap = new Map();
  for (const m of oldMessages.values()) {
    for (const e of m.embeds) {
      if (e.image?.url) {
        msgImageMap.set(m.id, e.image.url);
      }
      if (e.footer?.text && e.footer.text.includes('ID do Item: ')) {
        const idMatch = e.footer.text.match(/ID do Item:\s*(item_\d+)/);
        if (idMatch && e.image?.url) {
          msgImageMap.set(idMatch[1], e.image.url);
        }
      }
    }
    for (const a of m.attachments.values()) {
      msgImageMap.set(m.id, a.url);
    }
  }

  // 2. Carrega todos os leilões históricos do banco
  const leiloes = getLeiloes();
  const historyList = (leiloes.history || []).slice();
  console.log(`[CONVERSÃO] ${historyList.length} leilões históricos encontrados no banco de dados.`);

  // 3. Pré-baixa todas as imagens para buffers em memória
  console.log('[CONVERSÃO] Pré-baixando imagens dos leilões para a memória...');
  const imageBuffers = new Map();
  for (const item of historyList) {
    let imgUrl = item.imageUrl;
    if (!imgUrl || imgUrl.startsWith('attachment://')) {
      imgUrl = msgImageMap.get(item.id) || msgImageMap.get(item.messageId);
    }
    if (imgUrl && (imgUrl.startsWith('http://') || imgUrl.startsWith('https://'))) {
      const buf = await fetchBuffer(imgUrl);
      if (buf && buf.length > 0) {
        imageBuffers.set(item.id, buf);
        console.log(`  -> Imagem de "${item.itemName}" baixada (${buf.length} bytes)`);
      }
    }
  }

  // 4. Permissões clonadas do canal antigo
  const permissionOverwrites = oldChannel.permissionOverwrites.cache.map(po => ({
    id: po.id,
    type: po.type,
    allow: po.allow,
    deny: po.deny
  }));

  // 5. Criação do novo Canal Fórum
  console.log('[CONVERSÃO] Criando canal Fórum "leilao-drops"...');
  const forumChannel = await guild.channels.create({
    name: 'leilao-drops',
    type: ChannelType.GuildForum,
    parent: parentId,
    position: position,
    topic: '⚔️ Leilões oficiais de drops da NooMercy com sistema DKP Lock. Cada drop possui seu próprio tópico!',
    permissionOverwrites,
    availableTags: [
      { name: '🟢 Ativo', emoji: { name: '🟢' }, moderated: true },
      { name: '🔴 Encerrado', emoji: { name: '🔴' }, moderated: true },
      { name: '🌐 Livre', emoji: { name: '🌐' } },
      { name: '🩸 Bloodstained', emoji: { name: '🩸' } },
      { name: '⚔️ Carnage', emoji: { name: '⚔️' } },
      { name: '🔮 Akasha', emoji: { name: '🔮' } },
      { name: '🐍 Viper', emoji: { name: '🐍' } },
      { name: '💀 Grim Reaper', emoji: { name: '💀' } }
    ]
  });

  console.log(`[CONVERSÃO] NOVO FÓRUM CRIADO! ID: ${forumChannel.id}`);

  // 6. Atualiza discord_channels.json
  const configRaw = fs.readFileSync(CHANNELS_FILE, 'utf-8');
  const channelsConfig = JSON.parse(configRaw);
  channelsConfig.channels['leilao-drops'] = forumChannel.id;
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channelsConfig, null, 2), 'utf-8');
  console.log(`[CONVERSÃO] discord_channels.json atualizado com o novo canal ID: ${forumChannel.id}`);

  // 7. Deleta o canal de texto antigo para não duplicar no Discord
  console.log('[CONVERSÃO] Deletando canal de texto antigo...');
  await oldChannel.delete('Migrado para canal Fórum oficial de Leilões');
  console.log('[CONVERSÃO] Canal antigo deletado com sucesso.');

  // Mapeamento de tags do novo fórum
  const tagMap = new Map();
  for (const tag of forumChannel.availableTags) {
    tagMap.set(tag.name, tag.id);
  }

  const tagEncerradoId = tagMap.get('🔴 Encerrado');
  const tagLivreId = tagMap.get('🌐 Livre');

  // Ordena do mais antigo para o mais novo
  historyList.sort((a, b) => {
    const tA = new Date(a.startedAt || 0).getTime();
    const tB = new Date(b.startedAt || 0).getTime();
    return tA - tB;
  });

  console.log('[CONVERSÃO] Recriando leilões no fórum com embelezamento, cards e resultados...');

  for (const [idx, item] of historyList.entries()) {
    console.log(`[TÓPICO ${idx + 1}/${historyList.length}] Recriando: ${item.itemName} (Ganhador: ${item.highestBidderTag}, ${item.currentBid} DKP)...`);

    // Tags
    const appliedTags = [];
    if (tagEncerradoId) appliedTags.push(tagEncerradoId);

    const normClass = (item.targetClass || 'Livre').trim().toLowerCase();
    let classTagId = tagLivreId;
    if (normClass.includes('blood')) classTagId = tagMap.get('🩸 Bloodstained');
    else if (normClass.includes('carnage')) classTagId = tagMap.get('⚔️ Carnage');
    else if (normClass.includes('akasha')) classTagId = tagMap.get('🔮 Akasha');
    else if (normClass.includes('viper') || normClass.includes('vyper')) classTagId = tagMap.get('🐍 Viper');
    else if (normClass.includes('reaper') || normClass.includes('grim')) classTagId = tagMap.get('💀 Grim Reaper');
    if (classTagId && !appliedTags.includes(classTagId)) appliedTags.push(classTagId);

    // Título do Tópico
    const classPrefix = (item.targetClass && item.targetClass !== 'Livre' && item.targetClass !== 'all')
      ? `[${item.targetClass.toUpperCase()}] `
      : '';
    const threadTitle = `${classPrefix}🗡️ ${item.itemName} • ${item.currentBid} DKP (@${item.highestBidderTag || 'Sem lances'})`.slice(0, 100);

    // Monta o Embed do Card
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const bidsHistoryText = (item.bidsHistory && item.bidsHistory.length > 0)
      ? item.bidsHistory.slice(0, 5).map((b, bIdx) => {
          const icon = medals[bIdx] || `\`#${bIdx + 1}\``;
          const leaderTag = bIdx === 0 ? ' 👑 *(Vencedor)*' : '';
          const timeStr = b.timestamp ? `<t:${Math.floor(new Date(b.timestamp).getTime() / 1000)}:R>` : '';
          return `${icon} **${b.amount} DKP** — <@${b.userId}>${leaderTag} • ${timeStr}`;
        }).join('\n')
      : '*Nenhum histórico disponível.*';

    const classInfo = (item.targetClass && item.targetClass !== 'Livre' && item.targetClass !== 'all')
      ? `🛡️ **Restrição de Classe**: **${item.targetClass}**\n`
      : `🌐 **Classe**: **Todas as Classes (Livre)**\n`;

    const starterEmbed = new EmbedBuilder()
      .setTitle(`🎉 LEILÃO ENCERRADO • ${item.itemName.toUpperCase()}`)
      .setColor('#2ECC71')
      .setDescription(
        `📦 **Item**: **${item.itemName}**\n` +
        classInfo + '\n' +
        `🏆 **VENCEDOR**: ${item.highestBidderId ? `<@${item.highestBidderId}> (\`${item.highestBidderTag}\`)` : '*Nenhum lance*'}\n` +
        `💰 **Valor Final Arrematado**: **${item.currentBid} DKP**\n` +
        `💰 **Lance Mínimo Inicial**: **${item.minBid || 30} DKP**\n\n` +
        `🔒 *Pontos debitados com sucesso da carteira do vencedor.*`
      )
      .addFields(
        { name: '📊 Disputa de Lances Registrada', value: bidsHistoryText, inline: false }
      )
      .setFooter({ text: `ID do Item: ${item.id} • ${item.targetClass || 'Livre'} • Concluído` })
      .setTimestamp(new Date(item.finishedAt || item.endsAt || Date.now()));

    // Prepara arquivo de imagem
    const files = [];
    const buf = imageBuffers.get(item.id);
    if (buf) {
      const fileName = `drop_${item.id}.png`;
      const attachment = new AttachmentBuilder(buf, { name: fileName });
      files.push(attachment);
      starterEmbed.setImage(`attachment://${fileName}`);
    }

    // Cria o Tópico no Fórum
    const thread = await forumChannel.threads.create({
      name: threadTitle,
      autoArchiveDuration: 1440,
      appliedTags,
      message: {
        embeds: [starterEmbed],
        files
      }
    });

    // Envia mensagem de conclusão e comemoração dentro do tópico
    const winEmbed = new EmbedBuilder()
      .setTitle(`🏆 LEILÃO FINALIZADO COM SUCESSO!`)
      .setColor('#2ECC71')
      .setDescription(
        `O drop **${item.itemName}** foi arrematado com sucesso por <@${item.highestBidderId}> por **${item.currentBid} DKP**!\n\n` +
        `✅ O tópico agora está trancado e arquivado para consulta histórica.`
      )
      .setFooter({ text: `ID: ${item.id}` })
      .setTimestamp(new Date(item.finishedAt || item.endsAt || Date.now()));

    await thread.send({ embeds: [winEmbed] });

    // Tranca e arquiva o tópico
    await thread.setLocked(true);
    await thread.setArchived(true);

    // Atualiza referências no item
    item.channelId = thread.id;
    item.messageId = thread.id;

    // Pausa leve para não atingir ratelimit do Discord
    await sleep(600);
  }

  saveLeiloes(leiloes);
  console.log('\n======================================================');
  console.log('✅ MIGRAÇÃO PARA FÓRUM CONCLUÍDA COM TOTAL SUCESSO!');
  console.log(`Canal Fórum: #${forumChannel.name} (ID: ${forumChannel.id})`);
  console.log(`Total de Tópicos Históricos Recriados: ${historyList.length}`);
  console.log('======================================================\n');

  process.exit(0);
}

client.once('clientReady', main);
client.login(process.env.DISCORD_TOKEN);
