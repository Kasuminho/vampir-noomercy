const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

// 1. Painel de Membros (Bilingual PT/EN + Zuero Vlad)
function createMemberPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🧛 NOOMERCY • CENTRAL DO VAMPIRO & DKP / PLAYER & DKP HUB')
    .setColor('#9B59B6')
    .setDescription(
      'Fala seus sanguessugas da Shopee! / Greetings bloodsuckers!\n\n' +
      'Aqui você consulta suas moedinhas de sangue (DKP) pra saber se vai conseguir comprar item épico ou se vai continuar na lama com set verde!\n' +
      '*Here you check your blood tokens (DKP) to see if you can bid on drops or stay broke with green gear!*\n\n' +
      '📜 **REGRAS DE OURO / GOLDEN RULES:**\n' +
      '• **DKP Ponderado / Weighted DKP:** Quem tem mais CP e Nível ganha mais DKP por boss. Carregou o time? Ganha mais sangue! / Higher CP & Level = more DKP.\n' +
      '• **Obrigatório Print Semanal / Mandatory Weekly Screenshot:** Sem print aprovado em `#atualizacao-cp`, seu DKP é **ZERO**! Não adianta chorar no colo do Vlad! / No approved CP = **0 DKP**!\n' +
      '• **Virada Mensal / Monthly Decay:** Todo dia 1º, Vlad queima **80% do seu DKP** (você só retém 20%). Gastem essa porra nos leilões! / 80% decay on the 1st of every month (keep 20%). Don\'t hoard!\n' +
      '• **DKP Lock no Leilão / Auction Bid Lock:** Deu lance? Seus pontos ficam travados na carteira até alguém cobrir. Sem calote na guild! / Placed a bid? Balance is locked until outbid!'
    )
    .addFields(
      { name: '💰 Saldo / Balance', value: 'Seu saldo livre & travado.\n*Free & locked DKP.*', inline: true },
      { name: '🧮 Simulador / Simulator', value: 'Calcule seu ganho por boss.\n*Estimate DKP gain.*', inline: true },
      { name: '🏆 Ranks / Leaderboards', value: 'Top CP geral e por classe.\n*CP ranking by class.*', inline: true }
    )
    .setFooter({ text: 'Vlad, o Drácula da Shopee • NooMercy DKP System' })
    .setTimestamp();
}

function createMemberPanelButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_meu_dkp')
      .setLabel('💰 Meu DKP / My DKP')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_simular_dkp')
      .setLabel('🧮 Simular / Simulator')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_rank_geral')
      .setLabel('🏆 Rank Geral / CP Rank')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_rank_classe')
      .setLabel('🎯 Rank Classe / Class Rank')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1];
}

// 2. Painel de Atualização de CP (Bilingual PT/EN + Zuero Vlad)
function createCpUpdatePanelEmbed() {
  return new EmbedBuilder()
    .setTitle('📋 ATUALIZAÇÃO SEMANAL DE CP & NÍVEL / WEEKLY CP & LEVEL UPDATE')
    .setColor('#3498DB')
    .setDescription(
      'Quer ganhar DKP nos eventos? Então manda a porra do seu print atualizado todo início de semana!\n' +
      '*Want to earn DKP at bosses? Upload your updated character screenshot every week!*\n\n' +
      '🚫 **REGRA SUPREMA / SUPREME RULE (SEM CP = ZERO DKP):**\n' +
      '• Se você não tiver seu CP e Nível aprovados pela Staff, você ganha **0 DKP** em todos os bosses!\n' +
      '• *No approved CP/Level profile = ZERO DKP in all guild events! Non-negotiable!*\n\n' +
      '📱 **Joga no Celular? Sem Stress! / Mobile Friendly:**\n' +
      'Clique no botão abaixo para abrir seu **Ticket Exclusivo de 10 Minutos**. O Vlad vai conversar com você no chat e você manda a foto direto da galeria do celular!\n' +
      '*Click the button below to start your private 10-minute ticket. Vlad will guide you step-by-step and you can upload photos directly from your phone gallery!*'
    )
    .setFooter({ text: 'NooMercy • Auditoria Semanal de Combat Power' })
    .setTimestamp();
}

function createCpUpdatePanelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_abrir_update_cp')
        .setLabel('📱 Atualizar CP / Update CP (10 min)')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

// 3. Painel de Justificativa de Ausência (Bilingual PT/EN)
function createAbsencePanelEmbed() {
  return new EmbedBuilder()
    .setTitle('📝 JUSTIFICATIVA DE AUSÊNCIA / EXCUSE ABSENCE')
    .setColor('#E67E22')
    .setDescription(
      'Vai murchar e faltar no boss de hoje? Justifique antes que a liderança puxe sua orelha!\n' +
      '*Going to miss today\'s raid? Submit your absence notice before leadership kicks your butt!*\n\n' +
      '⚠️ **Avisos do Vlad / Warnings:**\n' +
      '• Justificar ausência evita advertência por inatividade, mas **NÃO DÁ DKP** (quem não luta não mama)!\n' +
      '• *Excusing absence prevents inactivity strikes, but GRANTS 0 DKP (no fight, no loot)!*\n\n' +
      'Clique no botão abaixo para registrar / Click below to submit:'
    )
    .setFooter({ text: 'Vlad da Shopee • Transparência na NooMercy' })
    .setTimestamp();
}

function createAbsencePanelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_abrir_ausencia')
        .setLabel('⏰ Justificar Ausência / Excuse Absence')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

