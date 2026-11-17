const { EmbedBuilder } = require('discord.js');
const { getPresencas, savePresencas, getAusencias, saveAusencias, getConfig } = require('../database/db');
const { getMember, getMemberDkp, addDkp, findMemberByNickOrId, resolveMembersBatch } = require('./memberService');
const { calculateDkpReward } = require('./dkpCalculator');

function recordEventAttendance({ eventKey, eventName, customBaseDkp = null, membersList, registeredBy, lastHitInput = null }) {
  const config = getConfig();
  const eventConfig = config.events[eventKey] || { name: eventName || 'Boss Geral', baseDkp: 30 };
  const baseDkp = customBaseDkp || eventConfig.baseDkp || 30;
  const resolvedEventName = eventName || eventConfig.name;

  const eventId = `evt_${Date.now()}`;
  const presencas = getPresencas();

  // 1. Resolve os membros do Last Hit (suporta 1 ou múltiplos jogadores!)
  const lastHitMembersMap = new Map();

  function addLastHitMatch(match) {
    if (!match) return;
    const uid = match.userId || match.id;
    if (!uid) return;
    lastHitMembersMap.set(uid, {
      userId: uid,
      nick: match.nick || null,
      tag: match.userTag || match.tag || match.nick || uid
    });
  }

  if (lastHitInput) {
    if (typeof lastHitInput === 'string' && lastHitInput.trim().length > 0) {
      const { resolved } = resolveMembersBatch(lastHitInput);
      for (const m of resolved) {
        addLastHitMatch(m);
      }
      if (lastHitMembersMap.size === 0) {
        const single = findMemberByNickOrId(lastHitInput.trim().replace(/^@/, ''));
        if (single) addLastHitMatch(single);
      }
    } else if (Array.isArray(lastHitInput)) {
      for (const item of lastHitInput) {
        if (typeof item === 'string') {
          const m = findMemberByNickOrId(item.replace(/^@/, '').trim());
          if (m) addLastHitMatch(m);
        } else if (item && (item.id || item.userId)) {
          addLastHitMatch(item);
        }
      }
    } else if (typeof lastHitInput === 'object') {
      if (lastHitInput.userId || lastHitInput.id) {
        addLastHitMatch(lastHitInput);
      }
    }
  }

  // Se quem deu Last Hit não constava na lista de presença, adiciona para receber pontuação
  for (const [lhId, lhData] of lastHitMembersMap.entries()) {
    if (!membersList.some(m => m.id === lhId)) {
      membersList.push({
        id: lhId,
        tag: lhData.tag || lhData.nick || lhId
      });
    }
  }

  const awardedList = [];
  const LAST_HIT_BONUS = 10; // Bônus fixo de 10 DKP sem multiplicador

  for (const m of membersList) {
    const memberId = m.id;
    const memberData = getMember(memberId) || {};
    const hasApprovedProfile = memberData && memberData.cp && memberData.cp > 0 && memberData.nivel && memberData.nivel > 0;
    const isLastHit = lastHitMembersMap.has(memberId);

    if (!hasApprovedProfile) {
      // PROIBIDO PONTUAR SEM CP/NÍVEL APROVADOS PELA STAFF!
      awardedList.push({
        userId: memberId,
        userTag: m.tag || memberData.nick || memberId,
        nick: memberData.nick || null,
        classe: memberData.classe || 'N/A',
        cp: 0,
        level: 0,
        noCpApproved: true,
        isLastHit: !!isLastHit,
        lastHitBonus: isLastHit ? LAST_HIT_BONUS : 0,
        totalAwardedDkp: 0,
        calc: {
          baseDkp,
          finalDkp: 0,
          multCp: 0,
          multLvl: 0,
          combinedMultiplier: 0,
          cutoffStatus: { isCut: true, details: { failedReason: 'PROIBIDO: Sem CP/Nível aprovados pela Staff (Envie print em #atualizacao-cp)' } }
        },
        newTotalDkp: (getMember(memberId) ? (getMemberDkp(memberId) || {}).totalDkp : 0) || 0
      });
      continue;
    }

    const cp = memberData.cp;
    const level = memberData.nivel;

    const calc = calculateDkpReward({ baseDkp, cp, level });
    let newBalance = 0;

    // Se tiver last hit, adiciona +10 DKP direto sem multiplicador
    const bonusDkp = isLastHit ? LAST_HIT_BONUS : 0;
    const totalAwardedDkp = calc.finalDkp + bonusDkp;

    if (!calc.cutoffStatus.isCut && totalAwardedDkp > 0) {
      const reasonText = isLastHit
        ? `Presença (${calc.finalDkp} DKP) + Last Hit (+${LAST_HIT_BONUS} DKP): ${resolvedEventName}`
        : `Presença: ${resolvedEventName}`;

      const credit = addDkp(memberId, totalAwardedDkp, reasonText, {
        isEvent: true,
        eventId,
        eventName: resolvedEventName,
        baseDkp,
        cp,
        level,
        multCp: calc.multCp,
        multLvl: calc.multLvl,
        finalDkp: calc.finalDkp,
        isLastHit: !!isLastHit,
        lastHitBonus: bonusDkp,
        registeredBy
      });
      newBalance = credit.newBalance;
    }

    awardedList.push({
      userId: memberId,
      userTag: m.tag || memberData.nick || memberId,
      nick: memberData.nick || null,
      classe: memberData.classe || 'N/A',
      cp,
      level,
      noCpApproved: false,
      isLastHit: !!isLastHit,
      lastHitBonus: bonusDkp,
      calc,
      totalAwardedDkp,
      newTotalDkp: newBalance
    });
  }

  const lastHitsArray = Array.from(lastHitMembersMap.values()).map(lh => ({
    userId: lh.userId,
    nick: lh.nick || lh.tag,
    bonus: LAST_HIT_BONUS
  }));

  const record = {
    eventId,
    eventKey,
    eventName: resolvedEventName,
    baseDkp,
    registeredBy,
    registeredAt: new Date().toISOString(),
    totalMembers: awardedList.length,
    lastHit: lastHitsArray.length === 1 ? lastHitsArray[0] : (lastHitsArray.length > 1 ? lastHitsArray : null),
    lastHits: lastHitsArray,
    members: awardedList
  };

  presencas.events[eventId] = record;
  savePresencas(presencas);

  return record;
}

