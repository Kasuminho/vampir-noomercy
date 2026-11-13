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

  const lines = validAwarded.slice(0, 25).map(m => {
    const lhText = m.isLastHit ? ' • 🎯 **Last Hit: +10 DKP**' : '';
    const points = m.totalAwardedDkp || m.calc?.finalDkp || 0;
    return `• <@${m.userId}> (\`${m.nick || m.userTag}\`): **+${points} DKP** *(Saldo: \`${m.newTotalDkp} DKP\`${lhText})*`;
  });

  let lastHitSection = '';
  const lhList = Array.isArray(lastHit) ? lastHit : (lastHit ? [lastHit] : []);
  if (lhList.length > 0) {
    const names = lhList.map(lh => `<@${lh.userId}> (\`${lh.nick || lh.userId}\`)`).join(', ');
    lastHitSection = `🎯 **Last Hit (+10 DKP Bônus${lhList.length > 1 ? ' cada' : ''}):** ${names}\n`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ LOG DKP • PRESENÇA / ATTENDANCE • ${eventName.toUpperCase()}`)
    .setColor('#2ECC71')
    .setDescription(
      `**Evento / Event:** \`${eventName}\`\n` +
      `**DKP Base / Base DKP:** \`${baseDkp} DKP\`\n` +
      lastHitSection +
      `**Registrado por / Registered by:** ${registeredBy}\n\n` +
      `**Pontuações Concedidas / Awarded Members (${validAwarded.length}):**\n` +
      (lines.length > 0 ? lines.join('\n') : '*Nenhum membro pontuado.*') +
      (validAwarded.length > 25 ? `\n*...e mais ${validAwarded.length - 25} membros.*` : '')
    )
    .setFooter({ text: 'NooMercy DKP Audit • Vlad, o Drácula da Shopee' })
    .setTimestamp();

  if (cutAwarded.length > 0) {
    const cutLines = cutAwarded.slice(0, 10).map(m =>
      `🚫 <@${m.userId}>: **0 DKP** (${m.calc?.cutoffStatus?.details?.failedReason || 'Sem CP aprovado / No approved CP'})`
    );
    embed.addFields({
      name: `⚠️ Membros Cortados / Blocked Members (${cutAwarded.length})`,
      value: cutLines.join('\n')
    });
  }

  await sendLog(client, embed);
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

module.exports = {
  logAttendance,
  logDisputeApproved,
  logAuctionBidLock,
  logAuctionBidUnlock,
  logAuctionWon,
  logDecayExecuted
};
