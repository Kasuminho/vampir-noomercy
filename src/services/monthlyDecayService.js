const cron = require('node-cron');
const { getDkp, saveDkp, getConfig } = require('../database/db');
const { EmbedBuilder } = require('discord.js');

function executeMonthlyDecay(client, channelLogsId, triggeredBy = 'Sistema Automático (Cron)') {
  const dkpData = getDkp();
  const config = getConfig();
  const retentionPercent = config.decay?.retentionPercent || 20;
  const decayMultiplier = retentionPercent / 100;

  let totalDecayedMembers = 0;
  let totalDkpBurned = 0;
  let totalDkpRetained = 0;

  const now = new Date();
  const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  for (const userId of Object.keys(dkpData.balances)) {
    const rec = dkpData.balances[userId];
    const previousTotal = rec.totalDkp || 0;

    if (previousTotal > 0) {
      const retainedTotal = Math.floor(previousTotal * decayMultiplier);
      const burned = previousTotal - retainedTotal;

      rec.totalDkp = retainedTotal;
      rec.lockedDkp = 0; // destrava qualquer pendência residual
      totalDkpBurned += burned;
      totalDkpRetained += retainedTotal;
      totalDecayedMembers++;

      dkpData.history.unshift({
        id: `decay_${Date.now()}_${userId}`,
        userId,
        amount: -burned,
        newBalance: retainedTotal,
        reason: `Virada Mensal (${retentionPercent}% mantido)`,
        meta: { previousTotal, burned, retainedTotal, triggeredBy },
        date: new Date().toISOString()
      });
    }
  }

  saveDkp(dkpData);

  const embed = new EmbedBuilder()
    .setTitle('🔄 VIRADA DE CICLO MENSAL DO DKP EXECUTADA')
    .setColor('#9B59B6')
    .setDescription(`A virada mensal de DKP referente a **${monthName}** foi concluída com sucesso!\nRegra aplicada: **${retentionPercent}% de retenção** (${100 - retentionPercent}% queimado).`)
    .addFields(
      { name: '👥 Jogadores Processados', value: `${totalDecayedMembers}`, inline: true },
      { name: '🔥 DKP Queimado', value: `${totalDkpBurned.toLocaleString('pt-BR')} pts`, inline: true },
      { name: '💰 DKP Retido Ativo', value: `${totalDkpRetained.toLocaleString('pt-BR')} pts`, inline: true },
      { name: '⚙️ Executado por', value: `${triggeredBy}`, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: 'Sistema de Economia NooMercy DKP' });

  if (client && channelLogsId) {
    client.channels.fetch(channelLogsId)
      .then(ch => {
        if (ch) ch.send({ embeds: [embed] });
      })
      .catch(err => console.error('Erro ao enviar log de virada mensal:', err));
  }

  return {
    success: true,
    totalDecayedMembers,
    totalDkpBurned,
    totalDkpRetained,
    embed
  };
}

function startDecayScheduler(client, channelLogsId) {
  // Roda todo dia 1 de cada mês às 00:00 (GMT-3)
  cron.schedule('0 0 1 * *', () => {
    console.log('[CRON] Executando virada de ciclo mensal...');
    executeMonthlyDecay(client, channelLogsId, 'Cron Automático (Dia 1)');
  }, {
    timezone: 'America/Sao_Paulo'
  });
  console.log('[CRON] Agendador de virada mensal ativo (Dia 1 de cada mês às 00:00 GMT-3).');
}

module.exports = {
  executeMonthlyDecay,
  startDecayScheduler
};