function submitPresenceDispute({ userId, userTag, eventKey, eventName, printUrl, note = '' }) {
  const config = getConfig();
  const eventConfig = config.events[eventKey] || { name: eventName || 'Evento', baseDkp: 30 };
  const presencas = getPresencas();
  const disputeId = `disp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const dispute = {
    disputeId,
    userId,
    userTag,
    eventKey,
    eventName: eventConfig.name || eventName,
    baseDkp: eventConfig.baseDkp,
    printUrl,
    note,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  presencas.disputes[disputeId] = dispute;
  savePresencas(presencas);

  return dispute;
}

function approvePresenceDispute(disputeId, approvedBy) {
  const presencas = getPresencas();
  const dispute = presencas.disputes[disputeId];
  if (!dispute || dispute.status !== 'pending') {
    return { success: false, error: 'Contestação não encontrada ou já analisada.' };
  }

  const config = getConfig();
  const memberData = getMember(dispute.userId) || {};
  const hasApprovedProfile = memberData && memberData.cp && memberData.cp > 0 && memberData.nivel && memberData.nivel > 0;

  if (!hasApprovedProfile) {
    return {
      success: false,
      error: 'PROIBIDO: Este jogador não possui CP e Nível aprovados na guild! Ele deve enviar o print em #atualizacao-cp antes de pontuar.'
    };
  }

  const cp = memberData.cp;
  const level = memberData.nivel;
  const eventConfig = (dispute.eventKey && config.events[dispute.eventKey]) ? config.events[dispute.eventKey] : { name: dispute.eventName, baseDkp: dispute.baseDkp || 30 };
  const baseDkp = eventConfig.baseDkp || 30;

  const calc = calculateDkpReward({ baseDkp, cp, level });

  let newBalance = 0;
  if (!calc.cutoffStatus.isCut && calc.finalDkp > 0) {
    const credit = addDkp(dispute.userId, calc.finalDkp, `Contestação Aprovada: ${dispute.eventName}`, {
      isEvent: true,
      eventName: dispute.eventName,
      eventKey: dispute.eventKey,
      disputeId,
      baseDkp,
      cp,
      level,
      finalDkp: calc.finalDkp,
      approvedBy
    });
    newBalance = credit.newBalance;
  }

  dispute.status = 'approved';
  dispute.approvedBy = approvedBy;
  dispute.approvedAt = new Date().toISOString();
  dispute.awardedDkp = calc.finalDkp;

  savePresencas(presencas);
  return { success: true, dispute, calc, newBalance };
}

function rejectPresenceDispute(disputeId, rejectedBy, reason) {
  const presencas = getPresencas();
  const dispute = presencas.disputes[disputeId];
  if (!dispute || dispute.status !== 'pending') {
    return { success: false, error: 'Contestação não encontrada ou já analisada.' };
  }

  dispute.status = 'rejected';
  dispute.rejectedBy = rejectedBy;
  dispute.rejectedAt = new Date().toISOString();
  dispute.reason = reason || 'Print insuficiente ou sem comprovação de presença';

  savePresencas(presencas);
  return { success: true, dispute };
}

function registerAbsence({ userId, userTag, startDate, endDate, eventOrDate, reason }) {
  const ausencias = getAusencias();
  if (!ausencias.requests) ausencias.requests = [];
  if (!ausencias.list) ausencias.list = ausencias.requests;

  const inicio = startDate || eventOrDate || 'Hoje / Today';
  const fim = endDate || 'Não especificado / 1 dia';
  const periodo = startDate && endDate ? `De ${startDate} até ${endDate}` : (eventOrDate || `${inicio} a ${fim}`);

  const record = {
    id: `abs_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    userId,
    userTag,
    startDate: inicio,
    endDate: fim,
    period: periodo,
    eventOrDate: periodo,
    reason,
    registeredAt: new Date().toISOString()
  };

  ausencias.requests.unshift(record);
  if (ausencias.requests.length > 500) ausencias.requests.pop();
  saveAusencias(ausencias);

  return record;
}

