const {
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const { submitCpUpdate } = require('./memberService');
const { submitPresenceDispute } = require('./presenceService');
const { channels, roles } = require('../config/channels');
const { getConfig, getMembers, saveMembers, getPresencas, savePresencas } = require('../database/db');

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

// Guarda os estados dos tickets ativos em memória:
// threadId -> { userId, type: 'cp' | 'dispute', step, data, timer, expiresAt }
const activeTickets = new Map();
const ticketLocks = new Set();

const CLASSES = ['Bloodstained', 'Carnage', 'Akasha', 'Viper', 'Grim Reaper'];

function createClassSelectionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_class_Bloodstained').setLabel('Bloodstained').setStyle(ButtonStyle.Primary).setEmoji('⚔️'),
    new ButtonBuilder().setCustomId('ticket_class_Carnage').setLabel('Carnage').setStyle(ButtonStyle.Primary).setEmoji('🔫'),
    new ButtonBuilder().setCustomId('ticket_class_Akasha').setLabel('Akasha').setStyle(ButtonStyle.Primary).setEmoji('🥋'),
    new ButtonBuilder().setCustomId('ticket_class_Viper').setLabel('Viper').setStyle(ButtonStyle.Primary).setEmoji('🔮'),
    new ButtonBuilder().setCustomId('ticket_class_Grim Reaper').setLabel('Grim Reaper').setStyle(ButtonStyle.Primary).setEmoji('💀')
  );
}

