"use strict";

const BASE_DADOS = "data/";
const TOP_ORGAOS = 15;

const fmtInt = new Intl.NumberFormat("pt-BR");
const fmtReal = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtMil = (v) => "R$ " + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v / 1000) + " mil";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMes = (ref) => { const [a, m] = ref.split("-"); return `${MESES[+m - 1]}/${a}`; };

const graficos = {};
let indice = null;
let atual = null;

// ---------------------------------------------------------------- tema

function cor(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function temaBase() {
  const texto2 = cor("--texto-2");
  return {
    textStyle: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: texto2 },
    grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: cor("--superficie"),
      borderColor: cor("--borda"),
      textStyle: { color: cor("--texto"), fontSize: 13 },
      confine: true,
    },
  };
}

const estreito = () => window.innerWidth < 600;

function eixoValor(extra = {}) {
  return {
    type: "value",
    splitNumber: estreito() ? 3 : 5,
    axisLabel: { color: cor("--texto-3"), formatter: (v) => fmtInt.format(v) },
    splitLine: { lineStyle: { color: cor("--grade"), width: 1 } },
    axisLine: { show: false },
    ...extra,
  };
}

function eixoCategoria(dados, extra = {}) {
  return {
    type: "category",
    data: dados,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: cor("--grade") } },
    axisLabel: { color: cor("--texto-2") },
    ...extra,
  };
}

// ---------------------------------------------------------------- gráficos

function grafico(id, opcoes) {
  const el = document.getElementById(id);
  if (!graficos[id]) graficos[id] = echarts.init(el, null, { renderer: "svg" });
  graficos[id].setOption({ ...temaBase(), ...opcoes }, true);
}

function barrasHorizontais(id, itens, rotulo = "ATIs") {
  const larguraRotulo = estreito() ? 130 : 260;
  const ordenados = [...itens].reverse();
  // Altura proporcional ao número de barras, para listas curtas não sobrarem vazias.
  const el = document.getElementById(id);
  el.style.height = `${Math.max(120, itens.length * 32 + 48)}px`;
  graficos[id]?.resize();
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "item", formatter: (p) => `${p.name}<br><b>${fmtInt.format(p.value)}</b> ${rotulo}` },
    xAxis: eixoValor(),
    yAxis: eixoCategoria(ordenados.map((d) => d.nome), {
      axisLabel: { color: cor("--texto-2"), width: larguraRotulo, overflow: "truncate" },
    }),
    series: [{
      type: "bar",
      data: ordenados.map((d) => d.qtd),
      barMaxWidth: 24,
      itemStyle: { color: cor("--serie"), borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: cor("--texto-2"), formatter: (p) => fmtInt.format(p.value) },
      emphasis: { itemStyle: { color: cor("--serie"), opacity: 0.85 } },
    }],
  });
  tabela(id, ["Item", rotulo], itens.map((d) => [d.nome, fmtInt.format(d.qtd)]));
}

function linhaHistorica(id, meses, valores, formatar) {
  const unico = meses.length === 1;
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: cor("--texto-3") } },
      formatter: (ps) => `${ps[0].name}<br><b>${formatar(ps[0].value)}</b>` },
    grid: { ...temaBase().grid, right: 72 },
    xAxis: eixoCategoria(meses, { boundaryGap: unico }),
    yAxis: eixoValor({ scale: true, axisLabel: { color: cor("--texto-3"), formatter: (v) => formatar(v) } }),
    series: [{
      type: "line",
      data: valores,
      smooth: false,
      symbol: "circle",
      symbolSize: 8,
      showSymbol: unico,
      lineStyle: { width: 2, color: cor("--serie"), cap: "round", join: "round" },
      itemStyle: { color: cor("--serie"), borderColor: cor("--superficie"), borderWidth: 2 },
      areaStyle: { color: cor("--serie-area") },
      endLabel: { show: true, color: cor("--texto"), formatter: (p) => formatar(p.value) },
    }],
  });
  tabela(id, ["Mês", "Valor"], meses.map((m, i) => [m, formatar(valores[i])]));
}

