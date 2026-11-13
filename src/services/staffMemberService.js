const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getMembers, getDkp } = require('../database/db');
const { findMemberByNickOrId } = require('./memberService');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function getStaffOverviewData(guild = null) {
  if (guild && guild.members) {
    await guild.members.fetch().catch(() => {});
  }

  const members = getMembers();
  const dkpData = getDkp();
  const balances = dkpData.balances || {};
  const now = Date.now();

  const onTime = [];
  const overdue = [];
  const noCp = [];
  const zeroPresence = [];

  let totalCp = 0;
  let totalLevel = 0;
  let totalDkp = 0;
  const classCounts = {};

  for (const [userId, m] of Object.entries(members)) {
    const bal = balances[userId] || { totalDkp: 0, eventsAttended: 0, lastEvent: null, lastDate: null };
    const memberCp = m.cp || 0;
    const memberLevel = m.nivel || 0;
    const memberClass = m.classe || 'N/A';
    const lastApproved = m.lastApprovedAt ? new Date(m.lastApprovedAt).getTime() : null;

    const enriched = {
      userId,
      userTag: m.userTag || userId,
      nick: m.nick || null,
      classe: memberClass,
      nivel: memberLevel,
      cp: memberCp,
      lastApprovedAt: m.lastApprovedAt || null,
      daysSinceApproval: lastApproved ? Math.floor((now - lastApproved) / (24 * 60 * 60 * 1000)) : null,
      lastApprovedPrint: m.lastApprovedPrint || null,
      pendingSubmission: m.pendingSubmission || null,
      totalDkp: bal.totalDkp || 0,
      lockedDkp: bal.lockedDkp || 0,
      eventsAttended: bal.eventsAttended || 0,
      lastEvent: bal.lastEvent || null,
      lastDate: bal.lastDate || null
    };

    if (memberCp > 0 && lastApproved) {
      const isOverdue = (now - lastApproved) > SEVEN_DAYS_MS;
      if (isOverdue) {
        overdue.push(enriched);
      } else {
        onTime.push(enriched);
      }
      totalCp += memberCp;
      totalLevel += memberLevel;
      classCounts[memberClass] = (classCounts[memberClass] || 0) + 1;

      // Combatentes cadastrados que nunca foram em boss
      if ((bal.eventsAttended || 0) === 0) {
        zeroPresence.push(enriched);
      }
    } else {
      noCp.push(enriched);
    }

    totalDkp += (bal.totalDkp || 0);
  }

  // Se a guilda foi passada, checa membros do Discord que não estão no members.json (todos menos bots)
  const unregistered = [];
  if (guild && guild.members && guild.members.cache) {
    for (const [gId, gMember] of guild.members.cache.entries()) {
      if (gMember.user?.bot || gMember.bot) continue;
      if (!members[gId]) {
        unregistered.push({
          userId: gId,
          userTag: gMember.user?.tag || gMember.displayName,
          nick: gMember.displayName
        });
      }
    }
  }

  const validCount = onTime.length + overdue.length;
  const avgCp = validCount > 0 ? Math.round(totalCp / validCount) : 0;
  const avgLevel = validCount > 0 ? (totalLevel / validCount).toFixed(1) : '0';

  return {
    onTime,
    overdue,
    noCp,
    zeroPresence,
    unregistered,
    totalRegistered: validCount,
    totalMembersWithProfile: Object.keys(members).length,
    avgCp,
    avgLevel,
    totalDkp,
    classCounts
  };
}

