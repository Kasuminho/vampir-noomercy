const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const { submitCpUpdate, getMember, getMemberDkp, getCpRanking, resolveMembersBatch } = require('../services/memberService');
const { calculateDkpReward } = require('../services/dkpCalculator');
const { recordEventAttendance, submitPresenceDispute, registerAbsence } = require('../services/presenceService');
const { startAuction, placeBid, finalizeAuction, renderAuctionEmbed, updateAuctionDisplay } = require('../services/auctionService');
const { executeMonthlyDecay } = require('../services/monthlyDecayService');
const { logAttendance, logAuctionBidLock, logAuctionBidUnlock } = require('../services/loggerService');
const { getConfig, saveConfig, getLeiloes, saveLeiloes } = require('../database/db');
const { channels, roles } = require('../config/channels');
const {
  getStaffOverviewData,
  buildStaffOverviewEmbed,
  buildOverdueEmbed,
  buildRosterPageEmbed,
  buildMemberDetailEmbed,
  buildStaffPanelComponents
} = require('../services/staffMemberService');
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
} = require('../ui/panels');

function isStaffMember(member) {
  if (!member) return false;
  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions && member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.roles && member.roles.cache) {
    return member.roles.cache.has(roles.staff) ||
           member.roles.cache.has(roles.lider) ||
           member.roles.cache.has(roles.admGuerra);
  }
  return false;
}

function formatPresenceMemberLine(m) {
  const lastHitTag = m.isLastHit ? ' • 🎯 **[LAST HIT +10 DKP]**' : '';
  const points = m.totalAwardedDkp || m.calc?.finalDkp || 0;
  if (m.calc.cutoffStatus && m.calc.cutoffStatus.isCut) {
    return `🚫 <@${m.userId}> (${m.nick || m.userTag}): **0 DKP** *(Cortado: ${m.calc.cutoffStatus.details.failedReason})*${lastHitTag}`;
  }
  if (m.calc.cutoffStatus && m.calc.cutoffStatus.inGracePeriod) {
    return `⚠️ <@${m.userId}> (${m.nick || m.userTag}): **+${points} DKP** *(Aviso: meta vence em ${m.calc.cutoffStatus.details.daysLeft}d)*${lastHitTag}`;
  }
  return `• <@${m.userId}> (${m.nick || m.userTag}): **+${points} DKP** *(Mult: ${m.calc.combinedMultiplier}x)*${lastHitTag}`;
}

