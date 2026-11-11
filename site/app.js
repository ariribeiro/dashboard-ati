"use strict";

const BASE_DADOS = "data/";
// Carreira do painel: ?carreira=atps (padrão: ati). Configuração em data/carreiras.json.
let SLUG = new URLSearchParams(location.search).get("carreira") || "ati";
let P = "ATIs"; // plural da sigla, usado nos textos
let CFG = {}; // entrada da carreira em data/carreiras.json
// Rótulo de exibição da classe (no SIAPE, "S" é a classe Especial em algumas carreiras).
const rotuloClasse = (c) => CFG.classes?.[c] ?? c;
// Sigla no singular ou no plural conforme a quantidade ("1 AIE", "2 AIEs").
const siglaQtd = (n) => (Math.abs(n) === 1 ? CFG.sigla : P);
// Favicon das carreiras sem marca própria: barras sobre a tinta, a mais alta na cor da carreira.
const faviconNeutro = (cor) => "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#17393B"/>' +
  '<rect x="14" y="34" width="8" height="16" rx="2" fill="#fff"/><rect x="28" y="24" width="8" height="26" rx="2" fill="#fff"/>' +
  `<rect x="42" y="14" width="8" height="36" rx="2" fill="${cor}"/></svg>`);
const TOP_ORGAOS = 15;

const fmtInt = new Intl.NumberFormat("pt-BR");
const fmtPct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const fmtReal = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtMil = (v) => "R$ " + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v / 1000) + " mil";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_EXTENSO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const fmtMes = (ref) => { const [a, m] = ref.split("-"); return `${MESES[+m - 1]}/${a}`; };

const SITUACOES = {
  "ATIVO PERMANENTE": "ativos permanentes",
  "ATIVO EM OUTRO ORGAO": "em outro órgão",
  "EXERC DESCENT CARREI": "em exercício descentralizado",
  "CEDIDO/REQUISITADO": "cedidos ou requisitados",
};

const graficos = {};
let indice = null;
let atual = null;
let anterior = null;

// ---------------------------------------------------------------- tema

function cor(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function temaEscuro() {
  const raiz = document.documentElement;
  return raiz.dataset.theme ? raiz.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

const estreito = () => window.innerWidth < 600;

function temaBase() {
  return {
    textStyle: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: cor("--texto-2") },
    grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: cor("--superficie"),
      borderColor: cor("--borda"),
      textStyle: { color: cor("--texto"), fontSize: 13 },
      confine: true,
    },
  };
}

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

// ---------------------------------------------------------------- órgãos

let coordenadas = new Map();

async function carregarCoordenadas() {
  const r = await fetch(BASE_DADOS + "orgaos_coordenadas.csv", { cache: "no-cache" });
  if (!r.ok) throw new Error(`orgaos_coordenadas.csv: HTTP ${r.status}`);
  const [cab, ...linhas] = (await r.text()).trim().split(/\r?\n/);
  const campos = cab.split(";");
  for (const linha of linhas) {
    const o = Object.fromEntries(linha.split(";").map((v, i) => [campos[i], v]));
    coordenadas.set(o.orgao_siape, { ...o, lat: parseFloat(o.lat), lon: parseFloat(o.lon) });
  }
}

// Nome legível do órgão: o SIAPE mistura abreviações em caixa alta com nomes completos.
function orgao(nomeSiape) {
  const c = coordenadas.get(nomeSiape);
  if (!c) return { curto: nomeSiape, completo: nomeSiape, sigla: "" };
  return { curto: c.nome_curto || nomeSiape, completo: c.nome || nomeSiape, sigla: c.sigla };
}

// ---------------------------------------------------------------- gráficos

function grafico(id, opcoes) {
  const el = document.getElementById(id);
  if (!graficos[id]) graficos[id] = echarts.init(el, null, { renderer: "svg" });
  graficos[id].setOption({ ...temaBase(), ...opcoes }, true);
}

// itens: [{ nome, qtd, completo? }]
function barrasHorizontais(id, itens, corVar, rotulo = P) {
  const larguraRotulo = estreito() ? 120 : 200;
  const ordenados = [...itens].reverse();
  // Altura proporcional ao número de barras, para listas curtas não sobrarem vazias.
  document.getElementById(id).style.height = `${Math.max(120, itens.length * 30 + 48)}px`;
  graficos[id]?.resize();
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "item",
      formatter: (p) => `${ordenados[p.dataIndex].completo ?? p.name}<br><b>${fmtInt.format(p.value)}</b> ${rotulo === P ? siglaQtd(p.value) : rotulo}` },
    xAxis: eixoValor(),
    yAxis: eixoCategoria(ordenados.map((d) => d.nome), {
      axisLabel: { color: cor("--texto-2"), width: larguraRotulo, overflow: "truncate" },
    }),
    series: [{
      type: "bar",
      data: ordenados.map((d) => d.qtd),
      barMaxWidth: 20,
      itemStyle: { color: cor(corVar), borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: cor("--texto-2"), formatter: (p) => fmtInt.format(p.value) },
      emphasis: { itemStyle: { color: cor(corVar), opacity: 0.85 } },
    }],
  });
  tabela(id, ["Item", rotulo], itens.map((d) => [d.completo ?? d.nome, fmtInt.format(d.qtd)]));
}

// Série mensal contínua: meses sem arquivo processado entram como null (lacuna na linha).
function serieMensal(campo) {
  const porMes = new Map(indice.meses.map((m) => [m.mes, m[campo]]));
  const [a0, m0] = indice.meses[0].mes.split("-").map(Number);
  const [a1, m1] = indice.meses.at(-1).mes.split("-").map(Number);
  const rotulos = [], valores = [];
  for (let a = a0, m = m0; a < a1 || (a === a1 && m <= m1); m === 12 ? (a++, m = 1) : m++) {
    const ref = `${a}-${String(m).padStart(2, "0")}`;
    rotulos.push(fmtMes(ref));
    valores.push(porMes.has(ref) ? porMes.get(ref) : null);
  }
  return { rotulos, valores };
}

function lacunas({ rotulos, valores }) {
  const faixas = [];
  let ini = null;
  valores.forEach((v, i) => {
    if (v === null && ini === null) ini = i;
    if (v !== null && ini !== null) { faixas.push(ini === i - 1 ? rotulos[ini] : `${rotulos[ini]} a ${rotulos[i - 1]}`); ini = null; }
  });
  return faixas.length ? `Sem dados processados de ${faixas.join(", ")}.` : "";
}

const isolado = (valores, i) => valores[i] !== null && valores[i - 1] == null && valores[i + 1] == null;

// Entradas de turma (mesmo critério da seção de tendência), como índices da série mensal.
function degraus() {
  const n0 = numMes(indice.meses[0].mes);
  return analisarFluxo().turmas.map((tm) => ({ fim: tm.fim - n0, dif: tm.entrada }));
}

