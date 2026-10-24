"use strict";

const BASE_DADOS = "data/";
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
function barrasHorizontais(id, itens, corVar, rotulo = "ATIs") {
  const larguraRotulo = estreito() ? 120 : 200;
  const ordenados = [...itens].reverse();
  // Altura proporcional ao número de barras, para listas curtas não sobrarem vazias.
  document.getElementById(id).style.height = `${Math.max(120, itens.length * 30 + 48)}px`;
  graficos[id]?.resize();
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "item",
      formatter: (p) => `${ordenados[p.dataIndex].completo ?? p.name}<br><b>${fmtInt.format(p.value)}</b> ${rotulo}` },
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

function linhaHistorica(id, serie, corVar, formatar) {
  const { rotulos, valores } = serie;
  grafico(id, {
    tooltip: { ...temaBase().tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: cor("--texto-3") } },
      formatter: (ps) => `${ps[0].name}<br><b>${ps[0].value == null ? "sem dados" : formatar(ps[0].value)}</b>` },
    grid: { ...temaBase().grid, right: 72 },
    xAxis: eixoCategoria(rotulos, { boundaryGap: false }),
    yAxis: eixoValor({ scale: true, axisLabel: { color: cor("--texto-3"), formatter: (v) => formatar(v) } }),
    series: [{
      type: "line",
      data: valores,
      connectNulls: false,
      symbol: "circle",
      // Só mostra marcador em mês isolado (entre lacunas), que de outro modo sumiria.
      symbolSize: (v, p) => (isolado(valores, p.dataIndex) || rotulos.length === 1 ? 8 : 0),
      lineStyle: { width: 2, color: cor(corVar), cap: "round", join: "round" },
      itemStyle: { color: cor(corVar), borderColor: cor("--superficie"), borderWidth: 2 },
      areaStyle: { color: cor(corVar + "-lavado") },
      endLabel: { show: true, color: cor("--texto"), formatter: (p) => formatar(p.value) },
      emphasis: { focus: "none" },
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
    tooltip: { ...temaBase().tooltip, trigger: "item", formatter: (p) => `${nomes[p.dataIndex]}<br><b>${fmtInt.format(p.value)}</b> ATIs` },
    xAxis: [
      eixoCategoria(curtos, { name: "R$ mil", nameLocation: "middle", nameTextStyle: { color: cor("--texto-3") },
        nameGap: estreito() ? 52 : 28,
        axisLabel: { color: cor("--texto-2"), interval: 0, fontSize: 11, rotate: estreito() ? 45 : 0 } }),
      { type: "value", min: 0, max: faixas.length, show: false },
    ],
    yAxis: eixoValor(),
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
  tabela(id, ["Faixa", "ATIs"], nomes.map((n, i) => [n, fmtInt.format(faixas[i].qtd)]));
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
      formatter: (p) => `Classe ${classes[p.value[1]]}, padrão ${padroes[p.value[0]]}<br><b>${fmtInt.format(p.value[2])}</b> ATIs` },
    grid: { ...temaBase().grid, right: 8, bottom: 24 },
    xAxis: eixoCategoria(padroes, { name: "Padrão", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: cor("--texto-3") } }),
    yAxis: [
      eixoCategoria(classes, { name: "Classe", nameTextStyle: { color: cor("--texto-3") }, inverse: true, axisLine: { show: false } }),
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
const DF = L.latLngBounds([-16.06, -48.29], [-15.49, -47.30]);

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
        if (vista && limites[vista]) mapa.fitBounds(limites[vista], { padding: [24, 24] });
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
      div.innerHTML = "ATIs por local<div class='itens'>" + exemplos.map((v) => {
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

  const max = Math.max(...[...locais.values()].map((l) => l.qtd));
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
    L.marker([l.lat, l.lon], { icon: iconeBolha(l.qtd, max), qtd: l.qtd, title: `${l.local}: ${l.qtd} ATIs`, riseOnHover: true })
      .bindPopup(`<strong>${escapar(l.local)}</strong><table>${linhas}</table>` +
        (l.orgaos.length > 1 ? `<p class="popup-total">${fmtInt.format(l.qtd)} ATIs no prédio</p>` : "") + aviso)
      .addTo(camadaBolhas);
  }
  camadaBolhas.addTo(mapa);
  atualizarLegenda(max);

  const pontos = [...locais.values()].map((l) => [l.lat, l.lon]);
  limites.brasil = L.latLngBounds(pontos);
  limites.brasilia = L.latLngBounds(pontos.filter((p) => DF.contains(p)));
  if (!mapa._vistaInicial) {
    mapa.fitBounds(limites.brasilia.isValid() ? limites.brasilia : limites.brasil, { padding: [24, 24] });
    mapa._vistaInicial = true;
  }

  const fora = [...locais.values()].filter((l) => !DF.contains([l.lat, l.lon])).reduce((s, l) => s + l.qtd, 0);
  const partes = [];
  if (fora) partes.push(`${fmtInt.format(fora)} ATIs em órgãos com sede fora do DF: use o botão “Brasil” para vê-los.`);
  if (semLocal) partes.push(`${fmtInt.format(semLocal)} sem localização: ${semLocalNomes.join(", ")}.`);
  partes.push("A posição é a da sede do órgão; o servidor pode trabalhar em um anexo ou unidade regional.");
  document.getElementById("mapa-nota").textContent = partes.join(" ");

  tabela("mapa-orgaos", ["Local", "Órgãos", "ATIs"], [...locais.values()].sort((a, b) => b.qtd - a.qtd)
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

const inicioCarreira = (d) => d.por_classe_padrao.find((c) => c.classe === "A" && c.padrao === "I")?.qtd ?? 0;

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
      itens.push(["geral", `<strong>${fmtInt.format(dif)} ATIs a mais</strong> que em ${refAnt}${recorde}.`]);
    } else if (dif < 0) {
      itens.push(["geral", `<strong>${fmtInt.format(-dif)} ATIs a menos</strong> que em ${refAnt}.`]);
    } else {
      itens.push(["geral", `Total estável em relação a ${refAnt}: <strong>${fmtInt.format(d.total)} ATIs</strong>.`]);
    }
  }

  const ai = inicioCarreira(d);
  const aiAnt = ant ? inicioCarreira(ant) : null;
  itens.push(["carreira", `<strong>${fmtInt.format(ai)} ATIs (${fmtPct.format(ai / d.total)})</strong> estão no início da carreira, classe A, padrão I` +
    (aiAnt !== null && aiAnt !== ai ? ` (eram ${fmtInt.format(aiAnt)} em ${refAnt}).` : ".")]);

  const med = d.remuneracao_basica_bruta.mediana;
  const medAnt = ant?.remuneracao_basica_bruta.mediana;
  if (medAnt && Math.abs(med - medAnt) >= 100) {
    const verbo = med < medAnt ? "caiu" : "subiu";
    const contexto = med < medAnt && aiAnt !== null && ai > aiAnt
      ? ", no mesmo período em que cresceu o número de ATIs no início da carreira" : "";
    itens.push(["remuneracao", `A mediana da remuneração básica bruta ${verbo} de <strong>${fmtMil(medAnt)}</strong> para <strong>${fmtMil(med)}</strong>${contexto}.`]);
  } else {
    itens.push(["remuneracao", `Metade dos ATIs recebe até <strong>${fmtMil(med)}</strong> de remuneração básica bruta.`]);
  }

  const [maior, ...demais] = d.por_orgao_exercicio;
  if (maior) {
    const o = orgao(maior.nome);
    itens.push(["onde", `<strong>${fmtPct.format(maior.qtd / d.total)}</strong> têm exercício ${o.sigla ? `no ${o.sigla}` : `em ${o.curto}`}; os demais estão em <strong>${fmtInt.format(demais.length)} outros órgãos</strong>.`]);
  }

  document.getElementById("destaques").innerHTML =
    itens.map(([tema, html]) => `<li data-tema="${tema}">${html}</li>`).join("");
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
  linhaHistorica("g-hist-total", serieTotal, "--geral", (v) => fmtInt.format(v));
  document.getElementById("hist-total-sub").textContent = lacunas(serieTotal);

  // Onde trabalham
  const lot = d.por_orgao_lotacao[0];
  const orgLot = lot && orgao(lot.nome);
  document.getElementById("onde-desc").textContent = lot
    ? `A carreira é centralizada: ${fmtInt.format(lot.qtd)} dos ${fmtInt.format(d.total)} ATIs estão lotados ${orgLot.sigla ? `no ${orgLot.sigla}` : `em ${orgLot.curto}`} e têm exercício em ${fmtInt.format(d.por_orgao_exercicio.length)} órgãos.`
    : "";
  mapaOrgaos(d.por_orgao_exercicio);
  barrasHorizontais("g-exercicio", topComOutros(d.por_orgao_exercicio, TOP_ORGAOS).map((o) => {
    const n = coordenadas.has(o.nome) ? orgao(o.nome) : null;
    return { nome: n?.curto ?? o.nome, completo: n ? `${n.completo}${n.sigla ? ` (${n.sigla})` : ""}` : o.nome, qtd: o.qtd };
  }), "--onde");
  barrasHorizontais("g-uf", d.por_uf, "--onde");
  const semUF = d.por_uf.find((u) => u.nome === "Não informado")?.qtd;
  document.getElementById("uf-sub").textContent = semUF ? `Em ${fmtInt.format(semUF)} casos o SIAPE não informa a UF` : "";

  // Carreira
  mapaClassePadrao("g-classe", d.por_classe_padrao);
  barrasHorizontais("g-funcao", d.funcao.por_sigla, "--carreira");
  document.getElementById("funcao-sub").textContent =
    `${fmtInt.format(d.funcao.com_funcao)} ATIs (${fmtPct.format(d.funcao.com_funcao / d.total)}) ocupam função ou cargo comissionado, por tipo`;

  // Remuneração
  histogramaFaixas("g-faixas", rem);
  document.getElementById("hist-sub").textContent = `${fmtInt.format(rem.n)} ATIs; linha na mediana e faixa sombreada entre P10 e P90`;
  linhaHistorica("g-hist-mediana", serieMediana, "--remuneracao", fmtMil);
  document.getElementById("hist-mediana-sub").textContent = lacunas(serieMediana);

  for (const id of ["ref", "ref-topo"]) document.getElementById(id).textContent = fmtMes(d.referencia);
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
  const pos = indice.meses.findIndex((m) => m.arquivo === arquivo);
  const arqAnt = pos > 0 ? indice.meses[pos - 1].arquivo : null;
  [atual, anterior] = await Promise.all([json(arquivo), arqAnt ? json(arqAnt) : null]);
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
  if (typeof L === "undefined") throw new Error("biblioteca de mapas não carregou");
  [indice] = await Promise.all([json("index.json"), carregarCoordenadas()]);
  const selAno = document.getElementById("ano");
  const selMes = document.getElementById("mes");
  const anos = [...new Set(indice.meses.map((m) => m.mes.slice(0, 4)))].reverse();
  for (const a of anos) selAno.add(new Option(a, a));

  // Mês: só os processados do ano escolhido. Ao trocar o ano, mantém o mês se existir; senão, o mais recente.
  const preencherMeses = (manter) => {
    const doAno = indice.meses.filter((m) => m.mes.startsWith(selAno.value));
    selMes.replaceChildren(...doAno.map((m) => new Option(MESES_EXTENSO[+m.mes.slice(5) - 1], m.arquivo)));
    const mesmo = doAno.find((m) => m.mes.slice(5) === manter);
    selMes.value = (mesmo ?? doAno.at(-1)).arquivo;
  };
  const mesAtual = () => indice.meses.find((m) => m.arquivo === selMes.value)?.mes.slice(5);

  selAno.addEventListener("change", () => { preencherMeses(mesAtual()); carregarMes(selMes.value).catch(mostrarErro); });
  selMes.addEventListener("change", () => carregarMes(selMes.value).catch(mostrarErro));
  preencherMeses(null);
  await carregarMes(selMes.value);
}

document.getElementById("tema").addEventListener("click", () => {
  const raiz = document.documentElement;
  raiz.dataset.theme = temaEscuro() ? "light" : "dark";
  try { localStorage.setItem("tema", raiz.dataset.theme); } catch (e) {}
  renderizar();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderizar);

let espera;
window.addEventListener("resize", () => {
  clearTimeout(espera);
  espera = setTimeout(() => { Object.values(graficos).forEach((g) => g.resize()); mapa?.invalidateSize(); renderizar(); }, 150);
});

iniciar().catch(mostrarErro);
