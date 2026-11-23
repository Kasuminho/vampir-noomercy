const { EmbedBuilder } = require('discord.js');
const { channels } = require('../config/channels');

async function sendLog(client, embed) {
  try {
    const logChannelId = channels['logs-dkp'];
    if (!logChannelId) return;
    const ch = await client.channels.fetch(logChannelId).catch(() => null);
    if (!ch) return;
    await ch.send({ embeds: [embed] }).catch(err => console.error('[LOGGER ERROR]', err));
  } catch (err) {
    console.error('[LOGGER ERROR]', err);
  }
}

// 1. Log Presença em Lote ou Voz
async function logAttendance({ client, eventName, baseDkp, registeredBy, awardedList, lastHit }) {
  const validAwarded = (awardedList || []).filter(m => !m.noCpApproved && !m.calc?.cutoffStatus?.isCut);
  const cutAwarded = (awardedList || []).filter(m => m.noCpApproved || m.calc?.cutoffStatus?.isCut);

  const chunkSize = 20;
  const totalPages = Math.max(1, Math.ceil(validAwarded.length / chunkSize));

  let lastHitSection = '';
  const lhList = Array.isArray(lastHit) ? lastHit : (lastHit ? [lastHit] : []);
  if (lhList.length > 0) {
    const names = lhList.map(lh => `<@${lh.userId}> (\`${lh.nick || lh.userId}\`)`).join(', ');
    lastHitSection = `🎯 **Last Hit (+10 DKP Bônus${lhList.length > 1 ? ' cada' : ''}):** ${names}\n`;
  }

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * chunkSize;
    const end = start + chunkSize;
    const chunk = validAwarded.slice(start, end);

    const lines = chunk.map(m => {
      const lhText = m.isLastHit ? ' • 🎯 **Last Hit: +10 DKP**' : '';
      const points = m.totalAwardedDkp || m.calc?.finalDkp || 0;
      return `• <@${m.userId}> (\`${m.nick || m.userTag}\`): **+${points} DKP** *(Saldo: \`${m.newTotalDkp} DKP\`${lhText})*`;
    });

    const isFirst = page === 1;
    const isLast = page === totalPages;
    const pageSuffix = totalPages > 1 ? ` (Parte ${page}/${totalPages})` : '';

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ LOG DKP • PRESENÇA / ATTENDANCE • ${eventName.toUpperCase()}${pageSuffix}`)
      .setColor('#2ECC71')
      .setDescription(
        (isFirst
          ? `**Evento / Event:** \`${eventName}\`\n` +
            `**DKP Base / Base DKP:** \`${baseDkp} DKP\`\n` +
            lastHitSection +
            `**Registrado por / Registered by:** ${registeredBy}\n\n` +
            `**Pontuações Concedidas / Awarded Members (${validAwarded.length} total${totalPages > 1 ? ` - Parte ${page}/${totalPages}` : ''}):**\n`
          : `**Pontuações Concedidas (Continuação - Parte ${page}/${totalPages}):**\n`
        ) +
        (lines.length > 0 ? lines.join('\n') : '*Nenhum membro pontuado.*')
      )
      .setFooter({ text: totalPages > 1 ? `Página ${page}/${totalPages} • NooMercy DKP Audit` : 'NooMercy DKP Audit • Vlad, o Drácula da Shopee' })
      .setTimestamp();

    if (isLast && cutAwarded.length > 0) {
      const cutLines = cutAwarded.map(m =>
        `🚫 <@${m.userId}>: **0 DKP** (${m.calc?.cutoffStatus?.details?.failedReason || 'Sem CP aprovado / No approved CP'})`
      );
      embed.addFields({
        name: `⚠️ Membros Cortados / Blocked Members (${cutAwarded.length})`,
        value: cutLines.join('\n')
      });
    }

    await sendLog(client, embed);
  }
}