// opcoes: zero (eixo a partir de 0, com área), degraus (marca altas), selecionado (rótulo do mês escolhido)
function linhaHistorica(id, serie, corVar, formatar, opcoes = {}) {
  const { rotulos, valores } = serie;
  const ano = (r) => +r.slice(4);
  const anos = new Set(rotulos.map(ano)).size;
  const passo = estreito() ? (anos > 4 ? 3 : 1) : (anos > 8 ? 2 : 1);
  const primeiroAno = ano(rotulos[0]);
  const marcas = opcoes.degraus ? degraus() : [];
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: cor("--texto-3") } },
      formatter: (ps) => `${ps[0].name}<br><b>${ps[0].value == null ? "sem dados" : formatar(ps[0].value)}</b>` },
    grid: { ...temaBase().grid, right: 72, top: 24 },
    xAxis: eixoCategoria(rotulos, {
      boundaryGap: false,
      axisLabel: {
        color: cor("--texto-2"),
        // Só janeiro, a cada `passo` anos, rotulado pelo ano.
        interval: (i, r) => r.startsWith("jan/") && (ano(r) - primeiroAno) % passo === 0,
        formatter: (r) => r.slice(4),
      },
    }),
    yAxis: eixoValor({
      ...(opcoes.zero ? { min: 0 } : { scale: true }),
      axisLabel: { color: cor("--texto-3"), formatter: (v) => formatar(v) },
    }),
    series: [{
      type: "line",
      data: valores,
      connectNulls: false,
      symbol: "circle",
      // Só mostra marcador em mês isolado (entre lacunas), que de outro modo sumiria.
      symbolSize: (v, p) => (isolado(valores, p.dataIndex) || rotulos.length === 1 ? 8 : 0),
      lineStyle: { width: 2, color: cor(corVar), cap: "round", join: "round" },
      itemStyle: { color: cor(corVar), borderColor: cor("--superficie"), borderWidth: 2 },
      // Área só quando o eixo parte do zero; senão ela exageraria as diferenças.
      areaStyle: opcoes.zero ? { color: cor(corVar + "-lavado") } : undefined,
      endLabel: { show: true, color: cor("--texto"), formatter: (p) => formatar(p.value) },
      emphasis: { focus: "none" },
      markPoint: marcas.length ? {
        symbol: "circle",
        symbolSize: 8,
        itemStyle: { color: cor(corVar), borderColor: cor("--superficie"), borderWidth: 2 },
        label: { position: "left", distance: 6, color: cor("--texto-2"), fontSize: 11, fontWeight: 600, formatter: (p) => p.name },
        data: marcas.map((m) => ({ name: `+${fmtInt.format(m.dif)}`, coord: [m.fim, valores[m.fim]] })),
      } : undefined,
      markLine: opcoes.selecionado && rotulos.length > 1 ? {
        silent: true,
        symbol: "none",
        lineStyle: { color: cor("--texto-3"), type: "solid", width: 1 },
        label: { show: false },
        data: [{ xAxis: opcoes.selecionado }],
      } : undefined,
    }],
  });
  tabela(id, ["Mês", "Valor"], rotulos.map((m, i) => [m, valores[i] == null ? "sem dados" : formatar(valores[i])]));
}

function sparkline(id, serie, corVar) {
  const el = document.getElementById(id);
  const pontos = serie.valores.filter((v) => v !== null).length;
  el.hidden = pontos < 2;
  if (el.hidden) return;
  const ultimo = serie.valores.length - 1;
  grafico(id, {
    tooltip: { show: false },
    grid: { left: 4, right: 6, top: 6, bottom: 4 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: serie.rotulos },
    yAxis: { type: "value", show: false, scale: true },
    series: [{
      type: "line",
      data: serie.valores,
      connectNulls: false,
      symbol: "circle",
      symbolSize: (v, p) => (p.dataIndex === ultimo ? 8 : 0),
      lineStyle: { width: 2, color: cor(corVar) },
      itemStyle: { color: cor(corVar), borderColor: cor("--superficie"), borderWidth: 2 },
      areaStyle: { color: cor(corVar + "-lavado") },
      silent: true,
    }],
  });
}

function histogramaFaixas(id, rem) {
  const faixas = rem.histograma;
  const nomes = faixas.map((f) =>
    f.max === null ? `≥ ${fmtMil(f.min)}` : f.min === 0 ? `< ${fmtMil(f.max)}` : `${fmtMil(f.min)} – ${fmtMil(f.max)}`);
  const curtos = faixas.map((f) => (f.max === null ? `≥${f.min / 1000}` : `${f.min / 1000}–${f.max / 1000}`));
  // Posição de um valor em R$ no eixo das faixas (faixa i ocupa [i, i+1]); a última, aberta, vale 10 mil.
  const posicao = (v) => {
    for (const [i, f] of faixas.entries()) {
      const max = f.max ?? f.min + 10000;
      if (v < max || f.max === null) return i + Math.min(1, Math.max(0, (v - f.min) / (max - f.min)));
    }
    return faixas.length;
  };
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "item", formatter: (p) => `${nomes[p.dataIndex]}<br><b>${fmtInt.format(p.value)}</b> ${siglaQtd(p.value)}` },
    xAxis: [
      eixoCategoria(curtos, { name: "R$ mil", nameLocation: "middle", nameTextStyle: { color: cor("--texto-3") },
        nameGap: estreito() ? 52 : 28,
        axisLabel: { color: cor("--texto-2"), interval: 0, fontSize: 11, rotate: estreito() ? 45 : 0 } }),
      { type: "value", min: 0, max: faixas.length, show: false },
    ],
    // Folga no topo: o número da barra mais alta não encosta no rótulo da mediana.
    yAxis: eixoValor({ boundaryGap: [0, "20%"] }),
    grid: { ...temaBase().grid, right: 8, top: 36, bottom: 24 },
    series: [
      {
        type: "bar",
        data: faixas.map((f) => f.qtd),
        barMaxWidth: 24,
        itemStyle: { color: cor("--remuneracao"), borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: cor("--texto-2"), formatter: (p) => (p.value ? fmtInt.format(p.value) : "") },
        z: 3,
      },
      {
        type: "line",
        xAxisIndex: 1,
        data: [],
        silent: true,
        markArea: {
          silent: true,
          itemStyle: { color: cor("--remuneracao-lavado") },
          label: { show: false },
          data: [[{ xAxis: posicao(rem.p10) }, { xAxis: posicao(rem.p90) }]],
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: cor("--texto-2"), type: "solid", width: 1.5 },
          label: { position: "end", color: cor("--texto"), fontWeight: 600, formatter: `mediana ${fmtMil(rem.mediana)}` },
          data: [{ xAxis: posicao(rem.mediana) }],
        },
      },
    ],
  });
  tabela(id, ["Faixa", P], nomes.map((n, i) => [n, fmtInt.format(faixas[i].qtd)]));
}

