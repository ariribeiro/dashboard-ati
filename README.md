<div align="center">

<a href="https://ariribeiro.github.io/dashboard-carreiras/"><img src="site/og-carreiras.png" alt="Painéis de carreiras do Executivo Federal" width="720"></a>

# Painéis de carreiras

**Quantos são, onde trabalham, como está a carreira e quanto recebem.**<br>
Painéis estáticos de carreiras do Executivo Federal, atualizados todo mês com dados do
[Portal da Transparência](https://portaldatransparencia.gov.br/download-de-dados/servidores).

[![Dados das carreiras](https://github.com/ariribeiro/dashboard-carreiras/actions/workflows/atis.yml/badge.svg)](https://github.com/ariribeiro/dashboard-carreiras/actions/workflows/atis.yml)
[![GitHub Pages](https://img.shields.io/badge/site-GitHub%20Pages-17393B)](https://ariribeiro.github.io/dashboard-carreiras/)
[![Dados agregados](https://img.shields.io/badge/LGPD-só%20dados%20agregados-0A8F45)](#privacidade)

**[Abrir os painéis →](https://ariribeiro.github.io/dashboard-carreiras/)**

</div>

---

## Carreiras

| | Carreira | Painel | Cargo no SIAPE |
|---|---|---|---|
| ![](https://img.shields.io/badge/-ATI-4C74EF) | Analista em Tecnologia da Informação | [`/ati/`](https://ariribeiro.github.io/dashboard-carreiras/ati/) | `ANALISTA EM TECNOL DA INFORMACAO` |
| ![](https://img.shields.io/badge/-ATPS-DC3525) | Analista Técnico de Políticas Sociais | [`/atps/`](https://ariribeiro.github.io/dashboard-carreiras/atps/) | `ANALISTA TECN EM POLITICAS SOCIAIS` |
| ![](https://img.shields.io/badge/-EPPGG-229136) | Especialista em Políticas Públicas e Gestão Governamental | [`/eppgg/`](https://ariribeiro.github.io/dashboard-carreiras/eppgg/) | `ESP POL PUBL GESTAO GOVERNAMENTAL` |
| ![](https://img.shields.io/badge/-ACE-F4DA27) | Analista de Comércio Exterior | [`/ace/`](https://ariribeiro.github.io/dashboard-carreiras/ace/) | `ANALISTA DE COMERCIO EXTERIOR` |
| ![](https://img.shields.io/badge/-AIE-EFA22A) | Analista de Infraestrutura | [`/aie/`](https://ariribeiro.github.io/dashboard-carreiras/aie/) | `ANALISTA DE INFRA-ESTRUTURA` |

Os links curtos têm prévia própria para redes sociais e levam a
`/painel.html?carreira=<sigla>`. A página inicial (`/`) lista todas as carreiras.

### O que cada painel mostra

- 📊 **Visão geral**: total de servidores, remuneração mediana, destaques do mês e histórico desde 2013.
- 📉 **Tendência**: ritmo de saídas entre concursos e projeção sem novas turmas.
- 🧾 **Impacto orçamentário**: folha anual estimada e projeção para os próximos 10 anos.
  A página inicial compara as carreiras.
- 🗺️ **Onde trabalham**: mapa com a sede de cada órgão de exercício, ranking de órgãos e UFs.
- 🪜 **Carreira**: distribuição por classe e padrão, e funções comissionadas.
- 💰 **Remuneração**: histograma, mediana e faixa P10–P90 da remuneração básica bruta.

<a id="privacidade"></a>
> [!NOTE]
> Só são publicados **dados agregados**. Nenhum nome, CPF, matrícula ou
> identificador individual sai do script, e os arquivos brutos do portal nunca
> são commitados (LGPD).
>
> As visitas são medidas com o [GoatCounter](https://www.goatcounter.com), sem
> cookies e sem dados pessoais. Painel de acessos: <https://ariribeiro.goatcounter.com>.

---

## Início rápido

**Ver o site** com os dados que já estão no repositório:

```bash
rm -rf site/data && cp -R data site/data
python3 -m http.server -d site 8000
```

Abra <http://localhost:8000>. A página precisa de um servidor, porque abrir o
`index.html` direto faz o navegador bloquear a leitura dos JSON. Refaça a cópia
de `data/` sempre que os dados mudarem.

**Gerar dados** (opcional, o workflow faz isso todo mês):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

.venv/bin/python scripts/gerar_dados.py                    # mês mais recente, todas as carreiras
.venv/bin/python scripts/gerar_dados.py --mes 202607       # um mês específico
.venv/bin/python scripts/gerar_dados.py --ano 2025         # todos os meses publicados do ano
.venv/bin/python scripts/gerar_dados.py --carreira atps    # só uma carreira (pode repetir)
.venv/bin/python scripts/gerar_dados.py --force            # reprocessa meses existentes
.venv/bin/python scripts/gerar_dados.py --manter-zip       # guarda o ZIP em .cache/
```

Cada mês baixa um ZIP de ~85 MB. Depois do download, o processamento leva
poucos segundos e usa cerca de 250 MB de RAM.

---

## Como funciona

```mermaid
flowchart LR
    A[Portal da Transparência<br><small>ZIP mensal SIAPE</small>] --> B[scripts/gerar_dados.py<br><small>pandas, em chunks</small>]
    B --> C[data/&lt;carreira&gt;/*.json<br><small>versionado</small>]
    C --> D[site/<br><small>HTML + JS + ECharts + Leaflet</small>]
    D --> E[GitHub Pages]
```

| Parte | O que faz |
|---|---|
| [`scripts/gerar_dados.py`](scripts/gerar_dados.py) | Descobre os meses publicados, baixa o ZIP `AAAAMM_Servidores_SIAPE` **uma vez**, lê cadastro e remuneração em chunks, separa cada carreira e grava os agregados. Um mês só é baixado se faltar para alguma carreira. |
| [`data/carreiras.json`](data/carreiras.json) | Configuração das carreiras (lida pelo script e pelo site). |
| `data/<carreira>/` | `AAAAMM.json` (agregados do mês), `latest.json` (mês mais recente) e `index.json` (série com total e mediana). |
| [`data/orgaos_coordenadas.csv`](data/orgaos_coordenadas.csv) | Sede de cada órgão de exercício, para o mapa. |
| [`site/`](site/) | HTML, CSS e JS puros, sem build. `painel.html` lê a carreira do endereço. |
| [`.github/workflows/atis.yml`](.github/workflows/atis.yml) | Roda no dia 15 de cada mês (12h UTC) ou manualmente: gera os dados, commita `data/` e publica no Pages. |

<details>
<summary><strong>Campos de <code>data/carreiras.json</code></strong></summary>

| Campo | Uso |
|---|---|
| `sigla`, `plural`, `nome`, `nome_plural` | Textos do painel |
| `padrao_cargo` | Regex do cargo no SIAPE (texto sem acentos, maiúsculo) |
| `marca` | `"ati"` usa a marca oficial da ATI; `"neutra"`, a sigla em texto |
| `ingresso` | Classe e padrão de entrada (`{"classe": "A", "padrao": "I"}`), ou `null` se não confirmado. Sem ele, o painel omite o destaque "no início da carreira" |
| `classes` | Opcional. Rótulo de exibição por código do SIAPE (ex.: `{"S": "Especial"}`) |
| `faixas` | Opcional. Limites (R$) do histograma, para carreiras em outro patamar salarial |
| `inicio` | Opcional. Primeiro mês (`AAAA-MM`) em que a carreira aparece no SIAPE; meses anteriores são ignorados em vez de falhar como "vazio" |
| `cores` | `destaque` (cor da carreira: faixa, brilho do cabeçalho, cartão da página inicial), `clara` (acento sobre fundo escuro e no modo escuro) e `forte` (acento sobre fundo claro, contraste ≥ 4,5:1). A ATI mantém a identidade oficial no painel |

</details>

<details>
<summary><strong>Como os dados do SIAPE são interpretados</strong></summary>

Conferido no arquivo de ago/2026:

- **Download**: `https://portaldatransparencia.gov.br/download-de-dados/servidores/AAAAMM_Servidores_SIAPE`
  redireciona para um ZIP (~85 MB, ~620 MB descompactado). A lista de meses
  disponíveis vem da própria página do portal.
- **Cargo**: o nome vem abreviado. A regex de cada carreira é aplicada ao texto
  sem acentos e em maiúsculas.
  - **ATI**: deixa de fora cargos parecidos que não são da carreira, como
    `ANALISTA DE TEC DA INFORMACAO` (PCCTAE), `ANALISTA DE TECNOL DA INFORMACAO - 40H`
    (EBSERH) e `ANALISTA - ANALISTA DE TECNOL DA INFORM` (Conab).
  - **ATPS**: aparece no SIAPE a partir de jul/2013, com a primeira turma (toda em A-I); por isso `inicio` é `2013-07`. A lotação só ficou centralizada no MGI em 2024. Classes A–C e padrões I–VI, como a ATI.
  - **EPPGG**: classes B, C e S. Pela remuneração, a ordem é B → C → S, e S é
    exibida como "Especial". Não há classe A nos dados e o ingresso não está
    configurado. Faixas próprias no histograma.
  - **ACE**: a maioria no MDIC. Classes B, C e S ("Especial"); ingresso não
    configurado. Usa as mesmas faixas da EPPGG.
  - **AIE**: espalhados pelos ministérios de infraestrutura. Classes A, B, C e S
    ("Especial"); ingresso não configurado. Não inclui
    `ESPECIALISTA EM INFRA-ESTRUTURA SENIOR` nem
    `ANALISTA EM INFRA-ESTRUT DE TRANSPORTES` (DNIT), que são outros cargos.
- **Função comissionada**: fica numa linha separada do mesmo
  `Id_SERVIDOR_PORTAL`, com `DESCRICAO_CARGO` "Sem informação" e `SIGLA_FUNCAO`
  preenchida (FEX, CCX…). O servidor conta como "com função" quando essa linha existe.
- **UF**: `UF_EXERCICIO` vem `-1` em boa parte das linhas de cargo. Nesses casos
  vale a UF da linha de função ou de exercício descentralizado. Sem nenhuma, o
  servidor entra como "Não informado".
- **Remuneração**: média, mediana, P10, P90 e histograma usam
  `REMUNERAÇÃO BÁSICA BRUTA (R$)`, só com valores maiores que zero no mês. As
  faixas do histograma são fixas por carreira, para que os meses possam ser comparados.

</details>

<details>
<summary><strong>Mapa de órgãos de exercício</strong></summary>

O SIAPE não informa endereço, então a localização vem de uma tabela mantida à
mão, `data/orgaos_coordenadas.csv` (separador `;`, nunca use `;` dentro de um campo):

| Coluna | Conteúdo |
|---|---|
| `orgao_siape` | Nome do órgão **exatamente** como aparece em `ORG_EXERCICIO` |
| `sigla` | Sigla exibida no mapa |
| `nome` | Nome oficial completo (tooltips) |
| `nome_curto` | Nome curto usado nos eixos dos gráficos |
| `local` | Prédio ou endereço da sede |
| `lat`, `lon` | Coordenadas da sede |
| `precisao` | `edificio`, `quadra` ou `rua` |
| `fonte` | De onde vieram o endereço e a coordenada |

- A coordenada é a da **sede**. O servidor pode trabalhar num anexo ou numa
  unidade regional, e o mapa avisa isso.
- Órgãos no mesmo prédio (ex.: Bloco C da Esplanada) viram uma bolinha só.
- Linhas com `lat`/`lon` vazios marcam órgãos sem lugar definido (ex.: "Estados /
  Municípios / Empresas", ou "Tribunal de Justiça" sem estado). Eles aparecem
  na nota abaixo do mapa.
- **Órgão novo**: o script emite um aviso (`::warning::`, visível no resumo da
  execução do Actions) e o órgão aparece como "sem localização" até alguém
  incluir a linha. Para achar a coordenada, busque o prédio em
  [openstreetmap.org](https://www.openstreetmap.org), clique com o botão direito
  → "Mostrar endereço" e copie latitude e longitude.

</details>

<details>
<summary><strong>Tendência sem novos concursos</strong></summary>

Calculada no navegador, só com `data/<carreira>/index.json`:

- Um mês com alta de 10 ou mais servidores é uma **entrada de turma**. Entradas
  separadas por até 2 meses formam uma turma só.
- Nos outros meses mede-se a **taxa de saída líquida** (perda somada ÷ total do
  mês anterior somado), em três cenários: últimos 5 anos, toda a série e pior
  janela de 24 meses.
- A projeção aplica cada taxa ao total mais recente por 15 anos, sem novas
  entradas, e estima quando o total voltaria ao nível de antes das duas últimas turmas.
- A seção fica oculta enquanto a carreira tiver menos de 24 meses processados.

**Limitações:** o dado agregado só mostra o saldo, não quem entrou ou saiu, e
nos meses de entrada as saídas ficam escondidas. Saída inclui exoneração,
aposentadoria e falecimento. A projeção não considera demanda, novas vagas nem
mudanças na carreira.

</details>

<details>
<summary><strong>Impacto orçamentário</strong></summary>

Calculado no navegador por `site/orcamento.js`, usado pelo painel e pela página
inicial, a partir de `n` e `media` do `index.json` de cada carreira:

- **Folha mensal** = servidores com remuneração no mês × remuneração básica bruta
  média. **Folha anual** = 12 meses + 13º (igual a dezembro). Meses sem arquivo
  são interpolados.
- **Efetivo**: "sem novas entradas" usa a taxa de saída líquida dos últimos 5
  anos (a mesma da Tendência); "repondo as saídas" mantém o efetivo atual.
- **Remuneração média**: com reajuste, cresce no ritmo anual dos últimos 10 anos
  (média dos últimos 12 meses contra a de 12 meses dez anos antes; com menos
  histórico, usa o que houver, no mínimo 3 anos). Esse ritmo junta reajustes,
  progressões e o efeito das turmas novas. O painel também mostra a estimativa em
  valores de hoje, sem reajuste.

**Limitações:** é só a remuneração básica bruta. Não inclui contribuição patronal,
terço de férias, auxílios, funções pagas à parte, nem aposentados e pensionistas.
Reajustes futuros dependem de negociação e de lei.

</details>

---

## Publicação e atualização

### Ativar o GitHub Pages

1. Envie o repositório para o GitHub.
2. Em **Settings → Pages → Build and deployment → Source**, escolha **GitHub Actions**.
3. Em **Actions → Dados das carreiras → Run workflow**, rode o primeiro deploy.

### Homologação (Cloudflare Pages)

A produção é o GitHub Pages. Para testar uma versão antes de levá-la ao `main`,
o repositório também está ligado a um projeto no Cloudflare Pages
(`dashboard-carreiras`), que só lê o código:

- Cada push em um branch que não seja o `main` gera um link de pré-visualização
  próprio, no formato `<branch>.dashboard-carreiras.pages.dev`. O link aparece em
  **Workers & Pages → dashboard-carreiras → Deployments**.
- Configuração do projeto: framework `None`, build `cp -r data site/data`, saída `site`.
- O GoatCounter só conta acessos a `ariribeiro.github.io`; visitas à homologação
  não entram nas estatísticas.

### Rodar o workflow manualmente

Em **Actions → Dados das carreiras → Run workflow**:

| Opção | Efeito |
|---|---|
| **mês** + **ano** | Processa um mês específico (ex.: `03` e `2026`). Com "mais recente" e ano em branco, busca o último mês publicado. |
| **mês = "ano inteiro"** + **ano** | Processa todos os meses publicados do ano, pulando os que já existem. Doze meses podem levar perto de uma hora. |
| **carreira** | "todas" (padrão) ou só uma. |
| **force** | Reprocessa mesmo que `data/<carreira>/AAAAMM.json` já exista. |

Pela linha de comando:

```bash
gh workflow run atis.yml -f mes=03 -f ano=2026 -f force=true
gh workflow run atis.yml -f mes="ano inteiro" -f ano=2025 -f carreira=aie
```

### Incluir outra carreira

1. Ache o nome do cargo na coluna `DESCRICAO_CARGO` do cadastro (vem abreviado)
   e escreva uma regex para ele.
2. Acrescente a carreira em `data/carreiras.json` e em `options` da entrada
   `carreira` do workflow. Para link curto, copie `site/atps/` para
   `site/<carreira>/` trocando a sigla.
3. Rode o workflow com "ano inteiro" para cada ano a partir de 2013. As
   carreiras que já têm dados não mudam.
4. Inclua em `data/orgaos_coordenadas.csv` os órgãos que o script apontar nos avisos.

---

## Observações

- **Inatividade**: o GitHub desativa workflows agendados depois de 60 dias sem
  atividade no repositório. Os commits mensais de `data/` costumam bastar; se o
  portal ficar meses sem publicar, reative o workflow em **Actions**.
- **Atraso do portal**: cada mês é publicado com algumas semanas de atraso. Um mês
  já presente em `data/` não é reprocessado.
- **Bloqueio**: a página de download usa AWS WAF. Hoje o download direto funciona,
  mas se o portal bloquear IPs de runners, o job vai falhar no download.
- **Arquivos brutos**: o `.gitignore` impede o commit de ZIPs e CSVs.
- **Estatísticas de acesso**: `index.html` e `painel.html` carregam o script do
  GoatCounter (cada carreira aparece como `painel.html?carreira=<sigla>`). Os links
  curtos redirecionam na hora, então contam a visita eles mesmos, com a origem
  original, e o painel não conta de novo quem chega por eles. Acessos em
  `localhost` não são contados.

<div align="center">
<sub>Desenvolvido por <strong>Ari Ribeiro</strong>, Analista em Tecnologia da Informação ·
<a href="mailto:contato@ariribeiro.dev">contato@ariribeiro.dev</a> ·
<a href="https://www.linkedin.com/in/arivaldo-ribeiro-26472823/">LinkedIn</a></sub>
</div>
