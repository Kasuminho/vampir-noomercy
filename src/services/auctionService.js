const { EmbedBuilder } = require('discord.js');
const { getLeiloes, saveLeiloes, getConfig } = require('../database/db');
const { getMemberDkp, lockDkp, unlockDkp, deductLockedDkp } = require('./memberService');

function renderAuctionEmbed(auction) {
  const isFinished = auction.status === 'finished';
  const color = isFinished ? '#2ECC71' : '#E67E22';
  const endsTimestamp = Math.floor(auction.endsAtTimestamp / 1000);

  const highestBidText = auction.highestBidderId
    ? `👑 **Liderando o Leilão:** **${auction.currentBid} DKP** por <@${auction.highestBidderId}> (\`${auction.highestBidderTag}\`)`
    : `💤 **Nenhum lance ainda!** (Lance inicial mínimo: **${auction.minBid} DKP**)`;

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const bidsHistoryText = (auction.bidsHistory && auction.bidsHistory.length > 0)
    ? auction.bidsHistory.slice(0, 5).map((b, idx) => {
        const icon = medals[idx] || `\`#${idx + 1}\``;
        const leaderTag = idx === 0 ? ' 👑 *(Líder)*' : '';
        return `${icon} **${b.amount} DKP** — <@${b.userId}>${leaderTag} • <t:${Math.floor(new Date(b.timestamp).getTime() / 1000)}:R>`;
      }).join('\n')
    : '*Nenhum lance registrado até o momento.*';

  const embed = new EmbedBuilder()
    .setTitle(isFinished ? `🎉 LEILÃO ENCERRADO • ${auction.itemName.toUpperCase()}` : `🔥 LEILÃO DE DROP ATIVO • ${auction.itemName.toUpperCase()}`)
    .setColor(color)
    .setDescription(
      `📦 **Item**: **${auction.itemName}**\n\n` +
      `${highestBidText}\n\n` +
      (isFinished
        ? `🏆 **VENCEDOR**: ${auction.highestBidderId ? `<@${auction.highestBidderId}> com o lance de **${auction.currentBid} DKP**!` : '*Nenhum lance registrado.*'}\n`
        : `⏱️ **Encerra em**: <t:${endsTimestamp}:R> (<t:${endsTimestamp}:T>)\n💰 **Lance Mínimo Inicial**: **${auction.minBid} DKP**\n\n🔒 *Sistema DKP Lock: O valor do seu lance fica travado na carteira até alguém cobrir!*`
      )
    )
    .addFields(
      { name: '📊 Disputa de Lances (1 lance por jogador)', value: bidsHistoryText, inline: false }
    )
    .setFooter({ text: `ID do Item: ${auction.id} • Clique no botão abaixo para cobrir!` })
    .setTimestamp();

  if (auction.imageUrl) {
    embed.setImage(auction.imageUrl);
  }

  return embed;
}

