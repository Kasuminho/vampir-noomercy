const { getMembers, saveMembers, getDkp, saveDkp } = require('../database/db');

function getMember(userId) {
  const members = getMembers();
  return members[userId] || null;
}

function getMemberDkp(userId) {
  const dkpData = getDkp();
  if (!dkpData.balances[userId]) {
    dkpData.balances[userId] = {
      userId,
      totalDkp: 0,
      lockedDkp: 0,
      eventsAttended: 0,
      lastEvent: null,
      lastDate: null
    };
    saveDkp(dkpData);
  }
  const rec = dkpData.balances[userId];
  rec.lockedDkp = rec.lockedDkp || 0;
  return {
    userId,
    totalDkp: rec.totalDkp || 0,
    lockedDkp: rec.lockedDkp || 0,
    availableDkp: Math.max(0, (rec.totalDkp || 0) - (rec.lockedDkp || 0)),
    eventsAttended: rec.eventsAttended || 0,
    lastEvent: rec.lastEvent || 'Nenhum',
    lastDate: rec.lastDate || null
  };
}

function submitCpUpdate({ userId, userTag, nick, classe, nivel, cp, printUrl, isRegistration = false }) {
  const members = getMembers();
  const existing = members[userId] || {
    userId,
    userTag,
    history: []
  };

  const isNew = isRegistration || !existing.classe || !existing.cp || (!existing.history || existing.history.length === 0);
  const submissionId = `sub_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const submission = {
    submissionId,
    userId,
    userTag,
    nick,
    classe,
    nivel: parseInt(nivel, 10),
    cp: parseInt(cp, 10),
    printUrl,
    isRegistration: isNew,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };

  existing.userTag = userTag;
  existing.pendingSubmission = submission;
  members[userId] = existing;
  saveMembers(members);

  return submission;
}

function approveCpSubmission(userId, approvedBy) {
  const members = getMembers();
  const member = members[userId];
  if (!member || !member.pendingSubmission) {
    return { success: false, error: 'Nenhuma submissão pendente encontrada para este jogador.' };
  }

  const sub = member.pendingSubmission;
  const isNewRegistration = !!sub.isRegistration || !member.lastApprovedAt || (!member.history || member.history.length === 0);
  const oldClasse = member.classe;

  member.nick = sub.nick;
  member.classe = sub.classe;
  member.nivel = sub.nivel;
  member.cp = sub.cp;
  member.lastApprovedPrint = sub.printUrl;
  member.lastApprovedAt = new Date().toISOString();
  member.approvedBy = approvedBy;

  if (!member.history) member.history = [];
  member.history.push({
    cp: sub.cp,
    nivel: sub.nivel,
    classe: sub.classe,
    date: new Date().toISOString(),
    approvedBy
  });

  member.pendingSubmission = null;
  members[userId] = member;
  saveMembers(members);

  return {
    success: true,
    member,
    isNewRegistration,
    classChanged: oldClasse && oldClasse !== sub.classe
  };
}

function rejectCpSubmission(userId, rejectedBy, reason) {
  const members = getMembers();
  const member = members[userId];
  if (!member || !member.pendingSubmission) {
    return { success: false, error: 'Nenhuma submissão pendente encontrada para este jogador.' };
  }

  const sub = member.pendingSubmission;
  sub.status = 'rejected';
  sub.rejectionReason = reason || 'Print inválido ou dados divergentes';
  sub.rejectedBy = rejectedBy;
  sub.rejectedAt = new Date().toISOString();

  if (!member.rejectedHistory) member.rejectedHistory = [];
  member.rejectedHistory.push(sub);

  member.pendingSubmission = null;
  members[userId] = member;
  saveMembers(members);

  return { success: true, rejectedSubmission: sub };
}

function addDkp(userId, amount, reason, meta = {}) {
  const dkpData = getDkp();
  if (!dkpData.balances[userId]) {
    dkpData.balances[userId] = {
      userId,
      totalDkp: 0,
      lockedDkp: 0,
      eventsAttended: 0,
      lastEvent: null,
      lastDate: null
    };
  }

  const rec = dkpData.balances[userId];
  rec.totalDkp = (rec.totalDkp || 0) + amount;
  if (meta.isEvent) {
    rec.eventsAttended = (rec.eventsAttended || 0) + 1;
    rec.lastEvent = meta.eventName || 'Evento';
    rec.lastDate = new Date().toISOString();
  }

  const historyEntry = {
    id: `dkp_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    userId,
    amount,
    newBalance: rec.totalDkp,
    reason,
    meta,
    date: new Date().toISOString()
  };

  dkpData.history.unshift(historyEntry);
  if (dkpData.history.length > 500) dkpData.history.pop();
  saveDkp(dkpData);

  return { newBalance: rec.totalDkp, historyEntry };
}