function mapaClassePadrao(id, itens) {
  const classes = [...new Set(itens.map((d) => d.classe))].sort();
  const padroes = [...new Set(itens.map((d) => d.padrao))];
  const romano = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  padroes.sort((a, b) => (romano[a] ?? 99) - (romano[b] ?? 99));
  const totais = Object.fromEntries(classes.map((c) => [c, itens.filter((d) => d.classe === c).reduce((s, d) => s + d.qtd, 0)]));
  const max = Math.max(...itens.map((d) => d.qtd));
  const [corMin, corMax] = [cor("--carreira-seq-min"), cor("--carreira-seq-max")];
  // Texto da célula: branco ou quase preto conforme a luminância do preenchimento.
  const dados = itens.map((d) => ({
    value: [padroes.indexOf(d.padrao), classes.indexOf(d.classe), d.qtd],
    label: { color: luminancia(misturar(corMin, corMax, d.qtd / max)) > 0.4 ? "#0b0b0b" : "#ffffff" },
  }));
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "item",
      formatter: (p) => `Classe ${rotuloClasse(classes[p.value[1]])}, padrão ${padroes[p.value[0]]}<br><b>${fmtInt.format(p.value[2])}</b> ${siglaQtd(p.value[2])}` },
    grid: { ...temaBase().grid, right: 8, bottom: 24 },
    xAxis: eixoCategoria(padroes, { name: "Padrão", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: cor("--texto-3") } }),
    yAxis: [
      eixoCategoria(classes, { name: "Classe", nameTextStyle: { color: cor("--texto-3") }, inverse: true, axisLine: { show: false },
        axisLabel: { color: cor("--texto-2"), formatter: rotuloClasse } }),
      eixoCategoria(classes, { inverse: true, position: "right", axisLine: { show: false }, name: "Total", nameTextStyle: { color: cor("--texto-3") },
        axisLabel: { color: cor("--texto"), fontWeight: 600, formatter: (c) => fmtInt.format(totais[c]) } }),
    ],
    visualMap: { show: false, min: 0, max, inRange: { color: [corMin, corMax] } },
    series: [{
      type: "heatmap",
      data: dados,
      itemStyle: { borderColor: cor("--superficie"), borderWidth: 2, borderRadius: 4 },
      label: { show: true, formatter: (p) => fmtInt.format(p.value[2]), fontWeight: 600 },
    }],
  });
  tabela(id, ["Classe", "Padrão", P], itens.map((d) => [rotuloClasse(d.classe), d.padrao, fmtInt.format(d.qtd)]));
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
  const painel = document.getElementById(id).closest(".painel");
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

// ---------------------------------------------------------------- mapa de órgãos

// Tiles padrão do OpenStreetMap (sem chave). No modo escuro, o CSS inverte as cores do mapa.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// Retângulo do DF. Sem usar o Leaflet aqui: se a biblioteca não carregar, iniciar() mostra o erro.
const noDF = ([lat, lon]) => lat >= -16.06 && lat <= -15.49 && lon >= -48.29 && lon <= -47.30;

let mapa = null;
let camadaBolhas = null;
let legendaBolhas = null;
let limites = { brasilia: null, brasil: null };

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Diâmetro proporcional à área: raiz da quantidade.
const diametro = (qtd, max) => Math.round(26 + 38 * Math.sqrt(qtd / max));

function iconeBolha(qtd, max, agrupado = false) {
  const d = diametro(qtd, max);
  return L.divIcon({
    className: "",
    html: `<span class="bolha${agrupado ? " agrupada" : ""}" style="width:${d}px;height:${d}px">${fmtInt.format(qtd)}</span>`,
    iconSize: [d, d],
  });
}

function criarMapa() {
  mapa = L.map("mapa-orgaos", { scrollWheelZoom: false, dragging: !L.Browser.mobile, zoomSnap: 0.5 });
  L.tileLayer(TILES, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);

  const Vistas = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const div = L.DomUtil.create("div", "vistas leaflet-bar");
      div.innerHTML = '<button type="button" data-vista="brasilia">Brasília</button><button type="button" data-vista="brasil">Brasil</button>';
      L.DomEvent.disableClickPropagation(div);
      div.addEventListener("click", (e) => {
        const vista = e.target.dataset.vista;
        if (vista && limites[vista]?.isValid()) mapa.fitBounds(limites[vista], { padding: [24, 24] });
      });
      return div;
    },
  });
  new Vistas().addTo(mapa);
}

function atualizarLegenda(max) {
  legendaBolhas?.remove();
  const exemplos = [...new Set([10, 50, max].filter((v) => v <= max))];
  const Legenda = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "legenda-bolhas");
      div.innerHTML = `${P} por local<div class='itens'>` + exemplos.map((v) => {
        const d = diametro(v, max);
        return `<div class="item"><span class="circulo" style="width:${d}px;height:${d}px"></span>${fmtInt.format(v)}</div>`;
      }).join("") + "</div>";
      return div;
    },
  });
  legendaBolhas = new Legenda().addTo(mapa);
}

function mapaOrgaos(orgaos) {
  if (!mapa) criarMapa();

  // Agrupa por coordenada: vários órgãos dividem o mesmo prédio (ex.: blocos da Esplanada).
  const locais = new Map();
  let semLocal = 0;
  const semLocalNomes = [];
  for (const o of orgaos) {
    const c = coordenadas.get(o.nome);
    if (!c || Number.isNaN(c.lat)) {
      semLocal += o.qtd;
      semLocalNomes.push(`${orgao(o.nome).curto} (${fmtInt.format(o.qtd)})`);
      continue;
    }
    const chave = `${c.lat},${c.lon}`;
    if (!locais.has(chave)) locais.set(chave, { local: c.local, lat: c.lat, lon: c.lon, precisao: c.precisao, qtd: 0, orgaos: [] });
    const l = locais.get(chave);
    l.qtd += o.qtd;
    l.orgaos.push({ ...orgao(o.nome), qtd: o.qtd });
  }

  const max = Math.max(1, ...[...locais.values()].map((l) => l.qtd));
  camadaBolhas?.remove();
  camadaBolhas = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 60,
    iconCreateFunction: (cluster) =>
      iconeBolha(cluster.getAllChildMarkers().reduce((s, m) => s + m.options.qtd, 0), max, true),
  });

  for (const l of locais.values()) {
    l.orgaos.sort((a, b) => b.qtd - a.qtd);
    const linhas = l.orgaos.map((o) =>
      `<tr><td title="${escapar(o.completo)}"><strong>${escapar(o.sigla || o.curto)}</strong> ${o.sigla && o.curto !== o.sigla ? escapar(o.curto) : ""}</td>` +
      `<td class="num">${fmtInt.format(o.qtd)}</td></tr>`).join("");
    const aviso = l.precisao === "edificio" ? "" : `<p class="popup-aviso">Localização aproximada (${l.precisao === "rua" ? "rua" : "quadra"}).</p>`;
    L.marker([l.lat, l.lon], { icon: iconeBolha(l.qtd, max), qtd: l.qtd, title: `${l.local}: ${l.qtd} ${P}`, riseOnHover: true })
      .bindPopup(`<strong>${escapar(l.local)}</strong><table>${linhas}</table>` +
        (l.orgaos.length > 1 ? `<p class="popup-total">${fmtInt.format(l.qtd)} ${P} no prédio</p>` : "") + aviso)
      .addTo(camadaBolhas);
  }
  camadaBolhas.addTo(mapa);
  atualizarLegenda(max);

  const pontos = [...locais.values()].map((l) => [l.lat, l.lon]);
  limites.brasil = L.latLngBounds(pontos);
  limites.brasilia = L.latLngBounds(pontos.filter(noDF));
  if (!mapa._vistaInicial && limites.brasil.isValid()) {
    mapa.fitBounds(limites.brasilia.isValid() ? limites.brasilia : limites.brasil, { padding: [24, 24] });
    mapa._vistaInicial = true;
  }

  const fora = [...locais.values()].filter((l) => !noDF([l.lat, l.lon])).reduce((s, l) => s + l.qtd, 0);
  const partes = [];
  if (fora) partes.push(`${fmtInt.format(fora)} ${P} em órgãos com sede fora do DF: use o botão “Brasil” para vê-los.`);
  if (semLocal) partes.push(`${fmtInt.format(semLocal)} sem localização: ${semLocalNomes.join(", ")}.`);
  partes.push("A posição é a da sede do órgão; o servidor pode trabalhar em um anexo ou unidade regional.");
  document.getElementById("mapa-nota").textContent = partes.join(" ");

  tabela("mapa-orgaos", ["Local", "Órgãos", P], [...locais.values()].sort((a, b) => b.qtd - a.qtd)
    .map((l) => [l.local, l.orgaos.map((o) => o.sigla || o.curto).join(", "), fmtInt.format(l.qtd)]));
}