// 2. Log Contestação Aprovada
async function logDisputeApproved({ client, eventName, userId, userTag, dkpEarned, approvedBy, newBalance }) {
  const embed = new EmbedBuilder()
    .setTitle(`📜 LOG DKP • CONTESTAÇÃO APROVADA / DISPUTE APPROVED`)
    .setColor('#3498DB')
    .setDescription(
      `**Membro / Member:** <@${userId}> (\`${userTag}\`)\n` +
      `**Evento / Event:** \`${eventName}\`\n` +
      `**DKP Creditado / Credited:** **+${dkpEarned} DKP**\n` +
      `**Novo Saldo / New Balance:** **${newBalance} DKP**\n` +
      `**Aprovado por / Approved by:** <@${approvedBy}>`
    )
    .setFooter({ text: 'NooMercy DKP Audit' })
    .setTimestamp();

  await sendLog(client, embed);
}

// 3. Log Lance Travado (DKP Lock)
async function logAuctionBidLock({ client, itemName, userId, userTag, amount, lockedTotal, availableDkp }) {
  const embed = new EmbedBuilder()
    .setTitle(`🔒 LOG DKP • LANCE NO LEILÃO (LOCK) / AUCTION BID LOCK`)
    .setColor('#E67E22')
    .setDescription(
      `**Item:** **${itemName}**\n` +
      `**Licitante / Bidder:** <@${userId}> (\`${userTag}\`)\n` +
      `**Valor do Lance / Bid Amount:** **${amount} DKP** (Travado / Locked)\n` +
      `**Saldo Livre Restante / Available DKP:** \`${availableDkp} DKP\` *(Total Travado: \`${lockedTotal} DKP\`)*`
    )
    .setFooter({ text: 'Sistema DKP Lock • NooMercy' })
    .setTimestamp();

  await sendLog(client, embed);
}

// 4. Log Lance Coberto (DKP Unlock)
async function logAuctionBidUnlock({ client, itemName, userId, amountUnlocked, availableDkp }) {
  const embed = new EmbedBuilder()
    .setTitle(`🔓 LOG DKP • LANCE COBERTO (UNLOCK) / OUTBID`)
    .setColor('#F1C40F')
    .setDescription(
      `**Item:** **${itemName}**\n` +
      `**Membro Coberto / Outbid Member:** <@${userId}>\n` +
      `**Valor Devolvido / Unlocked Amount:** **+${amountUnlocked} DKP** (Liberado de volta à carteira / Returned to balance)\n` +
      `**Novo Saldo Livre / New Available DKP:** \`${availableDkp} DKP\``
    )
    .setFooter({ text: 'Sistema DKP Lock • NooMercy' })
    .setTimestamp();

  await sendLog(client, embed);
}

// 5. Log Vitória no Leilão (Dedução Final)
async function logAuctionWon({ client, itemName, winnerId, winnerTag, finalAmount, newBalance }) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 LOG DKP • VITÓRIA NO LEILÃO (DÉBITO) / AUCTION WON (DEDUCTED)`)
    .setColor('#9B59B6')
    .setDescription(
      `**Item Vencido / Won Item:** **${itemName}**\n` +
      `**Vencedor / Winner:** <@${winnerId}> (\`${winnerTag}\`)\n` +
      `**Valor Debitado / Deducted Amount:** **-${finalAmount} DKP**\n` +
      `**Saldo Final / Final Balance:** \`${newBalance} DKP\``
    )
    .setFooter({ text: 'Item entregue e DKP debitado definitivamente.' })
    .setTimestamp();

  await sendLog(client, embed);
}

// 6. Log Virada Mensal
async function logDecayExecuted({ client, totalMembers, totalBurnedDkp, executedBy }) {
  const embed = new EmbedBuilder()
    .setTitle(`🔥 LOG DKP • VIRADA MENSAL (DECAY 80%) / MONTHLY DECAY`)
    .setColor('#E74C3C')
    .setDescription(
      `A virada mensal de DKP foi executada!\n` +
      `Monthly DKP reset executed (80% burned, 20% retained)!\n\n` +
      `👥 **Jogadores Processados / Members Processed:** \`${totalMembers}\`\n` +
      `🔥 **Total de DKP Queimado / Total DKP Burned:** \`-${totalBurnedDkp} DKP\`\n` +
      `🛡️ **Executado por / Triggered by:** \`${executedBy}\``
    )
    .setFooter({ text: 'NooMercy DKP • Virada Mensal' })
    .setTimestamp();

  await sendLog(client, embed);
}

