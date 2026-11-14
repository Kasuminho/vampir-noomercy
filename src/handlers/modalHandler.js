const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const { submitCpUpdate, getMember, getMemberDkp, resolveMembersBatch } = require('../services/memberService');
const { registerAbsence, submitPresenceDispute, recordEventAttendance } = require('../services/presenceService');
const { placeBid, startAuction, renderAuctionEmbed, updateAuctionDisplay } = require('../services/auctionService');
const { logAttendance, logAuctionBidLock, logAuctionBidUnlock } = require('../services/loggerService');
const { getLeiloes, saveLeiloes } = require('../database/db');
const { channels } = require('../config/channels');
const { buildMemberDetailEmbed } = require('../services/staffMemberService');

async function handleModalSubmit(interaction) {
  const { customId, fields, user } = interaction;

  // 1. Modal de Atualização de CP
  if (customId === 'modal_update_cp') {
    const nick = fields.getTextInputValue('input_nick');
    const classe = fields.getTextInputValue('input_classe');
    const nivel = parseInt(fields.getTextInputValue('input_nivel'), 10);
    const cp = parseInt(fields.getTextInputValue('input_cp'), 10);
    const printUrl = fields.getTextInputValue('input_print_url');

    if (isNaN(nivel) || isNaN(cp)) {
      return interaction.reply({ content: '❌ Nível e CP devem ser números válidos!', flags: MessageFlags.Ephemeral });
    }

    const existing = getMember(user.id);
    if (existing && existing.pendingSubmission) {
      return interaction.reply({
        content: `⚠️ Você já possui uma ficha de CP aguardando análise da Staff em <#${channels['auditoria-cp']}>! Aguarde a aprovação antes de enviar novamente.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = submitCpUpdate({
      userId: user.id,
      userTag: user.tag || user.username,
      nick,
      classe,
      nivel,
      cp,
      printUrl: printUrl || 'https://via.placeholder.com/600x300.png?text=Sem+URL+Informada'
    });

    // Envia ficha para canal de auditoria da Staff
    const auditChannelId = channels['auditoria-cp'];
    if (auditChannelId) {
      const ch = await interaction.client.channels.fetch(auditChannelId).catch(() => null);
      if (ch) {
        const files = [];
        let imageUri = printUrl;
        if (printUrl && (printUrl.startsWith('http://') || printUrl.startsWith('https://'))) {
          try {
            const attachment = new AttachmentBuilder(printUrl, { name: 'print_cp.png' });
            files.push(attachment);
            imageUri = 'attachment://print_cp.png';
          } catch (err) {
            console.error('Erro ao anexar print de modal CP na auditoria:', err);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('🛡️ NOVA ATUALIZAÇÃO DE CP / NÍVEL PARA APROVAÇÃO')
          .setColor('#3498DB')
          .setDescription(`Jogador: <@${user.id}> \`(${user.tag || user.username})\``)
          .addFields(
            { name: '🎮 Nick In-game', value: `\`${nick}\``, inline: true },
            { name: '🛡️ Classe', value: `\`${classe}\``, inline: true },
            { name: '⭐ Nível', value: `\`Nv. ${nivel}\``, inline: true },
            { name: '🔥 Combat Power (CP)', value: `**${cp.toLocaleString('pt-BR')}**`, inline: true }
          )
          .setImage(imageUri || null)
          .setFooter({ text: `ID do Envio: ${sub.submissionId}` })
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

        await ch.send({ embeds: [embed], files, components: [row] });
      }
    }

    return interaction.reply({
      content: `✅ Seus dados de **CP (${cp.toLocaleString('pt-BR')})**, **Nível (${nivel})** e **Classe (${classe})** foram enviados para a Staff analisar no canal de auditoria!`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 2. Modal de Justificativa de Ausência (Com Período e Notificação à Staff)
  if (customId === 'modal_ausencia') {
    let dataInicio = 'Hoje';
    let dataFim = '1 dia';
    try {
      dataInicio = fields.getTextInputValue('input_ausencia_inicio');
      dataFim = fields.getTextInputValue('input_ausencia_fim');
    } catch {
      dataInicio = fields.getTextInputValue('input_evento_data') || 'Hoje';
      dataFim = 'Conforme informado';
    }
    const motivo = fields.getTextInputValue('input_motivo');

    const memberData = getMember(user.id) || {};
    const nickText = memberData.nick ? `\`${memberData.nick}\` (${memberData.classe || 'Sem classe'})` : `\`${user.tag || user.username}\``;

    const rec = registerAbsence({
      userId: user.id,
      userTag: user.tag || user.username,
      startDate: dataInicio,
      endDate: dataFim,
      eventOrDate: `De ${dataInicio} até ${dataFim}`,
      reason: motivo
    });

    // 1. Notifica a Staff no canal oficial de auditoria (#auditoria-presencas)
    const auditChId = channels['auditoria-presencas'];
    if (auditChId) {
      const ch = await interaction.client.channels.fetch(auditChId).catch(() => null);
      if (ch) {
        const staffEmbed = new EmbedBuilder()
          .setTitle('📝 NOVA JUSTIFICATIVA DE AUSÊNCIA / ABSENCE NOTICE')
          .setColor('#E67E22')
          .setDescription(`O membro <@${user.id}> registrou uma justificativa de ausência no sistema:`)
          .addFields(
            { name: '👤 Jogador / Member', value: `<@${user.id}> • ${nickText}`, inline: false },
            { name: '📅 Período de Ausência', value: `**De:** \`${dataInicio}\`\n**Até:** \`${dataFim}\``, inline: true },
            { name: '📋 Motivo Informado', value: motivo, inline: false }
          )
          .setFooter({ text: `ID: ${rec.id} • Vaga e assiduidade protegidas` })
          .setTimestamp();

        await ch.send({ embeds: [staffEmbed] });
      }
    }

    // 2. Registra em #logs-dkp para auditoria
    const logsChId = channels['logs-dkp'];
    if (logsChId && logsChId !== auditChId) {
      const logCh = await interaction.client.channels.fetch(logsChId).catch(() => null);
      if (logCh) {
        const logEmbed = new EmbedBuilder()
          .setTitle('📝 LOG • AUSÊNCIA JUSTIFICADA REGISTRADA')
          .setColor('#E67E22')
          .setDescription(`**Membro:** <@${user.id}> (${nickText})\n**Período:** \`${dataInicio}\` até \`${dataFim}\`\n**Motivo:** ${motivo}`)
          .setTimestamp();
        await logCh.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }

    return interaction.reply({
      content: `✅ **Sua ausência foi registrada com sucesso! / Absence registered!**\n\n` +
               `📅 **Período:** De \`${dataInicio}\` até \`${dataFim}\`\n` +
               `🛡️ A liderança da guild foi notificada em <#${auditChId}> para proteger sua vaga e assiduidade.\n\n` +
               `*Lembre-se: Isso evita advertências por inatividade, mas não pontua DKP nos bosses não jogados.*`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 3. Modal de Contestação de Presença
  if (customId.startsWith('modal_contestacao')) {
    const eventKey = customId.replace('modal_contestacao_', '').replace('modal_contestacao', '') || 'custom';
    const { getConfig } = require('../database/db');
    const config = getConfig();
    const eventConfig = config.events[eventKey] || { name: 'Evento de Boss', baseDkp: 30 };

    const printUrl = fields.getTextInputValue('input_print_url');
    const obs = fields.getTextInputValue('input_obs') || 'Sem observações';

    const dispute = submitPresenceDispute({
      userId: user.id,
      userTag: user.tag || user.username,
      eventKey,
      eventName: eventConfig.name,
      printUrl,
      note: obs
    });

    const auditPresencasId = channels['auditoria-presencas'];
    if (auditPresencasId) {
      const ch = await interaction.client.channels.fetch(auditPresencasId).catch(() => null);
      if (ch) {
        const files = [];
        let imageUri = printUrl;
        if (printUrl && (printUrl.startsWith('http://') || printUrl.startsWith('https://'))) {
          try {
            const attachment = new AttachmentBuilder(printUrl, { name: 'print_dispute.png' });
            files.push(attachment);
            imageUri = 'attachment://print_dispute.png';
          } catch (err) {
            console.error('Erro ao anexar print de contestação modal:', err);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('🔍 REVISÃO DE PRESENÇA SOLICITADA')
          .setColor('#E74C3C')
          .addFields(
            { name: 'Jogador', value: `<@${user.id}> \`(${user.tag || user.username})\``, inline: true },
            { name: 'Boss / Evento', value: `\`${dispute.eventName}\` *(Base: ${dispute.baseDkp} DKP)*`, inline: true },
            { name: 'Obs / Piloto', value: obs, inline: false }
          )
          .setImage(imageUri || null)
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

        await ch.send({ embeds: [embed], files, components: [row] });
      }
    }

    return interaction.reply({
      content: `✅ Sua contestação para o evento **${dispute.eventName}** (${dispute.baseDkp} DKP Base) foi enviada para a liderança analisar!`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 4. Modal de Lance em Leilão
  if (customId.startsWith('modal_bid_')) {
    const itemId = customId.replace('modal_bid_', '');
    const amount = fields.getTextInputValue('input_bid_amount');

    const result = placeBid({
      itemId,
      userId: user.id,
      userTag: user.tag || user.username,
      amount
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
      amount: parseInt(amount, 10),
      lockedTotal: result.newLockedDkp,
      availableDkp: result.newAvailableDkp
    });

    // Se houve licitante anterior, avisa por DM que o lance foi coberto e DKP devolvido
    if (result.previousBidder && result.previousBidder !== user.id) {
      const prevDkp = getMemberDkp(result.previousBidder);
      await logAuctionBidUnlock({
        client: interaction.client,
        itemName: result.auction.itemName,
        userId: result.previousBidder,
        amountUnlocked: result.auction.currentBid,
        availableDkp: prevDkp.availableDkp
      });

      if (interaction.guild) {
        interaction.guild.members.fetch(result.previousBidder)
          .then(m => m.send(`⚠️ Seu lance no item **${result.auction.itemName}** foi coberto! Seus pontos travados foram liberados de volta na sua carteira. / You were outbid! Locked DKP returned to wallet.`).catch(() => {}))
          .catch(() => {});
      }
    }

    return interaction.reply({
      content: `🎉 **Lance de ${amount} DKP aceito com sucesso no item ${result.auction.itemName}! / Bid confirmed!**\n\n` +
               `👑 **Você agora está liderando o leilão! / You are leading the auction!**\n` +
               `💰 **Seu Saldo Livre Atual:** \`${result.newAvailableDkp} DKP\` *(Travado no Leilão: \`${result.newLockedDkp} DKP\` | Total: \`${result.newTotalDkp} DKP\`)*` +
               `${result.extended ? '\n\n⏳ *(Anti-sniping ativado: leilão estendido em +2 minutos! / Extended by 2 mins!)*' : ''}`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 5. Modal de Presença em Lote (Staff)
  if (customId === 'modal_staff_presenca_lote') {
    const eventoNome = fields.getTextInputValue('input_lote_evento');
    const inputJogadores = fields.getTextInputValue('input_lote_jogadores');
    let lastHitInput = null;
    try {
      lastHitInput = fields.getTextInputValue('input_lote_lasthit');
    } catch {}
    const dkpInput = fields.getTextInputValue('input_lote_dkp');
    const customBaseDkp = dkpInput ? parseInt(dkpInput, 10) : null;

    const { resolved, unresolved } = resolveMembersBatch(inputJogadores);

    if (resolved.length === 0) {
      return interaction.reply({
        content: `❌ Nenhum jogador válido foi identificado na lista fornecida.\n${unresolved.length > 0 ? `Itens não encontrados: \`${unresolved.join(', ')}\`` : ''}`,
        flags: MessageFlags.Ephemeral
      });
    }

    const rec = recordEventAttendance({
      eventKey: 'custom',
      eventName: eventoNome,
      customBaseDkp,
      membersList: resolved,
      registeredBy: user.tag || user.username,
      lastHitInput
    });

    await logAttendance({
      client: interaction.client,
      eventName: rec.eventName,
      baseDkp: rec.baseDkp,
      registeredBy: `<@${user.id}>`,
      awardedList: rec.members,
      lastHit: rec.lastHit
    });

    const lines = rec.members.slice(0, 25).map(m => {
      const lastHitTag = m.isLastHit ? ' • 🎯 **[LAST HIT +10 DKP]**' : '';
      const points = m.totalAwardedDkp || m.calc?.finalDkp || 0;
      if (m.calc.cutoffStatus && m.calc.cutoffStatus.isCut) {
        return `🚫 <@${m.userId}> (${m.nick || m.userTag}): **0 DKP** *(Cortado: ${m.calc.cutoffStatus.details.failedReason})*${lastHitTag}`;
      }
      if (m.calc.cutoffStatus && m.calc.cutoffStatus.inGracePeriod) {
        return `⚠️ <@${m.userId}> (${m.nick || m.userTag}): **+${points} DKP** *(Aviso: meta vence em ${m.calc.cutoffStatus.details.daysLeft}d)*${lastHitTag}`;
      }
      return `• <@${m.userId}> (${m.nick || m.userTag}): **+${points} DKP** *(Mult: ${m.calc.combinedMultiplier}x)*${lastHitTag}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ PRESENÇA EM LOTE REGISTRADA: ${rec.eventName}`)
      .setColor('#2ECC71')
      .setDescription(`Foram pontuados com sucesso **${rec.totalMembers} jogadores**!\n\n${lines.join('\n')}${rec.totalMembers > 25 ? `\n*...e mais ${rec.totalMembers - 25} jogadores.*` : ''}`)
      .addFields(
        { name: '🎯 DKP Base', value: `\`${rec.baseDkp} pts\``, inline: true },
        { name: '🛡️ Registrado por', value: `<@${user.id}>`, inline: true }
      );

    if (rec.lastHits && rec.lastHits.length > 0) {
      const lhList = rec.lastHits.map(lh => `<@${lh.userId}> (\`${lh.nick}\`)`).join(', ');
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
          value: `<@${single.userId}> (\`${single.nick}\`)`,
          inline: true
        });
      }
    }

    embed
      .setFooter({ text: 'DKP ponderado por CP e Nível creditado com sucesso!' })
      .setTimestamp();

    if (unresolved.length > 0) {
      embed.addFields({
        name: '⚠️ Não Encontrados no Discord (Sem Cadastro)',
        value: `\`${unresolved.join(', ')}\`\n*(Peça para eles enviarem seus dados via \`/atualizar-char\`)*`,
        inline: false
      });
    }

    return interaction.reply({ embeds: [embed] });
  }

  // 6. Modal Criar Leilão de Drop (Staff)
  if (customId.startsWith('modal_staff_criar_leilao')) {
    const targetClass = customId.startsWith('modal_staff_criar_leilao_')
      ? customId.replace('modal_staff_criar_leilao_', '')
      : 'Livre';

    const itemName = fields.getTextInputValue('input_leilao_item');
    const minBid = parseInt(fields.getTextInputValue('input_leilao_min_bid'), 10) || 30;
    const duration = parseInt(fields.getTextInputValue('input_leilao_duracao'), 10) || 15;
    const imageUrl = fields.getTextInputValue('input_leilao_imagem') || null;

    const auction = startAuction({
      itemName,
      targetClass: targetClass || 'Livre',
      minBid,
      durationMinutes: duration,
      imageUrl,
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

    const classMsg = targetClass === 'Livre' ? 'Livre para todas as classes' : `Exclusivo para a classe **${targetClass}**`;
    return interaction.reply({
      content: `✅ Leilão do item **${itemName}** (${classMsg}) iniciado com sucesso no canal <#${auctionChannelId}>! (ID: \`${auction.id}\`)`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 7. Modal de Consulta de Membro (Staff)
  if (customId === 'modal_staff_mem_lookup') {
    const input = fields.getTextInputValue('input_staff_lookup_member');
    const result = buildMemberDetailEmbed(input, interaction.guild);

    if (result.error) {
      return interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
    }

    return interaction.reply({ embeds: [result.embed], flags: MessageFlags.Ephemeral });
  }
}

module.exports = { handleModalSubmit };