function histogramaFaixas(id, rem) {
  const nomes = rem.histograma.map((f) =>
    f.max === null ? `≥ ${fmtMil(f.min)}` : f.min === 0 ? `< ${fmtMil(f.max)}` : `${fmtMil(f.min)} – ${fmtMil(f.max)}`);
  const curtos = rem.histograma.map((f) => (f.max === null ? `≥${f.min / 1000}` : `${f.min / 1000}–${f.max / 1000}`));
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "item", formatter: (p) => `${nomes[p.dataIndex]}<br><b>${fmtInt.format(p.value)}</b> ATIs` },
    xAxis: eixoCategoria(curtos, { name: "R$ mil", nameLocation: "middle", nameTextStyle: { color: cor("--texto-3") },
      nameGap: estreito() ? 52 : 28,
      axisLabel: { color: cor("--texto-2"), interval: 0, fontSize: 11, rotate: estreito() ? 45 : 0 } }),
    yAxis: eixoValor(),
    grid: { ...temaBase().grid, right: 8, bottom: 24 },
    series: [{
      type: "bar",
      data: rem.histograma.map((f) => f.qtd),
      barMaxWidth: 24,
      itemStyle: { color: cor("--serie"), borderRadius: [4, 4, 0, 0] },
      label: { show: true, position: "top", color: cor("--texto-2"), formatter: (p) => (p.value ? fmtInt.format(p.value) : "") },
    }],
  });
  tabela(id, ["Faixa", "ATIs"], nomes.map((n, i) => [n, fmtInt.format(rem.histograma[i].qtd)]));
}

function mapaClassePadrao(id, itens) {
  const classes = [...new Set(itens.map((d) => d.classe))];
  const padroes = [...new Set(itens.map((d) => d.padrao))];
  const romano = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  padroes.sort((a, b) => (romano[a] ?? 99) - (romano[b] ?? 99));
  const max = Math.max(...itens.map((d) => d.qtd));
  const [corMin, corMax] = [cor("--seq-min"), cor("--seq-max")];
  // Texto da célula: branco ou quase preto conforme a luminância do preenchimento.
  const dados = itens.map((d) => ({
    value: [padroes.indexOf(d.padrao), classes.indexOf(d.classe), d.qtd],
    label: { color: luminancia(misturar(corMin, corMax, d.qtd / max)) > 0.45 ? "#0b0b0b" : "#ffffff" },
  }));
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "item",
      formatter: (p) => `Classe ${classes[p.value[1]]}, padrão ${padroes[p.value[0]]}<br><b>${fmtInt.format(p.value[2])}</b> ATIs` },
    grid: { ...temaBase().grid, right: 8, bottom: 24 },
    xAxis: eixoCategoria(padroes, { name: "Padrão", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: cor("--texto-3") }, splitArea: { show: false } }),
    yAxis: eixoCategoria(classes, { name: "Classe", nameTextStyle: { color: cor("--texto-3") }, inverse: true }),
    visualMap: { show: false, min: 0, max, inRange: { color: [cor("--seq-min"), cor("--seq-max")] } },
    series: [{
      type: "heatmap",
      data: dados,
      itemStyle: { borderColor: cor("--superficie"), borderWidth: 2, borderRadius: 4 },
      label: { show: true, formatter: (p) => fmtInt.format(p.value[2]), fontWeight: 600 },
    }],
  });
  tabela(id, ["Classe", "Padrão", "ATIs"], itens.map((d) => [d.classe, d.padrao, fmtInt.format(d.qtd)]));
}

function rgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function misturar(a, b, t) {
  const [ca, cb] = [rgb(a), rgb(b)];
  return ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
}