// 1. Embed de Visão Geral (Overview)
function buildStaffOverviewEmbed(data) {
  const classBreakdown = Object.entries(data.classCounts)
    .map(([c, count]) => `\`${c}\`: **${count}**`)
    .join(' • ') || '*Nenhuma classe registrada*';

  const embed = new EmbedBuilder()
    .setTitle('🛡️ PAINEL DE MEMBROS • CONTROLE DA STAFF')
    .setColor('#2ECC71')
    .setDescription(
      'Visão geral em tempo real de todos os combatentes da guilda **NooMercy**:\n\n' +
      `👥 **Combatentes Cadastrados:** \`${data.totalRegistered}\`\n` +
      `✅ **CP em Dia (≤ 7 dias):** \`${data.onTime.length}\` membros\n` +
      `⏳ **CP Atrasado (> 7 dias):** \`${data.overdue.length}\` membros\n` +
      `💤 **Nunca Foram em Boss (0 presenças):** \`${data.zeroPresence.length}\` membros\n` +
      `❌ **Sem CP / Não Cadastrados:** \`${data.noCp.length + data.unregistered.length}\`\n` +
      `⚔️ **Média de CP da Guilda:** \`${data.avgCp.toLocaleString('pt-BR')} CP\` (Nv. Médio: \`${data.avgLevel}\`)\n` +
      `💰 **DKP Total em Circulação:** \`${data.totalDkp.toLocaleString('pt-BR')} pts\`\n\n` +
      `🛡️ **Classes Ativas:**\n${classBreakdown}`
    )
    .addFields(
      {
        name: '📌 Ações Rápidas da Staff',
        value:
          '• **⚠️ Ver Atrasados / Sem CP:** Lista quem precisa ser cobrado.\n' +
          '• **💤 Nunca Foi em Boss:** Lista quem nunca participou de nenhum boss.\n' +
          '• **📋 Roster Completo:** Exibe lista com CP, Presenças e DKP de todos.\n' +
          '• **🔍 Consultar Membro:** Ficha detalhada e histórico de um jogador.',
        inline: false
      }
    )
    .setFooter({ text: 'Painel Exclusivo da Staff • NooMercy' })
    .setTimestamp();

  return embed;
}

// 1.1 Embed de Combatentes que Nunca Foram em Boss (0 Presenças)
function buildZeroPresenceEmbed(data) {
  const sorted = [...data.zeroPresence].sort((a, b) => (b.cp || 0) - (a.cp || 0));

  const lines = sorted.map((m, idx) =>
    `\`#${idx + 1}\` <@${m.userId}> (\`${m.nick || m.userTag}\`) — **${m.classe}** (Nv. ${m.nivel}) • **${m.cp.toLocaleString('pt-BR')} CP**\n` +
    `  *Saldo: \`${m.totalDkp} DKP\` • Cadastrado há ${m.daysSinceApproval ?? '?'} dias • 0 presenças em bosses*`
  );

  const embed = new EmbedBuilder()
    .setTitle(`💤 COMBATENTES NUNCA PRESENTES EM BOSSES [${sorted.length}]`)
    .setColor('#E74C3C')
    .setDescription(
      'Membros que possuem ficha cadastrada na guilda, mas **nunca compareceram a nenhum boss** (0 presenças registradas):\n\n' +
      (lines.length > 0 ? lines.join('\n\n') : '✅ *Todos os combatentes cadastrados já participaram de pelo menos 1 boss!*')
    )
    .setFooter({ text: 'Auditoria de Assiduidade • NooMercy Staff' })
    .setTimestamp();

  return embed;
}

// 2. Embed de Atrasados e Sem CP
function buildOverdueEmbed(data) {
  const overdueLines = data.overdue.length > 0
    ? data.overdue.map(m =>
        `• <@${m.userId}> (\`${m.nick || m.userTag}\`) — **${m.classe}** (Nv. ${m.nivel}) • **${m.cp.toLocaleString('pt-BR')} CP**\n` +
        `  *Última atualização: há ${m.daysSinceApproval} dias (<t:${Math.floor(new Date(m.lastApprovedAt).getTime() / 1000)}:R>)*`
      )
    : ['✅ *Nenhum membro com CP atrasado no momento! Todos em dia!*'];

  const noCpLines = [...data.noCp, ...data.unregistered].slice(0, 15).map(m =>
    `• <@${m.userId}> (\`${m.nick || m.userTag}\`)${m.pendingSubmission ? ' ⏳ *Print pendente de análise*' : ' ❌ *Nunca enviou CP*'}`
  );

  const embed = new EmbedBuilder()
    .setTitle('⚠️ AUDITORIA DE CP ATRASADO & SEM CADASTRO')
    .setColor('#E67E22')
    .setDescription(
      `Jogadores que necessitam de atenção ou cobrança para atualização semanal de CP:\n\n` +
      `⏳ **CP Atrasado (> 7 dias sem atualizar) [${data.overdue.length}]:**\n` +
      overdueLines.join('\n') + '\n\n' +
      `❌ **Sem CP Cadastrado / Novos Membros [${data.noCp.length + data.unregistered.length}]:**\n` +
      (noCpLines.length > 0 ? noCpLines.join('\n') : '✅ *Todos os membros possuem CP cadastrado!*')
    )
    .setFooter({ text: 'Auditoria de Regularidade de CP • NooMercy' })
    .setTimestamp();

  return embed;
}