// 4. Painel de Contestação de Presença (Bilingual PT/EN)
function createDisputePanelEmbed() {
  return new EmbedBuilder()
    .setTitle('📸 REVISÃO DE PRESENÇA EM BOSS / ATTENDANCE DISPUTE')
    .setColor('#E74C3C')
    .setDescription(
      'A Staff estava cega e esqueceu de marcar sua presença no boss? Calma, não precisa xingar a mãe de ninguém!\n' +
      '*Did Staff forget to mark you at the boss? Don\'t panic and don\'t rage yet!*\n\n' +
      '🔍 **Como Funciona / How It Works:**\n' +
      '1. Clique no botão abaixo e selecione o evento em que esteve presente.\n' +
      '2. O Vlad vai abrir um **Ticket Privado de 10 Minutos** para você anexar o print de prova direto do celular ou PC!\n' +
      '3. A liderança analisa sua prova e, se for aceita, seus pontos entram com base no seu CP!\n\n' +
      '*1. Click below and pick the event.\n' +
      '*2. Vlad opens a private 10-min thread where you upload your proof screenshot.\n' +
      '*3. Staff audits and awards full weighted DKP!*'
    )
    .setFooter({ text: 'Sem print com dano ou presença visível = sem DKP!' })
    .setTimestamp();
}

function createDisputePanelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_abrir_contestacao')
        .setLabel('🔍 Solicitar Revisão / Dispute Attendance')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

// 5. Painel da Staff (Bilingual PT/EN)
function createStaffPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🛡️ PAINEL DE CONTROLE DA STAFF / STAFF COMMAND CENTER')
    .setColor('#2ECC71')
    .setDescription(
      'Painel exclusivo para Oficiais e Liderança da NooMercy / Officers & Leadership exclusive panel:\n\n' +
      '• **Presença em Lote / Batch Attendance:** Cole nicks do jogo ou @menções de uma vez.\n' +
      '• **Presença por Voz / Voice Attendance:** Registra presença automática de quem está na call do boss.\n' +
      '• **Criar Leilão / New Drop Auction:** Lança drop com sistema automático de DKP Lock.\n' +
      '• **Virada Mensal / Monthly Decay:** Teste do corte de 80% (agendado automático dia 1º às 00:00).'
    )
    .setFooter({ text: 'Acesso Restrito • NooMercy Leadership' })
    .setTimestamp();
}

function createStaffPanelButtons() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_staff_presenca_lote')
      .setLabel('📋 Presença em Lote')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_staff_presenca_voz')
      .setLabel('🎙️ Presença por Voz')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_staff_painel_membros')
      .setLabel('👥 Painel de Membros')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🛡️')
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_staff_novo_leilao')
      .setLabel('📦 Criar Leilão / New Auction')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_staff_reset_mensal')
      .setLabel('🔄 Virada Mensal / Monthly Decay')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

// 6. Painel de Registro / Alistamento Oficial (#registro)
function createRegistrationPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🦇 ALISTAMENTO OFICIAL & REGISTRO • NOOMERCY')
    .setColor('#9B59B6')
    .setDescription(
      'Bem-vindo ao quartel-general da **NooMercy**! / Welcome to NooMercy HQ!\n\n' +
      'Para **liberar o acesso completo** a todas as calls, canais de texto e começar a pontuar DKP nos bosses, faça o seu **Alistamento Oficial** agora mesmo!\n' +
      '*To unlock full server access (chats, voice channels) and start earning DKP, submit your Official Registration now!*\n\n' +
      '📋 **Como Funciona / How It Works:**\n' +
      '1. Clique no botão verde abaixo **`[📋 Fazer Alistamento / Register]`**.\n' +
      '2. O Vlad vai abrir um **Ticket Privado de 10 Minutos** exclusivo para você!\n' +
      '3. Digite seu Nick, selecione sua Classe, informe seu Nível e CP, e envie o **Print legível** do seu boneco!\n' +
      '4. Assim que a liderança aprovar, o **Vlad automaticamente entrega o cargo da sua classe** e o Discord inteiro se abre para você! 🦇\n\n' +
      '*(1. Click the button below to start your 10-min private ticket. 2. Vlad will ask for your Nick, Class, Level, CP and Character Screenshot. 3. Once approved, you get your Class role and full access!)*'
    )
    .addFields(
      { name: '🛡️ Classes Vampir', value: '`Akasha` • `Bloodstained` • `Carnage` • `Vyper` • `Grim Reaper`', inline: true },
      { name: '⚠️ Regra Obrigatória', value: 'Sem print ou com print ilegível = cadastro recusado!', inline: true }
    )
    .setFooter({ text: 'Vlad, o Drácula da Shopee • Alistamento NooMercy' })
    .setTimestamp();
}

function createRegistrationPanelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_abrir_update_cp')
        .setLabel('📋 Fazer Alistamento / Register (10 min)')
        .setEmoji('🦇')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

module.exports = {
  createMemberPanelEmbed,
  createMemberPanelButtons,
  createCpUpdatePanelEmbed,
  createCpUpdatePanelButtons,
  createAbsencePanelEmbed,
  createAbsencePanelButtons,
  createDisputePanelEmbed,
  createDisputePanelButtons,
  createStaffPanelEmbed,
  createStaffPanelButtons,
  createRegistrationPanelEmbed,
  createRegistrationPanelButtons
};
