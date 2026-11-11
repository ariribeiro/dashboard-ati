"use strict";

// Linha de auditoria no rodapé, usada por index.html e painel.html.
// Lê data/auditoria.json, gravado por scripts/auditar.py (resumo dos registros em auditoria/).
const Auditoria = (() => {
  let resumo = null;
  const dia = (iso) => new Date(iso).toLocaleDateString("pt-BR");
  const urlRegistro = (id) => `${resumo.repositorio}/blob/main/auditoria/registros/${id}.json`;
  const link = (texto, url) => {
    const a = document.createElement("a");
    a.textContent = texto; a.href = url; a.target = "_blank"; a.rel = "noopener";
    return a;
  };

  // Sem o arquivo (ou com erro de leitura), a linha simplesmente não aparece.
  async function carregar() {
    try {
      const r = await fetch("data/auditoria.json", { cache: "no-cache" });
      resumo = r.ok ? await r.json() : null;
    } catch (e) { resumo = null; }
    return resumo;
  }

  function escrever(el, partes) {
    if (!resumo || !partes.length) { el.hidden = true; return; }
    el.replaceChildren("Auditoria: ");
    partes.forEach((p, i) => { if (i) el.append(" "); el.append(...p); });
    const pagina = link("Ver auditorias", "auditoria.html");
    pagina.removeAttribute("target"); pagina.removeAttribute("rel");
    el.append(" ", pagina, ".");
    el.hidden = false;
  }

  // Painel de uma carreira: coerência da carreira e recontagem do mês selecionado (AAAA-MM).
  function painel(el, slug, referencia, rotuloMes) {
    if (!resumo) { el.hidden = true; return; }
    const partes = [];
    const c = resumo.coerencia?.[slug];
    if (c) {
      partes.push([`coerência interna dos dados conferida em ${dia(c.data)}, `,
        link(c.resultado === "ok" ? "sem divergências" : "com divergências", urlRegistro(c.registro)), "."]);
    }
    const r = resumo.recontagem?.[slug]?.[referencia.replace("-", "")];
    partes.push(r
      ? [`${partes.length ? "Os" : "os"} dados de ${rotuloMes} foram recontados a partir do arquivo do portal em ${dia(r.data)}, `,
        link(r.resultado === "ok" ? "sem divergências" : "com divergências", urlRegistro(r.registro)), "."]
      : [`${partes.length ? "Os" : "os"} dados de ${rotuloMes} ainda não foram recontados a partir do arquivo do portal.`]);
    escrever(el, partes);
  }

  // Página inicial: situação de todas as carreiras de carreiras.json ({ slug: { sigla } }).
  function geral(el, carreiras) {
    if (!resumo) { el.hidden = true; return; }
    const slugs = Object.keys(carreiras);
    const siglas = (lista) => lista.map((s) => carreiras[s].sigla).join(", ");
    const partes = [];

    const conferidas = slugs.filter((s) => resumo.coerencia?.[s]);
    if (conferidas.length) {
      const ruins = conferidas.filter((s) => resumo.coerencia[s].resultado !== "ok");
      const faltam = slugs.filter((s) => !resumo.coerencia?.[s]);
      // A data mais antiga entre as carreiras: todas foram conferidas pelo menos até ela.
      const desde = conferidas.map((s) => resumo.coerencia[s].data).sort()[0];
      partes.push([`coerência interna dos dados conferida em ${dia(desde)}, ` +
        (ruins.length ? `com divergências em ${siglas(ruins)}` : "sem divergências") +
        (faltam.length ? ` (ainda não conferidas: ${siglas(faltam)})` : "") + "."]);
    }

    const recontadas = slugs.filter((s) => Object.keys(resumo.recontagem?.[s] ?? {}).length);
    if (recontadas.length) {
      const itens = recontadas.map((s) => {
        const meses = Object.values(resumo.recontagem[s]);
        const ruins = meses.filter((m) => m.resultado !== "ok").length;
        return `${carreiras[s].sigla} ${meses.length} ${meses.length === 1 ? "mês" : "meses"}` + (ruins ? ` (${ruins} com divergências)` : "");
      });
      const algumRuim = recontadas.some((s) => Object.values(resumo.recontagem[s]).some((m) => m.resultado !== "ok"));
      partes.push([`${partes.length ? "Recontagem" : "recontagem"} a partir do arquivo do portal: ${itens.join(", ")}` +
        (algumRuim ? "." : ", sem divergências.")]);
    } else if (partes.length) {
      partes.push(["Nenhum mês foi recontado a partir do arquivo do portal ainda."]);
    }
    escrever(el, partes);
  }

  return { carregar, painel, geral };
})();
