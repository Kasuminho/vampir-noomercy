# 🏛️ Arquitetura do Sistema — Vampir NooMercy (Vlad, o Drácula da Shopee)

Este documento contém o mapeamento completo da arquitetura do bot, a responsabilidade de cada pasta e arquivo, o fluxo de dados e as regras de negócio essenciais.

---

## 🗺️ Mapa de Arquivos e Responsabilidades

```
vampir-noomercy/
├── .github/workflows/
│   └── docker-image.yml         # CI/CD: Constrói a imagem Docker e envia para o GHCR (ghcr.io/kasuminho/vampir-noomercy:latest)
├── data/                        # Diretório local de dados em JSON (usado para fallback e persistência offline)
│   ├── ausencias.json           # Registros de faltas justificadas
│   ├── config.json              # Configurações globais de multiplicadores e canais
│   ├── dkp.json                 # Saldos de DKP e histórico de transações
│   ├── leiloes.json             # Estado dos leilões ativos e concluídos (DKP locks)
│   ├── members.json             # Fichas dos membros (Nick, Discord ID, CP, Level, Classe, Data do CP)
│   └── presencas.json           # Histórico de presença em eventos/bosses
├── scripts/                     # Scripts utilitários de manutenção e migração
│   ├── create_db.js             # Criação do banco de dados no PostgreSQL
│   ├── init_schema.js           # Criação de tabelas, índices e constraints no PostgreSQL
│   ├── migrate_data.js          # Migração dos arquivos JSON para o PostgreSQL
│   ├── publish_registration_panel.js # Publicação avulsa do painel de registro
│   ├── reset_and_republish.js   # Limpa canais e republica todos os painéis
│   └── verify_pg.js             # Validação da conexão e integridade dos dados no PostgreSQL
├── src/
│   ├── commands/
│   │   ├── registerCommands.js  # Registra os Slash Commands na API do Discord (Global / Guild)
│   │   └── slashCommands.js     # Definição dos Slash Commands e subcomandos (SlashCommandBuilder)
│   ├── config/
│   │   └── channels.js          # Mapeamento e resolução de nomes/IDs de canais do servidor
│   ├── database/
│   │   └── db.js                # Camada de banco de dados híbrida (PostgreSQL pool + sincronização em memória/JSON)
│   ├── handlers/
│   │   ├── buttonHandler.js     # Trata todos os cliques em botões interativos
│   │   ├── commandHandler.js    # Trata a execução de todos os comandos slash
│   │   ├── interactionHandler.js # Roteador central de eventos de interação do Discord
│   │   ├── modalHandler.js      # Trata a submissão de formulários modais
│   │   └── selectMenuHandler.js # Trata seletores dropdown (ex: filtro por classe)
│   ├── services/
│   │   ├── auctionService.js    # Motor de leilões, travas de DKP (DKP Lock) e anti-sniping
│   │   ├── dkpCalculator.js     # Cálculo ponderado de DKP por CP e Nível + bônus de Last Hit
│   │   ├── loggerService.js     # Auditoria e envio de logs aos canais do Discord (ocultando CP em público)
│   │   ├── memberService.js     # Gestão de fichas dos membros, consultas e aprovação de CP
│   │   ├── monthlyDecayService.js # Virada mensal (retenção de 20%, queima de 80%)
│   │   ├── presenceService.js   # Registro de presenças individuais/lote/voz e creditação de DKP
│   │   ├── staffMemberService.js# Painel da Staff (visão geral, CP atrasado, fantasmas de boss, roster, consulta)
│   │   └── ticketService.js     # Justificativa de ausências e contestações de presença
│   ├── ui/
│   │   └── panels.js            # Construtor visual de Embeds e Botões para painéis fixos
│   └── index.js                 # Ponto de entrada da aplicação, inicialização do client e agendadores (cron)
├── docker-compose.yml           # Configuração de containers Docker (vampir-bot + vampir-tunnel)
├── Dockerfile                   # Build da imagem Node.js 20 Alpine para produção
├── package.json                 # Dependências e scripts npm
└── README.md                    # Documentação geral de operação
```

---

## 🔍 Detalhamento Arquitetural de Cada Módulo

### 1. Inicialização e Ciclo de Vida (`src/index.js`)
- **Papel:** Inicializa o `Client` do Discord com os intents configurados (`Guilds`, `GuildVoiceStates`, `GuildMessages`).
- **Conexão:** Estabelece conexão com o PostgreSQL através de `initDb()`.
- **Eventos:** Conecta o evento `interactionCreate` ao `handleInteraction`.
- **Agendamento:** Mantém o `cron` que dispara todo dia 1º às 00:00 (GMT-3) para executar o `runMonthlyDecay()`.

### 2. Camada de Dados (`src/database/db.js`)
- **Papel:** Abstrai a persistência com resiliência máxima.
- **Estratégia:** Mantém cache em memória para leituras instantâneas (0ms de latência para evitar timeouts no Discord) e persiste de forma assíncrona no PostgreSQL (`pg.Pool`). Em caso de falha temporária do banco, salva localmente em JSON (`data/*.json`).
- **Tabelas Gerenciadas:**
  - `members`: Armazena `id`, `discord_id`, `nick`, `class_name`, `level`, `cp`, `status`, `last_cp_update`, `print_url`.
  - `dkp`: Balanços acumulados e histórico de movimentações (`history`).
  - `presencas`: Registros de presenças em eventos, jogadores presentes, bônus de last hit e multiplicadores.
  - `leiloes`: Dados de leilões, lances correntes, histórico e locks de DKP.
  - `ausencias`: Justificativas de ausência.
  - `config`: Multiplicadores globais de CP/Nível e IDs de canais.

