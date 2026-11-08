# Painéis de carreiras

Painéis estáticos de carreiras do Executivo Federal, hoje **Analista em
Tecnologia da Informação (ATI)**, **Analista Técnico de Políticas Sociais
(ATPS)**, **Especialista em Políticas Públicas e Gestão Governamental
(EPPGG)**, **Analista de Comércio Exterior (ACE)** e **Analista de
Infraestrutura (AIE)**. São publicados no GitHub Pages e atualizados todo mês por GitHub
Actions com dados do [Portal da Transparência](https://portaldatransparencia.gov.br/download-de-dados/servidores).

| Página | Endereço |
|---|---|
| Página inicial (escolha da carreira) | `/` |
| Painel de uma carreira | `/painel.html?carreira=ati` (ou `atps`, `eppgg`, `ace`, `aie`) |
| Links curtos, com prévia própria para redes sociais | `/ati/`, `/atps/`, `/eppgg/`, `/ace/`, `/aie/` |

Só são publicados **dados agregados**. Nenhum nome, CPF, matrícula ou
identificador individual sai do script (LGPD).

## Arquitetura

```
Portal da Transparência ──► scripts/gerar_dados.py ──► data/<carreira>/*.json ──► site/ (HTML + JS + ECharts) ──► GitHub Pages
     (ZIP mensal SIAPE)        (pandas, em chunks)        (versionado)
```

- **`data/carreiras.json`** lista as carreiras. Campos:

  | campo | uso |
  |---|---|
  | `sigla`, `plural`, `nome`, `nome_plural` | textos do painel |
  | `padrao_cargo` | regex do cargo no SIAPE (texto sem acentos, maiúsculo) |
  | `marca` | `"ati"` usa a marca da ATI; `"neutra"`, a sigla em texto |
  | `ingresso` | classe e padrão de entrada (`{"classe": "A", "padrao": "I"}`), ou `null` se não confirmado; sem ele o painel omite o destaque "no início da carreira" |
  | `classes` | opcional; rótulo de exibição por código do SIAPE (ex.: `{"S": "Especial"}`) |
  | `faixas` | opcional; limites (R$) do histograma de remuneração, para carreiras em outro patamar salarial |
- **`scripts/gerar_dados.py`** descobre o mês mais recente publicado, baixa o ZIP
  `AAAAMM_Servidores_SIAPE` **uma vez**, lê `AAAAMM_Cadastro.csv` e
  `AAAAMM_Remuneracao.csv` em chunks, separa os servidores de cada carreira, junta
  pela coluna `Id_SERVIDOR_PORTAL` e grava, para cada carreira:
  - `data/<carreira>/AAAAMM.json`: agregados do mês
  - `data/<carreira>/latest.json`: cópia do mês mais recente
  - `data/<carreira>/index.json`: lista de meses com total e mediana (alimenta o histórico)

  Um mês só é baixado se faltar para alguma carreira, e só as carreiras que
  faltam são gravadas. Por isso, incluir uma carreira nova e rodar "ano inteiro"
  preenche o histórico dela sem tocar nas outras.
- **`site/`** tem HTML, CSS e JS puros, sem build. `painel.html` lê a carreira do
  endereço, `data/<carreira>/index.json` e o JSON do mês escolhido. O mapa de
  órgãos usa Leaflet com o mapa do OpenStreetMap e posiciona cada órgão pela
  tabela `data/orgaos_coordenadas.csv`, compartilhada entre as carreiras.
- **`.github/workflows/atis.yml`** roda no dia 15 de cada mês (12h UTC) ou
  manualmente: gera os dados, commita `data/` se mudou, copia para `site/data/`
  e publica no Pages.

### Como os dados do SIAPE são interpretados

Esses pontos foram conferidos no arquivo de ago/2026:

- **URL**: `https://portaldatransparencia.gov.br/download-de-dados/servidores/AAAAMM_Servidores_SIAPE`
  redireciona para um ZIP (~85 MB, ~620 MB descompactado). Um mês ainda não
  publicado responde HTTP 403.
- **Cargo**: no SIAPE o nome vem abreviado. A regex de cada carreira, em
  `data/carreiras.json`, é aplicada ao texto sem acentos e em maiúsculas.
  - **ATI**: `ANALISTA EM TECNOL DA INFORMACAO`. A regex deixa de fora cargos
    parecidos que não são da carreira: `ANALISTA DE TEC DA INFORMACAO` (PCCTAE das
    universidades), `ANALISTA DE TECNOL DA INFORMACAO - 40H` (EBSERH) e
    `ANALISTA - ANALISTA DE TECNOL DA INFORM` (Conab).
  - **ATPS**: `ANALISTA TECN EM POLITICAS SOCIAIS` (1.375 servidores em ago/2026,
    lotação centralizada no MGI, classes A–C e padrões I–VI, como a ATI).
  - **EPPGG**: `ESP POL PUBL GESTAO GOVERNAMENTAL` (1.064 em ago/2026, lotação no
    MGI). As classes ocupadas são B, C e S; pela remuneração, a ordem é
    B → C → S, e S é exibida como "Especial". Não há classe A nos dados, e o
    ingresso não está configurado. A remuneração (R$ 25–37 mil sem função) usa
    faixas próprias no histograma.
  - **ACE**: `ANALISTA DE COMERCIO EXTERIOR` (436 em ago/2026, a maioria no
    MDIC). Classes B, C e S ("Especial"); ingresso não configurado. Usa as
    mesmas faixas da EPPGG.
  - **AIE**: `ANALISTA DE INFRA-ESTRUTURA` (1.033 em ago/2026, espalhados
    pelos ministérios de infraestrutura). Classes A, B, C e S ("Especial");
    ingresso não configurado. Não inclui `ESPECIALISTA EM INFRA-ESTRUTURA
    SENIOR` nem `ANALISTA EM INFRA-ESTRUT DE TRANSPORTES` (DNIT), que são
    outros cargos. Faixas próprias no histograma (R$ 17,5–40 mil).
- **Função comissionada**: não aparece na linha do cargo. Fica numa linha
  separada do mesmo `Id_SERVIDOR_PORTAL`, com `DESCRICAO_CARGO` "Sem informação"
  e `SIGLA_FUNCAO` preenchida (FEX, CCX…). O script conta o servidor como "com
  função" quando existe essa linha.
- **UF**: `UF_EXERCICIO` vem `-1` em boa parte das linhas de cargo. Nesses casos o
  script usa a UF da linha de função ou de exercício descentralizado. Quando
  nenhuma linha tem UF, o servidor entra como "Não informado".
- **Remuneração**: média, mediana, P10, P90 e histograma usam a coluna
  `REMUNERAÇÃO BÁSICA BRUTA (R$)`, só com servidores que têm valor maior que zero
  no mês. As faixas do histograma são fixas para que os meses possam ser
  comparados.

### Mapa de órgãos de exercício

O SIAPE não informa endereço, então a localização vem de uma tabela mantida à
mão, `data/orgaos_coordenadas.csv` (separador `;`):

| coluna | conteúdo |
|---|---|
| `orgao_siape` | nome do órgão **exatamente** como aparece em `ORG_EXERCICIO` |
| `sigla` | sigla exibida no mapa |
| `nome` | nome oficial completo (tooltips) |
| `nome_curto` | nome curto usado nos eixos dos gráficos |
| `local` | prédio ou endereço da sede |
| `lat`, `lon` | coordenadas da sede |
| `precisao` | `edificio`, `quadra` ou `rua` |
| `fonte` | de onde veio o endereço e a coordenada |

- A coordenada é a da **sede** do órgão. O servidor pode trabalhar num anexo ou
  numa unidade regional, e o mapa avisa isso.
- Órgãos no mesmo prédio (ex.: Bloco C da Esplanada) viram uma única bolinha,
  com a lista de órgãos no popup.
- Linhas com `lat`/`lon` vazios marcam órgãos sem lugar físico (ex.: "Estados /
  Municípios / Empresas"). Eles aparecem na nota abaixo do mapa.
- **Órgão novo:** quando surge um órgão que não está na tabela, o script emite
  um aviso (`::warning::`, visível no resumo da execução do Actions). Ele aparece
  como "sem localização" até alguém incluir a linha. Para achar a coordenada,
  busque o prédio em [openstreetmap.org](https://www.openstreetmap.org), clique
  com o botão direito → "Mostrar endereço" e copie latitude e longitude.

### Tendência sem novos concursos

A seção "Tendência" é calculada no navegador, só com `data/index.json`, e se
atualiza sozinha a cada mês processado:

- Um mês com alta de 10 ou mais servidores é tratado como **entrada de turma**. Meses
  de entrada separados por até 2 meses formam uma turma só.
- Nos outros meses, mede-se a **taxa de saída líquida**: perda somada ÷ total do
  mês anterior somado. Há três cenários: últimos 5 anos, toda a série e a pior
  janela de 24 meses.
- A projeção aplica cada taxa ao total mais recente por 15 anos, sem novas
  entradas, e calcula em que ano o total voltaria ao nível de antes das duas
  últimas turmas.
- A tabela "entre um concurso e outro" compara a perda líquida de cada intervalo
  sem entradas com o tamanho da turma anterior.
- A seção fica oculta enquanto a carreira tiver menos de 24 meses processados.
- Limitações: o SIAPE agregado só mostra o saldo, não quem entrou ou saiu; nos
  meses de entrada as saídas ficam escondidas. Saída inclui exoneração,
  aposentadoria e falecimento. A projeção não considera demanda, novas vagas nem
  mudanças na carreira.

## Rodar localmente

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

.venv/bin/python scripts/gerar_dados.py                 # mês mais recente, todas as carreiras
.venv/bin/python scripts/gerar_dados.py --mes 202607    # mês específico (útil para histórico)
.venv/bin/python scripts/gerar_dados.py --ano 2025      # todos os meses publicados do ano
.venv/bin/python scripts/gerar_dados.py --carreira atps # só uma carreira
.venv/bin/python scripts/gerar_dados.py --force         # reprocessa um mês existente
.venv/bin/python scripts/gerar_dados.py --manter-zip    # guarda o ZIP em .cache/

# ver o site
rm -rf site/data && cp -r data site/data
python3 -m http.server -d site 8000   # http://localhost:8000 (painel: /painel.html?carreira=atps)
```

O processamento de um mês leva poucos segundos depois do download e usa cerca de
250 MB de RAM.

## Ativar o GitHub Pages

1. Envie o repositório para o GitHub.
2. Em **Settings → Pages → Build and deployment → Source**, escolha **GitHub Actions**.
3. Em **Actions → Dados das carreiras → Run workflow**, rode o primeiro deploy.

### Rodar o workflow manualmente

Em **Actions → Dados das carreiras → Run workflow** há quatro opções:

- **Mês** e **Ano**: processam um mês específico (ex.: `03` e `2026`). Com o mês
  em "mais recente" e o ano em branco, o workflow busca o último mês publicado,
  como na execução agendada. Mês sem ano, ou ano sem mês, é recusado.
- **Mês = "ano inteiro"** com um ano: processa todos os meses publicados daquele
  ano, um por vez. Meses já existentes são pulados (a menos que `force` esteja
  marcado) e meses ainda não publicados são ignorados. A execução só falha se o
  ano não tiver nenhum mês publicado. Doze meses podem levar perto de uma hora.
- **carreira**: "todas" (padrão), ou só uma. Útil com `force`, para reprocessar
  uma carreira sem mexer na outra.
- **force**: reprocessa o mês mesmo que `data/<carreira>/AAAAMM.json` já exista.

Um mês ainda não publicado pelo portal falha com uma mensagem de erro, sem
alterar `data/`. Pela linha de comando:
`gh workflow run atis.yml -f mes=03 -f ano=2026 -f force=true` ou
`gh workflow run atis.yml -f mes="ano inteiro" -f ano=2025`.

## Incluir outra carreira

1. Ache o nome do cargo no SIAPE (coluna `DESCRICAO_CARGO` do cadastro; vem
   abreviado) e escreva uma regex para ele.
2. Acrescente a carreira em `data/carreiras.json` (sigla, plural, nome, nome no
   plural, regex, `"marca": "neutra"` e, se for o caso, `ingresso`, `classes` e
   `faixas`), em `options` da entrada `carreira` do workflow e, se quiser link
   curto, copie `site/atps/` para `site/<carreira>/` trocando a sigla.
3. Rode o workflow com "ano inteiro" para cada ano a partir de 2013. Os meses só
   são baixados uma vez, e as carreiras que já têm dados não mudam.
4. Inclua em `data/orgaos_coordenadas.csv` os órgãos que o script apontar nos
   avisos.

## Observações

- **Inatividade**: em repositórios públicos, o GitHub desativa workflows agendados
  depois de 60 dias sem atividade no repositório. Os commits mensais de `data/`
  costumam bastar para manter o agendamento ativo. Se o portal ficar meses sem
  publicar, reative o workflow em **Actions** ou rode-o manualmente.
- O portal publica cada mês com algumas semanas de atraso. O script testa o mês
  atual e volta até 3 meses. Se o mês encontrado já estiver em `data/`, ele não é
  reprocessado.
- A página de download do portal usa proteção AWS WAF. Hoje o download direto
  funciona, mas se o portal passar a bloquear IPs de runners, o job vai falhar no
  download.
- `.gitignore` impede o commit de ZIPs e CSVs brutos.
