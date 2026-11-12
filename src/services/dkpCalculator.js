const { getConfig } = require('../database/db');

/**
 * Checa se o jogador está cortado de ganhar DKP ou se está em período de tolerância (7 dias).
 * Regra: se algum corte já venceu o prazo e o jogador estiver abaixo, ELE É CORTADO (0 DKP).
 * Se o prazo ainda não venceu, ele ganha DKP normal mas fica com aviso de tolerância.
 */
function checkPlayerCutoffStatus(cp = 0, level = 0) {
  const config = getConfig();
  const cutoffs = config.cutoffs || [];
  const now = Date.now();

  let expiredFailure = null;
  let activeGraceFailure = null;

  for (const cutoff of cutoffs) {
    const isBelowCp = cutoff.minCp && cp < cutoff.minCp;
    const isBelowLvl = cutoff.minLevel && level < cutoff.minLevel;

    if (isBelowCp || isBelowLvl) {
      if (now >= cutoff.deadlineTimestamp) {
        // Prazo já venceu e o jogador não atingiu os requisitos -> CORTADO IMEDIATO
        expiredFailure = {
          cutoff,
          minCp: cutoff.minCp,
          minLevel: cutoff.minLevel,
          deadlineTimestamp: cutoff.deadlineTimestamp,
          failedReason: isBelowCp && isBelowLvl
            ? `CP (${cp.toLocaleString('pt-BR')}/${cutoff.minCp.toLocaleString('pt-BR')}) e Nível (${level}/${cutoff.minLevel}) abaixo da meta vencida`
            : (isBelowCp ? `CP (${cp.toLocaleString('pt-BR')}/${cutoff.minCp.toLocaleString('pt-BR')}) abaixo da meta vencida` : `Nível (${level}/${cutoff.minLevel}) abaixo da meta vencida`)
        };
        break; // Prioridade máxima: se falhou em um corte vencido, já está cortado
      } else {
        // Prazo ainda não venceu -> Tolerância ativa
        if (!activeGraceFailure) {
          activeGraceFailure = {
            cutoff,
            minCp: cutoff.minCp,
            minLevel: cutoff.minLevel,
            deadlineTimestamp: cutoff.deadlineTimestamp,
            daysLeft: Math.max(0, Math.ceil((cutoff.deadlineTimestamp - now) / (1000 * 60 * 60 * 24)))
          };
        }
      }
    }
  }

  if (expiredFailure) {
    return {
      isCut: true,
      inGracePeriod: false,
      details: expiredFailure
    };
  }

  if (activeGraceFailure) {
    return {
      isCut: false,
      inGracePeriod: true,
      details: activeGraceFailure
    };
  }

  return {
    isCut: false,
    inGracePeriod: false
  };
}

/**
 * Calcula os multiplicadores e o DKP final com base em CP e Nível.
 */
function calculateDkpReward({ baseDkp, cp = 0, level = 0 }) {
  const config = getConfig();
  const cpConfig = config.cpCalculation || {
    enabled: true,
    baseCp: 330000,
    cpStep: 30000,
    stepBonusPercent: 8.8,
    minMultiplier: 0.65,
    maxMultiplier: 1.8
  };

  const lvlConfig = config.levelCalculation || {
    enabled: true,
    baseLevel: 72,
    levelStep: 1,
    stepBonusPercent: 1.5,
    minMultiplier: 0.85,
    maxMultiplier: 1.15
  };

  const cutoffStatus = checkPlayerCutoffStatus(cp, level);

  let multCp = 1.0;
  let cpBonusPercent = 0;
  if (cpConfig.enabled && cp > 0) {
    const diffCp = cp - cpConfig.baseCp;
    const steps = diffCp / cpConfig.cpStep;
    cpBonusPercent = steps * cpConfig.stepBonusPercent;
    multCp = 1 + (cpBonusPercent / 100);
    multCp = Math.min(Math.max(multCp, cpConfig.minMultiplier), cpConfig.maxMultiplier);
  }

  let multLvl = 1.0;
  let lvlBonusPercent = 0;
  if (lvlConfig.enabled && level > 0) {
    const diffLvl = level - lvlConfig.baseLevel;
    const steps = diffLvl / lvlConfig.levelStep;
    lvlBonusPercent = steps * lvlConfig.stepBonusPercent;
    multLvl = 1 + (lvlBonusPercent / 100);
    multLvl = Math.min(Math.max(multLvl, lvlConfig.minMultiplier), lvlConfig.maxMultiplier);
  }

  const combinedMult = multCp * multLvl;
  let finalDkp = Math.max(1, Math.round(baseDkp * combinedMult));

  // Se o jogador estiver cortado, o DKP dele é ZERO!
  if (cutoffStatus.isCut) {
    finalDkp = 0;
  }

  return {
    baseDkp,
    cp,
    level,
    multCp: Number(multCp.toFixed(2)),
    multLvl: Number(multLvl.toFixed(2)),
    combinedMultiplier: Number(combinedMult.toFixed(2)),
    finalDkp,
    cutoffStatus
  };
}

module.exports = {
  calculateDkpReward,
  checkPlayerCutoffStatus
};