// ---------------------------------------------------------------- textos

function topComOutros(itens, n) {
  if (itens.length <= n) return itens;
  const resto = itens.slice(n).reduce((s, d) => s + d.qtd, 0);
  return [...itens.slice(0, n), { nome: `Outros (${itens.length - n} órgãos)`, qtd: resto }];
}

function delta(el, atualV, anteriorV, formatar, rotulo, colorir = true) {
  el.className = "delta";
  if (anteriorV == null) { el.textContent = ""; return; }
  const d = atualV - anteriorV;
  if (d === 0) { el.textContent = `sem variação vs ${rotulo}`; return; }
  el.textContent = `${d > 0 ? "▲ +" : "▼ −"}${formatar(Math.abs(d))} vs ${rotulo}`;
  if (colorir) el.classList.add(d > 0 ? "sobe" : "desce");
}

// Servidores na posição de ingresso (carreiras.json "ingresso"); null se a carreira não a define.
const inicioCarreira = (d) => (CFG.ingresso
  ? d.por_classe_padrao.find((c) => c.classe === CFG.ingresso.classe && c.padrao === CFG.ingresso.padrao)?.qtd ?? 0
  : null);

// Maior variação positiva entre meses consecutivos do índice.
function maiorAltaMensal() {
  let maior = 0;
  const ms = indice.meses;
  for (let i = 1; i < ms.length; i++) {
    const [a0, m0] = ms[i - 1].mes.split("-").map(Number);
    const [a1, m1] = ms[i].mes.split("-").map(Number);
    if ((a1 * 12 + m1) - (a0 * 12 + m0) === 1) maior = Math.max(maior, ms[i].total - ms[i - 1].total);
  }
  return maior;
}

function destaques(d, ant) {
  const itens = [];
  const refAnt = ant && fmtMes(ant.referencia);

  if (ant) {
    const dif = d.total - ant.total;
    if (dif > 0) {
      const recorde = dif === maiorAltaMensal() ? ", a maior alta mensal da série" : "";
      itens.push(["geral", `<strong>${fmtInt.format(dif)} ${siglaQtd(dif)} a mais</strong> que em ${refAnt}${recorde}.`]);
    } else if (dif < 0) {
      itens.push(["geral", `<strong>${fmtInt.format(-dif)} ${siglaQtd(dif)} a menos</strong> que em ${refAnt}.`]);
    } else {
      itens.push(["geral", `Total estável em relação a ${refAnt}: <strong>${fmtInt.format(d.total)} ${P}</strong>.`]);
    }
  }

  const ai = inicioCarreira(d);
  const aiAnt = ant ? inicioCarreira(ant) : null;
  if (ai !== null) {
    const { classe, padrao } = CFG.ingresso;
    itens.push(["carreira", `<strong>${fmtInt.format(ai)} ${siglaQtd(ai)} (${fmtPct.format(ai / d.total)})</strong> ${ai === 1 ? "está" : "estão"} no início da carreira, classe ${rotuloClasse(classe)}, padrão ${padrao}` +
      (aiAnt !== null && aiAnt !== ai ? ` (eram ${fmtInt.format(aiAnt)} em ${refAnt}).` : ".")]);
  }

  const med = d.remuneracao_basica_bruta.mediana;
  const medAnt = ant?.remuneracao_basica_bruta.mediana;
  if (medAnt && Math.abs(med - medAnt) >= 100) {
    const verbo = med < medAnt ? "caiu" : "subiu";
    const contexto = med < medAnt && aiAnt !== null && ai > aiAnt
      ? `, no mesmo período em que cresceu o número de ${P} no início da carreira` : "";
    itens.push(["remuneracao", `A mediana da remuneração básica bruta ${verbo} de <strong>${fmtMil(medAnt)}</strong> para <strong>${fmtMil(med)}</strong>${contexto}.`]);
  } else {
    itens.push(["remuneracao", `Metade dos ${P} recebe até <strong>${fmtMil(med)}</strong> de remuneração básica bruta.`]);
  }

  const [maior, ...demais] = d.por_orgao_exercicio;
  if (maior) {
    const o = orgao(maior.nome);
    itens.push(["onde", `<strong>${fmtPct.format(maior.qtd / d.total)}</strong> têm exercício ${o.sigla ? `no ${o.sigla}` : `em ${o.curto}`}; os demais estão em <strong>${fmtInt.format(demais.length)} outros órgãos</strong>.`]);
  }

  document.getElementById("destaques").innerHTML =
    itens.map(([tema, html]) => `<li data-tema="${tema}">${html}</li>`).join("");
}

// ---------------------------------------------------------------- tendência

// LIMIAR_ENTRADA, numMes, refDeNum, anual, paresMensais e taxaSaida vêm de orcamento.js.
const HORIZONTE_MESES = 15 * 12;
const JANELA_PIOR = 24;
const fmtPct1 = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Variações entre meses consecutivos, separadas em meses de entrada e meses comuns.
function analisarFluxo() {
  const ms = indice.meses;
  const pares = paresMensais(ms);
  const comuns = pares.filter((p) => p.dif < LIMIAR_ENTRADA);
  const taxa = taxaSaida;

  // Turmas: meses de entrada separados por no máximo 2 meses viram uma só.
  const turmas = [];
  for (const p of pares.filter((p) => p.dif >= LIMIAR_ENTRADA)) {
    const t = turmas.at(-1);
    if (t && p.n - t.fim <= 2) { t.fim = p.n; t.entrada += p.dif; t.depois = p.total; }
    else turmas.push({ ini: p.n, fim: p.n, entrada: p.dif, antes: p.base, depois: p.total });
  }

  const ultimo = numMes(ms.at(-1).mes);
  const recentes = comuns.filter((p) => p.n > ultimo - 60);
  let pior = { taxa: 0 };
  for (const p of comuns) {
    const janela = comuns.filter((q) => q.n >= p.n && q.n < p.n + JANELA_PIOR);
    if (janela.length < JANELA_PIOR * 0.75) continue;
    const t = taxa(janela);
    if (t > pior.taxa) pior = { taxa: t, ini: janela[0].n, fim: janela.at(-1).n };
  }

  const cenarios = [
    { id: "recente", nome: "Ritmo dos últimos 5 anos", taxa: taxa(recentes), cor: "--cenario-1" },
    { id: "historico", nome: "Média de toda a série", taxa: taxa(comuns), cor: "--cenario-2" },
  ];
  // Só existe quando alguma janela de 24 meses tem dados suficientes e perda líquida.
  if (pior.ini != null) {
    cenarios.push({ id: "pior", nome: `Pior período (${fmtMes(refDeNum(pior.ini - 1))} a ${fmtMes(refDeNum(pior.fim))})`, taxa: pior.taxa, cor: "--cenario-3" });
  }

  // Intervalos entre turmas: perda líquida desde o fim da entrada até a próxima turma (ou o mês mais recente).
  const totalEm = new Map(ms.map((m) => [numMes(m.mes), m.total]));
  const intervalos = turmas.map((t, i) => {
    const prox = turmas[i + 1];
    const fim = prox ? prox.ini - 1 : ultimo;
    const perda = t.depois - totalEm.get(fim);
    return { turma: t, fim, meses: fim - t.fim, perda, emAndamento: !prox };
  });

  return { cenarios, turmas, intervalos, ultimo, totalAtual: ms.at(-1).total };
}