// 3. Embed de Roster Paginado com CP e Presenças
function buildRosterPageEmbed(data, page = 0, pageSize = 8) {
  const allMembers = [...data.onTime, ...data.overdue].sort((a, b) => (b.cp || 0) - (a.cp || 0));
  const totalPages = Math.ceil(allMembers.length / pageSize) || 1;
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));

  const start = currentPage * pageSize;
  const pageItems = allMembers.slice(start, start + pageSize);

  const lines = pageItems.map((m, idx) => {
    const rankNum = start + idx + 1;
    const medal = rankNum === 1 ? '🥇' : rankNum === 2 ? '🥈' : rankNum === 3 ? '🥉' : `\`#${rankNum}\``;
    const statusIcon = m.daysSinceApproval > 7 ? '⏳' : '✅';
    return (
      `${medal} **${m.nick || m.userTag}** • <@${m.userId}>\n` +
      `   🛡️ **${m.classe}** (Nv. ${m.nivel}) | 🔥 **${m.cp.toLocaleString('pt-BR')} CP**\n` +
      `   💰 DKP: \`${m.totalDkp} pts\` | ⚔️ Presenças: \`${m.eventsAttended}\` bosses *(Último: ${m.lastEvent || 'Nenhum'})*\n` +
      `   ${statusIcon} *CP atualizado há ${m.daysSinceApproval ?? '?'}d*`
    );
  });

  const embed = new EmbedBuilder()
    .setTitle('📋 ROSTER COMPLETO DA GUILDA • STAFF VIEW')
    .setColor('#3498DB')
    .setDescription(
      `Exibindo combatentes ordenados por **Combat Power (CP)** decrescente:\n\n` +
      (lines.length > 0 ? lines.join('\n\n') : '*Nenhum membro registrado.*')
    )
    .setFooter({ text: `Página ${currentPage + 1} de ${totalPages} • Total: ${allMembers.length} membros com CP ativo` })
    .setTimestamp();

  return { embed, currentPage, totalPages };
}

