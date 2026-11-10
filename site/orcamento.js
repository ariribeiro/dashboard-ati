"use strict";

// Modelo compartilhado por painel.html (seções Tendência e Orçamento) e index.html (comparação entre carreiras).
// Entrada: `meses` de data/<carreira>/index.json ({ mes, total, n, media }).

// Alta mensal a partir da qual o mês conta como entrada de turma.
const LIMIAR_ENTRADA = 10;
const numMes = (ref) => { const [a, m] = ref.split("-").map(Number); return a * 12 + m - 1; };
const refDeNum = (n) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
const anual = (r) => 1 - (1 - r) ** 12;

// Variações entre meses consecutivos ({ n, base, total, dif }); meses com lacuna antes ficam de fora.
function paresMensais(meses) {
  const pares = [];
  for (let i = 1; i < meses.length; i++) {
    const n = numMes(meses[i].mes);
    if (n - numMes(meses[i - 1].mes) !== 1) continue;
    pares.push({ n, base: meses[i - 1].total, total: meses[i].total, dif: meses[i].total - meses[i - 1].total });
  }
  return pares;
}

// Taxa mensal de saída líquida: perda somada ÷ estoque exposto somado.
function taxaSaida(pares) {
  const base = pares.reduce((s, p) => s + p.base, 0);
  return base ? Math.max(0, pares.reduce((s, p) => s - p.dif, 0) / base) : 0;
}

const Orcamento = (() => {
  const JANELA_SAIDA = 60; // meses usados na taxa de saída do cenário "sem novas entradas"
  const ANOS_REAJUSTE = 10; // anos usados no crescimento da remuneração média
  const MIN_ANOS_REAJUSTE = 3;
  const HORIZONTE_ANOS = 10;

  // Folha mensal de remuneração básica bruta: servidores com valor no mês × média.
  const folha = (m) => m.n * m.media;

  // Série mensal contínua da folha, com lacunas preenchidas por interpolação linear.
  function folhaMensal(meses) {
    const pontos = meses.filter((m) => m.n != null && m.media != null).map((m) => ({ n: numMes(m.mes), v: folha(m) }));
    const serie = new Map();
    pontos.forEach((p, i) => {
      serie.set(p.n, p.v);
      const prox = pontos[i + 1];
      if (prox) for (let k = p.n + 1; k < prox.n; k++) serie.set(k, p.v + (prox.v - p.v) * (k - p.n) / (prox.n - p.n));
    });
    return serie;
  }

  // Crescimento anual da remuneração média (reajustes + progressões − efeito de novatos):
  // média dos últimos 12 meses contra a média de 12 meses `anos` antes.
  function reajusteAnual(meses) {
    const porMes = new Map(meses.filter((m) => m.media != null).map((m) => [numMes(m.mes), m.media]));
    const ultimo = numMes(meses.at(-1).mes);
    const mediaJanela = (fim) => {
      const v = []; for (let k = fim - 11; k <= fim; k++) if (porMes.has(k)) v.push(porMes.get(k));
      return v.length >= 6 ? v.reduce((s, x) => s + x, 0) / v.length : null;
    };
    for (let anos = ANOS_REAJUSTE; anos >= MIN_ANOS_REAJUSTE; anos--) {
      const antes = mediaJanela(ultimo - 12 * anos);
      const agora = mediaJanela(ultimo);
      if (antes && agora) return { taxa: (agora / antes) ** (1 / anos) - 1, anos };
    }
    return null;
  }

  // Valor anual: soma dos 12 meses mais o 13º (igual à folha de dezembro).
  const somaAnual = (mensal, ano) => {
    let s = 0;
    for (let k = ano * 12; k < ano * 12 + 12; k++) s += mensal(k);
    return s + mensal(ano * 12 + 11);
  };

  // Projeção anual da folha. Cenários de efetivo: sem novas entradas (taxa de saída recente) e
  // repondo as saídas (efetivo constante). `comReajuste`: remuneração média cresce no ritmo histórico.
  function projetar(meses, { comReajuste = true, horizonte = HORIZONTE_ANOS } = {}) {
    if (!meses.length || meses.at(-1).n == null) return null;
    const ultimoM = meses.at(-1);
    const ultimo = numMes(ultimoM.mes);
    const pares = paresMensais(meses).filter((p) => p.dif < LIMIAR_ENTRADA && p.n > ultimo - JANELA_SAIDA);
    const saida = taxaSaida(pares);
    const reajuste = reajusteAnual(meses);
    const g = comReajuste && reajuste ? reajuste.taxa : 0;
    const real = folhaMensal(meses);
    const primeiro = Math.min(...real.keys());

    const mensal = (fatorEfetivo) => (k) => (k <= ultimo
      ? real.get(k) ?? 0
      : ultimoM.n * fatorEfetivo(k - ultimo) * ultimoM.media * (1 + g) ** ((k - ultimo) / 12));
    const cenarios = [
      { id: "constante", nome: "Repondo as saídas", fator: () => 1 },
      { id: "sem-entradas", nome: "Sem novas entradas", fator: (k) => (1 - saida) ** k },
    ];

    // Anos completos com dados reais; o ano corrente (parcial) já entra como projeção.
    const anoUltimo = Math.floor(ultimo / 12);
    const anoReal0 = Math.ceil(primeiro / 12);
    const anoReal1 = ultimo % 12 === 11 ? anoUltimo : anoUltimo - 1;
    const historico = [];
    for (let a = anoReal0; a <= anoReal1; a++) historico.push({ ano: a, valor: somaAnual((k) => real.get(k) ?? 0, a) });
    const anosProj = [];
    for (let a = anoReal1 + 1; a <= anoUltimo + horizonte; a++) anosProj.push(a);

    return {
      ultimo,
      saidaAnual: anual(saida),
      reajuste,
      reajusteAplicado: g,
      folhaMensalAtual: folha(ultimoM),
      efetivoAtual: ultimoM.total,
      historico,
      anosProj,
      cenarios: cenarios.map((c) => ({
        id: c.id,
        nome: c.nome,
        valores: anosProj.map((a) => somaAnual(mensal(c.fator), a)),
        efetivoFinal: Math.round(ultimoM.total * c.fator((anoUltimo + horizonte) * 12 + 11 - ultimo)),
      })),
    };
  }

  return { projetar, HORIZONTE_ANOS };
})();