// Meses até o total cair de `de` para `ate` à taxa mensal `r`.
const mesesAte = (de, ate, r) => (r > 0 && ate < de ? Math.log(ate / de) / Math.log(1 - r) : Infinity);

function graficoProjecao(id, fluxo) {
  // Só os últimos 5 anos de dados reais: o histórico completo já está em "Total de ATIs por mês".
  const serie = serieMensal("total");
  const n0 = numMes(indice.meses[0].mes);
  const corte = Math.max(0, numMes(`${Math.floor(fluxo.ultimo / 12) - 5}-01`) - n0);
  const rotulos = serie.rotulos.slice(corte);
  const valores = serie.valores.slice(corte);
  const ultimoIdx = fluxo.ultimo - n0 - corte;
  for (let k = 1; k <= HORIZONTE_MESES; k++) { rotulos.push(fmtMes(refDeNum(fluxo.ultimo + k))); valores.push(null); }
  const projecoes = fluxo.cenarios.map((c) => rotulos.map((_, i) =>
    i < ultimoIdx ? null : Math.round(fluxo.totalAtual * (1 - c.taxa) ** (i - ultimoIdx))));
  // Rótulo só no último ponto (endLabel do ECharts falha com séries que começam em null).
  const comRotulo = (dados) => dados.map((v, i) => (i === dados.length - 1 && !estreito()
    ? { value: v, label: { show: true, position: "right", color: cor("--texto"), formatter: (p) => fmtInt.format(p.value) } }
    : v));
  const referencias = fluxo.turmas.slice(-2);
  const ano = (r) => +r.slice(4);
  const passo = estreito() ? 5 : 2;

  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: cor("--texto-3") } },
      formatter: (ps) => {
        const linhas = ps.filter((p) => p.value != null && !(p.seriesIndex > 0 && p.dataIndex === ultimoIdx))
          .map((p) => `${p.marker}${p.seriesName}: <b>${fmtInt.format(p.value)}</b>`);
        return `${ps[0].name}<br>${linhas.join("<br>") || "sem dados"}`;
      } },
    legend: { bottom: 0, icon: "roundRect", itemWidth: 14, itemHeight: 3, textStyle: { color: cor("--texto-2"), fontSize: 12 } },
    grid: { ...temaBase().grid, right: 48, top: 24, bottom: estreito() ? 84 : 40 },
    xAxis: eixoCategoria(rotulos, {
      boundaryGap: false,
      axisLabel: { color: cor("--texto-2"), interval: (i, r) => r.startsWith("jan/") && ano(r) % passo === 0, formatter: (r) => r.slice(4) },
    }),
    yAxis: eixoValor({ min: 0 }),
    series: [
      {
        name: "Real",
        type: "line",
        data: valores,
        symbol: "none",
        // Histórico em cinza neutro; o destaque fica com as projeções (escala azul).
        lineStyle: { width: 2, color: cor("--real") },
        itemStyle: { color: cor("--real") },
        areaStyle: { color: cor("--real-lavado") },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: cor("--texto-3"), type: "dotted", width: 1 },
          label: { position: "insideStartBottom", color: cor("--texto-2"), fontSize: 11 },
          data: referencias.map((t) => ({ yAxis: t.antes, label: { formatter: `antes da entrada de ${fmtMes(refDeNum(t.ini))}: ${fmtInt.format(t.antes)}` } })),
        },
      },
      ...fluxo.cenarios.map((c, j) => ({
        name: c.nome,
        type: "line",
        data: comRotulo(projecoes[j]),
        symbol: "circle",
        symbolSize: (v, p) => (p.dataIndex === rotulos.length - 1 ? 6 : 0),
        showAllSymbol: true,
        lineStyle: { width: 2, type: "dashed", color: cor(c.cor) },
        itemStyle: { color: cor(c.cor) },
      })),
    ],
  });

  const passoTabela = 12;
  const linhasTabela = [];
  for (let i = ultimoIdx; i < rotulos.length; i += passoTabela) {
    linhasTabela.push([rotulos[i], ...projecoes.map((p) => fmtInt.format(p[i]))]);
  }
  tabela(id, ["Mês", ...fluxo.cenarios.map((c) => c.nome)], linhasTabela);
}

function anoPrevisto(fluxo, meses) {
  if (!Number.isFinite(meses)) return { texto: "nunca", anos: Infinity };
  const ref = refDeNum(fluxo.ultimo + Math.ceil(meses));
  return { texto: ref.slice(0, 4), anos: meses / 12 };
}

// Abaixo disso não há como medir saídas nem turmas (ex.: carreira recém-incluída).
const MESES_MINIMOS_TENDENCIA = 24;

