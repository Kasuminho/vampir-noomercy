const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');
const { getMember, getMemberDkp, approveCpSubmission, rejectCpSubmission, getCpRanking } = require('../services/memberService');
const { approvePresenceDispute, rejectPresenceDispute, recordEventAttendance } = require('../services/presenceService');
const { executeMonthlyDecay } = require('../services/monthlyDecayService');
const { calculateDkpReward } = require('../services/dkpCalculator');
const { logDisputeApproved, logAttendance } = require('../services/loggerService');
const { getConfig, getLeiloes } = require('../database/db');
const { channels, roles } = require('../config/channels');
const { startCpUpdateTicket, handleTicketButton } = require('../services/ticketService');
const {
  getStaffOverviewData,
  buildStaffOverviewEmbed,
  buildOverdueEmbed,
  buildZeroPresenceEmbed,
  buildRosterPageEmbed,
  buildMemberDetailEmbed,
  buildStaffPanelComponents
} = require('../services/staffMemberService');

function isStaffMember(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return member.roles.cache.has(roles.staff) ||
         member.roles.cache.has(roles.lider) ||
         member.roles.cache.has(roles.admGuerra);
}

async function handleButtonClick(interaction) {
  const { customId, user, member, guild } = interaction;

  // Interações de Tickets Interativos (PT/EN)
  if (customId.startsWith('ticket_')) {
    return await handleTicketButton(interaction);
  }

  // 1. Consultar Meu DKP
  if (customId === 'btn_meu_dkp') {
    const dkpInfo = getMemberDkp(user.id);
    const memberData = getMember(user.id) || {};

    const embed = new EmbedBuilder()
      .setTitle(`💰 EXTRATO DE DKP • ${memberData.nick || user.username}`)
      .setColor('#9B59B6')
      .setDescription(`Status atual da sua carteira no sistema **NooMercy**:`)
      .addFields(
        { name: '💎 DKP Total', value: `**${dkpInfo.totalDkp}** pts`, inline: true },
        { name: '🔒 DKP Bloqueado (Lances)', value: `**${dkpInfo.lockedDkp}** pts`, inline: true },
        { name: '🟢 DKP Livre p/ Gastar', value: `**${dkpInfo.availableDkp}** pts`, inline: true },
        { name: '🔥 Combat Power (CP)', value: memberData.cp ? `**${memberData.cp.toLocaleString('pt-BR')}**` : '*Pendente de envio*', inline: true },
        { name: '⭐ Nível', value: memberData.nivel ? `Nv. ${memberData.nivel}` : '*Pendente*', inline: true },
        { name: '🛡️ Classe', value: memberData.classe || '*Pendente*', inline: true },
        { name: '⚔️ Eventos Participados', value: `${dkpInfo.eventsAttended}`, inline: true },
        { name: '🕒 Último Evento', value: `${dkpInfo.lastEvent}`, inline: true }
      )
      .setFooter({ text: 'Seus pontos sofrem virada mensal (20% mantidos) todo dia 1º.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // 2. Simular DKP
  if (customId === 'btn_simular_dkp') {
    const config = getConfig();
    const eventOptions = Object.values(config.events || {}).map(e => ({
      label: `${e.name} (Base: ${e.baseDkp} DKP)`,
      value: e.key,
      description: `Calcular ganho estimado para ${e.name}`
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_simular_evento')
      .setPlaceholder('Escolha o Boss ou Evento para simular...')
      .addOptions(eventOptions.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(select);

    return interaction.reply({
      content: '🎯 **Selecione abaixo o boss ou evento para simular o ganho de DKP com seus atributos atuais:**',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  // 3. Rank Geral (Ordenado por CP sem exibir valores)
  if (customId === 'btn_rank_geral') {
    const ranking = getCpRanking({ limit: 15 });
    if (ranking.length === 0) {
      return interaction.reply({ content: 'Nenhum membro validado até o momento.', flags: MessageFlags.Ephemeral });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = ranking.map((m, idx) => {
      const pos = medals[idx] || `\`#${idx + 1}\``;
      const nick = m.nick || m.userTag;
      return `${pos} **${nick}** • *${m.classe || 'N/A'}* (Nv. ${m.nivel || '?'})`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏆 RANKING GERAL DA GUILDA • NOOMERCY')
      .setColor('#F1C40F')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Ordenado por poder de combate • Valores de CP confidenciais' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // 4. Rank por Classe (Abre Select de Classes com resposta efêmera)
  if (customId === 'btn_rank_classe') {
    const config = getConfig();
    const classList = config.classes || ['Bloodstained', 'Carnage', 'Akasha', 'Viper', 'Grim Reaper'];
    const options = classList.map(c => ({ label: c, value: c }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_rank_classe')
      .setPlaceholder('Selecione uma classe para ver os concorrentes...')
      .addOptions(options.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(select);

    return interaction.reply({
      content: '🎯 **Selecione a classe que deseja espionar (o rank será exibido apenas para você):**',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  // 5. Botão Iniciar Ticket Interativo de Atualização de CP
  if (customId === 'btn_abrir_update_cp') {
    return await startCpUpdateTicket(interaction);
  }

  // 6. Botão Abrir Modal de Ausência (Com Período e Notificação à Staff)
  if (customId === 'btn_abrir_ausencia') {
    const modal = new ModalBuilder()
      .setCustomId('modal_ausencia')
      .setTitle('Justificativa de Ausência');

    const inputInicio = new TextInputBuilder()
      .setCustomId('input_ausencia_inicio')
      .setLabel('Início da Ausência (Data ou Boss)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 10/11/2026 ou Geena 19h de hoje')
      .setRequired(true);

    const inputFim = new TextInputBuilder()
      .setCustomId('input_ausencia_fim')
      .setLabel('Término / Retorno Previsto')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 15/11/2026 ou Amanhã cedo')
      .setRequired(true);

    const inputMotivo = new TextInputBuilder()
      .setCustomId('input_motivo')
      .setLabel('Motivo Detalhado da Ausência')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Ex: Plantão no trabalho / compromisso de família...')
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputInicio),
      new ActionRowBuilder().addComponents(inputFim),
      new ActionRowBuilder().addComponents(inputMotivo)
    );

    return interaction.showModal(modal);
  }

  // 7. Botão Abrir Seleção de Evento para Contestação
  if (customId === 'btn_abrir_contestacao') {
    const config = getConfig();
    const eventOptions = Object.values(config.events || {}).map(e => ({
      label: `${e.name} (${e.baseDkp} DKP Base)`,
      value: e.key,
      description: `Reivindicar presença para ${e.name}`
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_contestar_evento')
      .setPlaceholder('Selecione o Boss ou Evento que você participou...')
      .addOptions(eventOptions.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(select);

    return interaction.reply({
      content: '🎯 **Selecione abaixo o evento/boss que você participou e a Staff esqueceu de computar sua presença:**',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  // 8. Botão Dar Lance no Leilão (Mostra Saldo Livre e Mínimo)
  if (customId.startsWith('btn_bid_')) {
    const itemId = customId.replace('btn_bid_', '');
    const leiloes = getLeiloes();
    const auction = leiloes.active[itemId];

    if (!auction) {
      return interaction.reply({
        content: '❌ Este leilão não está mais ativo ou já foi encerrado!',
        flags: MessageFlags.Ephemeral
      });
    }

    const dkpInfo = getMemberDkp(user.id);
    const config = getConfig();
    const minIncrement = config.auction?.minBidIncrement || 5;
    const minRequired = auction.currentBid === 0 ? auction.minBid : (auction.currentBid + minIncrement);

    if (dkpInfo.availableDkp < minRequired) {
      return interaction.reply({
        content: `❌ **Saldo DKP Insuficiente para dar lance!**\n\n` +
                 `💰 **Seu Saldo Livre Atual:** \`${dkpInfo.availableDkp} DKP\` *(Travado em outros lances: \`${dkpInfo.lockedDkp} DKP\` | Total: \`${dkpInfo.totalDkp} DKP\`)*\n` +
                 `🏷️ **Lance Mínimo Exigido:** \`${minRequired} DKP\`\n` +
                 `👑 **Líder Atual do Leilão:** ${auction.highestBidderId ? `<@${auction.highestBidderId}> com \`${auction.currentBid} DKP\`` : `\`Ninguém (Mínimo inicial: ${auction.minBid} DKP)\``}\n\n` +
                 `*Dica: Participe dos eventos de Geena/Guerras para acumular mais DKP ou aguarde alguém cobrir seus lances para liberar saldo travado!*`,
        flags: MessageFlags.Ephemeral
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`modal_bid_${itemId}`)
      .setTitle(`Dar Lance: ${auction.itemName.slice(0, 20)}`);

    const inputAmount = new TextInputBuilder()
      .setCustomId('input_bid_amount')
      .setLabel(`Saldo Livre: ${dkpInfo.availableDkp} DKP (Min: ${minRequired})`.slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`Digite ${minRequired} ou mais (Líder: ${auction.currentBid || auction.minBid} DKP)`.slice(0, 75))
      .setValue(String(minRequired))
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(inputAmount));
    return interaction.showModal(modal);
  }

  // --- BOTÕES PRIVADOS DA STAFF ---

  // 9. Staff Aprovar CP
  if (customId.startsWith('btn_aprovar_cp_')) {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas a Staff pode aprovar atualizações de CP!', flags: MessageFlags.Ephemeral });
    }

    const targetUserId = customId.replace('btn_aprovar_cp_', '');
    const result = approveCpSubmission(targetUserId, user.id);

    if (!result.success) {
      return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
    }

    const origEmbed = interaction.message.embeds[0];
    const newEmbed = EmbedBuilder.from(origEmbed)
      .setColor('#2ECC71')
      .setTitle(result.isNewRegistration ? '✅ NOVO ALISTAMENTO APROVADO' : '✅ ATUALIZAÇÃO DE CP APROVADA')
      .addFields({ name: 'Validado por', value: `<@${user.id}>`, inline: true });

    await interaction.update({ embeds: [newEmbed], components: [] });

    // Limpa quaisquer mensagens duplicadas pendentes desse mesmo usuário no canal de auditoria
    interaction.channel.messages.fetch({ limit: 25 }).then(msgs => {
      msgs.forEach(msg => {
        if (msg.id !== interaction.message.id) {
          const hasTargetBtn = msg.components?.[0]?.components?.some(b => b.customId === `btn_aprovar_cp_${targetUserId}`);
          if (hasTargetBtn) {
            msg.delete().catch(() => {});
          }
        }
      });
    }).catch(() => {});

    // Atribui o cargo da classe do jogador no Discord automaticamente e notifica por DM
    const { classRoles } = require('../config/channels');
    guild.members.fetch(targetUserId)
      .then(async m => {
        if (classRoles && result.member.classe) {
          const targetRoleId = classRoles[result.member.classe] || classRoles[result.member.classe.replace('Viper', 'Vyper')];
          const allClassRoleIds = Object.values(classRoles);

          // Remove outras classes se houver
          const rolesToRemove = allClassRoleIds.filter(id => id !== targetRoleId && m.roles.cache.has(id));
          if (rolesToRemove.length > 0) {
            await m.roles.remove(rolesToRemove).catch(() => {});
          }

          // Adiciona o cargo da classe aprovada
          if (targetRoleId && !m.roles.cache.has(targetRoleId)) {
            await m.roles.add(targetRoleId).catch(() => {});
          }
        }

        // Mensagem na DM diferenciada: Alistamento vs Atualização Semanal
        if (result.isNewRegistration) {
          await m.send(
            `🦇 **BEM-VINDO À NOOMERCY!** ⚔️\n\n` +
            `Seu alistamento com o personagem **${result.member.nick}** na classe **${result.member.classe}** (${(result.member.cp || 0).toLocaleString('pt-BR')} CP) foi **APROVADO** pela Staff!\n` +
            `🛡️ Você recebeu seu cargo **${result.member.classe}** e os canais de membros da guilda foram liberados para você!\n\n` +
            `*Fique atento aos avisos em <#${channels['anuncios'] || 'anúncios'}> e bom jogo!*`
          ).catch(() => {});
        } else if (result.classChanged) {
          await m.send(
            `🔄 **MUDANÇA DE CLASSE APROVADA!** 🦇\n\n` +
            `Sua ficha de **${result.member.nick}** foi atualizada para a nova classe **${result.member.classe}** com **${(result.member.cp || 0).toLocaleString('pt-BR')} CP** e **Nv. ${result.member.nivel}**!\n` +
            `🛡️ Seu cargo de classe foi atualizado no servidor.`
          ).catch(() => {});
        } else {
          await m.send(
            `✅ **ATUALIZAÇÃO DE CP APROVADA!** 🦇\n\n` +
            `Sua pontuação de **${result.member.nick}** foi atualizada com sucesso para **${(result.member.cp || 0).toLocaleString('pt-BR')} CP** e **Nv. ${result.member.nivel}**!\n` +
            `🔥 Seus novos valores já estão valendo para a pontuação de DKP nos próximos bosses da guilda.`
          ).catch(() => {});
        }
      })
      .catch(() => {});

    return;
  }

  // 10. Staff Rejeitar CP
  if (customId.startsWith('btn_rejeitar_cp_')) {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas a Staff pode rejeitar!', flags: MessageFlags.Ephemeral });
    }

    const targetUserId = customId.replace('btn_rejeitar_cp_', '');
    const result = rejectCpSubmission(targetUserId, user.id, 'Print ilegível ou divergente');

    if (!result.success) {
      return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
    }

    const origEmbed = interaction.message.embeds[0];
    const newEmbed = EmbedBuilder.from(origEmbed)
      .setColor('#E74C3C')
      .setTitle('❌ ATUALIZAÇÃO DE CP RECUSADA')
      .addFields({ name: 'Recusado por', value: `<@${user.id}>`, inline: true });

    await interaction.update({ embeds: [newEmbed], components: [] });

    // Limpa quaisquer mensagens duplicadas pendentes desse mesmo usuário no canal de auditoria
    interaction.channel.messages.fetch({ limit: 25 }).then(msgs => {
      msgs.forEach(msg => {
        if (msg.id !== interaction.message.id) {
          const hasTargetBtn = msg.components?.[0]?.components?.some(b => b.customId === `btn_aprovar_cp_${targetUserId}`);
          if (hasTargetBtn) {
            msg.delete().catch(() => {});
          }
        }
      });
    }).catch(() => {});

    guild.members.fetch(targetUserId)
      .then(m => m.send(`⚠️ Sua atualização de CP na guild **NooMercy** foi **RECUSADA** pela Staff (Print ilegível ou divergente). Por favor, reenvie!`).catch(() => {}))
      .catch(() => {});

    return;
  }

  // 11. Staff Aprovar Contestação de Presença
  if (customId.startsWith('btn_aprovar_disp_')) {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas a Staff pode aprovar presenças!', flags: MessageFlags.Ephemeral });
    }

    const disputeId = customId.replace('btn_aprovar_disp_', '');
    const res = approvePresenceDispute(disputeId, user.id);

    if (!res.success) {
      return interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral });
    }

    const origEmbed = interaction.message.embeds[0];
    const newEmbed = EmbedBuilder.from(origEmbed)
      .setColor('#2ECC71')
      .setTitle('✅ CONTESTAÇÃO DE PRESENÇA APROVADA')
      .addFields(
        { name: 'DKP Creditado', value: `+**${res.calc.finalDkp}** DKP (Mult. CP: ${res.calc.multCp}x, Mult. Nv: ${res.calc.multLvl}x)`, inline: false },
        { name: 'Aprovado por', value: `<@${user.id}>`, inline: true }
      );

    await interaction.update({ embeds: [newEmbed], components: [] });

    // Envia auditoria transparente em #logs-dkp
    await logDisputeApproved({
      client: interaction.client,
      eventName: res.dispute.eventName,
      userId: res.dispute.userId,
      userTag: res.dispute.userTag,
      dkpEarned: res.calc.finalDkp,
      approvedBy: user.id,
      newBalance: res.newBalance
    });

    guild.members.fetch(res.dispute.userId)
      .then(m => m.send(`🎉 Sua contestação de presença no evento **${res.dispute.eventName}** foi aprovada! Você recebeu **+${res.calc.finalDkp} DKP**! / Attendance dispute approved!`).catch(() => {}))
      .catch(() => {});

    return;
  }

  // 12. Staff Rejeitar Contestação
  if (customId.startsWith('btn_rejeitar_disp_')) {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas a Staff pode recusar!', flags: MessageFlags.Ephemeral });
    }

    const disputeId = customId.replace('btn_rejeitar_disp_', '');
    const res = rejectPresenceDispute(disputeId, user.id);

    if (!res.success) {
      return interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral });
    }

    const origEmbed = interaction.message.embeds[0];
    const newEmbed = EmbedBuilder.from(origEmbed)
      .setColor('#E74C3C')
      .setTitle('❌ CONTESTAÇÃO DE PRESENÇA REJEITADA')
      .addFields({ name: 'Rejeitado por', value: `<@${user.id}>`, inline: true });

    await interaction.update({ embeds: [newEmbed], components: [] });
    return;
  }

  // 13. Staff Testar Virada Mensal
  if (customId === 'btn_staff_reset_mensal') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const logsId = channels['logs-dkp'];
    const res = executeMonthlyDecay(interaction.client, logsId, `Staff: ${user.tag || user.username}`);

    return interaction.reply({
      content: `✅ Virada mensal executada com sucesso em teste! **${res.totalDecayedMembers}** jogadores processados. Detalhes enviados em <#${logsId}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 14. Staff Abrir Modal de Presença em Lote
  if (customId === 'btn_staff_presenca_lote') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_staff_presenca_lote')
      .setTitle('Marcar Presença em Lote');

    const inputEvento = new TextInputBuilder()
      .setCustomId('input_lote_evento')
      .setLabel('Evento / Boss')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: Geena 15:00 ou geena_15')
      .setValue('Geena 15:00')
      .setRequired(true);

    const inputJogadores = new TextInputBuilder()
      .setCustomId('input_lote_jogadores')
      .setLabel('Lista de Nicks ou @Menções')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Exemplo:\nNick1\nNick2\n@Membro3\n(separe por espaço, vírgula ou linha)')
      .setRequired(true);

    const inputLastHit = new TextInputBuilder()
      .setCustomId('input_lote_lasthit')
      .setLabel('🎯 Last Hit (+10 DKP Bônus, Opcional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Nick in-game ou @menção de quem deu o golpe final')
      .setRequired(false);

    const inputDkp = new TextInputBuilder()
      .setCustomId('input_lote_dkp')
      .setLabel('DKP Base (opcional, padrão: 30)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('30')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputEvento),
      new ActionRowBuilder().addComponents(inputJogadores),
      new ActionRowBuilder().addComponents(inputLastHit),
      new ActionRowBuilder().addComponents(inputDkp)
    );

    return interaction.showModal(modal);
  }

  // 14.1 Staff Marcar Presença por Voz (Call do Boss)
  if (customId === 'btn_staff_presenca_voz') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff / Staff only!', flags: MessageFlags.Ephemeral });
    }

    const voiceChannel = member.voice?.channel || guild.channels.cache.get(channels['🔊-boss-auditorio']);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      return interaction.reply({
        content: '❌ Você precisa estar em um canal de voz para usar este botão!\n*You must be inside a voice channel!*',
        flags: MessageFlags.Ephemeral
      });
    }

    const voiceMembers = voiceChannel.members.filter(m => !m.user.bot);
    if (voiceMembers.size === 0) {
      return interaction.reply({
        content: `❌ Nenhum membro encontrado na call **${voiceChannel.name}**!\n*No members found in voice channel!*`,
        flags: MessageFlags.Ephemeral
      });
    }

    const membersList = voiceMembers.map(m => ({ id: m.id, tag: m.user.tag || m.user.username }));
    const rec = recordEventAttendance({
      eventKey: 'custom',
      eventName: `Call: ${voiceChannel.name}`,
      membersList,
      registeredBy: user.tag || user.username
    });

    await logAttendance({
      client: interaction.client,
      eventName: rec.eventName,
      baseDkp: rec.baseDkp,
      registeredBy: `<@${user.id}>`,
      awardedList: rec.members
    });

    return interaction.reply({
      content: `✅ **Presença de voz registrada para ${rec.totalMembers} membros na call ${voiceChannel.name}!**\nDetalhes auditados enviados em <#${channels['logs-dkp']}>.\n*Voice attendance recorded successfully!*`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 15. Staff Criar Leilão de Drop (Abre Modal)
  if (customId === 'btn_staff_novo_leilao') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_staff_criar_leilao')
      .setTitle('Criar Leilão de Drop');

    const inputItem = new TextInputBuilder()
      .setCustomId('input_leilao_item')
      .setLabel('Nome do Item Dropado')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: Montante da Ruína Heroico')
      .setRequired(true);

    const inputMinBid = new TextInputBuilder()
      .setCustomId('input_leilao_min_bid')
      .setLabel('Lance Mínimo Inicial (em DKP)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('30')
      .setValue('30')
      .setRequired(true);

    const inputDuracao = new TextInputBuilder()
      .setCustomId('input_leilao_duracao')
      .setLabel('Duração em Minutos (ex: 15)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('15')
      .setValue('15')
      .setRequired(true);

    const inputImg = new TextInputBuilder()
      .setCustomId('input_leilao_imagem')
      .setLabel('Link da Foto do Item (opcional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://cdn.discordapp.com/...')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputItem),
      new ActionRowBuilder().addComponents(inputMinBid),
      new ActionRowBuilder().addComponents(inputDuracao),
      new ActionRowBuilder().addComponents(inputImg)
    );

    return interaction.showModal(modal);
  }

  // 16. Staff Painel de Membros
  if (customId === 'btn_staff_painel_membros' || customId === 'btn_staff_mem_overview' || customId === 'btn_staff_mem_refresh') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const data = await getStaffOverviewData(guild);
    const embed = buildStaffOverviewEmbed(data);
    const components = buildStaffPanelComponents('overview');

    if (customId === 'btn_staff_painel_membros') {
      return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    } else {
      return interaction.update({ embeds: [embed], components });
    }
  }

  // 16.1 Staff Ver CP Atrasado / Sem Envio
  if (customId === 'btn_staff_mem_overdue') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const data = await getStaffOverviewData(guild);
    const embed = buildOverdueEmbed(data);
    const components = buildStaffPanelComponents('overdue');

    return interaction.update({ embeds: [embed], components });
  }

  // 16.1.1 Staff Ver Membros sem Presença em Boss (0 Presenças)
  if (customId === 'btn_staff_mem_zero_pres') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const data = await getStaffOverviewData(guild);
    const embed = buildZeroPresenceEmbed(data);
    const components = buildStaffPanelComponents('zero_pres');

    return interaction.update({ embeds: [embed], components });
  }

  // 16.2 Staff Ver Roster Completo Paginado
  if (customId === 'btn_staff_mem_roster_main' || customId.startsWith('btn_staff_mem_page_prev_') || customId.startsWith('btn_staff_mem_page_next_') || customId.startsWith('btn_staff_mem_roster_')) {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    let pageIndex = 0;
    if (customId.startsWith('btn_staff_mem_page_prev_')) {
      pageIndex = parseInt(customId.replace('btn_staff_mem_page_prev_', ''), 10) || 0;
    } else if (customId.startsWith('btn_staff_mem_page_next_')) {
      pageIndex = parseInt(customId.replace('btn_staff_mem_page_next_', ''), 10) || 0;
    } else if (customId.startsWith('btn_staff_mem_roster_') && customId !== 'btn_staff_mem_roster_main') {
      pageIndex = parseInt(customId.replace('btn_staff_mem_roster_', ''), 10) || 0;
    }

    const data = await getStaffOverviewData(guild);
    const { embed, currentPage, totalPages } = buildRosterPageEmbed(data, pageIndex);
    const components = buildStaffPanelComponents('roster', currentPage, totalPages);

    return interaction.update({ embeds: [embed], components });
  }

  // 16.3 Staff Abrir Modal para Consultar Membro Específico
  if (customId === 'btn_staff_mem_lookup') {
    if (!isStaffMember(member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_staff_mem_lookup')
      .setTitle('Consultar Membro • Staff');

    const inputMember = new TextInputBuilder()
      .setCustomId('input_staff_lookup_member')
      .setLabel('Nick In-game, @Menção ou ID Discord')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: Sasuke ou 909786062602272802')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(inputMember));
    return interaction.showModal(modal);
  }
}

module.exports = { handleButtonClick };
