"use strict";

// Quadro "Economicidade" do painel da ATI. Lê data/ati/economicidade.json (scripts/economicidade_ati.py).
// Sem o arquivo, a seção e o link da barra ficam ocultos. Usa os utilitários de gráfico do app.js.

const Economicidade = (() => {
  let dados = null;
  let modo = "amostra"; // "amostra" (órgãos analisados) ou "carreira" (extrapolado ao efetivo nacional)

  const fmtPp = (v, casas = 2) => `${v >= 0 ? "+" : "−"}${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(Math.abs(v))}`;
  const fmtRs = (v) => {
    const s = v < 0 ? "−" : "";
    const a = Math.abs(v);
    const f = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return a >= 1e9 ? `${s}R$ ${f.format(a / 1e9)} bi` : `${s}R$ ${f.format(a / 1e6)} mi`;
  };
  const fmtN1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

  const VEREDITOS = {
    confirmada: ["Hipótese sustentada", "Onde há mais ATI para o volume de contratos de TIC, a perda é menor, e o intervalo de confiança não inclui zero."],
    inconclusiva: ["Ainda inconclusivo", "O efeito estimado tem intervalo de confiança que inclui zero: os dados não permitem afirmar nem negar a hipótese."],
    refutada: ["Hipótese não sustentada", "Onde há mais ATI para o volume de contratos de TIC, a perda estimada é maior, e o intervalo de confiança não inclui zero."],
    sem_dados: ["Sem dados suficientes", "A amostra não permitiu estimar o efeito."],
  };

  // Média do efetivo nacional em cada ano, a partir do index.json da carreira.
  function efetivoNacional(ano) {
    const v = indice.meses.filter((m) => m.mes.startsWith(String(ano))).map((m) => m.total);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  }

  function linhaEvidencia(e) {
    const tr = document.createElement("tr");
    const [lo, hi] = e.ic95 ?? [null, null];
    // Todos os resultados são frações ou índices de 0 a 1: ×100 dá pontos percentuais (ou pontos do índice).
    let leitura = "–";
    if (lo != null) leitura = hi < 0 ? "mais ATI, menos perda" : lo > 0 ? "mais ATI, mais perda" : "indistinguível de zero";
    tr.innerHTML = `<td>${e.nome}<small>${e.unidade}</small></td>` +
      `<td class="num">${e.beta == null ? "–" : fmtPp(e.beta * 100)}</td>` +
      `<td class="num">${lo == null ? "–" : `${fmtPp(lo * 100)} a ${fmtPp(hi * 100)}`}</td>` +
      `<td>${leitura}</td>` +
      `<td class="num">${e.n ?? "–"}<small>${e.orgaos ?? "–"} órgãos</small></td>`;
    return tr;
  }

  function graficoEconomia(el) {
    const hist = dados.economia_historica;
    const cens = dados.projecao.cenarios ?? [];
    if (!hist.length) return false;
    const carreira = modo === "carreira";
    const ult = hist.at(-1);
    const fator = (h) => (carreira ? efetivoNacional(h.ano) / h.atis : 1);
    const anosHist = hist.map((h) => h.ano);
    const anosProj = cens[0]?.anos ?? [];
    const anos = [...anosHist, ...anosProj.filter((a) => a > anosHist.at(-1))];
    const nH = anosHist.length;
    const iProj = (c, a) => c.anos.indexOf(a);
    const pontoProj = (c, campo, a) => {
      const i = iProj(c, a);
      if (i < 0) return null;
      return carreira ? c[`extrapolada_${campo}`][i] : c[campo][i];
    };
    const serieHist = (campo) => anos.map((a, i) => (i < nH ? hist[i][campo] * fator(hist[i]) : null));
    const cores = [cor("--cenario-2"), cor("--cenario-1")];

    const series = [
      { name: "Economia estimada (histórico)", type: "bar", data: serieHist("central"), barMaxWidth: 22,
        itemStyle: { color: cor("--real"), borderRadius: [3, 3, 0, 0] } },
    ];
    cens.forEach((c, j) => {
      const central = anos.map((a, i) => (i < nH - 1 ? null : i === nH - 1 ? hist[i].central * fator(hist[i]) : pontoProj(c, "central", a)));
      const baixo = anos.map((a, i) => (i < nH ? null : pontoProj(c, "baixo", a)));
      const alto = anos.map((a, i) => (i < nH ? null : pontoProj(c, "alto", a)));
      series.push({ name: c.nome, type: "line", data: central, symbol: "circle", symbolSize: 5,
        lineStyle: { width: 2, type: "dashed", color: cores[j] }, itemStyle: { color: cores[j] } });
      // Faixa do intervalo de confiança: base transparente + diferença empilhada.
      series.push({ name: `${c.nome} (IC 95%) base`, type: "line", stack: `ic${j}`, data: baixo, symbol: "none",
        lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true });
      series.push({ name: `${c.nome} (IC 95%)`, type: "line", stack: `ic${j}`, symbol: "none", lineStyle: { opacity: 0 },
        data: alto.map((v, i) => (v == null || baixo[i] == null ? null : v - baixo[i])),
        areaStyle: { color: cores[j], opacity: 0.14 }, silent: true });
    });
    grafico(el, {
      tooltip: { ...temaBase().tooltip, trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (ps) => `${ps[0].name}${ps[0].dataIndex >= nH ? " (projeção)" : ""}<br>` + ps
          .filter((p) => p.value != null && !/base$|IC 95%\)$/.test(p.seriesName))
          .map((p) => `${p.marker}${p.seriesName}: <b>${fmtRs(p.value)}</b>`).join("<br>") },
      legend: { bottom: 0, icon: "roundRect", itemWidth: 14, itemHeight: 3, textStyle: { color: cor("--texto-2"), fontSize: 12 },
        data: ["Economia estimada (histórico)", ...cens.map((c) => c.nome)] },
      grid: { ...temaBase().grid, right: 16, top: 24, bottom: estreito() ? 70 : 44 },
      xAxis: eixoCategoria(anos.map(String), { axisLabel: { color: cor("--texto-2"), interval: estreito() ? 3 : 1 } }),
      yAxis: eixoValor({ axisLabel: { color: cor("--texto-3"), formatter: (v) => (v ? fmtRs(v).replace(",0 ", " ") : "0") } }),
      series,
    });
    tabela(el, ["Ano", "Economia estimada", "Intervalo de confiança (95%)"], hist.map((h) => [String(h.ano),
      fmtRs(h.central * fator(h)), `${fmtRs(h.baixo * fator(h))} a ${fmtRs(h.alto * fator(h))}`]));
    return true;
  }

  function graficoTercis(el) {
    const t = dados.tercis;
    if (!t.length) return false;
    grafico(el, {
      tooltip: { ...temaBase().tooltip, trigger: "item",
        formatter: (p) => `${p.name}<br>Perda: <b>${fmtN1.format(p.value * 100)}%</b> do valor contratado<br>${t[p.dataIndex].n} órgãos-ano; ${fmtN1.format(t[p.dataIndex].x_medio)} ATI por R$ 100 mi` },
      grid: { ...temaBase().grid, right: 16, top: 28, bottom: 8 },
      xAxis: eixoCategoria(t.map((x) => x.grupo), { axisLabel: { color: cor("--texto-2"), interval: 0, width: 90, overflow: "break" } }),
      yAxis: eixoValor({ min: 0, axisLabel: { color: cor("--texto-3"), formatter: (v) => `${fmtN1.format(v * 100)}%` } }),
      series: [{ type: "bar", data: t.map((x) => x.perda_pct), barMaxWidth: 64,
        itemStyle: { color: cor("--geral"), borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: "top", color: cor("--texto-2"), formatter: (p) => `${fmtN1.format(p.value * 100)}%` } }],
    });
    tabela(el, ["Grupo", "Órgãos-ano", "ATI por R$ 100 mi", "Perda"], t.map((x) => [x.grupo, String(x.n), fmtN1.format(x.x_medio), `${fmtN1.format(x.perda_pct * 100)}%`]));
    return true;
  }

  function renderizar() {
    const secao = document.getElementById("s-economicidade");
    const link = document.querySelector('.barra-nav a[href="#s-economicidade"]');
    const ok = !!dados && SLUG === "ati";
    secao.hidden = !ok;
    if (link) link.hidden = !ok;
    if (!ok) return;

    const [titulo, texto] = VEREDITOS[dados.veredito] ?? VEREDITOS.sem_dados;
    const hist = dados.economia_historica;
    const ult = hist.at(-1);
    const cob = dados.cobertura;
    const c = dados.custo;

    document.getElementById("eco-desc").textContent =
      "O trabalho do ATI (planejar, fiscalizar e gerir contratos de tecnologia) não substitui a terceirização. A pergunta é outra: " +
      "órgãos com mais ATI para o volume de contratos de TIC que gerem perdem menos dinheiro com acréscimos de valor e preços acima do mercado?";

    document.getElementById("eco-veredito").textContent = titulo;
    document.getElementById("eco-veredito-det").textContent = texto;
    document.getElementById("eco-veredito-card").dataset.veredito = dados.veredito;

    const carreira = modo === "carreira";
    const f = ult ? (carreira ? efetivoNacional(ult.ano) / ult.atis : 1) : 1;
    document.getElementById("eco-ano-rotulo").textContent = ult ? `Economia estimada em ${ult.ano}` : "Economia estimada";
    document.getElementById("eco-ano").textContent = ult ? fmtRs(ult.central * f) : "–";
    document.getElementById("eco-ano-det").textContent = ult
      ? `intervalo de confiança de 95%: ${fmtRs(ult.baixo * f)} a ${fmtRs(ult.alto * f)}. ` +
        (carreira ? "Extrapolado ao efetivo nacional." : `Em ${cob.orgaos_no_painel} órgãos analisados.`)
      : "";
    const r = c.retorno_por_real;
    document.getElementById("eco-retorno").textContent = r ? `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(r.central)}` : "–";
    document.getElementById("eco-retorno-det").textContent = r
      ? `para cada R$ 1 de folha com encargos (IC 95%: ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(r.baixo)} a ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(r.alto)})`
      : "";
    const cenSem = dados.projecao.cenarios?.find((x) => x.id === "sem-entradas");
    if (cenSem) {
      const i = cenSem.anos.length - 1;
      const v = carreira ? cenSem.extrapolada_central[i] : cenSem.central[i];
      document.getElementById("eco-fim-rotulo").textContent = `Em ${cenSem.anos[i]}, sem novas entradas`;
      document.getElementById("eco-fim").textContent = fmtRs(v);
      document.getElementById("eco-fim-det").textContent = `com ~${new Intl.NumberFormat("pt-BR").format(cenSem.efetivo[i])} ${P}; repondo as saídas: ${fmtRs(carreira ? dados.projecao.cenarios.find((x) => x.id === "repondo").extrapolada_central[i] : dados.projecao.cenarios.find((x) => x.id === "repondo").central[i])}`;
    }

    for (const b of secao.querySelectorAll("[data-eco-modo]")) b.setAttribute("aria-pressed", String(b.dataset.ecoModo === modo));
    const ultAnos = ult ? (carreira ? efetivoNacional(ult.ano) : ult.atis) : 0;
    const custoTxt = ult ? ` Para comparar, a folha básica da carreira com ${Math.round(c.encargos_pct * 100)}% de encargos custa cerca de ${fmtRs(c.custo_por_ati_ano * ultAnos)} por ano nesse recorte.` : "";
    document.getElementById("eco-sub").textContent = (carreira
      ? "Estimativa dos órgãos analisados multiplicada pelo efetivo nacional de ATIs. É uma extrapolação: ministérios, onde estão a maioria dos ATIs, ficaram fora da estimativa."
      : "Soma dos órgãos analisados (entidades vinculadas com código estável). Barras: estimativa para anos já fechados. Linhas: projeção, com faixa de confiança.") + custoTxt;
    graficoEconomia("g-economia");

    const tb = document.getElementById("eco-evidencias");
    tb.replaceChildren();
    tb.innerHTML = '<thead><tr><th>Resultado</th><th class="num">Efeito de +1 ATI por R$ 100 mi</th><th class="num">Intervalo de confiança (95%)</th><th>Leitura</th><th class="num">Amostra</th></tr></thead>';
    const corpo = tb.createTBody();
    for (const e of dados.estimativas) corpo.appendChild(linhaEvidencia(e));

    const okT = graficoTercis("g-tercis");
    document.getElementById("eco-tercis").hidden = !okT;

    document.getElementById("eco-cobertura").textContent =
      `${cob.orgaos_no_painel} órgãos, ${cob.linhas_orgao_ano} órgãos-ano (${cob.linhas_na_estimacao} na estimação principal), ` +
      `${new Intl.NumberFormat("pt-BR").format(cob.contratos_tic)} contratos e empenhos de TIC, ` +
      `${new Intl.NumberFormat("pt-BR").format(cob.contratos_com_termos)} contratos com termos aditivos lidos no PNCP, anos ${cob.anos?.[0]} a ${cob.anos?.[1]}. ` +
      `Gerado em ${new Date(dados.gerado_em).toLocaleDateString("pt-BR")}.`;
    document.getElementById("eco-encargos").textContent = `${Math.round(c.encargos_pct * 100)}%`;
  }

  async function carregar() {
    if (SLUG !== "ati") return;
    try { dados = await json("ati/economicidade.json"); } catch (e) { dados = null; }
  }

  function ligar() {
    for (const b of document.querySelectorAll("[data-eco-modo]")) {
      b.addEventListener("click", () => { modo = b.dataset.ecoModo; renderizar(); });
    }
  }

  return { carregar, renderizar, ligar };
})();