function renderizarTendencia() {
  const fluxo = analisarFluxo();
  const suficiente = indice.meses.length >= MESES_MINIMOS_TENDENCIA && fluxo.turmas.length > 0;
  document.getElementById("s-tendencia").hidden = !suficiente;
  document.querySelector('.barra-nav a[href="#s-tendencia"]').hidden = !suficiente;
  if (!suficiente) return;
  const { cenarios, turmas, intervalos, totalAtual, ultimo } = fluxo;
  const refAtual = fmtMes(refDeNum(ultimo));
  const [recente] = cenarios;

  document.getElementById("m-limiar").textContent = LIMIAR_ENTRADA;
  document.getElementById("tendencia-desc").textContent =
    `Fora dos meses de concurso, o total de ${P} só cai. Hoje a carreira perde cerca de ${fmtPct1.format(anual(recente.taxa))} ao ano ` +
    `(${fmtInt.format(Math.round(totalAtual * anual(recente.taxa)))} ${P} por ano sobre os ${fmtInt.format(totalAtual)} de ${refAtual}). ` +
    "A projeção mostra para onde o total iria se nenhuma turma nova entrasse.";

  graficoProjecao("g-projecao", fluxo);
  document.getElementById("proj-sub").textContent =
    `Linha cheia: total real. Tracejadas: projeção a partir de ${refAtual}, sem novas entradas, com a taxa de saída de cada período. ` +
    "Linhas pontilhadas: total antes das duas últimas entradas de turma.";
  document.getElementById("proj-nota").textContent =
    `Taxas de saída líquida por ano: ${cenarios.map((c) => `${c.nome.toLowerCase()}, ${fmtPct1.format(anual(c.taxa))}`).join("; ")}.`;

  // Retorno ao nível de antes de cada uma das duas últimas turmas.
  const refs = turmas.slice(-2).reverse();
  const tRet = document.getElementById("t-retorno");
  tRet.innerHTML = `<thead><tr><th>Cenário</th>${refs.map((t) =>
    `<th class="num">Voltar a ${fmtInt.format(t.antes)}<small>antes de ${fmtMes(refDeNum(t.ini))}</small></th>`).join("")}</tr></thead>`;
  const corpo = tRet.createTBody();
  for (const c of cenarios) {
    const tr = corpo.insertRow();
    tr.insertCell().innerHTML = `<span class="cenario" style="background:${cor(c.cor)}"></span>${escapar(c.nome)}<small>${fmtPct1.format(anual(c.taxa))} ao ano</small>`;
    for (const t of refs) {
      const p = anoPrevisto(fluxo, mesesAte(totalAtual, t.antes, c.taxa));
      const td = tr.insertCell();
      td.className = "num";
      td.innerHTML = Number.isFinite(p.anos)
        ? `<strong>${p.texto}</strong><small>em ${fmtInt.format(Math.round(p.anos))} ${Math.round(p.anos) === 1 ? "ano" : "anos"}</small>`
        : "nunca";
    }
  }

  const tInt = document.getElementById("t-intervalos");
  tInt.innerHTML = '<thead><tr><th>Turma</th><th class="num">Entraram</th><th class="num">Meses sem entrada</th><th class="num">Saldo perdido</th><th class="num">% da turma</th></tr></thead>';
  const corpoInt = tInt.createTBody();
  for (const it of intervalos) {
    const tr = corpoInt.insertRow();
    // Turma com menos de 6 meses: o saldo ainda mistura nomeações tardias e não diz nada.
    const curto = it.meses < 6;
    const periodo = curto ? "acabou de entrar"
      : `${fmtMes(refDeNum(it.turma.fim + 1))} a ${fmtMes(refDeNum(it.fim))}${it.emAndamento ? " (em andamento)" : ""}`;
    tr.insertCell().innerHTML = `${fmtMes(refDeNum(it.turma.ini))}<small>${periodo}</small>`;
    for (const v of [fmtInt.format(it.turma.entrada), fmtInt.format(it.meses),
      curto ? "–" : fmtInt.format(it.perda), curto ? "–" : fmtPct.format(it.perda / it.turma.entrada)]) {
      const td = tr.insertCell(); td.className = "num"; td.textContent = v;
    }
  }
}

// ---------------------------------------------------------------- orçamento

let orcComReajuste = true;
// R$ em milhões ou bilhões, com uma casa decimal.
const fmtDinheiro = (v) => {
  const f = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v >= 1e9 ? `R$ ${f.format(v / 1e9)} bi` : `R$ ${f.format(v / 1e6)} mi`;
};

function graficoOrcamento(id, proj) {
  const anos = [...proj.historico.map((h) => h.ano), ...proj.anosProj];
  const nHist = proj.historico.length;
  // As projeções partem do último ano real, para a linha encostar na barra.
  const linha = (c) => anos.map((a, i) => (i < nHist - 1 ? null : i === nHist - 1 ? proj.historico[i].valor : c.valores[i - nHist]));
  const cores = ["--cenario-2", "--cenario-1"];
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => `${ps[0].name}${ps[0].dataIndex >= nHist ? " (projeção)" : ""}<br>` + ps
        .filter((p) => p.value != null && !(p.seriesIndex > 0 && p.dataIndex === nHist - 1))
        .map((p) => `${p.marker}${p.seriesName}: <b>${fmtDinheiro(p.value)}</b>`).join("<br>") },
    legend: { bottom: 0, icon: "roundRect", itemWidth: 14, itemHeight: 3, textStyle: { color: cor("--texto-2"), fontSize: 12 } },
    grid: { ...temaBase().grid, right: 16, top: 24, bottom: estreito() ? 60 : 40 },
    xAxis: eixoCategoria(anos.map(String), { axisLabel: { color: cor("--texto-2"), interval: estreito() ? 3 : 1 } }),
    yAxis: eixoValor({ min: 0, axisLabel: { color: cor("--texto-3"), formatter: (v) => (v ? fmtDinheiro(v).replace(",0 ", " ") : "0") } }),
    series: [
      {
        name: "Real",
        type: "bar",
        data: anos.map((a, i) => (i < nHist ? proj.historico[i].valor : null)),
        barMaxWidth: 22,
        itemStyle: { color: cor("--real"), borderRadius: [3, 3, 0, 0] },
      },
      ...proj.cenarios.map((c, j) => ({
        name: c.nome,
        type: "line",
        data: linha(c),
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2, type: "dashed", color: cor(cores[j]) },
        itemStyle: { color: cor(cores[j]) },
      })),
    ],
  });
  tabela(id, ["Ano", "Real", ...proj.cenarios.map((c) => c.nome)], anos.map((a, i) => [String(a),
    i < nHist ? fmtDinheiro(proj.historico[i].valor) : "–",
    ...proj.cenarios.map((c) => (i < nHist ? "–" : fmtDinheiro(c.valores[i - nHist])))]));
}

