const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getLeiloes, saveLeiloes, getConfig } = require('../database/db');
const { getMember, getMemberDkp, lockDkp, unlockDkp, deductLockedDkp } = require('./memberService');
const { logAuctionWon, logAuctionNoBids } = require('./loggerService');

function getAuctionChannelId() {
  try {
    const cfPath = path.join(__dirname, '..', '..', 'discord_channels.json');
    if (fs.existsSync(cfPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfPath, 'utf-8'));
      if (cfg.channels && cfg.channels['leilao-drops']) {
        return cfg.channels['leilao-drops'];
      }
    }
  } catch {}
  const { channels } = require('../config/channels');
  return channels['leilao-drops'];
}

function renderAuctionEmbed(auction) {
  const isFinished = auction.status === 'finished';
  const color = isFinished ? '#2ECC71' : '#E67E22';
  const endsTimestamp = Math.floor(auction.endsAtTimestamp / 1000);

  const isClassRestricted = auction.targetClass && auction.targetClass !== 'Livre' && auction.targetClass !== 'all';
  const classTag = isClassRestricted ? ` [${auction.targetClass.toUpperCase()}]` : '';
  const classInfo = isClassRestricted
    ? `🛡️ **Restrição de Classe**: **${auction.targetClass}** *(Apenas jogadores desta classe podem dar lances!)*\n`
    : `🌐 **Classe**: **Todas as Classes (Livre)**\n`;

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
    .setTitle(isFinished ? `🎉 LEILÃO ENCERRADO${classTag} • ${auction.itemName.toUpperCase()}` : `🔥 LEILÃO DE DROP ATIVO${classTag} • ${auction.itemName.toUpperCase()}`)
    .setColor(color)
    .setDescription(
      `📦 **Item**: **${auction.itemName}**\n` +
      classInfo + '\n' +
      `${highestBidText}\n\n` +
      (isFinished
        ? `🏆 **VENCEDOR**: ${auction.highestBidderId ? `<@${auction.highestBidderId}> com o lance de **${auction.currentBid} DKP**!` : '*Nenhum lance registrado.*'}\n`
        : `⏱️ **Encerra em**: <t:${endsTimestamp}:R> (<t:${endsTimestamp}:T>)\n💰 **Lance Mínimo Inicial**: **${auction.minBid} DKP**\n\n🔒 *Sistema DKP Lock: O valor do seu lance fica travado na carteira até alguém cobrir!*`
      )
    )
    .addFields(
      { name: '📊 Disputa de Lances (1 lance por jogador)', value: bidsHistoryText, inline: false }
    )
    .setFooter({ text: `ID do Item: ${auction.id} • ${isClassRestricted ? `Exclusivo ${auction.targetClass}` : 'Livre para todos'}` })
    .setTimestamp();

  if (auction.imageUrl) {
    embed.setImage(auction.imageUrl);
  }

  return embed;
}

/**
 * Cria o post do leilão como um Tópico no canal Fórum oficial
 */
