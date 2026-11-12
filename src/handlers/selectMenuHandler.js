const {
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require('discord.js');
const { getMember, getCpRanking } = require('../services/memberService');
const { calculateDkpReward } = require('../services/dkpCalculator');
const { getConfig } = require('../database/db');
const { startDisputeTicket } = require('../services/ticketService');

async function handleSelectMenu(interaction) {
  const { customId, values, user } = interaction;

  // 1. Simulação por Evento Selecionado
  if (customId === 'select_simular_evento') {
    const eventKey = values[0];
    const config = getConfig();
    const eventConfig = config.events[eventKey] || { name: 'Boss Geral', baseDkp: 30 };

    const memberData = getMember(user.id) || {};
    const cp = memberData.cp || config.cpCalculation?.baseCp || 50000;
    const level = memberData.nivel || config.levelCalculation?.baseLevel || 55;

    const calc = calculateDkpReward({
      baseDkp: eventConfig.baseDkp,
      cp,
      level
    });

    const embed = new EmbedBuilder()
      .setTitle(`🧮 SIMULADOR DE DKP • ${eventConfig.name}`)
      .setColor('#2ECC71')
      .setDescription(`Cálculo de rendimento para o jogador **${memberData.nick || user.username}**:`)
      .addFields(
        { name: '🔥 Seu Combat Power', value: `${cp.toLocaleString('pt-BR')} CP`, inline: true },
        { name: '⭐ Seu Nível', value: `Nv. ${level}`, inline: true },
        { name: '🛡️ Sua Classe', value: `${memberData.classe || 'N/A'}`, inline: true },
        { name: '🎯 DKP Base do Evento', value: `\`${calc.baseDkp} DKP\``, inline: true },
        { name: '📈 Multiplicador CP', value: `\`${calc.multCp}x\``, inline: true },
        { name: '📈 Multiplicador Nível', value: `\`${calc.multLvl}x\``, inline: true },
        { name: '✨ DKP TOTAL ESTIMADO', value: `**+${calc.finalDkp} DKP** (Mult Total: ${calc.combinedMultiplier}x)`, inline: false }
      )
      .setFooter({ text: 'Quanto mais forte você fica, mais DKP você gera para a guild!' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // 3. Seleção de Evento para Iniciar Ticket de Contestação
  if (customId === 'select_contestar_evento') {
    const eventKey = values[0];
    return await startDisputeTicket(interaction, eventKey);
  }

  // 2. Rank por Classe Selecionada (Ordenado por CP sem exibir valores)
  if (customId === 'select_rank_classe') {
    const selectedClass = values[0];
    const ranking = getCpRanking({ classe: selectedClass, limit: 15 });

    if (ranking.length === 0) {
      return interaction.reply({
        content: `Nenhum jogador da classe **${selectedClass}** possui cadastro validado no momento.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = ranking.map((m, idx) => {
      const pos = medals[idx] || `\`#${idx + 1}\``;
      const nick = m.nick || m.userTag;
      return `${pos} **${nick}** (Nv. ${m.nivel || '?'})`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎯 RANKING • CLASSE: ${selectedClass.toUpperCase()}`)
      .setColor('#9B59B6')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Ordenado por poder de combate • Valores de CP confidenciais' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // 3. Seleção de Evento para Iniciar Ticket de Contestação
  if (customId === 'select_contestar_evento') {
    const eventKey = values[0];
    return await startDisputeTicket(interaction, eventKey);
  }
}

module.exports = { handleSelectMenu };