// 7. Log Leilão Encerrado Sem Lances (Notificação para Staff)
async function logAuctionNoBids({ client, itemName, targetClass, minBid, itemId, threadId }) {
  const { roles, channels } = require('../config/channels');
  const embed = new EmbedBuilder()
    .setTitle(`⚠️ LEILÃO ENCERRADO SEM LANCES • ${itemName.toUpperCase()}`)
    .setColor('#E74C3C')
    .setDescription(
      `📦 **Item Não Arrematado:** **${itemName}**\n` +
      `🛡️ **Classe:** **${targetClass || 'Livre'}**\n` +
      `💰 **Lance Mínimo Exigido:** **${minBid} DKP**\n` +
      (threadId ? `📌 **Tópico:** <#${threadId}>\n\n` : '\n') +
      `⚠️ *O leilão expirou sem nenhum lance registrado. O item não foi arrematado e está disponível para a liderança definir novo destino ou re-leilão.*`
    )
    .setFooter({ text: `ID do Item: ${itemId} • Auditoria de Leilões` })
    .setTimestamp();

  // Envia no canal de logs com menção da staff para alerta imediato
  const logsChId = channels['logs-dkp'];
  if (logsChId) {
    const ch = await client.channels.fetch(logsChId).catch(() => null);
    if (ch) {
      const staffPing = roles.staff ? `<@&${roles.staff}> ` : '';
      await ch.send({
        content: `${staffPing}⚠️ **Atenção Staff: Item de leilão expirou sem lances!**`,
        embeds: [embed]
      }).catch(err => console.error('Erro ao enviar log sem lances:', err));
    }
  }

  // Envia também no canal de comando da staff se disponível
  const staffChId = channels['comando-staff'];
  if (staffChId && staffChId !== logsChId) {
    const staffCh = await client.channels.fetch(staffChId).catch(() => null);
    if (staffCh) {
      await staffCh.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

// 8. Notificação de Item Entregue via DM para o Vencedor
async function notifyItemDelivered({ client, memberId, nick, items, deliveredBy }) {
  if (!client || !memberId || !items || items.length === 0) return false;
  try {
    const user = await client.users.fetch(memberId).catch(() => null);
    if (!user) {
      console.warn(`[DELIVERY NOTIFY] Usuário Discord ${memberId} não encontrado.`);
      return false;
    }

    const totalDkp = items.reduce((acc, it) => acc + (Number(it.currentBid) || 0), 0);
    const isSingle = items.length === 1;

    const embed = new EmbedBuilder()
      .setTitle(`📦 ENTREGA DE ITEM DE LEILÃO • NOOMERCY`)
      .setColor('#2ECC71')
      .setDescription(
        `Olá <@${memberId}> (${nick ? `\`${nick}\`` : 'Guerreiro'})! 🎉\n\n` +
        `Seu${isSingle ? ' item arrematado' : 's itens arrematados'} no leilão ${isSingle ? 'foi marcado como **ENTREGUE**' : 'foram marcados como **ENTREGUES**'} no jogo!\n\n` +
        `📋 **Detalhes da Entrega:**\n` +
        items.map(it => `• 🗡️ **${it.itemName}** — \`${it.currentBid} DKP\` *(${it.targetClass || 'Livre'})*`).join('\n') +
        `\n\n💰 **Total Investido:** \`${totalDkp} DKP\`\n` +
        (deliveredBy ? `🛡️ **Entregue por:** \`${deliveredBy}\`\n\n` : '\n') +
        `⚠️ *Por favor, confira seu inventário / correio in-game. Caso haja qualquer divergência ou não tenha recebido, procure a liderança.*`
      )
      .setFooter({ text: 'Sistema de Entregas NooMercy • Vlad, o Drácula da Shopee' })
      .setTimestamp();

    await user.send({ embeds: [embed] });
    console.log(`[DELIVERY NOTIFY] DM enviada com sucesso para ${nick || memberId} (${items.length} itens).`);
    return true;
  } catch (err) {
    console.warn(`[DELIVERY NOTIFY] Não foi possível enviar DM para ${memberId} (${nick}):`, err.message);
    return false;
  }
}

module.exports = {
  logAttendance,
  logDisputeApproved,
  logAuctionBidLock,
  logAuctionBidUnlock,
  logAuctionWon,
  logAuctionNoBids,
  logDecayExecuted,
  notifyItemDelivered
};
