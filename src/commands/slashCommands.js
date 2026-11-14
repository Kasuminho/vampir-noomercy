const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../database/db');

function getSlashCommands() {
  const config = getConfig();
  const classesList = config.classes || ['Ceifador', 'Mago', 'Víbora', 'Berserker', 'Guerreiro', 'Paladino', 'Arqueiro', 'Assassino', 'Guardião', 'Invocador', 'Outra'];
  const classChoices = classesList.slice(0, 25).map(c => ({ name: c, value: c }));

  const eventChoices = Object.values(config.events || {}).map(e => ({
    name: `${e.name} (${e.baseDkp} DKP Base)`,
    value: e.key
  })).slice(0, 25);

  return [
    // 1. Atualizar Char
    new SlashCommandBuilder()
      .setName('atualizar-char')
      .setDescription('Envia a atualização semanal de CP, Nível e Classe com print de prova.')
      .addStringOption(opt => opt.setName('nick').setDescription('Seu nick exato dentro do jogo').setRequired(true))
      .addStringOption(opt => opt.setName('classe').setDescription('Sua classe').setRequired(true).addChoices(...classChoices))
      .addIntegerOption(opt => opt.setName('nivel').setDescription('Seu nível atual (ex: 58)').setRequired(true).setMinValue(1).setMaxValue(150))
      .addIntegerOption(opt => opt.setName('cp').setDescription('Seu Combat Power (CP) exato (ex: 64500)').setRequired(true).setMinValue(1))
      .addAttachmentOption(opt => opt.setName('print').setDescription('Captura de tela legível mostrando Nick, Nível e CP').setRequired(true)),

    // 2. Meu DKP
    new SlashCommandBuilder()
      .setName('meu-dkp')
      .setDescription('Consulta seu saldo atual de DKP, pontos travados e histórico (efêmero).'),

    // 3. Simular DKP
    new SlashCommandBuilder()
      .setName('simular-dkp')
      .setDescription('Simula quanto DKP você receberá em um evento com seu CP e Nível atuais.')
      .addStringOption(opt => opt.setName('evento').setDescription('Escolha o evento/boss').addChoices(...eventChoices))
      .addIntegerOption(opt => opt.setName('cp_simulado').setDescription('Simular outro valor de CP (opcional)').setMinValue(1))
      .addIntegerOption(opt => opt.setName('nivel_simulado').setDescription('Simular outro nível (opcional)').setMinValue(1)),

    // 4. Ranks de CP
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Consulta o ranking de CP dos jogadores da guild.')
      .addSubcommand(sub =>
        sub.setName('geral')
          .setDescription('Exibe o ranking geral dos maiores CPs da guilda.')
          .addIntegerOption(opt => opt.setName('limite').setDescription('Quantidade de jogadores (padrão: 15)').setMinValue(5).setMaxValue(50))
      )
      .addSubcommand(sub =>
        sub.setName('classe')
          .setDescription('Exibe o ranking de CP da classe escolhida (Resposta Efêmera).')
          .addStringOption(opt => opt.setName('classe').setDescription('Selecione a classe').setRequired(true).addChoices(...classChoices))
      ),

    // 5. Justificar Ausência
    new SlashCommandBuilder()
      .setName('justificar-ausencia')
      .setDescription('Justifica sua ausência em um evento ou período (não gera DKP, mas evita punição de inatividade).')
      .addStringOption(opt => opt.setName('evento_ou_data').setDescription('Data ou evento que estará ausente (ex: Geena 19h de hoje)').setRequired(true))
      .addStringOption(opt => opt.setName('motivo').setDescription('Motivo da sua ausência').setRequired(true)),

    // 6. Contestar Presença
    new SlashCommandBuilder()
      .setName('contestar-presenca')
      .setDescription('Solicita revisão se a Staff esqueceu de computar sua presença no boss.')
      .addStringOption(opt => opt.setName('evento').setDescription('Selecione o Boss ou Evento que você participou').setRequired(true).addChoices(...eventChoices))
      .addAttachmentOption(opt => opt.setName('print').setDescription('Print comprovando sua presença no local/boss').setRequired(true))
      .addStringOption(opt => opt.setName('observacao').setDescription('Detalhes extras ou nick se for piloto')),

    // 7. Presença Staff
    new SlashCommandBuilder()
      .setName('presenca')
      .setDescription('[STAFF] Gestão de presença de bosses e eventos.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('marcar-lote')
          .setDescription('Marca presença para múltiplos jogadores de uma vez por Nicks in-game, @menções ou IDs.')
          .addStringOption(opt => opt.setName('evento').setDescription('Evento correspondente').setRequired(true).addChoices(...eventChoices))
          .addStringOption(opt => opt.setName('jogadores').setDescription('Cole a lista de Nicks ou @menções separados por espaço, vírgula ou quebra de linha').setRequired(true))
          .addStringOption(opt => opt.setName('last_hit').setDescription('Nick ou @menção de quem deu o Last Hit (+10 DKP bônus sem multiplicador)'))
          .addIntegerOption(opt => opt.setName('dkp_base_manual').setDescription('Substituir o DKP base'))
      )
      .addSubcommand(sub =>
        sub.setName('marcar-voz')
          .setDescription('Puxa a presença de todos conectados na sala de voz especificada.')
          .addStringOption(opt => opt.setName('evento').setDescription('Evento correspondente').setRequired(true).addChoices(...eventChoices))
          .addChannelOption(opt => opt.setName('canal_voz').setDescription('Canal de voz onde os membros estão').setRequired(false))
          .addStringOption(opt => opt.setName('last_hit').setDescription('Nick ou @menção de quem deu o Last Hit (+10 DKP bônus sem multiplicador)'))
          .addIntegerOption(opt => opt.setName('dkp_base_manual').setDescription('Substituir o DKP base deste evento'))
      )
      .addSubcommand(sub =>
        sub.setName('marcar-membro')
          .setDescription('Concede presença avulsa para um membro específico.')
          .addUserOption(opt => opt.setName('membro').setDescription('Membro que esteve presente').setRequired(true))
          .addStringOption(opt => opt.setName('evento').setDescription('Evento correspondente').setRequired(true).addChoices(...eventChoices))
          .addBooleanOption(opt => opt.setName('last_hit').setDescription('Este membro deu o Last Hit? (+10 DKP bônus fixo)'))
          .addIntegerOption(opt => opt.setName('dkp_base_manual').setDescription('Substituir o DKP base'))
      ),

    // 8. Leilão Staff
    new SlashCommandBuilder()
      .setName('leilao')
      .setDescription('[STAFF] Criação e gerenciamento de leilões de drops com DKP Lock.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('iniciar')
          .setDescription('Inicia um novo leilão de drop em #leilao-drops.')
          .addStringOption(opt => opt.setName('item').setDescription('Nome exato do item dropado').setRequired(true))
          .addStringOption(opt =>
            opt.setName('classe')
              .setDescription('Classe permitida para disputar o item (ou Livre para todos)')
              .setRequired(true)
              .addChoices(
                { name: '🌐 Todas as Classes (Livre)', value: 'Livre' },
                { name: '🩸 Bloodstained', value: 'Bloodstained' },
                { name: '⚔️ Carnage', value: 'Carnage' },
                { name: '🔮 Akasha', value: 'Akasha' },
                { name: '🐍 Viper', value: 'Viper' },
                { name: '💀 Grim Reaper', value: 'Grim Reaper' }
              )
          )
          .addIntegerOption(opt => opt.setName('lance_minimo').setDescription('Lance inicial mínimo (ex: 20)').setRequired(true).setMinValue(1))
          .addIntegerOption(opt => opt.setName('duracao_minutos').setDescription('Duração do leilão em minutos (ex: 15)').setRequired(true).setMinValue(1).setMaxValue(1440))
          .addAttachmentOption(opt => opt.setName('imagem').setDescription('Print ou foto do item no jogo'))
      )
      .addSubcommand(sub =>
        sub.setName('encerrar')
          .setDescription('Encerra antecipadamente um leilão ativo e declara o vencedor.')
          .addStringOption(opt => opt.setName('item_id').setDescription('ID do item em leilão').setRequired(true))
      ),

    // 9. Dar Lance (Bid)
    new SlashCommandBuilder()
      .setName('bid')
      .setDescription('Dá um lance de DKP em um item em leilão ativo (trava o DKP com DKP Lock).')
      .addStringOption(opt => opt.setName('item_id').setDescription('ID do item em leilão').setRequired(true))
      .addIntegerOption(opt => opt.setName('valor').setDescription('Valor do seu lance em DKP').setRequired(true).setMinValue(1)),

    // 10. Configurar Régua Única (Staff)
    new SlashCommandBuilder()
      .setName('configurar-regua')
      .setDescription('[STAFF] Configura a régua completa, cortes mínimos (+7 dias) e posta anúncio oficial.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addIntegerOption(opt => opt.setName('cp_minimo').setDescription('Corte mínimo de CP para pontuar DKP (ex: 290000)').setRequired(true))
      .addIntegerOption(opt => opt.setName('nivel_minimo').setDescription('Corte mínimo de Nível para pontuar DKP (ex: 65)').setRequired(true))
      .addIntegerOption(opt => opt.setName('base_cp').setDescription('CP de referência média 1.0x da guild (ex: 330000)').setRequired(true))
      .addIntegerOption(opt => opt.setName('passo_cp').setDescription('Intervalo do degrau de CP (ex: 30000)').setRequired(true))
      .addNumberOption(opt => opt.setName('bonus_por_passo').setDescription('Bônus percentual por degrau (ex: 8.8 para +8.8%)').setRequired(true))
      .addNumberOption(opt => opt.setName('teto_cp').setDescription('Multiplicador teto máximo de CP (ex: 1.8)').setRequired(true))
      .addIntegerOption(opt => opt.setName('base_nivel').setDescription('Nível médio 1.0x da guild (ex: 72)').setRequired(true))
      .addNumberOption(opt => opt.setName('bonus_por_nivel').setDescription('Bônus percentual por nível (ex: 1.5 para +1.5%)').setRequired(true))
      .addNumberOption(opt => opt.setName('teto_nivel').setDescription('Multiplicador teto máximo de nível (ex: 1.15)').setRequired(true)),

    // 11. Ver Régua Ativa
    new SlashCommandBuilder()
      .setName('ver-regua')
      .setDescription('Exibe a régua atual da guild, prazos de corte de 7 dias e multiplicadores ativos.'),

    // 11. Virada Mensal
    new SlashCommandBuilder()
      .setName('reset-mensal-executar')
      .setDescription('[STAFF] Executa manualmente a virada mensal (mantém 20% do DKP e queima 80%).')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // 12. Setup Painéis
    new SlashCommandBuilder()
      .setName('setup-paineis')
      .setDescription('[STAFF] Publica ou recria os painéis fixos com botões interativos nos canais.')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // 13. Painel de Membros (Staff)
    new SlashCommandBuilder()
      .setName('painel-membros')
      .setDescription('[STAFF] Consulta painel de membros, CPs atrasados, presenças e fichas detalhadas.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(sub =>
        sub.setName('visao-geral')
          .setDescription('Exibe a visão geral dos combatentes, estatísticas e regularidade de CP.')
      )
      .addSubcommand(sub =>
        sub.setName('atrasados')
          .setDescription('Lista membros com CP atrasado (> 7 dias) ou que ainda não enviaram CP.')
      )
      .addSubcommand(sub =>
        sub.setName('sem-presenca')
          .setDescription('Lista combatentes cadastrados que nunca compareceram a nenhum boss (0 presenças).')
      )
      .addSubcommand(sub =>
        sub.setName('roster')
          .setDescription('Exibe a lista completa de membros com CP, presenças e DKP.')
          .addIntegerOption(opt => opt.setName('pagina').setDescription('Número da página (padrão: 1)').setMinValue(1))
      )
      .addSubcommand(sub =>
        sub.setName('consultar')
          .setDescription('Consulta a ficha completa de um membro (CP, Nível, Presenças, DKP, prints).')
          .addStringOption(opt => opt.setName('membro').setDescription('Nick in-game, @menção ou ID do membro').setRequired(true))
      )
  ];
}

module.exports = {
  getSlashCommands
};