async function updateAuctionDisplay(client, auction) {
  if (!auction || !auction.channelId || !auction.messageId) return;
  try {
    const ch = await client.channels.fetch(auction.channelId).catch(() => null);
    if (ch) {
      const msg = await ch.messages.fetch(auction.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [renderAuctionEmbed(auction)] }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Erro ao atualizar mensagem do leilão:', err);
  }
}

function startAuction({ itemId, itemName, minBid = 10, durationMinutes = 15, imageUrl = null, startedBy }) {
  const leiloes = getLeiloes();
  const id = itemId || `item_${Date.now()}`;
  const now = Date.now();
  const endsAt = now + durationMinutes * 60 * 1000;

  const auction = {
    id,
    itemName,
    minBid: parseInt(minBid, 10),
    currentBid: 0,
    highestBidderId: null,
    highestBidderTag: null,
    startedBy,
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    endsAtTimestamp: endsAt,
    imageUrl,
    status: 'active',
    bidsHistory: []
  };

  leiloes.active[id] = auction;
  saveLeiloes(leiloes);

  return auction;
}

function placeBid({ itemId, userId, userTag, amount }) {
  const leiloes = getLeiloes();
  const auction = leiloes.active[itemId];

  if (!auction) {
    return { success: false, error: 'Este leilão não existe ou já foi encerrado!' };
  }

  const now = Date.now();
  if (now > auction.endsAtTimestamp) {
    return { success: false, error: 'O tempo deste leilão já expirou!' };
  }

  const bidAmount = parseInt(amount, 10);
  if (isNaN(bidAmount) || bidAmount <= 0) {
    return { success: false, error: 'Valor de lance inválido.' };
  }

  // Verifica lance mínimo
  const config = getConfig();
  const minIncrement = config.auction?.minBidIncrement || 5;

  if (auction.currentBid === 0) {
    if (bidAmount < auction.minBid) {
      return { success: false, error: `O primeiro lance precisa ser no mínimo ${auction.minBid} DKP!` };
    }
  } else {
    const requiredMin = auction.currentBid + minIncrement;
    if (bidAmount < requiredMin) {
      return { success: false, error: `O lance precisa ser de no mínimo ${requiredMin} DKP (Lance atual: ${auction.currentBid} + ${minIncrement} DKP de incremento)!` };
    }
  }

  // Se o próprio usuário já é o maior lance, ele só pode aumentar se tiver a diferença
  const isSameBidder = auction.highestBidderId === userId;
  const neededLock = isSameBidder ? (bidAmount - auction.currentBid) : bidAmount;

  // Verifica se o usuário tem saldo disponível
  const dkpInfo = getMemberDkp(userId);
  if (dkpInfo.availableDkp < neededLock) {
    return {
      success: false,
      error: `Saldo livre de DKP insuficiente! Você tem ${dkpInfo.availableDkp} DKP disponível (Total: ${dkpInfo.totalDkp}, Travado em outros lances: ${dkpInfo.lockedDkp}).`
    };
  }

  // 1. Destrava o saldo do licitante anterior se for outro jogador
  if (!isSameBidder && auction.highestBidderId && auction.currentBid > 0) {
    unlockDkp(auction.highestBidderId, auction.currentBid, itemId);
  }

  // 2. Trava o saldo do novo lance
  const lockedOk = lockDkp(userId, neededLock, itemId);
  if (!lockedOk) {
    return { success: false, error: 'Falha ao travar o DKP para o lance. Tente novamente.' };
  }

  // 3. Verifica Anti-Sniping (se faltam menos de 60s, prorroga)
  const thresholdMs = (config.auction?.antiSnipingThresholdSeconds || 60) * 1000;
  const extendMs = (config.auction?.antiSnipingExtensionSeconds || 120) * 1000;
  let extended = false;

  const msRemaining = auction.endsAtTimestamp - now;
  if (msRemaining <= thresholdMs) {
    auction.endsAtTimestamp = now + extendMs;
    auction.endsAt = new Date(auction.endsAtTimestamp).toISOString();
    extended = true;
  }

  // 4. Registra o lance garantindo 1 posição por jogador (substitui lance anterior do mesmo usuário)
  const previousBidder = auction.highestBidderId;
  auction.currentBid = bidAmount;
  auction.highestBidderId = userId;
  auction.highestBidderTag = userTag;

  // Remove qualquer lance anterior deste mesmo usuário para não duplicar o nome
  auction.bidsHistory = (auction.bidsHistory || []).filter(b => b.userId !== userId);

  // Adiciona o novo lance atualizado
  auction.bidsHistory.unshift({
    userId,
    userTag,
    amount: bidAmount,
    timestamp: new Date().toISOString()
  });

  // Mantém sempre ordenado pelo maior valor
  auction.bidsHistory.sort((a, b) => b.amount - a.amount);

  saveLeiloes(leiloes);

  const updatedDkp = getMemberDkp(userId);

  return {
    success: true,
    auction,
    extended,
    previousBidder,
    newAvailableDkp: updatedDkp.availableDkp,
    newLockedDkp: updatedDkp.lockedDkp,
    newTotalDkp: updatedDkp.totalDkp
  };
}

function finalizeAuction(itemId) {
  const leiloes = getLeiloes();
  const auction = leiloes.active[itemId];
  if (!auction) return null;

  auction.status = 'finished';
  auction.finishedAt = new Date().toISOString();

  if (auction.highestBidderId && auction.currentBid > 0) {
    deductLockedDkp(
      auction.highestBidderId,
      auction.currentBid,
      itemId,
      `Vitória no Leilão: ${auction.itemName}`
    );
  }

  delete leiloes.active[itemId];
  leiloes.history.unshift(auction);
  if (leiloes.history.length > 200) leiloes.history.pop();
  saveLeiloes(leiloes);

  return auction;
}

module.exports = {
  renderAuctionEmbed,
  updateAuctionDisplay,
  startAuction,
  placeBid,
  finalizeAuction
};