// 4. Embed de Detalhes de um Membro Específico
function buildMemberDetailEmbed(identifier, guild = null) {
  const members = getMembers();
  const dkpData = getDkp();
  const balances = dkpData.balances || {};

  const match = findMemberByNickOrId(identifier, members);
  if (!match) {
    // Se não encontrou no banco, checa se é um membro/visitante do Discord
    let discordUser = null;
    if (guild && guild.members && guild.members.cache) {
      const cleanId = (identifier || '').replace(/[<@!>]/g, '').trim();
      const gm = guild.members.cache.get(cleanId) ||
                 guild.members.cache.find(m => m.displayName.toLowerCase() === identifier.toLowerCase() || m.user.username.toLowerCase() === identifier.toLowerCase());
      if (gm) {
        if (gm.user?.bot || gm.bot) {
          return { error: '❌ Bots não possuem ficha de combatente!' };
        }
        discordUser = gm;
      }
    }

    if (discordUser) {
      const embed = new EmbedBuilder()
        .setTitle(`👤 CONSULTA DE USUÁRIO: ${discordUser.displayName}`)
        .setColor('#95A5A6')
        .setDescription(
          `Este usuário está no Discord, mas **ainda não possui ficha cadastrada** na guilda:\n\n` +
          `💬 **Discord:** <@${discordUser.id}> \`(${discordUser.user.tag || discordUser.id})\`\n` +
          `📌 **Status:** ❌ Sem Alistamento / Sem CP enviado\n` +
          `💰 **Saldo de DKP:** \`0 pts\`\n` +
          `⚔️ **Presenças em Bosses:** \`0 eventos\`\n\n` +
          `*Peça para o usuário realizar o alistamento no canal oficial (#registro) para liberar acesso e pontuar!*`
        )
        .setFooter({ text: `ID: ${discordUser.id} • Consulta Staff NooMercy` })
        .setTimestamp();
      return { embed };
    }

    return {
      error: `❌ Membro \`${identifier}\` não encontrado na guilda nem no Discord!`
    };
  }

  const userId = match.userId;
  const memberData = members[userId] || {};
  const bal = balances[userId] || { totalDkp: 0, lockedDkp: 0, eventsAttended: 0, lastEvent: null, lastDate: null };
  const now = Date.now();
  const lastApproved = memberData.lastApprovedAt ? new Date(memberData.lastApprovedAt).getTime() : null;
  const daysAgo = lastApproved ? Math.floor((now - lastApproved) / (24 * 60 * 60 * 1000)) : null;

  const isOverdue = daysAgo !== null && daysAgo > 7;
  const cpStatus = !memberData.cp || memberData.cp <= 0
    ? '❌ Sem CP cadastrado'
    : isOverdue
      ? `⏳ Atrasado há ${daysAgo} dias (atualize semanalmente!)`
      : `✅ Em dia (atualizado há ${daysAgo} dias)`;

  // Últimas movimentações de DKP desse membro
  const memberHistory = (dkpData.history || [])
    .filter(h => h.userId === userId)
    .slice(0, 5)
    .map(h => {
      const sign = (h.amount || 0) >= 0 ? '+' : '';
      return `• \`${sign}${h.amount} DKP\`: ${h.reason || 'Movimentação'} *(<t:${Math.floor(new Date(h.date).getTime() / 1000)}:R>)*`;
    });

  const embed = new EmbedBuilder()
    .setTitle(`👤 FICHA COMPLETA DO MEMBRO: ${memberData.nick || memberData.userTag}`)
    .setColor(isOverdue ? '#E67E22' : '#2ECC71')
    .setDescription(
      `Informações cadastrais e auditoria de presença do combatente:\n\n` +
      `🎮 **Nick In-game:** \`${memberData.nick || 'Não informado'}\`\n` +
      `💬 **Discord:** <@${userId}> \`(${memberData.userTag || userId})\`\n` +
      `🛡️ **Classe:** \`${memberData.classe || 'N/A'}\`\n` +
      `⭐ **Nível:** \`Nv. ${memberData.nivel || 0}\`\n` +
      `🔥 **Combat Power:** \`${(memberData.cp || 0).toLocaleString('pt-BR')} CP\`\n` +
      `📌 **Status do CP:** ${cpStatus}\n` +
      `💰 **Saldo de DKP:** \`${bal.totalDkp || 0} pts\` *(Travado: \`${bal.lockedDkp || 0} pts\`)*\n` +
      `⚔️ **Presença em Bosses:** \`${bal.eventsAttended || 0} eventos\`\n` +
      `🕒 **Último Boss Presente:** \`${bal.lastEvent || 'Nenhum'}\` ${bal.lastDate ? `*(<t:${Math.floor(new Date(bal.lastDate).getTime() / 1000)}:R>)*` : ''}\n\n` +
      `📜 **Histórico Recente de DKP:**\n` +
      (memberHistory.length > 0 ? memberHistory.join('\n') : '*Nenhuma movimentação registrada.*')
    )
    .setFooter({ text: `ID: ${userId} • Consulta Staff NooMercy` })
    .setTimestamp();

  if (memberData.lastApprovedPrint) {
    embed.setImage(memberData.lastApprovedPrint);
  }

  return { embed };
}

// 5. Botões de Navegação do Painel de Membros
function buildStaffPanelComponents(view = 'overview', currentPage = 0, totalPages = 1) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_staff_mem_overview')
      .setLabel('📊 Visão Geral')
      .setStyle(view === 'overview' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_staff_mem_overdue')
      .setLabel('⚠️ CP Atrasado')
      .setStyle(view === 'overdue' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_staff_mem_zero_pres')
      .setLabel('💤 0 Presenças')
      .setStyle(view === 'zero_pres' ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_staff_mem_roster_main')
      .setLabel('📋 Roster Completo')
      .setStyle(view === 'roster' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_staff_mem_lookup')
      .setLabel('🔍 Consultar')
      .setStyle(ButtonStyle.Secondary)
  );

  const rows = [row1];

  if (view === 'roster') {
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_staff_mem_page_prev_${Math.max(0, currentPage - 1)}`)
        .setLabel('◀️ Anterior')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage <= 0),
      new ButtonBuilder()
        .setCustomId(`btn_staff_mem_page_curr_${currentPage}`)
        .setLabel(`Página ${currentPage + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`btn_staff_mem_page_next_${Math.min(totalPages - 1, currentPage + 1)}`)
        .setLabel('Próximo ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('btn_staff_mem_refresh')
        .setLabel('🔄 Atualizar')
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(row2);
  }

  return rows;
}

module.exports = {
  getStaffOverviewData,
  buildStaffOverviewEmbed,
  buildOverdueEmbed,
  buildZeroPresenceEmbed,
  buildRosterPageEmbed,
  buildMemberDetailEmbed,
  buildStaffPanelComponents
};