function lockDkp(userId, amount, itemId) {
  const dkpData = getDkp();
  if (!dkpData.balances[userId]) return false;
  const rec = dkpData.balances[userId];
  const total = rec.totalDkp || 0;
  const locked = rec.lockedDkp || 0;
  const available = total - locked;

  if (available < amount) return false;

  rec.lockedDkp = locked + amount;
  saveDkp(dkpData);
  return true;
}

function unlockDkp(userId, amount, itemId) {
  const dkpData = getDkp();
  if (!dkpData.balances[userId]) return false;
  const rec = dkpData.balances[userId];
  rec.lockedDkp = Math.max(0, (rec.lockedDkp || 0) - amount);
  saveDkp(dkpData);
  return true;
}

function deductLockedDkp(userId, amount, itemId, reason) {
  const dkpData = getDkp();
  if (!dkpData.balances[userId]) return false;
  const rec = dkpData.balances[userId];

  rec.lockedDkp = Math.max(0, (rec.lockedDkp || 0) - amount);
  rec.totalDkp = Math.max(0, (rec.totalDkp || 0) - amount);

  const historyEntry = {
    id: `bid_won_${Date.now()}`,
    userId,
    amount: -amount,
    newBalance: rec.totalDkp,
    reason,
    meta: { itemId },
    date: new Date().toISOString()
  };
  dkpData.history.unshift(historyEntry);
  saveDkp(dkpData);
  return true;
}

function getCpRanking({ classe = null, limit = 20 } = {}) {
  const members = getMembers();
  let list = Object.values(members).filter(m => m.cp && m.cp > 0);

  if (classe) {
    list = list.filter(m => (m.classe || '').toLowerCase() === classe.toLowerCase());
  }

  list.sort((a, b) => b.cp - a.cp);

  if (limit) {
    list = list.slice(0, limit);
  }

  return list;
}

function findMemberByNickOrId(identifier, membersCache = null) {
  const members = membersCache || getMembers();
  const clean = identifier.replace(/[<@!>]/g, '').trim().toLowerCase();

  // 1. Busca por userId exato
  if (members[clean]) {
    return { ...members[clean], resolvedBy: 'id' };
  }

  // 2. Busca por nick in-game (case-insensitive)
  for (const m of Object.values(members)) {
    if (m.nick && m.nick.trim().toLowerCase() === clean) {
      return { ...m, resolvedBy: 'nick' };
    }
  }

  // 3. Busca por userTag / username
  for (const m of Object.values(members)) {
    if (m.userTag && m.userTag.trim().toLowerCase() === clean) {
      return { ...m, resolvedBy: 'tag' };
    }
  }

  return null;
}

function resolveMembersBatch(inputString, guildMembers = null) {
  const members = getMembers();
  // Divide por vírgula, ponto e vírgula, espaço ou quebra de linha
  const tokens = inputString
    .split(/[\n,;\t]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);

  const resolved = [];
  const unresolved = [];
  const seenIds = new Set();

  for (const token of tokens) {
    // Se tiver múltiplas menções coladas como <@123><@456>
    const subMentions = token.match(/<@!?(\d+)>/g);
    const subTokens = subMentions || [token];

    for (const raw of subTokens) {
      const match = findMemberByNickOrId(raw, members);
      if (match) {
        if (!seenIds.has(match.userId)) {
          seenIds.add(match.userId);
          resolved.push({
            id: match.userId,
            tag: match.userTag || match.nick || match.userId,
            nick: match.nick || null,
            classe: match.classe || 'N/A',
            cp: match.cp || 0,
            nivel: match.nivel || 0
          });
        }
      } else {
        // Se for um ID de Discord válido que ainda não tem ficha no members.json
        const pureId = raw.replace(/[<@!>]/g, '').trim();
        if (/^\d{17,20}$/.test(pureId)) {
          if (!seenIds.has(pureId)) {
            seenIds.add(pureId);
            resolved.push({
              id: pureId,
              tag: pureId,
              nick: null,
              classe: 'N/A',
              cp: 0,
              nivel: 0
            });
          }
        } else {
          unresolved.push(raw);
        }
      }
    }
  }

  return { resolved, unresolved };
}

module.exports = {
  getMember,
  getMemberDkp,
  submitCpUpdate,
  approveCpSubmission,
  rejectCpSubmission,
  addDkp,
  lockDkp,
  unlockDkp,
  deductLockedDkp,
  getCpRanking,
  findMemberByNickOrId,
  resolveMembersBatch
};
