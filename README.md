# ⚔️ NooMercy DKP & Presence Bot (Vlad, o Drácula da Shopee)

Bot oficial de controle de presença em bosses, pontuação de DKP ponderada por CP e Nível, auditoria de fichas, leilões multi-itens com **DKP Lock**, persistência em banco PostgreSQL e virada mensal automática para a guilda **NooMercy** no jogo *Vampir*.

---

## 🐳 Como Subir na VPS com Docker

### 1. Clonar o Repositório
```bash
git clone https://github.com/Kasuminho/vampir-noomercy.git
cd vampir-noomercy
```

### 2. Configurar Variáveis de Ambiente
Copie o `.env.example` e preencha suas chaves:
```bash
cp .env.example .env
nano .env
```

### 3. Build e Execução com Docker Compose
```bash
docker compose up -d --build
```

### 4. Visualizar Logs em Tempo Real
```bash
docker compose logs -f
```

### 5. Parar ou Reiniciar o Container
```bash
docker compose restart
# ou para parar completamente:
docker compose down
```

---

## 🚀 Funcionalidades

1. **DKP Ponderado por CP e Nível**:
   - Cada evento possui um DKP base (ex: Geena 15h = 30 pts, Guerra = 50 pts).
   - O ganho real de cada membro é multiplicado proporcionalmente pelo seu CP e Nível aprovados.
   - Configurável em tempo de execução via `/config-dkp`.

2. **Auditoria Semanal de Personagem**:
   - Os membros enviam semanalmente Nick, Classe, Nível, CP e Print comprovatório via `/atualizar-char` ou no canal `#atualizacao-cp`.
   - A Staff aprova ou rejeita com botões interativos em `#auditoria-cp`.

3. **Simulador de DKP**:
   - O jogador simula no botão ou com `/simular-dkp` exatamente quantos pontos receberá em cada boss (resposta efêmera e detalhada).

4. **Ranks de CP**:
   - `/rank geral`: Ranking público dos maiores CPs da guilda inteira.
   - `/rank classe`: Menu de seleção de classe com resposta **efêmera** (o membro vê seus concorrentes diretos por drops).

5. **Leilão Multi-Itens com DKP Lock**:
   - A Staff inicia leilões com `/leilao iniciar`.
   - Os lances em `/bid` ou botões travam o DKP do licitante (*DKP Lock*). Se alguém cobrir o lance, o saldo anterior é destravado na hora.
   - Anti-sniping automático: lances no último minuto prorrogam o leilão em +2 minutos.
   - Encerramento automático com dedução do saldo e anúncio do vencedor.

6. **Justificativa de Ausência**:
   - Canal `#justificar-ausencia` para avisar com antecedência.
   - Mantém a assiduidade e a vaga preservadas (não gera DKP).

7. **Contestação de Presença em Boss**:
   - Se a Staff esqueceu de marcar um membro, ele envia a prova em `#contestacao-presenca`.
   - A Staff valida em `#auditoria-presencas` com 1 clique (o DKP é recalculado pelo CP do membro e creditado automaticamente).

8. **Virada Mensal (Dia 1)**:
   - Todo dia 1º às 00:00 (GMT-3), roda automaticamente a retenção de 20% do DKP e queima os 80% restantes.
   - Relatório automático enviado em `#logs-dkp`.

---

## 🛠️ Comandos Slash Disponíveis

| Comando | Descrição | Permissão |
| :--- | :--- | :--- |
| `/atualizar-char` | Envia Nick, Classe, Nível, CP e Print semanal | Todos |
| `/meu-dkp` | Consulta extrato detalhado de DKP e status | Todos |
| `/simular-dkp` | Simula ganho de DKP por evento | Todos |
| `/rank geral` | Exibe Top CP da guilda | Todos |
| `/rank classe` | Exibe Top CP da classe (Efêmero) | Todos |
| `/justificar-ausencia`| Justifica falta em boss ou data | Todos |
| `/contestar-presenca` | Envia print de presença não computada | Todos |
| `/bid` | Dá lance de DKP em item em leilão | Todos |
| `/presenca marcar-voz`| Puxa presença da sala de voz e calcula DKP | Staff |
| `/presenca marcar-membro`| Marca presença avulsa para um jogador | Staff |
| `/leilao iniciar` | Inicia leilão de drop em `#leilao-drops` | Staff |
| `/leilao encerrar` | Encerra leilão antecipadamente | Staff |
| `/config-dkp` | Ajusta multiplicadores de CP e Nível | Admin |
| `/reset-mensal-executar`| Força virada mensal imediatamente | Admin |
| `/setup-paineis` | Posta os painéis interativos nos canais | Admin |