function renderizarOrcamento() {
  const proj = Orcamento.projetar(indice.meses, { comReajuste: orcComReajuste });
  const secao = document.getElementById("s-orcamento");
  const ok = ORCAMENTO_VISIVEL && proj && proj.historico.length >= 2;
  secao.hidden = !ok;
  document.querySelector('.barra-nav a[href="#s-orcamento"]').hidden = !ok;
  if (!ok) return;
  for (const b of secao.querySelectorAll("[data-reajuste]")) b.setAttribute("aria-pressed", String((b.dataset.reajuste === "sim") === orcComReajuste));

  const refAtual = fmtMes(refDeNum(proj.ultimo));
  const anoFim = proj.anosProj.at(-1);
  const anoIni = Math.floor(proj.ultimo / 12) + 1;
  const [constante, semEntradas] = proj.cenarios;
  const somaDe = (c) => c.valores.reduce((s, v, i) => s + (proj.anosProj[i] >= anoIni ? v : 0), 0);
  const reajuste = proj.reajuste;
  const txtReajuste = reajuste ? `${fmtPct1.format(reajuste.taxa)} ao ano nos últimos ${reajuste.anos} anos` : "sem histórico suficiente";
  const modo = orcComReajuste && reajuste ? `com a remuneração média crescendo ${fmtPct1.format(reajuste.taxa)} ao ano` : "em valores de hoje, com a remuneração média congelada";

  document.getElementById("orc-desc").textContent =
    `Quanto a carreira custa por ano em remuneração básica bruta e quanto pode custar até ${anoFim}. ` +
    `A estimativa combina a tendência do efetivo com o crescimento histórico da remuneração média: ${txtReajuste}.`;
  document.getElementById("orc-atual").textContent = fmtDinheiro(proj.folhaMensalAtual * 13);
  document.getElementById("orc-atual-det").textContent =
    `${fmtDinheiro(proj.folhaMensalAtual)} por mês em ${refAtual}, × 13 (12 meses + 13º)`;
  document.getElementById("orc-fim-rotulo").textContent = `Folha anual em ${anoFim}`;
  document.getElementById("orc-fim").textContent = fmtDinheiro(semEntradas.valores.at(-1));
  document.getElementById("orc-fim-det").textContent =
    `sem novas entradas (~${fmtInt.format(semEntradas.efetivoFinal)} ${P}); repondo as saídas: ${fmtDinheiro(constante.valores.at(-1))}`;
  document.getElementById("orc-soma-rotulo").textContent = `Soma de ${anoIni} a ${anoFim}`;
  document.getElementById("orc-soma").textContent = fmtDinheiro(somaDe(semEntradas));
  document.getElementById("orc-soma-det").textContent =
    `sem novas entradas; repondo as saídas: ${fmtDinheiro(somaDe(constante))}, ${fmtDinheiro(somaDe(constante) - somaDe(semEntradas))} a mais`;

  graficoOrcamento("g-orcamento", proj);
  document.getElementById("orc-sub").textContent =
    `Barras: anos completos com dados reais. Linhas: estimativa ${modo}. ` +
    `${Math.floor(proj.ultimo / 12)} já mistura meses reais (até ${refAtual}) e estimados.`;
  document.getElementById("orc-nota").textContent =
    `Saída líquida usada no cenário sem novas entradas: ${fmtPct1.format(proj.saidaAnual)} do efetivo por ano. ` +
    "Não inclui encargos patronais, terço de férias, auxílios nem inativos: o custo total para o orçamento é maior.";
}

// ---------------------------------------------------------------- render

function renderizar() {
  if (!atual) return;
  const d = atual;
  const rem = d.remuneracao_basica_bruta;
  const pos = indice.meses.findIndex((m) => m.mes === d.referencia);
  const antIdx = pos > 0 ? indice.meses[pos - 1] : null;
  const refAnt = antIdx && fmtMes(antIdx.mes);

  // Visão geral
  document.getElementById("c-total").textContent = fmtInt.format(d.total);
  delta(document.getElementById("c-total-delta"), d.total, antIdx?.total, fmtInt.format, refAnt);
  document.getElementById("c-situacao").textContent = d.por_situacao
    .map((s) => `${fmtInt.format(s.qtd)} ${SITUACOES[s.nome] ?? s.nome.toLowerCase()}`).join(" · ");
  document.getElementById("c-mediana").textContent = fmtReal.format(rem.mediana);
  delta(document.getElementById("c-mediana-delta"), rem.mediana, antIdx?.mediana, (v) => fmtReal.format(v), refAnt, false);
  document.getElementById("c-media").textContent = `média ${fmtReal.format(rem.media)}`;
  document.getElementById("c-faixa").textContent = `${fmtReal.format(rem.p10)} – ${fmtReal.format(rem.p90)}`;
  document.getElementById("c-n").textContent = `80% dos ${fmtInt.format(rem.n)} com remuneração no mês estão nessa faixa`;
  document.getElementById("c-funcao").textContent = fmtInt.format(d.funcao.com_funcao);
  document.getElementById("c-funcao-pct").textContent = `${fmtPct.format(d.funcao.com_funcao / d.total)} do total`;

  const serieTotal = serieMensal("total");
  const serieMediana = serieMensal("mediana");
  sparkline("s-total", serieTotal, "--geral");
  sparkline("s-mediana", serieMediana, "--remuneracao");
  destaques(d, anterior);
  const selecionado = fmtMes(d.referencia);
  linhaHistorica("g-hist-total", serieTotal, "--geral", (v) => fmtInt.format(v), { zero: true, degraus: true, selecionado });
  document.getElementById("hist-total-sub").textContent =
    ["Os números marcam as entradas de turma (soma dos meses seguidos com alta); a linha vertical é o mês selecionado.", lacunas(serieTotal)].join(" ").trim();

  renderizarTendencia();
  renderizarOrcamento();

  // Onde trabalham
  const lot = d.por_orgao_lotacao[0];
  const orgLot = lot && orgao(lot.nome);
  // "Centralizada" só quando quase todos estão lotados no mesmo órgão (a ATPS, por exemplo, não era até 2024).
  const ondeLot = lot && (orgLot.sigla ? `no ${orgLot.sigla}` : `em ${orgLot.curto}`);
  const nExercicio = `${fmtInt.format(d.por_orgao_exercicio.length)} ${d.por_orgao_exercicio.length === 1 ? "órgão" : "órgãos"}`;
  document.getElementById("onde-desc").textContent = !lot ? ""
    : lot.qtd / d.total >= 0.9
      ? `A carreira é centralizada: ${fmtInt.format(lot.qtd)} dos ${fmtInt.format(d.total)} ${P} estão lotados ${ondeLot} e têm exercício em ${nExercicio}.`
      : `Os ${fmtInt.format(d.total)} ${P} estão lotados em ${fmtInt.format(d.por_orgao_lotacao.length)} órgãos (${fmtPct.format(lot.qtd / d.total)} ${ondeLot}) e têm exercício em ${nExercicio}.`;
  mapaOrgaos(d.por_orgao_exercicio);
  barrasHorizontais("g-exercicio", topComOutros(d.por_orgao_exercicio, TOP_ORGAOS).map((o) => {
    const n = coordenadas.has(o.nome) ? orgao(o.nome) : null;
    return { nome: n?.curto ?? o.nome, completo: n ? `${n.completo}${n.sigla ? ` (${n.sigla})` : ""}` : o.nome, qtd: o.qtd };
  }), "--onde");
  barrasHorizontais("g-uf", d.por_uf, "--onde");
  const semUF = d.por_uf.find((u) => u.nome === "Não informado")?.qtd;
  document.getElementById("uf-sub").textContent = semUF ? `Em ${fmtInt.format(semUF)} casos o SIAPE não informa a UF` : "";

  // Carreira
  const classesMes = [...new Set(d.por_classe_padrao.map((c) => c.classe))].sort().map(rotuloClasse);
  const listaClasses = classesMes.length > 1 ? `${classesMes.slice(0, -1).join(", ")} e ${classesMes.at(-1)}` : classesMes[0];
  document.getElementById("carreira-desc").textContent =
    `Em ${fmtMes(d.referencia)}, os ${P} estão ${classesMes.length > 1 ? "nas classes" : "na classe"} ${listaClasses}, cada uma dividida em padrões.` +
    (CFG.ingresso ? ` O ingresso acontece na classe ${rotuloClasse(CFG.ingresso.classe)}, padrão ${CFG.ingresso.padrao}.` : "");
  mapaClassePadrao("g-classe", d.por_classe_padrao);
  barrasHorizontais("g-funcao", d.funcao.por_sigla, "--carreira");
  document.getElementById("funcao-sub").textContent =
    `${fmtInt.format(d.funcao.com_funcao)} ${P} (${fmtPct.format(d.funcao.com_funcao / d.total)}) ocupam função ou cargo comissionado, por tipo`;

  // Remuneração
  histogramaFaixas("g-faixas", rem);
  document.getElementById("hist-sub").textContent = `${fmtInt.format(rem.n)} ${P}; linha na mediana e faixa sombreada entre P10 e P90`;
  linhaHistorica("g-hist-mediana", serieMediana, "--remuneracao", fmtMil, { selecionado });
  document.getElementById("hist-mediana-sub").textContent =
    ["Valores nominais, sem correção pela inflação.", lacunas(serieMediana)].join(" ").trim();

  for (const el of document.querySelectorAll("[data-ref]")) el.textContent = fmtMes(d.referencia);
  document.getElementById("barra-numeros").textContent = `${fmtInt.format(d.total)} ${P} · mediana ${fmtMil(rem.mediana)}`;
  document.getElementById("gerado").textContent = new Date(d.gerado_em).toLocaleDateString("pt-BR");
  document.getElementById("filtro").textContent = d.filtro_cargo;
  document.getElementById("fonte").href = d.fonte.url;
  // Situação da auditoria da carreira e do mês selecionado (auditoria.js).
  Auditoria.painel(document.getElementById("auditoria"), SLUG, d.referencia, fmtMes(d.referencia));
}

