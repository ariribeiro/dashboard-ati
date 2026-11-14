#!/usr/bin/env python3
"""Pipeline de economicidade da carreira de ATI (só ATI).

Hipótese: investir na carreira de ATI gera economicidade. O ATI não substitui a
terceirização (fiscalizar e gerir contratos é função de Estado); o que se testa é se
órgãos com mais ATI para o volume de contratos de TIC que gerem perdem menos dinheiro:
menos acréscimos de valor nos contratos e preços menos acima da mediana do mesmo item.

Fluxo:
  coletar  -> contratos (Compras.gov.br), itens (Compras.gov.br) e termos aditivos (PNCP)
              dos órgãos de data/ati/economicidade_orgaos.csv; guarda respostas em .cache/
  analisar -> painel órgão x ano, regressão com efeito fixo de órgão e de ano,
              economia histórica, projeção e data/ati/economicidade.json
  tudo     -> os dois passos

Só agregados por órgão são publicados. Veja a seção "Economicidade" do README e o texto
do painel para as limitações.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

RAIZ = Path(__file__).resolve().parent.parent
DIR_ATI = RAIZ / "data" / "ati"
ARQ_ORGAOS = DIR_ATI / "economicidade_orgaos.csv"
ARQ_PREMISSAS = DIR_ATI / "economicidade_premissas.json"
ARQ_SAIDA = DIR_ATI / "economicidade.json"
DIR_CACHE = RAIZ / ".cache" / "economicidade"

API_COMPRAS = "https://dadosabertos.compras.gov.br"
API_PNCP = "https://pncp.gov.br/api/pncp/v1"
USER_AGENT = "Mozilla/5.0 (dashboard-carreiras; +https://github.com/ariribeiro/dashboard-carreiras)"

ANO_INI = 2021  # Lei 14.133 e PNCP: a partir daqui os termos aditivos estão publicados
PAUSA = 0.12  # s entre chamadas
TAMANHO_PAGINA = 500

DIRETA = {"Dispensa", "Inexigibilidade"}
# Objeto de contrato que é TIC mesmo quando a categoria do Compras diz "Serviços" ou "Mão de Obra".
RE_TIC = re.compile(
    r"TECNOLOGIA DA INFORMA|SOFTWARE|SISTEMAS? DE INFORMA|NUVEM|CLOUD|DATA ?CENTER|FIREWALL|"
    r"LICEN[CÇ]AS? DE USO|HARDWARE|LINKS? DE (INTERNET|DADOS)|\bTIC\b|SERVI[CÇ]OS? DE INTERNET|"
    r"DESENVOLVIMENTO DE SISTEMAS|F[AÁ]BRICA DE SOFTWARE|SUPORTE T[EÉ]CNICO.*(SERVIDOR|REDE|USU[AÁ]RIO)|"
    r"SERVIDORES? DE (REDE|DADOS|APLICA)|BANCO DE DADOS|SEGURAN[CÇ]A DA INFORMA|CIBERNETIC|"
    r"MICROSOFT|ORACLE|VMWARE|ANTIV[IÍ]RUS|NOTEBOOKS?|MICROCOMPUTADOR|IMPRESS[AÃ]O.*(OUTSOURCING|CORPORATIV)",
    re.I,
)


# ---------------------------------------------------------------- utilidades

def norm(t: str) -> str:
    t = unicodedata.normalize("NFD", t or "")
    return "".join(c for c in t if not unicodedata.combining(c)).upper()


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def sessao() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
    return s


def get_json(s: requests.Session, url: str, params: dict | None = None, tentativas: int = 5):
    """GET com repetição em 429/5xx. Devolve None em 404 (recurso inexistente)."""
    for t in range(tentativas):
        try:
            r = s.get(url, params=params, timeout=90)
        except requests.RequestException as e:
            if t == tentativas - 1:
                raise
            time.sleep(3 * (t + 1))
            continue
        if r.status_code == 404:
            return None
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(5 * (t + 1))
            continue
        r.raise_for_status()
        time.sleep(PAUSA)
        # 204 ou corpo vazio: o PNCP responde assim a contratos sem termos.
        return r.json() if r.content.strip() else None
    raise RuntimeError(f"Falha após {tentativas} tentativas: {url}")


def cache_json(caminho: Path, produzir, forcar: bool = False):
    if caminho.exists() and not forcar:
        return json.loads(caminho.read_text(encoding="utf-8"))
    dados = produzir()
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    return dados


def paginar(s: requests.Session, url: str, params: dict) -> list[dict]:
    saida, pagina = [], 1
    while True:
        d = get_json(s, url, {**params, "pagina": pagina, "tamanhoPagina": TAMANHO_PAGINA})
        if not d:
            break
        saida += d.get("resultado", [])
        if not d.get("paginasRestantes"):
            break
        pagina += 1
    return saida


# ---------------------------------------------------------------- órgãos e efetivo de ATI

def carregar_orgaos() -> list[dict]:
    with ARQ_ORGAOS.open(encoding="utf-8") as f:
        linhas = list(csv.DictReader(f, delimiter=";"))
    return [{**l, "codigo": int(l["codigo_compras"])} for l in linhas if l["uso"] == "painel" and l["codigo_compras"]]


def atis_por_orgao_ano(orgaos: list[dict], anos: list[int]) -> dict[tuple[int, int], float]:
    """ATIs em exercício em cada órgão: média dos meses do ano, a partir de data/ati/AAAAMM.json."""
    por_nome = defaultdict(list)
    for o in orgaos:
        por_nome[o["orgao_siape"]].append(o["codigo"])
    soma: dict[tuple[int, int], float] = defaultdict(float)
    meses: dict[int, int] = defaultdict(int)
    for arq in sorted(DIR_ATI.glob("[0-9]" * 6 + ".json")):
        d = json.loads(arq.read_text(encoding="utf-8"))
        ano = int(d["referencia"][:4])
        if ano not in anos:
            continue
        meses[ano] += 1
        for r in d["por_orgao_exercicio"]:
            for cod in por_nome.get(r["nome"], []):
                soma[(cod, ano)] += r["qtd"]
    return {k: v / meses[k[1]] for k, v in soma.items()}


# ---------------------------------------------------------------- coleta

def eh_tic(c: dict) -> bool:
    if c.get("nomeCategoria") == "Informática (TIC)":
        return True
    return bool(RE_TIC.search(norm(c.get("objeto") or "")))


def coletar_contratos(s, codigo: int, ano: int, forcar: bool) -> list[dict]:
    def produzir():
        brutos = paginar(s, f"{API_COMPRAS}/modulo-contratos/1_consultarContratos", {
            "codigoOrgao": codigo,
            "dataVigenciaInicialMin": f"{ano}-01-01", "dataVigenciaInicialMax": f"{ano}-12-31",
        })
        campos = ("codigoUnidadeGestora", "numeroContrato", "codigoTipo", "nomeCategoria", "nomeModalidadeCompra",
                  "niFornecedor", "objeto", "dataVigenciaInicial", "dataVigenciaFinal", "valorGlobal",
                  "numeroControlePncpContrato", "contratoExcluido")
        return [{k: b.get(k) for k in campos} for b in brutos if not b.get("contratoExcluido")]
    return cache_json(DIR_CACHE / "contratos" / f"{codigo}_{ano}.json", produzir, forcar)


def coletar_itens(s, codigo: int, ano: int, forcar: bool) -> list[dict]:
    def produzir():
        brutos = paginar(s, f"{API_COMPRAS}/modulo-contratos/2_consultarContratosItem", {
            "codigoOrgao": codigo,
            "dataVigenciaInicialMin": f"{ano}-01-01", "dataVigenciaInicialMax": f"{ano}-12-31",
        })
        campos = ("codigoUnidadeGestora", "numeroContrato", "tipoItem", "codigoItem", "quantidadeItem",
                  "valorUnitarioItem", "valorTotalItem", "contratoItemExcluido", "contratoExcluido")
        return [{k: b.get(k) for k in campos} for b in brutos if not (b.get("contratoItemExcluido") or b.get("contratoExcluido"))]
    return cache_json(DIR_CACHE / "itens" / f"{codigo}_{ano}.json", produzir, forcar)


def chave_pncp(ctrl: str | None) -> tuple[str, int, int] | None:
    """'26664015000148-2-000005/2024' -> (cnpj, ano, sequencial)."""
    m = re.fullmatch(r"(\d{14})-2-(\d+)/(\d{4})", ctrl or "")
    return (m.group(1), int(m.group(3)), int(m.group(2))) if m else None


def coletar_termos(s, ctrl: str, forcar: bool) -> list[dict] | None:
    k = chave_pncp(ctrl)
    if not k:
        return None
    cnpj, ano, seq = k

    def produzir():
        d = get_json(s, f"{API_PNCP}/orgaos/{cnpj}/contratos/{ano}/{seq}/termos") or []
        campos = ("sequencialTermoContrato", "tipoTermoContratoNome", "valorGlobal", "valorAcrescido",
                  "qualificacaoAcrescimoSupressao", "qualificacaoVigencia", "qualificacaoReajuste", "prazoAditadoDias")
        return [{c: t.get(c) for c in campos} for t in d]
    return cache_json(DIR_CACHE / "termos" / f"{cnpj}_{ano}_{seq}.json", produzir, forcar)


TRABALHADORES = 6  # consultas simultâneas ao PNCP; poucas, para não sobrecarregar a API pública


def coletar(orgaos: list[dict], anos: list[int], forcar: bool = False) -> None:
    s = sessao()
    for o in orgaos:
        for ano in anos:
            contratos = coletar_contratos(s, o["codigo"], ano, forcar)
            coletar_itens(s, o["codigo"], ano, forcar)
            tic = [c for c in contratos if c["codigoTipo"] == "50" and eh_tic(c)]
            # Uma sessão por consulta: requests.Session não é garantida entre threads.
            with ThreadPoolExecutor(TRABALHADORES) as ex:
                list(ex.map(lambda c: coletar_termos(sessao(), c["numeroControlePncpContrato"], forcar), tic))
            log(f"{o['codigo']} {ano}: {len(contratos)} contratos, {len(tic)} contratos TIC")


# ---------------------------------------------------------------- aditivos

def acrescimo_do_contrato(valor_inicial: float, termos: list[dict]) -> tuple[float, float]:
    """(valor acrescido, dias de prazo aditado) de um contrato, pelos seus termos no PNCP.

    Reajuste e repactuação não contam: são previstos no contrato, não falha de gestão. Só conta
    termo marcado como acréscimo/supressão de valor (e só o acréscimo) e o prazo aditado.
    O valor global do termo é cumulativo, então o acréscimo é medido contra o valor anterior.
    """
    anterior, acrescimo, dias = valor_inicial, 0.0, 0.0
    for t in sorted(termos, key=lambda x: x.get("sequencialTermoContrato") or 0):
        vg = t.get("valorGlobal")
        if t.get("qualificacaoAcrescimoSupressao") and not t.get("qualificacaoReajuste"):
            delta = t["valorAcrescido"] if t.get("valorAcrescido") is not None else ((vg - anterior) if vg is not None else 0.0)
            acrescimo += max(delta, 0.0)
        if vg is not None:
            anterior = vg
        if t.get("qualificacaoVigencia"):
            dias += max(t.get("prazoAditadoDias") or 0, 0)
    return acrescimo, dias


# ---------------------------------------------------------------- painel órgão x ano

def mediana_referencia_itens(itens_tic: list[dict]) -> dict[tuple[int, int], float]:
    """Mediana do valor unitário de cada item do catálogo em cada ano, entre todos os órgãos do painel.

    Só vale com pelo menos 4 observações de pelo menos 3 órgãos; sem isso o item não entra no índice.
    """
    grupos = defaultdict(list)
    for i in itens_tic:
        grupos[(i["codigoItem"], i["ano"])].append(i)
    ref = {}
    for k, v in grupos.items():
        if len(v) >= 4 and len({x["orgao"] for x in v}) >= 3:
            ref[k] = float(np.median([x["valorUnitarioItem"] for x in v]))
    return ref


def montar_painel(orgaos: list[dict], anos: list[int], atis: dict, ano_limite_aditivos: int) -> list[dict]:
    nome_de = {o["codigo"]: o["nome_compras"] for o in orgaos}
    contratos_por = {}
    itens_tic = []
    for o in orgaos:
        for ano in anos:
            arq_c = DIR_CACHE / "contratos" / f"{o['codigo']}_{ano}.json"
            arq_i = DIR_CACHE / "itens" / f"{o['codigo']}_{ano}.json"
            if not arq_c.exists():
                continue
            cs = json.loads(arq_c.read_text(encoding="utf-8"))
            tic = {(c["codigoUnidadeGestora"], c["numeroContrato"]): c for c in cs if eh_tic(c)}
            contratos_por[(o["codigo"], ano)] = list(tic.values())
            if arq_i.exists():
                for i in json.loads(arq_i.read_text(encoding="utf-8")):
                    if (i["codigoUnidadeGestora"], i["numeroContrato"]) in tic and i["valorUnitarioItem"] and i["codigoItem"]:
                        itens_tic.append({**i, "ano": ano, "orgao": o["codigo"]})
    ref = mediana_referencia_itens(itens_tic)

    painel = []
    for (cod, ano), cs in sorted(contratos_por.items()):
        valor = sum(c["valorGlobal"] or 0 for c in cs)
        if valor <= 0:
            continue
        # modalidade e concentração: todos os registros TIC (contratos e empenhos)
        direta = sum(c["valorGlobal"] or 0 for c in cs if c["nomeModalidadeCompra"] in DIRETA)
        por_forn = defaultdict(float)
        for c in cs:
            por_forn[c["niFornecedor"]] += c["valorGlobal"] or 0
        hhi = sum((v / valor) ** 2 for v in por_forn.values())

        # aditivos: só contratos (tipo 50), com termos no PNCP e tempo de acompanhamento
        acresc = base_ad = dias = n_ad = 0
        if ano <= ano_limite_aditivos:
            for c in cs:
                if c["codigoTipo"] != "50" or not c["valorGlobal"]:
                    continue
                termos = coletar_termos_cache(c["numeroControlePncpContrato"])
                if termos is None:
                    continue
                a, d = acrescimo_do_contrato(c["valorGlobal"], termos)
                acresc += a
                dias += d
                base_ad += c["valorGlobal"]
                n_ad += 1

        # preço: sobrepreço em R$ = Σ valor do item × (preço / mediana do item no ano − 1)
        sobre = base_pr = 0.0
        for i in itens_tic:
            if i["orgao"] != cod or i["ano"] != ano:
                continue
            m = ref.get((i["codigoItem"], ano))
            vt = i["valorTotalItem"] or i["valorUnitarioItem"] * (i["quantidadeItem"] or 0)
            if m and vt and vt > 0:
                sobre += vt * (i["valorUnitarioItem"] / m - 1)
                base_pr += vt

        painel.append({
            "codigo": cod, "orgao": nome_de[cod], "ano": ano,
            "atis": round(atis.get((cod, ano), 0.0), 2),
            "valor_tic": round(valor, 2), "n_tic": len(cs),
            "pct_direta": direta / valor,
            "hhi": hhi,
            "valor_aditivos_base": round(base_ad, 2), "n_contratos_termos": n_ad,
            "acrescimo": round(acresc, 2),
            "aditivo_pct": acresc / base_ad if base_ad else None,
            "prazo_aditado_dias": dias / n_ad if n_ad else None,
            "valor_itens_base": round(base_pr, 2),
            "sobrepreco": round(sobre, 2),
            "sobrepreco_pct": sobre / base_pr if base_pr else None,
        })
    return painel


def coletar_termos_cache(ctrl: str | None):
    k = chave_pncp(ctrl)
    if not k:
        return None
    arq = DIR_CACHE / "termos" / f"{k[0]}_{k[1]}_{k[2]}.json"
    return json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else None


# ---------------------------------------------------------------- estimação

def t_critico(df: int, nivel: float = 0.975) -> float:
    """Quantil da t de Student (aproximação de Cornish-Fisher; erro < 0,01 para df >= 10)."""
    z = {0.975: 1.959964, 0.95: 1.644854}[nivel]
    return z + (z**3 + z) / (4 * df) + (5 * z**5 + 16 * z**3 + 3 * z) / (96 * df**2)


def p_valor_bicaudal(t: float, df: int) -> float:
    """p-valor aproximado: normal com correção de df (suficiente para decidir o veredito)."""
    z = abs(t) * (1 - 1 / (4 * df)) / math.sqrt(1 + t * t / (2 * df))
    return math.erfc(z / math.sqrt(2))


def efeitos_fixos(y: np.ndarray, x: np.ndarray, org: np.ndarray, ano: np.ndarray, peso: np.ndarray | None = None) -> dict | None:
    """Regressão y = b·x + efeito do órgão + efeito do ano, com erro-padrão robusto agrupado por órgão (CR1)."""
    orgs, anos = sorted(set(org)), sorted(set(ano))
    n, g = len(y), len(orgs)
    if n < 20 or g < 8 or len(anos) < 2 or np.ptp(x) == 0:
        return None
    cols = [x]
    cols += [(org == o).astype(float) for o in orgs]
    cols += [(ano == a).astype(float) for a in anos[1:]]
    X = np.column_stack(cols)
    w = np.ones(n) if peso is None else peso
    sw = np.sqrt(w)
    Xw, yw = X * sw[:, None], y * sw
    beta, *_ = np.linalg.lstsq(Xw, yw, rcond=None)
    res = yw - Xw @ beta
    bread = np.linalg.pinv(Xw.T @ Xw)
    meat = np.zeros((X.shape[1], X.shape[1]))
    for o in orgs:
        idx = org == o
        sc = Xw[idx].T @ res[idx]
        meat += np.outer(sc, sc)
    k = np.linalg.matrix_rank(Xw)
    cr1 = (g / (g - 1)) * ((n - 1) / (n - k))
    ep = math.sqrt(max((bread @ meat @ bread * cr1)[0, 0], 0.0))
    df = g - 1
    tc = t_critico(df)
    t = beta[0] / ep if ep else float("inf")
    return {"beta": float(beta[0]), "ep": ep, "ic95": [float(beta[0] - tc * ep), float(beta[0] + tc * ep)],
            "p": p_valor_bicaudal(t, df) if ep else 0.0, "n": int(n), "orgaos": int(g)}


# ---------------------------------------------------------------- projeção do efetivo

def taxa_saida_mensal(meses: list[dict], janela: int = 60, limiar: int = 10) -> float:
    """Mesma regra de site/orcamento.js: saída líquida nos meses sem entrada de turma, últimos `janela` meses."""
    def num(ref): a, m = ref.split("-"); return int(a) * 12 + int(m) - 1
    ult = num(meses[-1]["mes"])
    base = perda = 0.0
    for a, b in zip(meses, meses[1:]):
        if num(b["mes"]) - num(a["mes"]) != 1 or num(b["mes"]) <= ult - janela:
            continue
        dif = b["total"] - a["total"]
        if dif >= limiar:
            continue
        base += a["total"]
        perda -= dif
    return max(perda / base, 0.0) if base else 0.0


# ---------------------------------------------------------------- análise

def veredito(ic: list[float] | None) -> str:
    if not ic:
        return "sem_dados"
    if ic[1] < 0:
        return "confirmada"
    if ic[0] > 0:
        return "refutada"
    return "inconclusiva"


def analisar(premissas: dict) -> dict:
    orgaos = carregar_orgaos()
    ultimo_ano = int(json.loads((DIR_ATI / "latest.json").read_text(encoding="utf-8"))["referencia"][:4])
    anos = list(range(ANO_INI, ultimo_ano))  # anos completos
    ano_ad = premissas["ultimo_ano_com_acompanhamento_aditivos"]
    atis = atis_por_orgao_ano(orgaos, anos)
    painel = montar_painel(orgaos, anos, atis, ano_ad)

    # carteira dos 3 últimos anos por órgão (denominador da carga de gestão)
    por_org = defaultdict(dict)
    for l in painel:
        por_org[l["codigo"]][l["ano"]] = l["valor_tic"]
    for l in painel:
        l["carteira_3a"] = sum(por_org[l["codigo"]].get(a, 0) for a in (l["ano"] - 2, l["ano"] - 1, l["ano"]))
        l["x"] = l["atis"] / (l["carteira_3a"] / 1e8) if l["carteira_3a"] >= premissas["carteira_minima"] else None

    def serie(campo, filtro=lambda l: True, peso=None):
        ls = [l for l in painel if l["x"] is not None and l.get(campo) is not None and filtro(l)]
        if not ls:
            return None
        arr = lambda k: np.array([l[k] for l in ls], dtype=float)
        return efeitos_fixos(arr(campo), arr("x"), np.array([l["codigo"] for l in ls]), np.array([l["ano"] for l in ls]),
                             None if peso is None else arr(peso))

    # perda evitável combinada: (acréscimos + sobrepreço) / valor TIC, nos anos com os dois componentes
    for l in painel:
        ok = l["ano"] <= ano_ad and l["valor_aditivos_base"] > 0 and l["valor_itens_base"] > 0
        l["perda_pct"] = (l["acrescimo"] + max(l["sobrepreco"], 0)) / (l["valor_aditivos_base"] + l["valor_itens_base"]) if ok else None

    est = {
        "perda": ("Perda evitável (acréscimos + sobrepreço)", "% do valor contratado", serie("perda_pct", peso="valor_tic")),
        "aditivo": ("Acréscimo de valor nos contratos", "% do valor inicial", serie("aditivo_pct", peso="valor_aditivos_base")),
        "preco": ("Preço acima da mediana do item", "% do valor dos itens", serie("sobrepreco_pct", peso="valor_itens_base")),
        "direta": ("Contratação direta (dispensa e inexigibilidade)", "% do valor contratado", serie("pct_direta", peso="valor_tic")),
        "hhi": ("Concentração em fornecedores (HHI)", "índice 0 a 1", serie("hhi", peso="valor_tic")),
    }
    estimativas = [{"id": k, "nome": n, "unidade": u, **(r or {})} for k, (n, u, r) in est.items()]
    principal = est["perda"][2]
    ver = veredito(principal["ic95"] if principal else None)

    # economia atribuída aos ATIs, por ano: -b · x · valor (b em fração do valor contratado por unidade de x)
    historico = []
    if principal:
        for ano in sorted({l["ano"] for l in painel if l["perda_pct"] is not None}):
            ls = [l for l in painel if l["ano"] == ano and l["x"] is not None and l["perda_pct"] is not None]
            carga = sum(l["x"] * l["valor_tic"] for l in ls)
            n_atis = sum(l["atis"] for l in ls)
            f = lambda b: -b * carga
            historico.append({"ano": ano, "central": f(principal["beta"]),
                              "baixo": min(f(principal["ic95"][0]), f(principal["ic95"][1])),
                              "alto": max(f(principal["ic95"][0]), f(principal["ic95"][1])),
                              "atis": round(n_atis, 1), "valor_tic": sum(l["valor_tic"] for l in ls), "orgaos": len(ls)})

    # custo da carreira e projeção
    idx = json.loads((DIR_ATI / "index.json").read_text(encoding="utf-8"))["meses"]
    ult = idx[-1]
    encargos = premissas["encargos_pct"]
    custo_por_ati = ult["media"] * 13 * (1 + encargos)
    taxa = taxa_saida_mensal(idx)
    proj = {"cenarios": [], "taxa_saida_mensal": taxa}
    base = historico[-1] if historico else None
    if base and base["atis"]:
        por_ati = {k: base[k] / base["atis"] for k in ("central", "baixo", "alto")}
        horizonte = premissas["horizonte_anos"]
        anos_p = list(range(ultimo_ano, ultimo_ano + horizonte + 1))
        for cid, nome, fator in (("sem-entradas", "Sem novas entradas", lambda m: (1 - taxa) ** m),
                                 ("repondo", "Repondo as saídas", lambda m: 1.0)):
            efetivos = [ult["total"] * fator(12 * (a - ultimo_ano) + 6) for a in anos_p]
            proj["cenarios"].append({
                "id": cid, "nome": nome, "anos": anos_p, "efetivo": [round(e) for e in efetivos],
                "central": [por_ati["central"] * ef_amostra(e, ult["total"], base["atis"]) for e in efetivos],
                "baixo": [por_ati["baixo"] * ef_amostra(e, ult["total"], base["atis"]) for e in efetivos],
                "alto": [por_ati["alto"] * ef_amostra(e, ult["total"], base["atis"]) for e in efetivos],
                "extrapolada_central": [por_ati["central"] * e for e in efetivos],
                "extrapolada_baixo": [por_ati["baixo"] * e for e in efetivos],
                "extrapolada_alto": [por_ati["alto"] * e for e in efetivos],
            })
        proj["economia_por_ati"] = por_ati
    custo = {"folha_basica_por_ati_ano": ult["media"] * 13, "custo_por_ati_ano": custo_por_ati, "encargos_pct": encargos,
             "efetivo": ult["total"], "referencia": ult["mes"]}
    if base and base["atis"]:
        custo["retorno_por_real"] = {k: (base[k] / base["atis"]) / custo_por_ati for k in ("central", "baixo", "alto")}

    # comparação simples por terço de carga de gestão (sem modelo)
    tercis = []
    ls = [l for l in painel if l["x"] is not None and l["perda_pct"] is not None]
    if len(ls) >= 12:
        cortes = np.quantile([l["x"] for l in ls], [1 / 3, 2 / 3])
        for nome, lo, hi in (("Menos ATI por contrato", -1, cortes[0]), ("Intermediário", cortes[0], cortes[1]), ("Mais ATI por contrato", cortes[1], 1e18)):
            g = [l for l in ls if lo < l["x"] <= hi]
            v = sum(l["valor_aditivos_base"] + l["valor_itens_base"] for l in g)
            tercis.append({"grupo": nome, "n": len(g), "perda_pct": (sum(l["acrescimo"] + max(l["sobrepreco"], 0) for l in g) / v) if v else None,
                           "x_medio": float(np.mean([l["x"] for l in g]))})

    cobertura = {
        "orgaos_no_painel": len({l["codigo"] for l in painel}),
        "linhas_orgao_ano": len(painel),
        "linhas_na_estimacao": sum(1 for l in painel if l["x"] is not None and l["perda_pct"] is not None),
        "contratos_tic": sum(l["n_tic"] for l in painel),
        "contratos_com_termos": sum(l["n_contratos_termos"] for l in painel),
        "anos": [anos[0], anos[-1]] if anos else None,
        # Órgãos mapeados que não devolveram nenhum contrato de TIC: código errado ou órgão sem compras próprias.
        "orgaos_sem_contratos": sorted(o["orgao_siape"] for o in orgaos if o["codigo"] not in {l["codigo"] for l in painel}),
    }
    return {
        "referencia": f"{ultimo_ano - 1}",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "veredito": ver,
        "estimativas": estimativas,
        "economia_historica": historico,
        "projecao": proj,
        "custo": custo,
        "tercis": tercis,
        "cobertura": cobertura,
        "painel": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in l.items()} for l in painel],
        "premissas": premissas,
        "fontes": [
            {"nome": "Compras.gov.br — Dados Abertos (contratos e itens de contrato)", "url": "https://dadosabertos.compras.gov.br"},
            {"nome": "PNCP — termos de contrato (aditivos, apostilamentos, reajustes)", "url": "https://pncp.gov.br"},
            {"nome": "Portal da Transparência — Servidores SIAPE (efetivo de ATI por órgão)", "url": "https://portaldatransparencia.gov.br/download-de-dados/servidores"},
        ],
    }


def ef_amostra(efetivo_nacional: float, efetivo_atual: float, atis_amostra: float) -> float:
    """ATIs da amostra de órgãos no cenário: a mesma proporção do efetivo nacional."""
    return atis_amostra * efetivo_nacional / efetivo_atual if efetivo_atual else 0.0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("etapa", choices=["coletar", "analisar", "tudo"], nargs="?", default="tudo")
    ap.add_argument("--orgao", type=int, action="append", help="só este código do Compras (pode repetir)")
    ap.add_argument("--forcar", action="store_true", help="refaz as consultas mesmo que haja cache")
    a = ap.parse_args()

    premissas = json.loads(ARQ_PREMISSAS.read_text(encoding="utf-8"))
    if a.etapa in ("coletar", "tudo"):
        orgaos = [o for o in carregar_orgaos() if not a.orgao or o["codigo"] in a.orgao]
        ultimo_ano = int(json.loads((DIR_ATI / "latest.json").read_text(encoding="utf-8"))["referencia"][:4])
        coletar(orgaos, list(range(ANO_INI, ultimo_ano)), a.forcar)
    if a.etapa in ("analisar", "tudo"):
        saida = analisar(premissas)
        ARQ_SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"Gravado {ARQ_SAIDA.relative_to(RAIZ)}: veredito {saida['veredito']}, {saida['cobertura']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