function formatPresenceMemberLine(m) {
  const lastHitTag = m.isLastHit ? ' • 🎯 **[LAST HIT +10 DKP]**' : '';
  const points = m.totalAwardedDkp || m.calc?.finalDkp || 0;
  if (m.calc?.cutoffStatus?.isCut) {
    return `🚫 <@${m.userId}> (${m.nick || m.userTag}): **0 DKP** *(Cortado: ${m.calc.cutoffStatus.details?.failedReason || 'Meta não atingida'})*${lastHitTag}`;
  }
  if (m.calc?.cutoffStatus?.inGracePeriod) {
    return `⚠️ <@${m.userId}> (${m.nick || m.userTag}): **+${points} DKP** *(Aviso: meta vence em ${m.calc.cutoffStatus.details?.daysLeft || 0}d)*${lastHitTag}`;
  }
  return `• <@${m.userId}> (${m.nick || m.userTag}): **+${points} DKP** *(Mult: ${m.calc?.combinedMultiplier || '1.00'}x)*${lastHitTag}`;
}

function buildPresenceResultEmbeds({ rec, userId, unresolved = [], voiceChannelId = null, chunkSize = 20 }) {
  const members = rec.members || [];
  const totalPages = Math.max(1, Math.ceil(members.length / chunkSize));
  const embeds = [];

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * chunkSize;
    const end = start + chunkSize;
    const chunk = members.slice(start, end);
    const chunkLines = chunk.map(m => formatPresenceMemberLine(m));

    const isFirst = page === 1;
    const isLast = page === totalPages;
    const pageSuffix = totalPages > 1 ? ` (Parte ${page}/${totalPages})` : '';

    const title = `⚔️ PRESENÇA REGISTRADA: ${rec.eventName}${pageSuffix}`;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor('#2ECC71')
      .setTimestamp();

    if (isFirst) {
      const originText = voiceChannelId
        ? `Presença capturada via sala de voz <#${voiceChannelId}> para **${rec.totalMembers} membros**.\n`
        : `Foram pontuados com sucesso **${rec.totalMembers} jogadores**!\n`;

      const pageNote = totalPages > 1
        ? `*(Listando jogadores ${start + 1} a ${Math.min(end, rec.totalMembers)} de ${rec.totalMembers})*\n\n`
        : '\n';

      embed.setDescription(originText + pageNote + chunkLines.join('\n'));

      embed.addFields(
        { name: '🎯 DKP Base', value: `\`${rec.baseDkp} pts\``, inline: true },
        { name: '🛡️ Registrado por', value: `<@${userId}>`, inline: true }
      );

      if (rec.lastHits && rec.lastHits.length > 0) {
        const lhList = rec.lastHits.map(lh => `<@${lh.userId}> \`(${lh.nick || lh.tag})\``).join(', ');
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
    } else {
      embed.setDescription(
        `*(Continuação dos jogadores pontuados - ${start + 1} a ${Math.min(end, rec.totalMembers)} de ${rec.totalMembers})*\n\n` +
        chunkLines.join('\n')
      );
    }

    if (isLast && unresolved && unresolved.length > 0) {
      embed.addFields({
        name: '⚠️ Não Encontrados no Discord (Sem Cadastro)',
        value: `\`${unresolved.join(', ')}\`\n*(Peça para eles enviarem seus dados via \`/atualizar-char\`)*`,
        inline: false
      });
    }

    embed.setFooter({
      text: totalPages > 1
        ? `Página ${page} de ${totalPages} • DKP ponderado por CP e Nível creditado!`
        : 'DKP ponderado por CP e Nível creditado com sucesso!'
    });

    embeds.push(embed);
  }

  return embeds;
}

module.exports = {
  recordEventAttendance,
  submitPresenceDispute,
  approvePresenceDispute,
  rejectPresenceDispute,
  registerAbsence,
  formatPresenceMemberLine,
  buildPresenceResultEmbeds
};