async function handleSlashCommand(interaction) {
  const { commandName, options, user, guild } = interaction;

  // 1. /atualizar-char
  if (commandName === 'atualizar-char') {
    const nick = options.getString('nick');
    const classe = options.getString('classe');
    const nivel = options.getInteger('nivel');
    const cp = options.getInteger('cp');
    const printAttachment = options.getAttachment('print');

    const sub = submitCpUpdate({
      userId: user.id,
      userTag: user.tag || user.username,
      nick,
      classe,
      nivel,
      cp,
      printUrl: printAttachment ? printAttachment.url : null
    });

    // Enviar para canal de auditoria
    const auditChId = channels['auditoria-cp'];
    if (auditChId) {
      const ch = await interaction.client.channels.fetch(auditChId).catch(() => null);
      if (ch) {
        const embed = new EmbedBuilder()
          .setTitle('🛡️ NOVA ATUALIZAÇÃO SEMANAL DE PERSONAGEM')
          .setColor('#3498DB')
          .setDescription(`Jogador: <@${user.id}> \`(${user.tag || user.username})\``)
          .addFields(
            { name: '🎮 Nick', value: `\`${nick}\``, inline: true },
            { name: '🛡️ Classe', value: `\`${classe}\``, inline: true },
            { name: '⭐ Nível', value: `\`Nv. ${nivel}\``, inline: true },
            { name: '🔥 Combat Power (CP)', value: `**${cp.toLocaleString('pt-BR')} CP**`, inline: true }
          )
          .setImage(printAttachment ? printAttachment.url : null)
          .setFooter({ text: `ID: ${sub.submissionId}` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_aprovar_cp_${user.id}`)
            .setLabel('Aprovar CP')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
          new ButtonBuilder()
            .setCustomId(`btn_rejeitar_cp_${user.id}`)
            .setLabel('Rejeitar CP')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
        );

        await ch.send({ embeds: [embed], components: [row] });
      }
    }

    return interaction.reply({
      content: `✅ Seus dados foram enviados com sucesso!\n🎮 **${nick}** (${classe}) • Nv. **${nivel}** • **${cp.toLocaleString('pt-BR')} CP**\n*Aguarde a aprovação da Staff no canal de auditoria para começar a pontuar com seus novos valores.*`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 2. /meu-dkp
  if (commandName === 'meu-dkp') {
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
      .setFooter({ text: 'Virada mensal de 20% todo dia 1º.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // 3. /simular-dkp
  if (commandName === 'simular-dkp') {
    const config = getConfig();
    const eventKey = options.getString('evento') || 'geena_15';
    const eventConfig = config.events[eventKey] || { name: 'Boss Geral', baseDkp: 30 };

    const memberData = getMember(user.id) || {};
    const simulatedCp = options.getInteger('cp_simulado');
    const simulatedLvl = options.getInteger('nivel_simulado');

    const cp = simulatedCp || memberData.cp || config.cpCalculation?.baseCp || 50000;
    const level = simulatedLvl || memberData.nivel || config.levelCalculation?.baseLevel || 55;

    const calc = calculateDkpReward({
      baseDkp: eventConfig.baseDkp,
      cp,
      level
    });

    const embed = new EmbedBuilder()
      .setTitle(`🧮 SIMULADOR DE DKP • ${eventConfig.name}`)
      .setColor('#2ECC71')
      .setDescription(`Simulação de recompensa para **${memberData.nick || user.username}**:`)
      .addFields(
        { name: '🔥 Combat Power', value: `${cp.toLocaleString('pt-BR')} CP ${simulatedCp ? '*(Simulado)*' : ''}`, inline: true },
        { name: '⭐ Nível', value: `Nv. ${level} ${simulatedLvl ? '*(Simulado)*' : ''}`, inline: true },
        { name: '🎯 DKP Base', value: `\`${calc.baseDkp} DKP\``, inline: true },
        { name: '📈 Mult. CP', value: `\`${calc.multCp}x\``, inline: true },
        { name: '📈 Mult. Nível', value: `\`${calc.multLvl}x\``, inline: true },
        { name: '✨ DKP TOTAL ESTIMADO', value: `**+${calc.finalDkp} DKP** (Mult Total: ${calc.combinedMultiplier}x)`, inline: false }
      )
      .setFooter({ text: 'NooMercy DKP System' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // 4. /rank
  if (commandName === 'rank') {
    const sub = options.getSubcommand();

    if (sub === 'geral') {
      const limit = options.getInteger('limite') || 15;
      const ranking = getCpRanking({ limit });

      if (ranking.length === 0) {
        return interaction.reply({ content: 'Nenhum jogador cadastrado no ranking.', flags: MessageFlags.Ephemeral });
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
        .setFooter({ text: `Top ${ranking.length} jogadores ordenados por poder • Valores de CP confidenciais` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'classe') {
      const selectedClass = options.getString('classe');
      const ranking = getCpRanking({ classe: selectedClass, limit: 15 });

      if (ranking.length === 0) {
        return interaction.reply({ content: `Nenhum membro da classe **${selectedClass}** cadastrado.`, flags: MessageFlags.Ephemeral });
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
  }

  // 5. /justificar-ausencia
  if (commandName === 'justificar-ausencia') {
    const eventoOuData = options.getString('evento_ou_data');
    const motivo = options.getString('motivo');

    const memberData = getMember(user.id) || {};
    const nickText = memberData.nick ? `\`${memberData.nick}\` (${memberData.classe || 'Sem classe'})` : `\`${user.tag || user.username}\``;

    const rec = registerAbsence({
      userId: user.id,
      userTag: user.tag || user.username,
      eventOrDate: eventoOuData,
      reason: motivo
    });

    // Notifica no canal de auditoria da Staff
    const auditChId = channels['auditoria-presencas'];
    if (auditChId) {
      const ch = await interaction.client.channels.fetch(auditChId).catch(() => null);
      if (ch) {
        const staffEmbed = new EmbedBuilder()
          .setTitle('📝 NOVA JUSTIFICATIVA DE AUSÊNCIA / ABSENCE NOTICE')
          .setColor('#E67E22')
          .setDescription(`O membro <@${user.id}> registrou uma ausência via comando:`)
          .addFields(
            { name: '👤 Jogador', value: `<@${user.id}> • ${nickText}`, inline: false },
            { name: '📅 Período / Data', value: `\`${eventoOuData}\``, inline: true },
            { name: '📋 Motivo', value: motivo, inline: false }
          )
          .setFooter({ text: `ID: ${rec.id} • Assiduidade protegida` })
          .setTimestamp();
        await ch.send({ embeds: [staffEmbed] });
      }
    }

    const logsChannelId = channels['logs-dkp'];
    if (logsChannelId && logsChannelId !== auditChId) {
      const ch = await interaction.client.channels.fetch(logsChannelId).catch(() => null);
      if (ch) {
        const embed = new EmbedBuilder()
          .setTitle('📝 LOG • AUSÊNCIA JUSTIFICADA')
          .setColor('#E67E22')
          .addFields(
            { name: 'Membro', value: `<@${user.id}> • ${nickText}`, inline: true },
            { name: 'Data / Período', value: eventoOuData, inline: true },
            { name: 'Motivo', value: motivo, inline: false }
          )
          .setTimestamp();
        await ch.send({ embeds: [embed] }).catch(() => {});
      }
    }

    return interaction.reply({
      content: `✅ **Ausência registrada com sucesso para:** \`${eventoOuData}\`!\n*A liderança da guild foi notificada para proteger sua assiduidade e vaga.*`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 6. /contestar-presenca
  if (commandName === 'contestar-presenca') {
    const eventKey = options.getString('evento');
    const print = options.getAttachment('print');
    const obs = options.getString('observacao') || 'Sem observações';
    const config = getConfig();
    const eventConfig = config.events[eventKey] || { name: eventKey, baseDkp: 30 };

    const dispute = submitPresenceDispute({
      userId: user.id,
      userTag: user.tag || user.username,
      eventKey,
      eventName: eventConfig.name,
      printUrl: print ? print.url : null,
      note: obs
    });

    const auditPresId = channels['auditoria-presencas'];
    if (auditPresId) {
      const ch = await interaction.client.channels.fetch(auditPresId).catch(() => null);
      if (ch) {
        const embed = new EmbedBuilder()
          .setTitle('🔍 REVISÃO DE PRESENÇA SOLICITADA')
          .setColor('#E74C3C')
          .addFields(
            { name: 'Jogador', value: `<@${user.id}> \`(${user.tag || user.username})\``, inline: true },
            { name: 'Boss / Evento', value: `\`${dispute.eventName}\` *(Base: ${dispute.baseDkp} DKP)*`, inline: true },
            { name: 'Obs / Piloto', value: obs, inline: false }
          )
          .setImage(print ? print.url : null)
          .setFooter({ text: `ID: ${dispute.disputeId}` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_aprovar_disp_${dispute.disputeId}`)
            .setLabel('Validar Presença')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
          new ButtonBuilder()
            .setCustomId(`btn_rejeitar_disp_${dispute.disputeId}`)
            .setLabel('Rejeitar')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
        );

        await ch.send({ embeds: [embed], components: [row] });
      }
    }

    return interaction.reply({
      content: `✅ Sua contestação para o evento **${dispute.eventName}** (${dispute.baseDkp} DKP Base) foi enviada para validação da Staff no canal de auditoria!`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 7. /presenca (Staff)
  if (commandName === 'presenca') {
    const sub = options.getSubcommand();
    const eventKey = options.getString('evento');
    const dkpManual = options.getInteger('dkp_base_manual');

    if (sub === 'marcar-lote') {
      const inputJogadores = options.getString('jogadores');
      const lastHitInput = options.getString('last_hit');
      const { resolved, unresolved } = resolveMembersBatch(inputJogadores);

      if (resolved.length === 0) {
        return interaction.reply({
          content: `❌ Nenhum jogador válido foi identificado na lista fornecida.\n${unresolved.length > 0 ? `Itens não encontrados: \`${unresolved.join(', ')}\`` : ''}`,
          flags: MessageFlags.Ephemeral
        });
      }

      const rec = recordEventAttendance({
        eventKey,
        customBaseDkp: dkpManual,
        membersList: resolved,
        registeredBy: user.tag || user.username,
        lastHitInput
      });

      const lines = rec.members.slice(0, 25).map(m => formatPresenceMemberLine(m));

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ PRESENÇA EM LOTE REGISTRADA: ${rec.eventName}`)
        .setColor('#2ECC71')
        .setDescription(`Foram pontuados com sucesso **${rec.totalMembers} jogadores**!\n\n${lines.join('\n')}${rec.totalMembers > 25 ? `\n*...e mais ${rec.totalMembers - 25} jogadores.*` : ''}`)
        .addFields(
          { name: '🎯 DKP Base', value: `\`${rec.baseDkp} pts\``, inline: true },
          { name: '🛡️ Registrado por', value: `<@${user.id}>`, inline: true }
        )
        .setFooter({ text: 'DKP ponderado por CP e Nível creditado com sucesso!' })
        .setTimestamp();

      if (rec.lastHits && rec.lastHits.length > 0) {
        const lhList = rec.lastHits.map(lh => `<@${lh.userId}> \`(${lh.nick})\``).join(', ');
        embed.addFields({
          name: `🎯 Last Hit (+10 DKP Bônus Fixo${rec.lastHits.length > 1 ? ' cada' : ''})`,
          value: lhList,
          inline: true
        });
      } else if (rec.lastHit) {
        const single = Array.isArray(rec.lastHit) ? rec.lastHit[0] : rec.lastHit;
        if (single) {
          embed.addFields({
            name: '🎯 Last Hit (+10 DKP Bônus Fixo)',
            value: `<@${single.userId}> \`(${single.nick || single.tag})\``,
            inline: true
          });
        }
      }

      if (unresolved.length > 0) {
        embed.addFields({
          name: '⚠️ Não Encontrados no Discord (Sem Cadastro)',
          value: `\`${unresolved.join(', ')}\`\n*(Peça para eles enviarem seus dados via \`/atualizar-char\`)*`,
          inline: false
        });
      }

      await logAttendance({
        client: interaction.client,
        eventName: rec.eventName,
        baseDkp: rec.baseDkp,
        registeredBy: `<@${user.id}>`,
        awardedList: rec.members,
        lastHit: rec.lastHits || rec.lastHit
      });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'marcar-voz') {
      let voiceChannel = options.getChannel('canal_voz');
      const lastHitInput = options.getString('last_hit');
      if (!voiceChannel) {
        // Usa o canal de voz de auditorio salvo ou busca na guilda
        const defaultVoiceId = channels['🔊-boss-auditorio'];
        if (defaultVoiceId) {
          voiceChannel = await guild.channels.fetch(defaultVoiceId).catch(() => null);
        }
      }

      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        return interaction.reply({
          content: '❌ Canal de voz não encontrado ou inválido. Selecione um canal de voz onde os jogadores estão!',
          flags: MessageFlags.Ephemeral
        });
      }

      const connected = voiceChannel.members.filter(m => !m.user.bot);
      if (connected.size === 0) {
        return interaction.reply({
          content: `❌ Não há nenhum jogador conectado em <#${voiceChannel.id}> no momento!`,
          flags: MessageFlags.Ephemeral
        });
      }

      const membersList = connected.map(m => ({ id: m.user.id, tag: m.user.tag || m.displayName }));
      const rec = recordEventAttendance({
        eventKey,
        customBaseDkp: dkpManual,
        membersList,
        registeredBy: user.tag || user.username,
        lastHitInput
      });

      const lines = rec.members.slice(0, 25).map(m => formatPresenceMemberLine(m));

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ PRESENÇA REGISTRADA: ${rec.eventName}`)
        .setColor('#2ECC71')
        .setDescription(`Presença capturada via sala de voz <#${voiceChannel.id}> para **${rec.totalMembers} membros**.\n\n${lines.join('\n')}${rec.totalMembers > 20 ? `\n*...e mais ${rec.totalMembers - 20} jogadores.*` : ''}`)
        .addFields(
          { name: '🎯 DKP Base', value: `\`${rec.baseDkp} pts\``, inline: true },
          { name: '🛡️ Registrado por', value: `<@${user.id}>`, inline: true }
        )
        .setFooter({ text: 'Pontuação creditada com sucesso!' })
        .setTimestamp();

      if (rec.lastHits && rec.lastHits.length > 0) {
        const lhList = rec.lastHits.map(lh => `<@${lh.userId}> \`(${lh.nick})\``).join(', ');
        embed.addFields({
          name: `🎯 Last Hit (+10 DKP Bônus Fixo${rec.lastHits.length > 1 ? ' cada' : ''})`,
          value: lhList,
          inline: true
        });
      } else if (rec.lastHit) {
        const single = Array.isArray(rec.lastHit) ? rec.lastHit[0] : rec.lastHit;
        if (single) {
          embed.addFields({
            name: '🎯 Last Hit (+10 DKP Bônus Fixo)',
            value: `<@${single.userId}> \`(${single.nick || single.tag})\``,
            inline: true
          });
        }
      }

      await logAttendance({
        client: interaction.client,
        eventName: rec.eventName,
        baseDkp: rec.baseDkp,
        registeredBy: `<@${user.id}>`,
        awardedList: rec.members,
        lastHit: rec.lastHits || rec.lastHit
      });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'marcar-membro') {
      const targetUser = options.getUser('membro');
      const isLastHit = options.getBoolean('last_hit');
      const rec = recordEventAttendance({
        eventKey,
        customBaseDkp: dkpManual,
        membersList: [{ id: targetUser.id, tag: targetUser.tag || targetUser.username }],
        registeredBy: user.tag || user.username,
        lastHitInput: isLastHit ? targetUser.id : null
      });

      const awarded = rec.members[0];
      await logAttendance({
        client: interaction.client,
        eventName: rec.eventName,
        baseDkp: rec.baseDkp,
        registeredBy: `<@${user.id}>`,
        awardedList: rec.members,
        lastHit: rec.lastHit
      });

      const lastHitText = awarded.isLastHit ? '\n🎯 **Bônus de Last Hit:** +10 DKP' : '';
      return interaction.reply({
        content: `✅ Presença marcada para <@${targetUser.id}> no evento **${rec.eventName}**!\nDKP Concedido: **+${awarded.calc.finalDkp} DKP** (Mult CP: ${awarded.calc.multCp}x, Mult Nv: ${awarded.calc.multLvl}x).${lastHitText}`,
        ephemeral: false
      });
    }
  }

  // 8. /leilao (Staff)
  if (commandName === 'leilao') {
    const sub = options.getSubcommand();

    if (sub === 'iniciar') {
      const itemName = options.getString('item');
      const minBid = options.getInteger('lance_minimo');
      const duration = options.getInteger('duracao_minutos');
      const image = options.getAttachment('imagem');

      const auction = startAuction({
        itemName,
        minBid,
        durationMinutes: duration,
        imageUrl: image ? image.url : null,
        startedBy: user.tag || user.username
      });

      const auctionChannelId = channels['leilao-drops'];
      if (auctionChannelId) {
        const ch = await interaction.client.channels.fetch(auctionChannelId).catch(() => null);
        if (ch) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`btn_bid_${auction.id}`)
              .setLabel('Dar Lance (DKP)')
              .setEmoji('💎')
              .setStyle(ButtonStyle.Success)
          );

          const embed = renderAuctionEmbed(auction);
          const msg = await ch.send({ embeds: [embed], components: [row] });
          auction.messageId = msg.id;
          auction.channelId = ch.id;

          const leiloes = getLeiloes();
          if (leiloes.active[auction.id]) {
            leiloes.active[auction.id].messageId = msg.id;
            leiloes.active[auction.id].channelId = ch.id;
            saveLeiloes(leiloes);
          }
        }
      }

      return interaction.reply({
        content: `✅ Leilão do item **${itemName}** iniciado com sucesso no canal <#${auctionChannelId}>! (ID: \`${auction.id}\`)`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'encerrar') {
      const itemId = options.getString('item_id');
      const finished = finalizeAuction(itemId);

      if (!finished) {
        return interaction.reply({ content: `❌ Leilão com ID \`${itemId}\` não encontrado ou já encerrado!`, flags: MessageFlags.Ephemeral });
      }

      const winnerText = finished.highestBidderId
        ? `🏆 Vencedor: <@${finished.highestBidderId}> com o lance de **${finished.currentBid} DKP**!`
        : `⚠️ Nenhum lance foi realizado no item.`;

      return interaction.reply({
        content: `✅ Leilão de **${finished.itemName}** encerrado!\n${winnerText}`,
        ephemeral: false
      });
    }
  }

  // 9. /bid
  if (commandName === 'bid') {
    const itemId = options.getString('item_id');
    const valor = options.getInteger('valor');

    const result = placeBid({
      itemId,
      userId: user.id,
      userTag: user.tag || user.username,
      amount: valor
    });

    if (!result.success) {
      return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
    }

    // Atualiza imediatamente a mensagem do leilão em tempo real no canal
    await updateAuctionDisplay(interaction.client, result.auction);

    // Registra lance travado em #logs-dkp
    await logAuctionBidLock({
      client: interaction.client,
      itemName: result.auction.itemName,
      userId: user.id,
      userTag: user.tag || user.username,
      amount: valor,
      lockedTotal: result.newLockedDkp,
      availableDkp: result.newAvailableDkp
    });

    // Se houve licitante anterior, avisa ele por DM
    if (result.previousBidder && result.previousBidder !== user.id) {
      const prevDkp = getMemberDkp(result.previousBidder);
      await logAuctionBidUnlock({
        client: interaction.client,
        itemName: result.auction.itemName,
        userId: result.previousBidder,
        amountUnlocked: result.auction.currentBid,
        availableDkp: prevDkp.availableDkp
      });

      if (guild) {
        guild.members.fetch(result.previousBidder)
          .then(m => m.send(`⚠️ Seu lance no item **${result.auction.itemName}** foi coberto! Seus pontos travados foram liberados de volta na sua carteira. / You were outbid! Locked DKP returned.`).catch(() => {}))
          .catch(() => {});
      }
    }

    return interaction.reply({
      content: `🎉 **Lance de ${valor} DKP aceito no item ${result.auction.itemName}!**\n\n` +
               `👑 **Você agora é o maior lance!**\n` +
               `💰 **Seu Saldo Livre Atual:** \`${result.newAvailableDkp} DKP\` *(Travado no Leilão: \`${result.newLockedDkp} DKP\` | Total: \`${result.newTotalDkp} DKP\`)*` +
               `${result.extended ? '\n\n⏳ *(Anti-sniping: tempo prorrogado em +2 minutos!)*' : ''}`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 10. /configurar-regua (Staff) - Comando Único
  if (commandName === 'configurar-regua') {
    const cpMinimo = options.getInteger('cp_minimo');
    const nivelMinimo = options.getInteger('nivel_minimo');
    const baseCp = options.getInteger('base_cp');
    const passoCp = options.getInteger('passo_cp');
    let bonusPasso = options.getNumber('bonus_por_passo');
    let tetoCp = options.getNumber('teto_cp');
    const baseNivel = options.getInteger('base_nivel');
    let bonusNivel = options.getNumber('bonus_por_nivel');
    let tetoNivel = options.getNumber('teto_nivel');

    // Auto-sanitização inteligente
    if (bonusPasso > 50) bonusPasso = bonusPasso / 10;
    if (tetoCp > 10) tetoCp = tetoCp / 10;
    if (bonusNivel > 10) bonusNivel = bonusNivel / 10;
    if (tetoNivel > 10) tetoNivel = tetoNivel / 10;

    const config = getConfig();

    // Atualiza cálculos
    config.cpCalculation.minCp = cpMinimo;
    config.cpCalculation.baseCp = baseCp;
    config.cpCalculation.cpStep = passoCp;
    config.cpCalculation.stepBonusPercent = bonusPasso;
    config.cpCalculation.maxMultiplier = tetoCp;

    config.levelCalculation.minLevel = nivelMinimo;
    config.levelCalculation.baseLevel = baseNivel;
    config.levelCalculation.stepBonusPercent = bonusNivel;
    config.levelCalculation.maxMultiplier = tetoNivel;

    // Registra o novo corte com prazo de 7 dias
    const now = Date.now();
    const deadlineTimestamp = now + (7 * 24 * 60 * 60 * 1000);
    const deadlineIso = new Date(deadlineTimestamp).toISOString();

    if (!config.cutoffs) config.cutoffs = [];
    const newCutoff = {
      id: `cut_${now}`,
      minCp: cpMinimo,
      minLevel: nivelMinimo,
      createdAt: new Date(now).toISOString(),
      deadline: deadlineIso,
      deadlineTimestamp,
      setBy: user.tag || user.username
    };
    config.cutoffs.unshift(newCutoff);
    saveConfig(config);

    // Publica Anúncio Oficial no canal 1566503321416507573
    const announcementChannelId = config.announcementChannelId || '1566503321416507573';
    let announcementSent = false;
    try {
      const annChannel = await interaction.client.channels.fetch(announcementChannelId).catch(() => null);
      if (annChannel) {
        const announceEmbed = new EmbedBuilder()
          .setTitle('📢 COMUNICADO OFICIAL • ATUALIZAÇÃO DA RÉGUA DE DKP')
          .setColor('#E74C3C')
          .setDescription(
            `A liderança da **NooMercy** estabeleceu a nova régua de corte e metas de poder para pontuação de DKP!\n\n` +
            `🎯 **REQUISITOS MÍNIMOS ESTABELECIDOS:**\n` +
            `• **Combat Power (CP) Mínimo**: **${cpMinimo.toLocaleString('pt-BR')} CP**\n` +
            `• **Nível Mínimo**: **Nv. ${nivelMinimo}**\n\n` +
            `⏳ **PRAZO DE TOLERÂNCIA (7 DIAS):**\n` +
            `• Limite para atingir a meta: <t:${Math.floor(deadlineTimestamp / 1000)}:F> (<t:${Math.floor(deadlineTimestamp / 1000)}:R>)\n\n` +
            `⚠️ **REGRA DE CORTE (SEM ANISTIA):**\n` +
            `• Durante esses 7 dias, quem estiver abaixo continua marcando DKP normalmente em período probatório.\n` +
            `• **Após o encerramento do prazo, quem não atingir o corte deixará de pontuar DKP nos bosses e eventos (0 DKP) até bater o requisito!**\n\n` +
            `📊 **NOVA CALIBRAGEM DA GUILDA:**\n` +
            `• **Média Base**: **${baseCp.toLocaleString('pt-BR')} CP** *(Mult. 1.0x)* • **Nv. ${baseNivel}**\n` +
            `• **Bônus de CP**: **+${bonusPasso}%** a cada degrau de **${passoCp.toLocaleString('pt-BR')} CP** (Teto: **${tetoCp}x**)\n` +
            `• **Bônus de Nível**: **+${bonusNivel}%** por nível acima da base (Teto: **${tetoNivel}x**)`
          )
          .setFooter({ text: `Atualizado por ${user.tag || user.username} • NooMercy DKP` })
          .setTimestamp();

        await annChannel.send({ embeds: [announceEmbed] });
        announcementSent = true;
      }
    } catch (err) {
      console.error('Erro ao postar anúncio oficial de régua:', err);
    }

    return interaction.reply({
      content: `✅ **Régua da guild configurada com sucesso!**\n\n` +
        `• Requisitos Mínimos: **${cpMinimo.toLocaleString('pt-BR')} CP** | **Nv. ${nivelMinimo}**\n` +
        `• Prazo de 7 dias: <t:${Math.floor(deadlineTimestamp / 1000)}:R>\n` +
        `• Base: **${baseCp.toLocaleString('pt-BR')} CP** | **Nv. ${baseNivel}**\n` +
        `• Anúncio Oficial: ${announcementSent ? `Postado com sucesso em <#${announcementChannelId}>!` : `⚠️ Não foi possível postar no canal <#${announcementChannelId}>.`}`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 11. /ver-regua
  if (commandName === 'ver-regua') {
    const config = getConfig();
    const cpCfg = config.cpCalculation;
    const lvlCfg = config.levelCalculation;
    const cutoffs = config.cutoffs || [];
    const now = Date.now();

    const cutoffLines = cutoffs.slice(0, 5).map(c => {
      const isExpired = now >= c.deadlineTimestamp;
      const statusIcon = isExpired ? '🔴 **EXPIRADO (CORTE ATIVO)**' : '🟢 **TOLERÂNCIA ATIVA**';
      return `• Meta: **${c.minCp.toLocaleString('pt-BR')} CP** | **Nv. ${c.minLevel}**\n  Status: ${statusIcon} — Prazo: <t:${Math.floor(c.deadlineTimestamp / 1000)}:R>`;
    });

    const embed = new EmbedBuilder()
      .setTitle('📐 RÉGUA ATIVA & HISTÓRICO DE CORTES • NOOMERCY')
      .setColor('#9B59B6')
      .addFields(
        {
          name: '🎯 Prazos de Cortes Mínimos (7 Dias)',
          value: cutoffLines.length > 0 ? cutoffLines.join('\n\n') : '*Nenhum corte registrado.*',
          inline: false
        },
        {
          name: '🔥 Calibragem de CP',
          value: `• Base (1.0x): **${cpCfg.baseCp.toLocaleString('pt-BR')} CP**\n• Degrau: **${cpCfg.cpStep.toLocaleString('pt-BR')} CP** (+${cpCfg.stepBonusPercent}%)\n• Limites: **${cpCfg.minMultiplier}x** a **${cpCfg.maxMultiplier}x**`,
          inline: true
        },
        {
          name: '⭐ Calibragem de Nível',
          value: `• Base (1.0x): **Nv. ${lvlCfg.baseLevel}**\n• Bônus: **+${lvlCfg.stepBonusPercent}%** por nível\n• Limites: **${lvlCfg.minMultiplier}x** a **${lvlCfg.maxMultiplier}x**`,
          inline: true
        }
      )
      .setFooter({ text: 'NooMercy DKP Governance' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // 11. /reset-mensal-executar (Staff)
  if (commandName === 'reset-mensal-executar') {
    const logsId = channels['logs-dkp'];
    const res = executeMonthlyDecay(interaction.client, logsId, `Staff Manual: ${user.tag || user.username}`);

    return interaction.reply({
      content: `✅ Virada mensal executada com sucesso! **${res.totalDecayedMembers}** jogadores processados. **${res.totalDkpBurned.toLocaleString('pt-BR')} DKP** queimados e **${res.totalDkpRetained.toLocaleString('pt-BR')} DKP** retidos (20%).`,
      ephemeral: false
    });
  }

  // 12. /setup-paineis (Staff)
  if (commandName === 'setup-paineis') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // 1. Painel de Membros
      const memChId = channels['painel-membros'];
      if (memChId) {
        const ch = await interaction.client.channels.fetch(memChId).catch(() => null);
        if (ch) {
          await ch.send({
            embeds: [createMemberPanelEmbed()],
            components: createMemberPanelButtons()
          });
        }
      }

      // 2. Painel Atualização CP
      const cpChId = channels['atualizacao-cp'];
      if (cpChId) {
        const ch = await interaction.client.channels.fetch(cpChId).catch(() => null);
        if (ch) {
          await ch.send({
            embeds: [createCpUpdatePanelEmbed()],
            components: createCpUpdatePanelButtons()
          });
        }
      }

      // 3. Painel Ausências
      const ausChId = channels['justificar-ausencia'];
      if (ausChId) {
        const ch = await interaction.client.channels.fetch(ausChId).catch(() => null);
        if (ch) {
          await ch.send({
            embeds: [createAbsencePanelEmbed()],
            components: createAbsencePanelButtons()
          });
        }
      }

      // 4. Painel Contestação Presença
      const dispChId = channels['contestacao-presenca'];
      if (dispChId) {
        const ch = await interaction.client.channels.fetch(dispChId).catch(() => null);
        if (ch) {
          await ch.send({
            embeds: [createDisputePanelEmbed()],
            components: createDisputePanelButtons()
          });
        }
      }

      // 5. Painel Staff
      const staffChId = channels['comando-staff'];
      if (staffChId) {
        const ch = await interaction.client.channels.fetch(staffChId).catch(() => null);
        if (ch) {
          await ch.send({
            embeds: [createStaffPanelEmbed()],
            components: createStaffPanelButtons()
          });
        }
      }

      return interaction.editReply({ content: '✅ Todos os painéis fixos foram postados com sucesso nos respectivos canais!' });
    } catch (e) {
      console.error(e);
      return interaction.editReply({ content: `❌ Erro ao postar painéis: ${e.message}` });
    }
  }

  // 13. /painel-membros (Staff)
  if (commandName === 'painel-membros') {
    if (!isStaffMember(interaction.member)) {
      return interaction.reply({ content: '❌ Acesso restrito à Staff!', flags: MessageFlags.Ephemeral });
    }

    const sub = options.getSubcommand();

    if (sub === 'visao-geral') {
      const data = await getStaffOverviewData(guild);
      const embed = buildStaffOverviewEmbed(data);
      const components = buildStaffPanelComponents('overview');
      return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'atrasados') {
      const data = await getStaffOverviewData(guild);
      const embed = buildOverdueEmbed(data);
      const components = buildStaffPanelComponents('overdue');
      return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'roster') {
      const pageNum = options.getInteger('pagina') || 1;
      const data = await getStaffOverviewData(guild);
      const { embed, currentPage, totalPages } = buildRosterPageEmbed(data, pageNum - 1);
      const components = buildStaffPanelComponents('roster', currentPage, totalPages);
      return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'consultar') {
      const identifier = options.getString('membro');
      const result = buildMemberDetailEmbed(identifier, guild);

      if (result.error) {
        return interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
      }

      return interaction.reply({ embeds: [result.embed], flags: MessageFlags.Ephemeral });
    }
  }
}

module.exports = { handleSlashCommand };