async function startCpUpdateTicket(interaction) {
  const { channel, user, member, guild } = interaction;

  // 1. Anti-spam / Debounce imediato
  if (ticketLocks.has(user.id)) {
    return interaction.reply({
      content: '⏳ Calma lá, apressadinho! Seu ticket já está sendo gerado, aguarde um instante...',
      flags: MessageFlags.Ephemeral
    });
  }

  // 2. Checa se o membro já tem um envio pendente de aprovação pela Staff
  const members = getMembers();
  const memberData = members[user.id];
  if (memberData && memberData.pendingSubmission) {
    const sub = memberData.pendingSubmission;
    return interaction.reply({
      content: `⚠️ **VOCÊ JÁ TEM UM REGISTRO AGUARDANDO APROVAÇÃO!**\n\n` +
               `Sua ficha com **${sub.nick}** (${sub.classe}) de **${(sub.cp || 0).toLocaleString('pt-BR')} CP** já está na mesa da Staff em <#${channels['auditoria-cp']}>.\n\n` +
               `*Aguarde a liderança aprovar ou recusar antes de enviar um novo registro!* 🦇`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 3. Se estiver no canal de Registro e já for membro verificado com classe
  if (channel.id === channels['registro'] && memberData && memberData.classe && memberData.cp > 0) {
    return interaction.reply({
      content: `✅ Você já é um membro registrado da guilda como **${memberData.nick}** (${memberData.classe})!\n\n` +
               `Se você deseja apenas atualizar seus pontos de CP e Nível da semana, utilize o canal oficial: <#${channels['atualizacao-cp']}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 4. Verifica se o usuário já tem um ticket ativo aberto em memória
  for (const [tId, t] of activeTickets.entries()) {
    if (t.userId === user.id && t.type === 'cp') {
      return interaction.reply({
        content: `⚠️ Você já tem um ticket de atualização aberto em <#${tId}>! Termine ele ou espere os 10 minutos expirarem.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  ticketLocks.add(user.id);
  let thread;
  try {
    const isRegistration = channel.id === channels['registro'] || (!memberData || !memberData.classe || !memberData.cp);
    const threadPrefix = isRegistration ? 'alistamento' : 'cp';
    const threadReason = isRegistration ? `Ticket de novo alistamento para ${user.tag}` : `Ticket de atualização semanal de CP para ${user.tag}`;

    // Cria Thread exclusiva para o membro
    try {
      thread = await channel.threads.create({
        name: `📋-${threadPrefix}-${user.username.slice(0, 15)}`,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread,
        reason: threadReason
      });
    } catch (err) {
      // Fallback para PublicThread se o Discord reclamar de thread privada
      thread = await channel.threads.create({
        name: `📋-${threadPrefix}-${user.username.slice(0, 15)}`,
        autoArchiveDuration: 60,
        type: ChannelType.PublicThread,
        reason: threadReason
      });
    }

    // Adiciona o membro à thread
    await thread.members.add(user.id).catch(() => {});

    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos

    // Agenda cancelamento automático após 10 minutos
    const timer = setTimeout(async () => {
      if (activeTickets.has(thread.id)) {
        activeTickets.delete(thread.id);
        await thread.send({
          content: `⏰ **TEMPO ESGOTADO! / TIME'S UP!**\n<@${user.id}> você moscou demais e passaram os 10 minutos! Esse ticket foi cancelado. Se vira e abre outro lá no canal quando tiver com tudo pronto! 🦇`
        }).catch(() => {});
        setTimeout(() => thread.delete().catch(() => {}), 5000);
      }
    }, 10 * 60 * 1000);

    activeTickets.set(thread.id, {
      threadId: thread.id,
      userId: user.id,
      userTag: user.tag || user.username,
      type: 'cp',
      step: 'nick',
      data: { isRegistration: !!isRegistration },
      timer,
      expiresAt
    });

    const introEmbed = new EmbedBuilder()
      .setTitle(isRegistration ? '🦇 ALISTAMENTO DE NOVO MEMBRO • NOOMERCY' : '🦇 ATUALIZAÇÃO SEMANAL DE CP & NÍVEL • NOOMERCY')
      .setColor('#9B59B6')
      .setDescription(
        isRegistration
          ? `E aí <@${user.id}>, novo sangue fresco! / Welcome recruit!\n\n` +
            `Para entrar na NooMercy e liberar os canais do Discord, precisamos validar seu boneco no jogo!\n\n` +
            `⏱️ **Você tem 10 minutos para concluir o envio antes do ticket expirar!**\n\n` +
            `👉 **Passo 1 / Step 1:**\n` +
            `Qual é o seu **Nick exato no jogo**? / What is your exact in-game Nickname?\n` +
            `*(Basta digitar seu nick aqui embaixo no chat / Just type your nick below)*`
          : `E aí <@${user.id}>, seu sangue-ruim! / Hey bloodbag!\n\n` +
            `Bora atualizar seu CP e Nível da semana para garantir sua pontuação de DKP nos bosses!\n\n` +
            `⏱️ **Você tem 10 minutos antes deste ticket sumir do mapa! / You have 10 minutes!**\n\n` +
            `👉 **Passo 1 / Step 1:**\n` +
            `Qual é o seu **Nick exato no jogo**? / What is your exact in-game Nickname?\n` +
            `*(Basta digitar seu nick aqui embaixo no chat / Just type your nick below)*`
      )
      .setFooter({ text: 'NooMercy DKP • Vlad, o Drácula da Shopee' })
      .setTimestamp();

    await thread.send({ embeds: [introEmbed] });
  } finally {
    ticketLocks.delete(user.id);
  }

  return interaction.reply({
    content: `🦇 Seu ticket exclusivo foi aberto em <#${thread.id}>! Corre lá que você tem 10 minutos.`,
    flags: MessageFlags.Ephemeral
  });
}

async function startDisputeTicket(interaction, eventKey) {
  const { channel, user, member, guild } = interaction;
  const config = getConfig();
  const eventConfig = config.events[eventKey] || { name: 'Evento', baseDkp: 30 };

  for (const [tId, t] of activeTickets.entries()) {
    if (t.userId === user.id && t.type === 'dispute') {
      return interaction.reply({
        content: `⚠️ Você já tem um ticket de contestação aberto em <#${tId}>! Termine ele ou espere expirar.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  let thread;
  try {
    thread = await channel.threads.create({
      name: `🔍-revisao-${user.username.slice(0, 15)}`,
      autoArchiveDuration: 60,
      type: ChannelType.PrivateThread,
      reason: `Ticket de contestação de presença para ${user.tag}`
    });
  } catch (err) {
    thread = await channel.threads.create({
      name: `🔍-revisao-${user.username.slice(0, 15)}`,
      autoArchiveDuration: 60,
      type: ChannelType.PublicThread,
      reason: `Ticket de contestação de presença para ${user.tag}`
    });
  }

  await thread.members.add(user.id).catch(() => {});

  const expiresAt = Date.now() + 10 * 60 * 1000;

  const timer = setTimeout(async () => {
    if (activeTickets.has(thread.id)) {
      activeTickets.delete(thread.id);
      await thread.send({
        content: `⏰ **TEMPO ESGOTADO! / TIME'S UP!**\n<@${user.id}> passaram os 10 minutos de revisão! Ticket cancelado. Se vira e abre outro se ainda quiser chorar pela presença! 🦇`
      }).catch(() => {});
      setTimeout(() => thread.delete().catch(() => {}), 5000);
    }
  }, 10 * 60 * 1000);

  activeTickets.set(thread.id, {
    threadId: thread.id,
    userId: user.id,
    userTag: user.tag || user.username,
    type: 'dispute',
    step: 'print',
    data: {
      eventKey,
      eventName: eventConfig.name,
      baseDkp: eventConfig.baseDkp
    },
    timer,
    expiresAt
  });

  const introEmbed = new EmbedBuilder()
    .setTitle(`🦇 REVISÃO DE PRESENÇA • ${eventConfig.name.toUpperCase()}`)
    .setColor('#E74C3C')
    .setDescription(
      `Ora ora, parece que a Staff te esqueceu em **${eventConfig.name}** (${eventConfig.baseDkp} DKP Base)!\n\n` +
      `⏱️ **Você tem 10 minutos para mandar as provas!**\n\n` +
      `📸 **Passo 1:**\n` +
      `Anexe e envie a **FOTO / PRINT** comprovando que você estava lá no boss!\n` +
      `*(Basta enviar a foto do celular ou print direto aqui no chat)*`
    )
    .setFooter({ text: 'Sem print com dano ou presença = sem DKP!' });

  await thread.send({ embeds: [introEmbed] });

  return interaction.reply({
    content: `🦇 Seu ticket de revisão foi aberto em <#${thread.id}>! Anexe a foto lá.`,
    flags: MessageFlags.Ephemeral
  });
}

// Processa mensagens enviadas pelo usuário dentro da Thread do Ticket
async function handleTicketMessage(message) {
  const targetId = message.channel.isThread() ? message.channel.id : (message.threadId || message.channelId);
  const ticket = activeTickets.get(targetId);

  if (!ticket || (ticket.userId !== message.author.id && !isStaffMember(message.member))) return false;

  const text = (message.content || '').trim();
  const attachments = message.attachments;

  // === FLUXO ATUALIZAÇÃO CP ===
  if (ticket.type === 'cp') {
    // 1. Recebeu Nick
    if (ticket.step === 'nick') {
      if (!text || text.length < 2) {
        await message.reply('Qualé, manda um Nick de verdade aí, não enrola! / Send a real Nickname!');
        return true;
      }
      ticket.data.nick = text;
      ticket.step = 'classe';

      await message.reply({
        content: `Boa, **${text}**! Agora clique no botão abaixo com a sua **Classe**: / Got it! Now select your **Class** below:`,
        components: [createClassSelectionRow()]
      });
      return true;
    }

    // 2. Recebeu Nível (após selecionar classe)
    if (ticket.step === 'nivel') {
      const lvl = parseInt(text, 10);
      if (isNaN(lvl) || lvl < 1 || lvl > 150) {
        await message.reply('Nível inválido, animal! Manda só o número do seu nível (ex: 74). / Invalid level, just type the number (e.g. 74)!');
        return true;
      }
      ticket.data.nivel = lvl;
      ticket.step = 'cp';

      await message.reply(`Beleza, Nível **${lvl}**! Agora digite o seu **Combat Power (CP)** exato (apenas números, ex: 345000): / Nice, now type your exact **Combat Power (CP)**:`);
      return true;
    }

    // 3. Recebeu CP
    if (ticket.step === 'cp') {
      const cpVal = parseInt(text.replace(/[\.\,\s]/g, ''), 10);
      if (isNaN(cpVal) || cpVal < 1000) {
        await message.reply('Manda um CP que faça sentido, comédia! Só números (ex: 350000). / Enter a valid CP number!');
        return true;
      }
      ticket.data.cp = cpVal;
      ticket.step = 'print';

      await message.reply(
        `Fechou, **${cpVal.toLocaleString('pt-BR')} CP**!\n\n` +
        `📸 **Agora mande o PRINT da tela do seu boneco aqui no chat! / Now attach your character SCREENSHOT right here!**\n` +
        `*(Precisa mostrar Nick, Nível e CP bem legíveis, sem Photoshop fajuto!)*`
      );
      return true;
    }

    // 4. Recebeu Print
    if (ticket.step === 'print') {
      let printUrl = null;
      if (attachments && attachments.size > 0) {
        printUrl = attachments.first().url;
      } else if (text.startsWith('http://') || text.startsWith('https://')) {
        printUrl = text;
      }

      if (!printUrl) {
        await message.reply('Cadê a imagem, cego?! Anexa a foto aqui no chat do Discord! / Where is the picture? Attach the screenshot image file here!');
        return true;
      }

      ticket.data.printUrl = printUrl;
      ticket.step = 'confirm';

      const confirmEmbed = new EmbedBuilder()
        .setTitle('🧐 CONFERÊNCIA DOS DADOS • CONFIRM DETAILS')
        .setColor('#2ECC71')
        .setDescription(
          `Confere aí se tá tudo certo antes de mandar pros carrascos da Staff:\n\n` +
          `🎮 **Nick:** \`${ticket.data.nick}\`\n` +
          `🛡️ **Classe:** \`${ticket.data.classe}\`\n` +
          `⭐ **Nível:** \`Nv. ${ticket.data.nivel}\`\n` +
          `🔥 **Combat Power:** \`${ticket.data.cp.toLocaleString('pt-BR')} CP\`\n\n` +
          `Se tiver tudo nos conformes, clica no botão verde abaixo para enviar!`
        )
        .setImage(printUrl)
        .setFooter({ text: 'Clique em Confirmar para finalizar o ticket!' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_cp_confirm_${ticket.threadId}`)
          .setLabel('Confirmar e Enviar pra Staff')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🚀'),
        new ButtonBuilder()
          .setCustomId(`ticket_cp_cancel_${ticket.threadId}`)
          .setLabel('Cancelar Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
      );

      await message.reply({ embeds: [confirmEmbed], components: [row] });
      return true;
    }
  }

  // === FLUXO CONTESTAÇÃO DE PRESENÇA ===
  if (ticket.type === 'dispute') {
    if (ticket.step === 'print') {
      let printUrl = null;
      if (attachments && attachments.size > 0) {
        printUrl = attachments.first().url;
      } else if (text.startsWith('http://') || text.startsWith('https://')) {
        printUrl = text;
      }

      if (!printUrl) {
        await message.reply('Cadê o print comprovando o boss, filho de cristo?! Anexa a foto aí! / Attach the proof screenshot image here!');
        return true;
      }

      ticket.data.printUrl = printUrl;
      ticket.step = 'obs';

      await message.reply(
        `Print recebido! 📸\n\n` +
        `Agora digite se tem alguma **observação** (ex: *"estava de piloto no char X"* ou digite *"nenhuma"* se não tiver):`
      );
      return true;
    }

    if (ticket.step === 'obs') {
      ticket.data.note = text.toLowerCase() === 'nenhuma' ? 'Sem observações' : text;
      ticket.step = 'confirm';

      const confirmEmbed = new EmbedBuilder()
        .setTitle('🧐 CONFERÊNCIA DA CONTESTAÇÃO')
        .setColor('#E74C3C')
        .setDescription(
          `Evento Reivindicado: **${ticket.data.eventName}** (${ticket.data.baseDkp} DKP Base)\n` +
          `Observação / Piloto: \`${ticket.data.note}\`\n\n` +
          `Clica no botão abaixo para mandar pra Staff analisar!`
        )
        .setImage(ticket.data.printUrl)
        .setFooter({ text: 'A Staff vai checar o log e o print!' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_disp_confirm_${ticket.threadId}`)
          .setLabel('Enviar Revisão para a Staff')
          .setStyle(ButtonStyle.Success)
          .setEmoji('📩'),
        new ButtonBuilder()
          .setCustomId(`ticket_disp_cancel_${ticket.threadId}`)
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
      );

      await message.reply({ embeds: [confirmEmbed], components: [row] });
      return true;
    }
  }

  return false;
}

// Trata os cliques dos botões dentro do ticket (Escolha de classe e confirmações)
async function handleTicketButton(interaction) {
  const { customId, channel, user, member } = interaction;

  // 1. Escolha da Classe
  if (customId.startsWith('ticket_class_')) {
    const chosenClass = customId.replace('ticket_class_', '');
    const ticket = activeTickets.get(channel.id);

    if (!ticket || (ticket.userId !== user.id && !isStaffMember(member))) {
      return interaction.reply({ content: '❌ Esse ticket não é seu, curioso!', flags: MessageFlags.Ephemeral });
    }

    ticket.data.classe = chosenClass;
    ticket.step = 'nivel';

    await interaction.update({
      content: `🛡️ Classe selecionada: **${chosenClass}**!\n\nAgora digite o seu **Nível atual** no chat (apenas números, ex: 74): / Now type your current **Level**:`,
      components: []
    });
    return true;
  }

  // 2. Confirmação do Envio de CP
  if (customId.startsWith('ticket_cp_confirm_')) {
    const threadId = customId.replace('ticket_cp_confirm_', '');
    const ticket = activeTickets.get(threadId);

    if (!ticket) {
      return interaction.reply({
        content: '⚠️ Este ticket já foi concluído ou expirou! Esse canal será encerrado.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (ticket.userId !== user.id && !isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas o dono do ticket ou a Staff podem confirmar!', flags: MessageFlags.Ephemeral });
    }

    // Defer imediato para evitar timeout de 3 segundos do Discord durante o upload do print
    await interaction.deferUpdate().catch(() => {});

    clearTimeout(ticket.timer);
    activeTickets.delete(threadId);

    // Remove botões imediatamente para evitar cliques duplos/flood
    await interaction.editReply({
      content: '⏳ **Processando seu registro e enviando para a auditoria da Staff...** Aguarde!',
      components: [],
      embeds: []
    }).catch(() => {});

    const isNewRegistration = !!ticket.data.isRegistration;
    const targetUserId = ticket.userId;
    const targetUserTag = ticket.userTag || user.tag || user.username;

    const sub = submitCpUpdate({
      userId: targetUserId,
      userTag: targetUserTag,
      nick: ticket.data.nick,
      classe: ticket.data.classe,
      nivel: ticket.data.nivel,
      cp: ticket.data.cp,
      printUrl: ticket.data.printUrl,
      isRegistration: isNewRegistration
    });

    // Envia ficha oficial no canal de auditoria
    const auditChId = channels['auditoria-cp'];
    if (auditChId) {
      const ch = await interaction.client.channels.fetch(auditChId).catch(() => null);
      if (ch) {
        const files = [];
        let imageUri = ticket.data.printUrl;
        if (ticket.data.printUrl) {
          try {
            const attachment = new AttachmentBuilder(ticket.data.printUrl, { name: 'print_cp.png' });
            files.push(attachment);
            imageUri = 'attachment://print_cp.png';
          } catch (err) {
            console.error('Erro ao anexar print de CP na auditoria:', err);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(isNewRegistration ? '📜 NOVO ALISTAMENTO DE MEMBRO • NOOMERCY' : '🛡️ ATUALIZAÇÃO SEMANAL DE CP / NÍVEL • NOOMERCY')
          .setColor(isNewRegistration ? '#9B59B6' : '#3498DB')
          .setDescription(
            isNewRegistration
              ? `Novo recruta: <@${targetUserId}> \`(${targetUserTag})\`\n*Aprovação dará o cargo da classe e liberará os canais.*`
              : `Membro: <@${targetUserId}> \`(${targetUserTag})\`\n*Atualização de pontuação semanal de DKP.*`
          )
          .addFields(
            { name: '🎮 Nick In-game', value: `\`${ticket.data.nick}\``, inline: true },
            { name: '🛡️ Classe', value: `\`${ticket.data.classe}\``, inline: true },
            { name: '⭐ Nível', value: `\`Nv. ${ticket.data.nivel}\``, inline: true },
            { name: '🔥 Combat Power (CP)', value: `**${ticket.data.cp.toLocaleString('pt-BR')} CP**`, inline: true }
          )
          .setImage(imageUri)
          .setFooter({ text: `ID: ${sub.submissionId} • Tipo: ${isNewRegistration ? 'Alistamento' : 'Atualização Semanal'}` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`btn_aprovar_cp_${targetUserId}`).setLabel(isNewRegistration ? 'Aprovar Alistamento' : 'Aprovar CP').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(`btn_rejeitar_cp_${targetUserId}`).setLabel('Rejeitar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        const sentMsg = await ch.send({ embeds: [embed], files, components: [row] });
        if (sentMsg && sentMsg.attachments && sentMsg.attachments.size > 0) {
          const permUrl = sentMsg.attachments.first().url;
          const mems = getMembers();
          if (mems[targetUserId] && mems[targetUserId].pendingSubmission) {
            mems[targetUserId].pendingSubmission.printUrl = permUrl;
            saveMembers(mems);
          }
        }
      }
    }

    if (isNewRegistration) {
      await channel.send({
        content: `🎉 **ALISTAMENTO ENVIADO COM SUCESSO! / RECRUITMENT SUBMITTED!**\nSua ficha foi enviada para a Staff analisar em <#${auditChId}>! Assim que for aprovado, você receberá o cargo da sua classe e os canais da guild serão liberados. Fechando em 5 segundos! 🦇`
      }).catch(() => {});
    } else {
      await channel.send({
        content: `🎉 **CP ENVIADO COM SUCESSO! / CP SUBMITTED!**\nSua atualização semanal de CP foi enviada para a Staff em <#${auditChId}>. Esse ticket será fechado em 5 segundos! 🦇`
      }).catch(() => {});
    }

    setTimeout(() => channel.delete().catch(() => {}), 5000);
    return true;
  }

  // 3. Cancelar Ticket de CP
  if (customId.startsWith('ticket_cp_cancel_')) {
    const threadId = customId.replace('ticket_cp_cancel_', '');
    const ticket = activeTickets.get(threadId);

    if (ticket && ticket.userId !== user.id && !isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas o dono do ticket ou a Staff podem cancelar!', flags: MessageFlags.Ephemeral });
    }

    if (ticket) clearTimeout(ticket.timer);
    activeTickets.delete(threadId);

    await interaction.update({
      content: `❌ Ticket cancelado a pedido do freguês. Fechando em 3 segundos...`,
      components: [],
      embeds: []
    });
    setTimeout(() => channel.delete().catch(() => {}), 3000);
    return true;
  }

  // 4. Confirmação do Envio de Contestação
  if (customId.startsWith('ticket_disp_confirm_')) {
    const threadId = customId.replace('ticket_disp_confirm_', '');
    const ticket = activeTickets.get(threadId);

    if (!ticket) {
      return interaction.reply({
        content: '⚠️ Esta contestação já foi enviada ou o ticket expirou!',
        flags: MessageFlags.Ephemeral
      });
    }

    if (ticket.userId !== user.id && !isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas o dono do ticket ou a Staff podem confirmar!', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate().catch(() => {});

    clearTimeout(ticket.timer);
    activeTickets.delete(threadId);

    await interaction.editReply({
      content: '⏳ **Transmitindo contestação para a Staff...** Aguarde!',
      components: [],
      embeds: []
    }).catch(() => {});

    const targetUserId = ticket.userId;
    const targetUserTag = ticket.userTag || user.tag || user.username;

    const dispute = submitPresenceDispute({
      userId: targetUserId,
      userTag: targetUserTag,
      eventKey: ticket.data.eventKey,
      eventName: ticket.data.eventName,
      printUrl: ticket.data.printUrl,
      note: ticket.data.note
    });

    const auditPresId = channels['auditoria-presencas'];
    if (auditPresId) {
      const ch = await interaction.client.channels.fetch(auditPresId).catch(() => null);
      if (ch) {
        const files = [];
        let imageUri = ticket.data.printUrl;
        if (ticket.data.printUrl) {
          try {
            const attachment = new AttachmentBuilder(ticket.data.printUrl, { name: 'print_dispute.png' });
            files.push(attachment);
            imageUri = 'attachment://print_dispute.png';
          } catch (err) {
            console.error('Erro ao anexar print de contestação na auditoria:', err);
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('🔍 REVISÃO DE PRESENÇA SOLICITADA')
          .setColor('#E74C3C')
          .addFields(
            { name: 'Jogador', value: `<@${targetUserId}> \`(${targetUserTag})\``, inline: true },
            { name: 'Boss / Evento', value: `\`${dispute.eventName}\` *(Base: ${dispute.baseDkp} DKP)*`, inline: true },
            { name: 'Obs / Piloto', value: ticket.data.note, inline: false }
          )
          .setImage(imageUri)
          .setFooter({ text: `ID: ${dispute.disputeId}` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`btn_aprovar_disp_${dispute.disputeId}`).setLabel('Validar Presença').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId(`btn_rejeitar_disp_${dispute.disputeId}`).setLabel('Rejeitar').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );

        const sentMsg = await ch.send({ embeds: [embed], files, components: [row] });
        if (sentMsg && sentMsg.attachments && sentMsg.attachments.size > 0) {
          const permUrl = sentMsg.attachments.first().url;
          const p = getPresencas();
          if (p.disputes && p.disputes[dispute.disputeId]) {
            p.disputes[dispute.disputeId].printUrl = permUrl;
            savePresencas(p);
          }
        }
      }
    }

    await channel.send({
      content: `🎉 **CHORO ENVIADO COM SUCESSO! / DISPUTE SENT!**\nSua contestação de **${ticket.data.eventName}** tá na mesa da Staff em <#${auditPresId}>. Fechando em 5 segundos! 🦇`
    }).catch(() => {});

    setTimeout(() => channel.delete().catch(() => {}), 5000);
    return true;
  }

  // 5. Cancelar Ticket de Contestação
  if (customId.startsWith('ticket_disp_cancel_')) {
    const threadId = customId.replace('ticket_disp_cancel_', '');
    const ticket = activeTickets.get(threadId);

    if (ticket && ticket.userId !== user.id && !isStaffMember(member)) {
      return interaction.reply({ content: '❌ Apenas o dono do ticket ou a Staff podem cancelar!', flags: MessageFlags.Ephemeral });
    }

    if (ticket) clearTimeout(ticket.timer);
    activeTickets.delete(threadId);

    await interaction.update({
      content: `❌ Revisão cancelada. Fechando em 3 segundos...`,
      components: [],
      embeds: []
    });
    setTimeout(() => channel.delete().catch(() => {}), 3000);
    return true;
  }

  return false;
}

module.exports = {
  startCpUpdateTicket,
  startDisputeTicket,
  handleTicketMessage,
  handleTicketButton
};
