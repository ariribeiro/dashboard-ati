# Painel ATI

Painel estático da carreira de **Analista em Tecnologia da Informação (ATI)** do
Executivo Federal, publicado no GitHub Pages e atualizado todo mês por GitHub
Actions com dados do [Portal da Transparência](https://portaldatransparencia.gov.br/download-de-dados/servidores).

Só são publicados **dados agregados**. Nenhum nome, CPF, matrícula ou
identificador individual sai do script (LGPD).

## Arquitetura

```
Portal da Transparência ──► scripts/gerar_atis.py ──► data/*.json ──► site/ (HTML + JS + ECharts) ──► GitHub Pages
     (ZIP mensal SIAPE)        (pandas, em chunks)      (versionado)
```

- **`scripts/gerar_atis.py`** descobre o mês mais recente publicado, baixa o ZIP
  `AAAAMM_Servidores_SIAPE`, lê `AAAAMM_Cadastro.csv` e `AAAAMM_Remuneracao.csv`
  em chunks, filtra os ATIs, junta pela coluna `Id_SERVIDOR_PORTAL` e grava:
  - `data/AAAAMM.json`: agregados do mês
  - `data/latest.json`: cópia do mês mais recente
  - `data/index.json`: lista de meses com total e mediana (alimenta o histórico)
- **`site/`** tem HTML, CSS e JS puros, sem build. Lê `data/index.json` e o JSON do
  mês escolhido. O mapa de órgãos usa Leaflet com o mapa do OpenStreetMap e
  posiciona cada órgão pela tabela `data/orgaos_coordenadas.csv`.
- **`.github/workflows/atis.yml`** roda no dia 15 de cada mês (12h UTC) ou
  manualmente: gera os dados, commita `data/` se mudou, copia para `site/data/`
  e publica no Pages.

### Como os dados do SIAPE são interpretados

Esses pontos foram conferidos no arquivo de ago/2026:

- **URL**: `https://portaldatransparencia.gov.br/download-de-dados/servidores/AAAAMM_Servidores_SIAPE`
  redireciona para um ZIP (~85 MB, ~620 MB descompactado). Um mês ainda não
  publicado responde HTTP 403.
- **Cargo**: no SIAPE o nome vem abreviado como `ANALISTA EM TECNOL DA INFORMACAO`.
  O filtro padrão é a regex `^ANALISTA EM TECNOL(OGIA)? DA INFORMACAO$`, aplicada
  ao texto sem acentos e em maiúsculas. Ela deixa de fora outros cargos parecidos
  que não são da carreira ATI: `ANALISTA DE TEC DA INFORMACAO` (PCCTAE das
  universidades), `ANALISTA DE TECNOL DA INFORMACAO - 40H` (EBSERH) e
  `ANALISTA - ANALISTA DE TECNOL DA INFORM` (Conab). Para mudar o filtro, use
  `--padrao-cargo`.
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

## Rodar localmente

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

.venv/bin/python scripts/gerar_atis.py              # mês mais recente
.venv/bin/python scripts/gerar_atis.py --mes 202607 # mês específico (útil para histórico)
.venv/bin/python scripts/gerar_atis.py --force      # reprocessa um mês existente
.venv/bin/python scripts/gerar_atis.py --manter-zip # guarda o ZIP em .cache/

# ver o site
rm -rf site/data && cp -r data site/data
python3 -m http.server -d site 8000   # http://localhost:8000
```

O processamento de um mês leva poucos segundos depois do download e usa cerca de
250 MB de RAM.

## Ativar o GitHub Pages

1. Envie o repositório para o GitHub.
2. Em **Settings → Pages → Build and deployment → Source**, escolha **GitHub Actions**.
3. Em **Actions → Dados ATI → Run workflow**, rode o primeiro deploy.

### Rodar o workflow manualmente

Em **Actions → Dados ATI → Run workflow** há três opções:

- **Mês** e **Ano**: processam um mês específico (ex.: `03` e `2026`). Com o mês
  em "mais recente" e o ano em branco, o workflow busca o último mês publicado,
  como na execução agendada. Mês sem ano, ou ano sem mês, é recusado.
- **force**: reprocessa o mês mesmo que `data/AAAAMM.json` já exista.

Um mês ainda não publicado pelo portal falha com uma mensagem de erro, sem
alterar `data/`. Pela linha de comando:
`gh workflow run atis.yml -f mes=03 -f ano=2026 -f force=true`.

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