function luminancia([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function tabela(id, cabecalho, linhas) {
  const painel = document.getElementById(id).parentElement;
  painel.querySelector("details")?.remove();
  const det = document.createElement("details");
  const ultima = cabecalho.length - 1;
  det.innerHTML = `<summary>Ver tabela</summary><table><thead><tr>${cabecalho
    .map((c, i) => `<th${i === ultima ? ' class="num"' : ""}>${c}</th>`).join("")}</tr></thead><tbody></tbody></table>`;
  const corpo = det.querySelector("tbody");
  for (const linha of linhas) {
    const tr = corpo.insertRow();
    linha.forEach((v, i) => { const td = tr.insertCell(); td.textContent = v; if (i === ultima) td.className = "num"; });
  }
  painel.appendChild(det);
}

// ---------------------------------------------------------------- render

function topComOutros(itens, n) {
  if (itens.length <= n) return itens;
  const resto = itens.slice(n).reduce((s, d) => s + d.qtd, 0);
  return [...itens.slice(0, n), { nome: `Outros (${itens.length - n} órgãos)`, qtd: resto }];
}

function delta(el, atualV, anteriorV, formatar, rotulo) {
  el.className = "delta";
  if (anteriorV == null) { el.textContent = ""; return; }
  const d = atualV - anteriorV;
  if (d === 0) { el.textContent = `sem variação vs ${rotulo}`; return; }
  el.textContent = `${d > 0 ? "▲ +" : "▼ −"}${formatar(Math.abs(d))} vs ${rotulo}`;
  el.classList.add(d > 0 ? "sobe" : "desce");
}

function renderizar() {
  if (!atual) return;
  const d = atual;
  const rem = d.remuneracao_basica_bruta;
  const pos = indice.meses.findIndex((m) => m.mes === d.referencia);
  const anterior = pos > 0 ? indice.meses[pos - 1] : null;

  document.getElementById("c-total").textContent = fmtInt.format(d.total);
  delta(document.getElementById("c-total-delta"), d.total, anterior?.total, fmtInt.format, anterior && fmtMes(anterior.mes));
  document.getElementById("c-mediana").textContent = fmtReal.format(rem.mediana);
  document.getElementById("c-media").textContent = `média ${fmtReal.format(rem.media)}`;
  document.getElementById("c-faixa").textContent = `${fmtReal.format(rem.p10)} – ${fmtReal.format(rem.p90)}`;
  document.getElementById("c-n").textContent = `${fmtInt.format(rem.n)} com remuneração no mês`;
  document.getElementById("c-funcao").textContent = fmtInt.format(d.funcao.com_funcao);
  document.getElementById("c-funcao-pct").textContent =
    `${new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(d.funcao.com_funcao / d.total)} do total`;
  document.getElementById("hist-sub").textContent = `${fmtInt.format(rem.n)} ATIs com remuneração básica bruta > 0`;

  const meses = indice.meses.map((m) => fmtMes(m.mes));
  linhaHistorica("g-hist-total", meses, indice.meses.map((m) => m.total), (v) => fmtInt.format(v));
  linhaHistorica("g-hist-mediana", meses, indice.meses.map((m) => m.mediana), fmtMil);

  barrasHorizontais("g-exercicio", topComOutros(d.por_orgao_exercicio, TOP_ORGAOS));
  barrasHorizontais("g-lotacao", d.por_orgao_lotacao);
  barrasHorizontais("g-uf", d.por_uf);
  barrasHorizontais("g-funcao", d.funcao.por_sigla);
  barrasHorizontais("g-situacao", d.por_situacao);
  histogramaFaixas("g-faixas", rem);
  mapaClassePadrao("g-classe", d.por_classe_padrao);

  document.getElementById("ref").textContent = fmtMes(d.referencia);
  document.getElementById("gerado").textContent = new Date(d.gerado_em).toLocaleDateString("pt-BR");
  document.getElementById("filtro").textContent = d.filtro_cargo;
  document.getElementById("fonte").href = d.fonte.url;
}

// ---------------------------------------------------------------- dados

async function json(caminho) {
  const r = await fetch(BASE_DADOS + caminho, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

async function carregarMes(arquivo) {
  atual = await json(arquivo);
  renderizar();
}

function mostrarErro(e) {
  const el = document.getElementById("erro");
  el.textContent = `Não foi possível carregar os dados (${e.message}).`;
  el.hidden = false;
  console.error(e);
}

async function iniciar() {
  if (typeof echarts === "undefined") throw new Error("biblioteca de gráficos não carregou");
  indice = await json("index.json");
  const select = document.getElementById("mes");
  for (const m of [...indice.meses].reverse()) select.add(new Option(fmtMes(m.mes), m.arquivo));
  select.addEventListener("change", () => carregarMes(select.value).catch(mostrarErro));
  await carregarMes(select.value);
}

document.getElementById("tema").addEventListener("click", () => {
  const raiz = document.documentElement;
  const escuroAgora = raiz.dataset.theme
    ? raiz.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  raiz.dataset.theme = escuroAgora ? "light" : "dark";
  try { localStorage.setItem("tema", raiz.dataset.theme); } catch (e) {}
  renderizar();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderizar);

let espera;
window.addEventListener("resize", () => {
  clearTimeout(espera);
  espera = setTimeout(() => { Object.values(graficos).forEach((g) => g.resize()); renderizar(); }, 150);
});

iniciar().catch(mostrarErro);