### 3. Roteador de Interações (`src/handlers/interactionHandler.js`)
- **Papel:** Ponto único de entrada para qualquer interação do Discord.
- **Roteamento:**
  - `interaction.isChatInputCommand()` ➔ `handleSlashCommand(interaction)`
  - `interaction.isButton()` ➔ `handleButtonClick(interaction)`
  - `interaction.isModalSubmit()` ➔ `handleModalSubmit(interaction)`
  - `interaction.isStringSelectMenu()` ➔ `handleSelectMenu(interaction)`
- **Tratamento de Erros:** Captura qualquer exceção não tratada e envia mensagem efêmera de erro ao usuário caso a interação ainda não tenha sido respondida.

### 4. Manipuladores de Ações (`src/handlers/`)
- **`commandHandler.js`:**
  - Trata comandos como `/presenca marcar-lote`, `/presenca marcar-voz`, `/meu-dkp`, `/simular-dkp`, `/rank`, `/painel-membros`, `/leilao`, `/setup-paineis`.
  - **Regra Crítica de Performance:** Comandos pesados ou que exibem painéis executam `await interaction.deferReply({ flags: MessageFlags.Ephemeral })` na primeira linha para evitar o timeout de 3 segundos do Discord.
- **`buttonHandler.js`:**
  - Responde a botões do painel de membros, painel de staff, aprovação de CP, auditoria de presença e paginação.
  - Executa `deferReply` ou `deferUpdate` imediatamente.
- **`modalHandler.js`:**
  - Recebe os dados digitados pelos membros em modais (registro, justificativa, contestação, marcação de lote, consulta de membro).
- **`selectMenuHandler.js`:**
  - Gerencia seletores dropdown (ex: seleção de classe para ranking efêmero).

### 5. Serviços de Negócio (`src/services/`)
- **`staffMemberService.js`:**
  - Responsável por todas as visões do **Painel de Membros da Staff**:
    - `getStaffOverviewData(guild)`: Coleta dados sincronizados em memória de todos os membros, histórico de DKP e cache de usuários do Discord.
    - `buildStaffOverviewEmbed`: Estatísticas gerais (CP em dia, CP atrasado, membros com 0 presenças, não registrados, médias de CP/Level, DKP total).
    - `buildOverdueEmbed`: Lista membros com CP atrasado (> 7 dias) e visitantes sem cadastro no Discord.
    - `buildZeroPresenceEmbed`: Lista membros registrados com **0 presenças em bosses** ("fantasmas de boss").
    - `buildRosterPageEmbed`: Roster completo paginado com CP, nível, classe e DKP (visível apenas para Staff).
    - `buildMemberDetailEmbed`: Ficha individual de qualquer combatente ou visitante do Discord.
- **`dkpCalculator.js`:**
  - Calcula a pontuação ponderada do evento: `Base * Multiplicador_CP * Multiplicador_Level`.
  - Calcula bônus fixo de **Last Hit** (+10 DKP fixos, sem aplicação de multiplicador).
- **`presenceService.js`:**
  - Processa a marcação de presenças em lote por menção, nick ou ID.
  - Suporta marcação automática puxando todos os presentes em salas de voz.
  - Aplica o bônus de Last Hit aos jogadores indicados.
  - Atualiza o balanço de DKP e grava o histórico.
- **`loggerService.js`:**
  - Envia resumos formatados para `#logs-dkp`, `#logs-geral`, `#auditoria-cp`, etc.
  - **Regra de Ouro de Privacidade:** O Combat Power (CP) é **sempre ocultado** de mensagens e logs públicos. Apenas Staff tem acesso ao CP através do Painel de Membros.
- **`auctionService.js`:**
  - Sistema de leilão com **Restrição de Classe** e `DKP Lock`:
    - Permite cadastrar leilões livres para todas as classes ou restritos a uma classe específica (`Bloodstained`, `Carnage`, `Akasha`, `Viper`, `Grim Reaper`).
    - Bloqueia automaticamente lances de jogadores que não pertençam à classe exclusiva do item.
    - Ao dar um lance, o saldo do jogador é bloqueado para impedir lances múltiplos acima do saldo real.
    - Caso o jogador seja superado, o saldo é desbloqueado automaticamente.
    - Anti-sniping: estende o prazo em +2 minutos se houver lance no minuto final.
- **`monthlyDecayService.js`:**
  - Executa a virada de mês: retém 20% do DKP de cada membro e remove 80%.

---

## ⚡ Regras Técnicas e Diretrizes Críticas

1. **Prevenção de Timeout no Discord (3000ms):**
   - O Discord cancela qualquer interação após 3 segundos.
   - Sempre utilize `await interaction.deferReply({ flags: MessageFlags.Ephemeral })` ou `await interaction.deferUpdate()` imediatamente ao processar painéis, comandos ou cliques complexos.
   - **Nunca** chame `guild.members.fetch()` sem necessidade ou sem o gateway intent `GuildMembers`. Utilize `guild.members.cache` para operações síncronas e instantâneas.

2. **IDs de Componentes Únicos:**
   - Em ActionRows do Discord, botões não podem ter `customId` duplicado na mesma mensagem. Botões de paginação usam sufixos distintos (`btn_staff_mem_page_prev_X`, `btn_staff_mem_page_next_X`, `btn_staff_mem_roster_main`).

3. **Ocultação do Combat Power (CP):**
   - Ranks públicos e logs no canal `#logs-dkp` contêm apenas Nicks, Pontuação de DKP e Novo Saldo.
   - O CP real é informação estratégica da guilda e fica restrito ao canal `#comando-staff` e ao `/painel-membros`.