async function createAuctionPost({ client, auction, files = [] }) {
  const auctionChannelId = getAuctionChannelId();
  if (!auctionChannelId) {
    throw new Error('Canal #leilao-drops não configurado.');
  }

  const forumChannel = await client.channels.fetch(auctionChannelId).catch(() => null);
  if (!forumChannel) {
    throw new Error('Canal #leilao-drops não encontrado no Discord.');
  }

  // Tags do fórum
  let appliedTags = [];
  if (forumChannel.availableTags && forumChannel.availableTags.length > 0) {
    const activeTag = forumChannel.availableTags.find(t => t.name.includes('Ativo'));
    if (activeTag) appliedTags.push(activeTag.id);

    const normClass = (auction.targetClass || 'Livre').toLowerCase().trim();
    const classTag = forumChannel.availableTags.find(t => {
      const tn = t.name.toLowerCase();
      if (normClass === 'livre' || normClass === 'all') return tn.includes('livre');
      return tn.includes(normClass);
    });
    if (classTag) appliedTags.push(classTag.id);

    // Tag inicial: "Sem Lance" para permitir filtro no Discord Forum
    const semLanceTag = forumChannel.availableTags.find(t => t.name.includes('Sem Lance'));
    if (semLanceTag) appliedTags.push(semLanceTag.id);
  }

  const embed = renderAuctionEmbed(auction);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_bid_${auction.id}`)
      .setLabel('Dar Lance (DKP)')
      .setEmoji('💎')
      .setStyle(ButtonStyle.Success)
  );

  const classPrefix = (auction.targetClass && auction.targetClass !== 'Livre' && auction.targetClass !== 'all')
    ? `[${auction.targetClass.toUpperCase()}] `
    : '';
  const threadTitle = `${classPrefix}🗡️ ${auction.itemName} • Min: ${auction.minBid} DKP`.slice(0, 100);

  // Se o canal for Fórum (ou suportar threads)
  if (forumChannel.threads) {
    const thread = await forumChannel.threads.create({
      name: threadTitle,
      autoArchiveDuration: 1440,
      appliedTags,
      message: {
        embeds: [embed],
        components: [row],
        files
      }
    });

    auction.channelId = thread.id;
    auction.messageId = thread.id;

    // Se houve imagem anexada, salva URL permanente do Discord CDN
    try {
      const starterMsg = await thread.fetchStarterMessage().catch(() => null);
      if (starterMsg && starterMsg.attachments.size > 0) {
        auction.imageUrl = starterMsg.attachments.first().url;
        await starterMsg.edit({ embeds: [renderAuctionEmbed(auction)] }).catch(() => {});
      }
    } catch (err) {
      console.warn('Aviso ao obter starter message:', err.message);
    }

    const leiloes = getLeiloes();
    if (leiloes.active[auction.id]) {
      leiloes.active[auction.id].channelId = thread.id;
      leiloes.active[auction.id].messageId = thread.id;
      leiloes.active[auction.id].imageUrl = auction.imageUrl;
      saveLeiloes(leiloes);
    }

    return thread;
  } else {
    // Fallback para canal de texto tradicional
    const msg = await forumChannel.send({ embeds: [embed], components: [row], files });
    auction.channelId = forumChannel.id;
    auction.messageId = msg.id;

    if (msg.attachments.size > 0) {
      auction.imageUrl = msg.attachments.first().url;
      await msg.edit({ embeds: [renderAuctionEmbed(auction)] }).catch(() => {});
    }

    const leiloes = getLeiloes();
    if (leiloes.active[auction.id]) {
      leiloes.active[auction.id].channelId = forumChannel.id;
      leiloes.active[auction.id].messageId = msg.id;
      leiloes.active[auction.id].imageUrl = auction.imageUrl;
      saveLeiloes(leiloes);
    }

    return msg;
  }
}

/**
 * Atualiza o embed do leilão em tempo real após um lance
 */
async function updateAuctionDisplay(client, auction) {
  if (!auction || !auction.channelId) return;
  try {
    const targetChannel = await client.channels.fetch(auction.channelId).catch(() => null);
    if (!targetChannel) return;

    let msg = null;
    if (targetChannel.isThread()) {
      msg = await targetChannel.fetchStarterMessage().catch(() => null);
      if (!msg && auction.messageId) {
        msg = await targetChannel.messages.fetch(auction.messageId).catch(() => null);
      }

      // Se recebeu lance (currentBid > 0), troca a tag do fórum: remove "Sem Lance", adiciona "Com Lance"
      if (auction.currentBid > 0) {
        const parentForum = targetChannel.parent || (targetChannel.parentId ? await client.channels.fetch(targetChannel.parentId).catch(() => null) : null);
        const comLanceTagId = parentForum?.availableTags?.find(t => t.name.includes('Com Lance'))?.id || '1572030359955050608';
        const semLanceTagId = parentForum?.availableTags?.find(t => t.name.includes('Sem Lance'))?.id || '1572030359955050609';

        let curTags = (targetChannel.appliedTags || []).slice();
        let changed = false;
        if (semLanceTagId && curTags.includes(semLanceTagId)) {
          curTags = curTags.filter(id => id !== semLanceTagId);
          changed = true;
        }
        if (comLanceTagId && !curTags.includes(comLanceTagId)) {
          curTags.push(comLanceTagId);
          changed = true;
        }
        if (changed) {
          await targetChannel.setAppliedTags(curTags).catch(() => {});
        }
      }
    } else if (auction.messageId) {
      msg = await targetChannel.messages.fetch(auction.messageId).catch(() => null);
    }

    if (msg) {
      await msg.edit({ embeds: [renderAuctionEmbed(auction)] }).catch(() => {});
    }
  } catch (err) {
    console.error('Erro ao atualizar mensagem do leilão:', err);
  }
}

/**
 * Finaliza o leilão no Discord: atualiza starter embed, envia conclusão,
 * troca tags para Encerrado, tranca e arquiva o tópico, e envia log único para #logs-dkp.
 */
async function closeAuctionThread(client, finished) {
  if (!finished || !finished.channelId) return;
  try {
    const targetChannel = await client.channels.fetch(finished.channelId).catch(() => null);
    if (!targetChannel) return;

    if (targetChannel.isThread()) {
      // 1. Atualiza starter message removendo o botão de lance
      const starterMsg = await targetChannel.fetchStarterMessage().catch(() => null)
        || await targetChannel.messages.fetch(targetChannel.id).catch(() => null);
      if (starterMsg) {
        await starterMsg.edit({
          embeds: [renderAuctionEmbed(finished)],
          components: []
        }).catch(() => {});
      }

      // 2. Envia mensagem comemorativa de conclusão dentro do tópico
      const winEmbed = new EmbedBuilder()
        .setTitle(`🎉 LEILÃO ENCERRADO • ${finished.itemName.toUpperCase()}`)
        .setColor('#2ECC71')
        .setDescription(
          finished.highestBidderId
            ? `🏆 **VENCEDOR DO LEILÃO**: <@${finished.highestBidderId}>\n` +
              `💰 **Valor Final**: **${finished.currentBid} DKP**\n\n` +
              `🔒 *O valor de **${finished.currentBid} DKP** foi debitado definitivamente da carteira do jogador.*`
            : `⚠️ **Leilão expirado sem nenhum lance registrado.**`
        )
        .setFooter({ text: `ID do Item: ${finished.id}` })
        .setTimestamp();

      await targetChannel.send({ embeds: [winEmbed] }).catch(() => {});

      // 3. Atualiza tags do fórum: remove "Ativo", remove "Sem Lance", adiciona "Encerrado", preserva classe
      const parentForum = targetChannel.parent || (targetChannel.parentId ? await client.channels.fetch(targetChannel.parentId).catch(() => null) : null);
      const closedTagId = parentForum?.availableTags?.find(t => t.name.includes('Encerrado'))?.id || '1572020984838365236';
      const activeTagId = parentForum?.availableTags?.find(t => t.name.includes('Ativo'))?.id || '1572020984838365235';
      const semLanceTagId = parentForum?.availableTags?.find(t => t.name.includes('Sem Lance'))?.id || '1572030359955050609';

      let newTags = (targetChannel.appliedTags || []).filter(tId => tId !== activeTagId && tId !== semLanceTagId);
      if (closedTagId && !newTags.includes(closedTagId)) {
        newTags.push(closedTagId);
      }
      await targetChannel.setAppliedTags(newTags).catch(() => {});

      // 4. Tranca e arquiva o tópico (Leilões finalizados = tópicos fechados)
      await targetChannel.setLocked(true).catch(() => {});
      await targetChannel.setArchived(true).catch(() => {});
    } else {
      // Fallback para canal tradicional
      if (finished.messageId) {
        const msg = await targetChannel.messages.fetch(finished.messageId).catch(() => null);
        if (msg) {
          await msg.edit({
            embeds: [renderAuctionEmbed(finished)],
            components: []
          }).catch(() => {});
        }
      }
      const winEmbed = new EmbedBuilder()
        .setTitle(`🎉 LEILÃO ENCERRADO • ${finished.itemName.toUpperCase()}`)
        .setColor('#2ECC71')
        .setDescription(
          finished.highestBidderId
            ? `🏆 **Vencedor**: <@${finished.highestBidderId}>\n💰 **Valor Final**: **${finished.currentBid} DKP**`
            : `⚠️ Leilão encerrado sem lances.`
        )
        .setTimestamp();
      await targetChannel.send({ embeds: [winEmbed] }).catch(() => {});
    }

    // 5. Notificação de resultado para Staff e Auditoria
    if (finished.highestBidderId && finished.currentBid > 0) {
      const winnerDkp = getMemberDkp(finished.highestBidderId);
      await logAuctionWon({
        client,
        itemName: finished.itemName,
        winnerId: finished.highestBidderId,
        winnerTag: finished.highestBidderTag,
        finalAmount: finished.currentBid,
        newBalance: winnerDkp?.totalDkp || 0
      }).catch(err => console.error('Erro ao enviar log de vitória de leilão:', err));
    } else {
      // Leilão fechou sem nenhum lance! Informa a staff em #logs-dkp e #comando-staff
      await logAuctionNoBids({
        client,
        itemName: finished.itemName,
        targetClass: finished.targetClass,
        minBid: finished.minBid,
        itemId: finished.id,
        threadId: finished.channelId
      }).catch(err => console.error('Erro ao notificar staff sobre leilão sem lances:', err));
    }
  } catch (err) {
    console.error('Erro ao fechar thread de leilão:', err);
  }
}

function startAuction({ itemId, itemName, minBid = 10, durationMinutes = 15, imageUrl = null, targetClass = 'Livre', startedBy }) {
  const leiloes = getLeiloes();
  const id = itemId || `item_${Date.now()}`;
  const now = Date.now();
  const endsAt = now + durationMinutes * 60 * 1000;

  const normalizedClass = (!targetClass || targetClass === 'all') ? 'Livre' : targetClass;

  const auction = {
    id,
    itemName,
    targetClass: normalizedClass,
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

  // 0. Validação de Restrição de Classe
  if (auction.targetClass && auction.targetClass !== 'Livre' && auction.targetClass !== 'all') {
    const member = getMember(userId);
    if (!member || !member.classe) {
      return {
        success: false,
        error: `Este leilão é exclusivo para a classe **${auction.targetClass}**!\nVocê precisa ter sua ficha cadastrada e aprovada com sua classe para poder dar lances.`
      };
    }

    if (member.classe.toLowerCase().trim() !== auction.targetClass.toLowerCase().trim()) {
      return {
        success: false,
        error: `⛔ **Lance Bloqueado!** Este leilão é exclusivo para a classe **${auction.targetClass}**.\nSua classe registrada na guilda é **${member.classe}**.`
      };
    }
  }

  const bidAmount = parseInt(amount, 10);
  if (isNaN(bidAmount) || bidAmount <= 0) {
    return { success: false, error: 'Valor de lance inválido.' };
  }

  // Verifica lance mínimo
  const config = getConfig();
  const minIncrement = config.auction?.minBidIncrement || 1;

  if (auction.currentBid === 0) {
    if (bidAmount < auction.minBid) {
      return { success: false, error: `O primeiro lance precisa ser no mínimo ${auction.minBid} DKP!` };
    }
  } else {
    const requiredMin = auction.currentBid + minIncrement;
    if (bidAmount < requiredMin) {
      return { success: false, error: `O lance precisa ser maior que o lance atual! Mínimo aceito: ${requiredMin} DKP (Lance atual: ${auction.currentBid} DKP).` };
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
  createAuctionPost,
  updateAuctionDisplay,
  closeAuctionThread,
  startAuction,
  placeBid,
  finalizeAuction
};
