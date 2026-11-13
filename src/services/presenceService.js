const { getPresencas, savePresencas, getAusencias, saveAusencias, getConfig } = require('../database/db');
const { getMember, getMemberDkp, addDkp, findMemberByNickOrId } = require('./memberService');
const { calculateDkpReward } = require('./dkpCalculator');

function recordEventAttendance({ eventKey, eventName, customBaseDkp = null, membersList, registeredBy, lastHitInput = null }) {
  const config = getConfig();
  const eventConfig = config.events[eventKey] || { name: eventName || 'Boss Geral', baseDkp: 30 };
  const baseDkp = customBaseDkp || eventConfig.baseDkp || 30;
  const resolvedEventName = eventName || eventConfig.name;

  const eventId = `evt_${Date.now()}`;
  const presencas = getPresencas();

  // 1. Resolve o membro do Last Hit se fornecido
  let lastHitMember = null;
  if (lastHitInput && typeof lastHitInput === 'string' && lastHitInput.trim().length > 0) {
    lastHitMember = findMemberByNickOrId(lastHitInput.trim());
  } else if (lastHitInput && typeof lastHitInput === 'object') {
    lastHitMember = lastHitInput.userId ? lastHitInput : findMemberByNickOrId(lastHitInput.id || lastHitInput.tag || '');
  }

  // Se quem deu Last Hit não constava na lista de presença, adiciona para receber pontuação
  if (lastHitMember && !membersList.some(m => m.id === (lastHitMember.userId || lastHitMember.id))) {
    membersList.push({
      id: lastHitMember.userId || lastHitMember.id,
      tag: lastHitMember.userTag || lastHitMember.nick || (lastHitMember.userId || lastHitMember.id)
    });
  }

  const awardedList = [];
  const LAST_HIT_BONUS = 10; // Bônus fixo de 10 DKP sem multiplicador

  for (const m of membersList) {
    const memberId = m.id;
    const memberData = getMember(memberId) || {};
    const hasApprovedProfile = memberData && memberData.cp && memberData.cp > 0 && memberData.nivel && memberData.nivel > 0;
    const isLastHit = lastHitMember && (lastHitMember.userId === memberId || lastHitMember.id === memberId);

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

  const record = {
    eventId,
    eventKey,
    eventName: resolvedEventName,
    baseDkp,
    registeredBy,
    registeredAt: new Date().toISOString(),
    totalMembers: awardedList.length,
    lastHit: lastHitMember ? {
      userId: lastHitMember.userId || lastHitMember.id,
      nick: lastHitMember.nick || lastHitMember.userTag || (lastHitMember.userId || lastHitMember.id),
      bonus: LAST_HIT_BONUS
    } : null,
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

module.exports = {
  recordEventAttendance,
  submitPresenceDispute,
  approvePresenceDispute,
  rejectPresenceDispute,
  registerAbsence
};
