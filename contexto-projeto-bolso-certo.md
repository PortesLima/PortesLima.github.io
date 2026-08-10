# Projeto: Bolso Certo — Dashboard de controle de gastos

## O que é
App único em HTML puro (sem build, sem framework) para controle financeiro pessoal:
lançamento de salário/receitas e gastos, categorização, orçamentos, metas de economia,
gastos fixos recorrentes, parcelamentos, status de pagamento, gráficos e alertas.
Tudo em um arquivo `index.html`.

Arquivo atual: `dashboard-financeiro.html` (deve ser renomeado para `index.html` ao publicar).

## Stack
- HTML/CSS/JS puro, sem dependências de build.
- Chart.js via CDN para os gráficos (categoria, últimos 6 meses, saldo acumulado, fixo x variável).
- jsPDF via CDN para gerar relatório mensal em PDF.
- Persistência local: `window.storage` (API key-value dos Artifacts do Claude) — funciona
  sozinho, sem backend.
- Sincronização entre dispositivos: Google Drive API (arquivo JSON `bolso-certo-dados.json`
  salvo no Drive do usuário), usando Google Identity Services (GIS) no navegador, sem
  servidor próprio.

## Funcionalidades já implementadas

### Lançamentos
- Receita ou gasto, com categoria, conta, data de vencimento, status (pago/pendente/vencido
  — vencido é calculado automaticamente quando a data já passou e não foi pago).
- Parcelamento: divide o valor total em N parcelas lançadas automaticamente nos meses seguintes.
- Anexo de comprovante (foto, salva como base64 dentro do próprio lançamento).
- Edição, exclusão (com confirmação) e botão de desfazer a última exclusão.
- Busca por texto, filtro por categoria e por status.
- Data do formulário acompanha o mês selecionado no topo (permite lançar em meses
  passados/futuros sem ficar voltando pra "hoje").
- Atalho Enter para salvar sem clicar no botão.

### Contas e orçamento
- Múltiplas contas (Conta corrente, Cartão de crédito, Dinheiro) com filtro.
- Orçamento por categoria com limite manual, barra de progresso e alerta em 80%/100%.
- Orçamento total do mês (soma dos limites) vs gasto real.
- Card fixos x variáveis com barra + mini gráfico de pizza.

### Metas e recorrência
- Metas de economia (nome, valor alvo, prazo, valor atual, botão de adicionar valor).
- Lançamentos fixos/recorrentes: cadastra um template e lança com 1 clique todo mês.
- Alerta automático quando um fixo do mês ainda não foi lançado.

### Análise
- KPIs: receitas, gastos, saldo, taxa de poupança — com comparação % vs mês anterior.
- Ritmo de gastos: média diária e projeção de quantos dias o saldo aguenta no ritmo atual.
- Comparação com o mesmo mês do ano anterior.
- Ranking dos 5 maiores gastos individuais do mês.
- Projeção de fechamento do mês com base no ritmo atual de gastos.
- Gráficos: pizza por categoria, barras dos últimos 6 meses, linha de saldo acumulado —
  todos com estado vazio tratado (mensagem em vez de sumir quando não há dados).

### Alertas
- Saldo negativo, categoria de orçamento estourada/perto de estourar, taxa de poupança baixa,
  contas vencidas, contas a vencer nos próximos 5 dias, fixo do mês não lançado, projeção de
  estouro de orçamento.
- Aba de dicas geradas dinamicamente com base nos dados do usuário.

### Interface
- 4 abas principais com navegação e transição suave (fade): Visão geral, Lançamentos,
  Orçamento, Metas e fixos.
- Modo escuro/claro com toggle, tema salvo e sincronizado.
- Logo própria (SVG inline) no cabeçalho e na tela de PIN; favicon próprio.
- Modal de onboarding na primeira visita, explicando as abas (mostra uma vez, controlado
  por flag salva).
- Responsivo: layout compacto para telas até 480px (fontes menores, tabela com scroll
  horizontal, KPIs em 2 colunas).

### Segurança e privacidade
- PIN opcional de 4-6 dígitos, tela de bloqueio ao abrir o app, com opção de remover.
- Modo somente-leitura via URL (`?readonly=1`): esconde todos os formulários e botões de
  edição/exclusão — usado para gerar um "link de leitura" compartilhável (botão no topo,
  copia a URL automaticamente). Limitação: quem abrir precisa logar no Drive com a mesma
  conta Google para ver os dados sincronizados.