// ---------------------------------------------------------------- dados

async function json(caminho) {
  const r = await fetch(BASE_DADOS + caminho, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

const dadosCarreira = (arquivo) => json(`${SLUG}/${arquivo}`);

async function carregarMes(arquivo) {
  const pos = indice.meses.findIndex((m) => m.arquivo === arquivo);
  const arqAnt = pos > 0 ? indice.meses[pos - 1].arquivo : null;
  [atual, anterior] = await Promise.all([dadosCarreira(arquivo), arqAnt ? dadosCarreira(arqAnt) : null]);
  renderizar();
}

function mostrarErro(e) {
  const el = document.getElementById("erro");
  el.textContent = `Não foi possível carregar os dados (${e.message}).`;
  el.hidden = false;
  console.error(e);
}

// Nome, sigla e identidade visual da carreira escolhida.
function aplicarCarreira(carreiras) {
  const c = carreiras[SLUG];
  P = c.plural;
  CFG = c;
  document.title = `Painel ${c.sigla}`;
  document.documentElement.dataset.marca = c.marca;
  for (const el of document.querySelectorAll("[data-sigla]")) el.textContent = c.sigla;
  for (const el of document.querySelectorAll("[data-plural]")) el.textContent = c.plural;
  for (const el of document.querySelectorAll("[data-nome-plural]")) el.textContent = c.nome_plural;
  if (c.cores) {
    const raiz = document.documentElement.style;
    for (const [nome, cor] of Object.entries(c.cores)) raiz.setProperty(`--cor-${nome}`, cor);
  }
  if (c.marca !== "ati") document.getElementById("favicon").href = faviconNeutro(c.cores?.clara ?? "#F4C400");

  const sel = document.getElementById("carreira");
  for (const [slug, cfg] of Object.entries(carreiras)) sel.add(new Option(cfg.sigla, slug));
  sel.value = SLUG;
  sel.addEventListener("change", () => { location.search = `?carreira=${sel.value}`; });
}

async function iniciar() {
  if (typeof echarts === "undefined") throw new Error("biblioteca de gráficos não carregou");
  if (typeof L === "undefined") throw new Error("biblioteca de mapas não carregou");
  const carreiras = await json("carreiras.json");
  if (!carreiras[SLUG]) SLUG = Object.keys(carreiras)[0];
  aplicarCarreira(carreiras);
  [indice] = await Promise.all([dadosCarreira("index.json"), carregarCoordenadas(), Auditoria.carregar()]);
  // Os seletores existem no cabeçalho e na barra fixa; ficam sempre sincronizados.
  const selAnos = [...document.querySelectorAll('select[data-campo="ano"]')];
  const selMeses = [...document.querySelectorAll('select[data-campo="mes"]')];
  const anos = [...new Set(indice.meses.map((m) => m.mes.slice(0, 4)))].reverse();
  for (const s of selAnos) for (const a of anos) s.add(new Option(a, a));

  // Mês: só os processados do ano escolhido. Ao trocar o ano, mantém o mês se existir; senão, o mais recente.
  const selecionar = (ano, manterMes) => {
    const doAno = indice.meses.filter((m) => m.mes.startsWith(ano));
    const escolhido = doAno.find((m) => m.mes.slice(5) === manterMes) ?? doAno.at(-1);
    for (const s of selAnos) s.value = ano;
    for (const s of selMeses) {
      s.replaceChildren(...doAno.map((m) => new Option(MESES_EXTENSO[+m.mes.slice(5) - 1], m.arquivo)));
      s.value = escolhido.arquivo;
    }
    return escolhido.arquivo;
  };
  const mesSelecionado = () => indice.meses.find((m) => m.arquivo === selMeses[0].value)?.mes.slice(5);

  for (const s of selAnos) {
    s.addEventListener("change", () => carregarMes(selecionar(s.value, mesSelecionado())).catch(mostrarErro));
  }
  for (const s of selMeses) {
    s.addEventListener("change", () => {
      for (const outro of selMeses) outro.value = s.value;
      carregarMes(s.value).catch(mostrarErro);
    });
  }
  await carregarMes(selecionar(anos[0], null));
  // Link direto para uma seção (#s-onde etc.): o navegador rolou antes dos gráficos existirem.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant" });
}

// ---------------------------------------------------------------- barra fixa

// Aparece quando o cabeçalho sai da tela; destaca a seção que está no meio da tela.
function iniciarBarra() {
  const barra = document.getElementById("barra");
  new IntersectionObserver(([e]) => {
    barra.classList.toggle("visivel", !e.isIntersecting);
    barra.inert = e.isIntersecting;
  }).observe(document.querySelector(".topo"));

  const links = new Map([...barra.querySelectorAll(".barra-nav a")].map((a) => [a.getAttribute("href").slice(1), a]));
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      for (const [id, a] of links) a.toggleAttribute("aria-current", id === e.target.id);
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  for (const id of links.keys()) observador.observe(document.getElementById(id));
}

document.getElementById("tema").addEventListener("click", () => {
  const raiz = document.documentElement;
  raiz.dataset.theme = temaEscuro() ? "light" : "dark";
  try { localStorage.setItem("tema", raiz.dataset.theme); } catch (e) {}
  renderizar();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderizar);

for (const b of document.querySelectorAll("[data-reajuste]")) {
  b.addEventListener("click", () => { orcComReajuste = b.dataset.reajuste === "sim"; renderizarOrcamento(); });
}

let espera;
window.addEventListener("resize", () => {
  clearTimeout(espera);
  espera = setTimeout(() => { Object.values(graficos).forEach((g) => g.resize()); mapa?.invalidateSize(); renderizar(); }, 150);
});

iniciarBarra();
iniciar().catch(mostrarErro);