### Dados
- Backup completo em JSON (todos os lançamentos, orçamentos, metas, fixos) — botão de
  download e de importação (substitui os dados locais, com confirmação).
- Exportação CSV e relatório PDF mensal (resumo + lista de lançamentos).
- Multi-moeda: alterna a formatação entre BRL, USD, EUR, GBP (só muda símbolo/formatação,
  não faz conversão cambial). Sincronizado com o Drive.
- Notificações do navegador (Web Notification API): avisa sobre contas vencidas/vencendo
  hoje quando o app é aberto. Não é push real (exigiria backend/service worker) — só
  funciona com o app aberto no navegador.

## Integração Google Drive (sincronização entre celular/web)
Já configurado no Google Cloud Console:
- Projeto: **bolso-certo** (ID: `bolso-certo-505116`)
- Google Drive API: ativada
- Tela de consentimento OAuth: configurada, tipo "Externo", em modo de teste
- Escopo usado: `https://www.googleapis.com/auth/drive.file` (acesso só aos arquivos
  criados pelo próprio app, não ao Drive inteiro)
- Usuário de teste adicionado: o e-mail Google do usuário (obrigatório em modo de teste,
  senão o login falha)
- Client ID OAuth criado (tipo "Aplicativo da Web"):
  `413352313626-5t1nnc98oo3k700tgogpnqg4vu77mhne.apps.googleusercontent.com`
- Origens JavaScript autorizadas cadastradas no Google Cloud:
  - `https://PortesLima.github.io`
  - `http://localhost:8080`

No código (`dashboard-financeiro.html`):
- Botão "Conectar Google Drive" no topo, dispara `tokenClient.requestAccessToken()`
  (Google Identity Services, carregado via `https://accounts.google.com/gsi/client`).
- Ao conectar: busca (ou cria) o arquivo `bolso-certo-dados.json` no Drive do usuário via
  API REST (`googleapis.com/drive/v3/files`), baixa o conteúdo e substitui o estado local
  se já existir.
- A cada alteração (novo lançamento, edição, orçamento, meta, tema, moeda, etc.) o estado
  inteiro é reenviado ao Drive com debounce de ~1.2s (`driveAgendarSync` → `driveSalvarAgora`).
- Detecção de token expirado (erro 401): o botão muda para "🔄 Sessão expirada, clique
  para reconectar" — ainda não há renovação automática, exige clique manual.
- Indicador de "última sync: HH:MM" ao lado do botão.
- Sem esse login, o app funciona 100% offline via `window.storage` (não sincroniza entre
  dispositivos, mas não quebra nada).

## Publicação (em andamento)
Objetivo: publicar em `https://PortesLima.github.io` via GitHub Pages, pois essa é a
origem autorizada cadastrada no Google Cloud para o login funcionar.

Passos combinados com o usuário (ele nunca usou GitHub antes, está usando VSCode):
1. Criar repositório no GitHub chamado exatamente `PortesLima.github.io` (público, sem README).
2. Colocar o arquivo do dashboard numa pasta local, renomeado para `index.html`.
3. Abrir a pasta no VSCode, inicializar git (`git init`), commit, e push para
   `https://github.com/PortesLima/PortesLima.github.io.git` na branch `main`.
4. Aguardar 1-2 min e acessar `https://portesLima.github.io` para confirmar publicação.
5. A partir daí, testar o botão "Conectar Google Drive" no site publicado.

**Status no momento deste resumo**: usuário ainda vai subir o projeto pro GitHub agora —
o código está pronto e validado localmente (sintaxe JS e balanceamento de HTML conferidos),
mas ainda não testado rodando de fato publicado/em produção.

## Possíveis próximos passos
- Confirmar se o GitHub Pages está no ar e se o login Google funciona a partir da URL publicada.
- Testar no celular de verdade (responsividade, sincronização, notificações).
- Se o usuário quiser sair do modo de teste do OAuth (para não precisar recadastrar
  usuários de teste), seria necessário publicar o app OAuth no Google Cloud (processo de
  verificação do Google — geralmente não necessário para uso pessoal/individual).
- Renovação automática do token do Google (hoje expira em ~1h e exige reconexão manual).
- Notificações reais (push) exigiriam um service worker + backend — hoje é só
  Notification API local, com o app aberto.
- Conversão de câmbio real para o multi-moeda (hoje é só troca de formatação/símbolo).
