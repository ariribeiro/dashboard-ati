"""Audita os dados publicados em data/ e grava um registro em auditoria/.

Dois métodos, sempre registrados com o nome:

  coerencia    Confere todos os arquivos de data/ entre si, sem baixar nada: somas por
               órgão, UF, situação e classe iguais ao total, histograma igual a n,
               index.json e latest.json iguais aos arquivos mensais.

  recontagem   Baixa o ZIP do mês no Portal da Transparência e recalcula os agregados de
               cada carreira, comparando com o que está publicado.

Este script não importa nada de gerar_dados.py e não usa pandas: lê os CSV linha a linha
com a biblioteca padrão. A ideia é que um erro de lógica em um dos dois apareça como
divergência, em vez de se repetir. O que os dois compartilham é a configuração
(data/carreiras.json) e as regras descritas no README.

Somente agregados entram no registro — nenhum nome, CPF, matrícula ou identificador
individual (LGPD).

Uso:
    python scripts/auditar.py coerencia
    python scripts/auditar.py recontagem --mes 202609          # pode repetir --mes
    python scripts/auditar.py recontagem --mais-recente --sortear 2
    python scripts/auditar.py recontagem --mes 202609 --cache .cache   # usa ZIP local
"""

from __future__ import annotations

import argparse
import csv
import functools
import hashlib
import io
import json
import os
import random
import re
import subprocess
import sys
import time
import unicodedata
import zipfile
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "data"
AUDITORIA = RAIZ / "auditoria"
REGISTROS = AUDITORIA / "registros"

URL_ZIP = "https://portaldatransparencia.gov.br/download-de-dados/servidores/{mes}_Servidores_SIAPE"
AGENTE = "Mozilla/5.0 (dashboard-carreiras auditoria; +https://github.com/ariribeiro/dashboard-carreiras)"
FAIXAS_PADRAO = [0, 10_000, 12_500, 15_000, 17_500, 20_000, 22_500, 25_000, 30_000, 35_000]
COL_REM = "REMUNERAÇÃO BÁSICA BRUTA (R$)"
SEM_VALOR = re.compile(r"^(-1|SEM INFORM.*|INVALIDO)?$")
TOLERANCIA_REAIS = 0.01
MAX_ITENS = 20  # divergências detalhadas por lista (órgãos, UFs...)

METODOS = {
    "coerencia": "Coerência interna: todos os arquivos de data/ conferidos entre si (somas, índice, "
                 "latest, filtro de cargo), sem consulta ao portal.",
    "recontagem": "Recontagem independente: ZIP Servidores_SIAPE baixado do Portal da Transparência e "
                  "agregados recalculados por scripts/auditar.py (biblioteca padrão, sem código de "
                  "gerar_dados.py), comparados com data/<carreira>/AAAAMM.json.",
}


def ler_json(caminho: Path):
    return json.loads(caminho.read_text(encoding="utf-8"))


# Poucos valores distintos (cargos, UFs, siglas) em milhões de linhas: o cache evita renormalizar.
@functools.lru_cache(maxsize=None)
def norm(texto: str | None) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sem_acento).strip().upper()


def sem_valor(texto: str | None) -> bool:
    return bool(SEM_VALOR.match(norm(texto)))


class Resultado:
    """Acumula verificações, divergências e avisos de uma execução."""

    def __init__(self) -> None:
        self.verificacoes = 0
        self.divergencias: list[dict] = []
        self.avisos: list[str] = []

    def conferir(self, ok: bool, **detalhe) -> None:
        self.verificacoes += 1
        if not ok:
            self.divergencias.append(detalhe)


# ---------------------------------------------------------------- coerência

def arquivos_mensais(carreira: str) -> list[Path]:
    return sorted((DADOS / carreira).glob("[0-9]" * 6 + ".json"))


def auditar_coerencia(carreiras: dict[str, dict], res: Resultado) -> dict:
    conhecidos = set()
    arq_coord = DADOS / "orgaos_coordenadas.csv"
    if arq_coord.exists():
        with open(arq_coord, encoding="utf-8", newline="") as f:
            conhecidos = {linha["orgao_siape"] for linha in csv.DictReader(f, delimiter=";")}
    sem_coord: Counter = Counter()
    escopo = {}

    for c, cfg in carreiras.items():
        arquivos = arquivos_mensais(c)
        escopo[c] = {"arquivos": len(arquivos),
                     "de": arquivos[0].stem if arquivos else None, "ate": arquivos[-1].stem if arquivos else None}
        if not arquivos:
            res.avisos.append(f"{c}: nenhum arquivo mensal em data/{c}/.")
            continue
        base = {"carreira": c}

        # Meses que deveriam existir entre o primeiro e o último.
        a, m = int(arquivos[0].stem[:4]), int(arquivos[0].stem[4:])
        esperados = []
        while f"{a}{m:02d}" <= arquivos[-1].stem:
            esperados.append(f"{a}{m:02d}")
            a, m = (a + 1, 1) if m == 12 else (a, m + 1)
        faltam = sorted(set(esperados) - {x.stem for x in arquivos})
        if faltam:
            res.avisos.append(f"{c}: meses sem arquivo entre {arquivos[0].stem} e {arquivos[-1].stem}: {', '.join(faltam)}.")

        indice = ler_json(DADOS / c / "index.json")["meses"]
        res.conferir([x["arquivo"] for x in indice] == [x.name for x in arquivos],
                     **base, campo="index.json: lista de arquivos", publicado=len(indice), recalculado=len(arquivos))
        res.conferir(ler_json(DADOS / c / "latest.json") == ler_json(arquivos[-1]),
                     **base, campo="latest.json igual ao mês mais recente", publicado="latest.json", recalculado=arquivos[-1].name)
        por_arquivo = {x["arquivo"]: x for x in indice}
        faixas = cfg.get("faixas", FAIXAS_PADRAO)

        for arq in arquivos:
            d = ler_json(arq)
            rem = d["remuneracao_basica_bruta"]
            ref = {"carreira": c, "mes": arq.stem}

            def igual(campo, publicado, recalculado):
                res.conferir(publicado == recalculado, **ref, campo=campo, publicado=publicado, recalculado=recalculado)

            igual("referencia", d["referencia"], f"{arq.stem[:4]}-{arq.stem[4:]}")
            igual("filtro_cargo igual a carreiras.json", d["filtro_cargo"], cfg["padrao_cargo"])
            for chave in ("por_situacao", "por_orgao_exercicio", "por_orgao_lotacao", "por_uf", "por_classe_padrao"):
                igual(f"soma de {chave} = total", sum(x["qtd"] for x in d[chave]), d["total"])
            igual("soma de funcao.por_sigla = com_funcao", sum(x["qtd"] for x in d["funcao"]["por_sigla"]), d["funcao"]["com_funcao"])
            igual("soma do histograma = n", sum(x["qtd"] for x in rem["histograma"]), rem["n"])
            igual("limites do histograma = carreiras.json", [x["min"] for x in rem["histograma"]], faixas)
            res.conferir(rem["n"] <= d["total"], **ref, campo="n <= total", publicado=rem["n"], recalculado=d["total"])
            if rem["n"]:
                res.conferir(rem["p10"] <= rem["mediana"] <= rem["p90"], **ref, campo="p10 <= mediana <= p90",
                             publicado=[rem["p10"], rem["mediana"], rem["p90"]], recalculado=None)
            entrada = por_arquivo.get(arq.name)
            if entrada:
                igual("index.json: mes, total, mediana, n, media",
                      [entrada["mes"], entrada["total"], entrada["mediana"], entrada.get("n"), entrada.get("media")],
                      [d["referencia"], d["total"], rem["mediana"], rem["n"], rem["media"]])
            for o in d["por_orgao_exercicio"]:
                if conhecidos and o["nome"] not in conhecidos:
                    sem_coord[o["nome"]] += 1

    if sem_coord:
        res.avisos.append("Órgãos de exercício sem linha em orgaos_coordenadas.csv (arquivos mensais em que aparecem): "
                          + "; ".join(f"{nome} ({qtd})" for nome, qtd in sem_coord.most_common()) + ".")
    return {"carreiras": escopo}


# ---------------------------------------------------------------- recontagem

def baixar_zip(mes: str, cache: Path | None) -> tuple[Path, bool]:
    """Devolve (caminho, temporario). Usa o ZIP de `cache` se existir; senão baixa do portal."""
    nome = f"{mes}_Servidores_SIAPE.zip"
    if cache and (cache / nome).exists():
        return cache / nome, False
    import requests  # só a recontagem com download precisa de rede

    destino = (cache or RAIZ / ".cache")
    destino.mkdir(parents=True, exist_ok=True)
    caminho = destino / nome
    espera = 5.0
    for tentativa in range(1, 5):
        try:
            with requests.get(URL_ZIP.format(mes=mes), headers={"User-Agent": AGENTE}, stream=True, timeout=(30, 300)) as r:
                r.raise_for_status()
                with open(caminho, "wb") as f:
                    for bloco in r.iter_content(chunk_size=1 << 20):
                        f.write(bloco)
            if not zipfile.is_zipfile(caminho):
                raise OSError("o arquivo baixado não é um ZIP válido")
            return caminho, cache is None
        except (requests.RequestException, OSError) as erro:
            caminho.unlink(missing_ok=True)
            if tentativa == 4:
                raise RuntimeError(f"download de {mes} falhou: {erro}") from erro
            print(f"  falha ({erro}); nova tentativa em {espera:.0f}s", file=sys.stderr)
            time.sleep(espera)
            espera *= 2
    raise AssertionError("inalcançável")


def sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def linhas_csv(zf: zipfile.ZipFile, nome: str):
    with zf.open(nome) as bruto:
        yield from csv.DictReader(io.TextIOWrapper(bruto, encoding="latin-1", newline=""), delimiter=";")


def reais(texto: str | None) -> Decimal | None:
    try:
        return Decimal((texto or "").strip().replace(".", "").replace(",", "."))
    except InvalidOperation:
        return None


def quantil(ordenados: list[float], q: float) -> float:
    """Quantil com interpolação linear entre as posições vizinhas (o método usual)."""
    pos = (len(ordenados) - 1) * q
    i = int(pos)
    j = min(i + 1, len(ordenados) - 1)
    return ordenados[i] + (ordenados[j] - ordenados[i]) * (pos - i)


def cargos_parecidos(aceitos: Counter, todos: Counter) -> list[dict]:
    """Cargos que o filtro rejeitou mas que lembram os aceitos (mesmos radicais), para revisão humana."""
    # Parecido = começa como um cargo aceito ("ANA...", "ESP...") e tem algum radical das outras palavras.
    inicios = {nome[:3] for nome in aceitos}
    radicais = {p[:4] for nome in aceitos for p in re.split(r"[ -]+", nome)[1:] if len(p) >= 4}
    if not radicais:
        return []
    achados = [(nome, qtd) for nome, qtd in todos.items()
               if nome not in aceitos and nome[:3] in inicios and any(r in nome for r in radicais)]
    return [{"cargo": nome, "linhas": qtd} for nome, qtd in sorted(achados, key=lambda x: -x[1])[:15]]


def recontar(zf: zipfile.ZipFile, mes: str, carreiras: dict[str, dict]) -> tuple[dict[str, dict], dict]:
    """Recalcula os agregados de cada carreira a partir dos CSV do mês."""
    padroes = {c: re.compile(cfg["padrao_cargo"]) for c, cfg in carreiras.items()}
    servidores: dict[str, dict[str, dict]] = {c: {} for c in carreiras}  # carreira -> id -> 1ª linha do cargo
    funcao: dict[str, str] = {}   # id -> 1ª sigla de função em linha sem cargo
    uf_extra: dict[str, str] = {}  # id -> 1ª UF informada em linha sem cargo
    todos_cargos: Counter = Counter()
    aceitos: dict[str, Counter] = {c: Counter() for c in carreiras}

    for linha in linhas_csv(zf, f"{mes}_Cadastro.csv"):
        ident = linha["Id_SERVIDOR_PORTAL"]
        cargo = norm(linha["DESCRICAO_CARGO"])
        todos_cargos[cargo] += 1
        if sem_valor(linha["DESCRICAO_CARGO"]):
            # Linha sem cargo: função comissionada ou exercício descentralizado do mesmo servidor.
            if ident not in funcao and not sem_valor(linha["SIGLA_FUNCAO"]):
                funcao[ident] = linha["SIGLA_FUNCAO"]
            if ident not in uf_extra and not sem_valor(linha["UF_EXERCICIO"]):
                uf_extra[ident] = linha["UF_EXERCICIO"]
            continue
        for c, padrao in padroes.items():
            if padrao.match(cargo):
                aceitos[c][cargo] += 1
                servidores[c].setdefault(ident, linha)

    interessam = set().union(*(set(s) for s in servidores.values()))
    soma: dict[str, Decimal] = {}
    linhas_rem: Counter = Counter()
    for linha in linhas_csv(zf, f"{mes}_Remuneracao.csv"):
        ident = linha["Id_SERVIDOR_PORTAL"]
        if ident not in interessam:
            continue
        linhas_rem[ident] += 1
        valor = reais(linha[COL_REM])
        if valor is not None:
            soma[ident] = soma.get(ident, Decimal(0)) + valor

    agregados, diagnosticos = {}, {}
    for c, cfg in carreiras.items():
        pessoas = servidores[c]
        ufs = Counter()
        for ident, linha in pessoas.items():
            uf = linha["UF_EXERCICIO"]
            ufs[uf if not sem_valor(uf) else uf_extra.get(ident, "Não informado")] += 1
        com_funcao = [funcao[i] for i in pessoas if i in funcao]
        valores = sorted(float(soma[i]) for i in pessoas if soma.get(i, Decimal(0)) > 0)
        limites = cfg.get("faixas", FAIXAS_PADRAO) + [float("inf")]
        agregados[c] = {
            "total": len(pessoas),
            "por_situacao": Counter(p["SITUACAO_VINCULO"] for p in pessoas.values()),
            "por_orgao_exercicio": Counter(p["ORG_EXERCICIO"] for p in pessoas.values()),
            "por_orgao_lotacao": Counter(p["ORG_LOTACAO"] for p in pessoas.values()),
            "por_uf": ufs,
            "por_classe_padrao": Counter((p["CLASSE_CARGO"], p["PADRAO_CARGO"]) for p in pessoas.values()),
            "com_funcao": len(com_funcao),
            "por_sigla": Counter(com_funcao),
            "n": len(valores),
            "media": sum(valores) / len(valores) if valores else None,
            "mediana": quantil(valores, 0.5) if valores else None,
            "p10": quantil(valores, 0.10) if valores else None,
            "p90": quantil(valores, 0.90) if valores else None,
            "histograma": [sum(1 for v in valores if a <= v < b) for a, b in zip(limites[:-1], limites[1:])],
        }
        # Diagnósticos (não são divergências): ajudam a interpretar o que a remuneração somada contém.
        med = lambda xs: round(quantil(sorted(xs), 0.5), 2) if xs else None  # noqa: E731
        positivos = {i: float(soma[i]) for i in pessoas if soma.get(i, Decimal(0)) > 0}
        diagnosticos[c] = {
            "cargos_aceitos_pelo_filtro": [{"cargo": nome, "linhas": qtd} for nome, qtd in aceitos[c].most_common()],
            "cargos_parecidos_rejeitados": cargos_parecidos(aceitos[c], todos_cargos),
            "servidores_com_mais_de_uma_linha_de_remuneracao": sum(1 for i in pessoas if linhas_rem[i] > 1),
            "servidores_sem_linha_de_remuneracao": sum(1 for i in pessoas if linhas_rem[i] == 0),
            "mediana_com_funcao": med([v for i, v in positivos.items() if i in funcao]),
            "mediana_sem_funcao": med([v for i, v in positivos.items() if i not in funcao]),
        }
    return agregados, diagnosticos


def comparar_lista(res: Resultado, ref: dict, campo: str, publicado: list[dict], recalculado: Counter, chave=lambda x: x["nome"]) -> None:
    pub = {chave(x): x["qtd"] for x in publicado}
    rec = {k: v for k, v in recalculado.items()}
    diferentes = sorted(k for k in set(pub) | set(rec) if pub.get(k, 0) != rec.get(k, 0))
    res.conferir(not diferentes, **ref, campo=campo,
                 publicado={str(k): pub.get(k, 0) for k in diferentes[:MAX_ITENS]},
                 recalculado={str(k): rec.get(k, 0) for k in diferentes[:MAX_ITENS]},
                 itens_diferentes=len(diferentes))


def comparar(res: Resultado, c: str, mes: str, pub: dict, rec: dict) -> None:
    ref = {"carreira": c, "mes": mes}
    rem = pub["remuneracao_basica_bruta"]

    def inteiro(campo, publicado, recalculado):
        res.conferir(publicado == recalculado, **ref, campo=campo, publicado=publicado, recalculado=recalculado)

    def dinheiro(campo, publicado, recalculado):
        iguais = (publicado is None and recalculado is None) or (
            publicado is not None and recalculado is not None and abs(publicado - recalculado) <= TOLERANCIA_REAIS)
        res.conferir(iguais, **ref, campo=campo, publicado=publicado,
                     recalculado=None if recalculado is None else round(recalculado, 2))

    inteiro("total", pub["total"], rec["total"])
    for campo in ("por_situacao", "por_orgao_exercicio", "por_orgao_lotacao", "por_uf"):
        comparar_lista(res, ref, campo, pub[campo], rec[campo])
    comparar_lista(res, ref, "por_classe_padrao", pub["por_classe_padrao"], rec["por_classe_padrao"],
                   chave=lambda x: (x["classe"], x["padrao"]))
    inteiro("funcao.com_funcao", pub["funcao"]["com_funcao"], rec["com_funcao"])
    comparar_lista(res, ref, "funcao.por_sigla", pub["funcao"]["por_sigla"], rec["por_sigla"])
    inteiro("remuneracao.n", rem["n"], rec["n"])
    for campo in ("media", "mediana", "p10", "p90"):
        dinheiro(f"remuneracao.{campo}", rem[campo], rec[campo])
    inteiro("remuneracao.histograma", [x["qtd"] for x in rem["histograma"]], rec["histograma"])


def escolher_meses(args, carreiras: dict[str, dict], indice: dict) -> tuple[list[str], dict | None]:
    publicados = sorted({a.stem for c in carreiras for a in arquivos_mensais(c)})
    if not publicados:
        return [], None
    meses = list(args.mes or [])
    if args.mais_recente and publicados[-1] not in meses:
        meses.append(publicados[-1])
    sorteio = None
    if args.sortear:
        # Prefere meses que ainda não passaram por recontagem, para a cobertura crescer a cada execução.
        ja = set(indice.get("cobertura_recontagem", {}))
        candidatos = [m for m in publicados if m not in meses and m not in ja] or [m for m in publicados if m not in meses]
        semente = args.semente if args.semente is not None else random.SystemRandom().randrange(1 << 31)
        escolhidos = random.Random(semente).sample(candidatos, min(args.sortear, len(candidatos)))
        sorteio = {"semente": semente, "quantidade": args.sortear, "candidatos": len(candidatos),
                   "criterio": "meses publicados ainda sem recontagem; se todos já tiverem, qualquer mês publicado"}
        meses += sorted(escolhidos)
    return meses, sorteio


def auditar_recontagem(args, carreiras: dict[str, dict], res: Resultado, indice: dict) -> dict:
    meses, sorteio = escolher_meses(args, carreiras, indice)
    if not meses:
        raise SystemExit("Nenhum mês para auditar: informe --mes, --mais-recente ou --sortear.")
    cache = Path(args.cache).resolve() if args.cache else None
    fontes, diagnosticos, auditados = [], {}, {}

    for mes in meses:
        ativas = {c: cfg for c, cfg in carreiras.items() if mes >= cfg.get("inicio", "0000-00").replace("-", "")}
        com_arquivo = {c: cfg for c, cfg in ativas.items() if (DADOS / c / f"{mes}.json").exists()}
        for c in sorted(set(ativas) - set(com_arquivo)):
            res.avisos.append(f"{c}/{mes}: sem arquivo publicado em data/; não comparado.")
        if not com_arquivo:
            continue
        print(f"Recontando {mes} ({', '.join(com_arquivo)})...")
        try:
            caminho, temporario = baixar_zip(mes, cache)
        except RuntimeError as erro:
            res.avisos.append(f"{mes}: não auditado ({erro}).")
            auditados[mes] = {"carreiras": [], "erro": str(erro)}
            continue
        try:
            fontes.append({"mes": mes, "url": URL_ZIP.format(mes=mes), "sha256": sha256(caminho),
                           "bytes": caminho.stat().st_size, "origem": "cache local" if not temporario else "download"})
            with zipfile.ZipFile(caminho) as zf:
                agregados, diag = recontar(zf, mes, com_arquivo)
        finally:
            if temporario:
                caminho.unlink(missing_ok=True)
        antes = len(res.divergencias)
        for c in com_arquivo:
            comparar(res, c, mes, ler_json(DADOS / c / f"{mes}.json"), agregados[c])
        diagnosticos[mes] = diag
        auditados[mes] = {"carreiras": sorted(com_arquivo), "divergencias": len(res.divergencias) - antes}
    return {"meses": auditados, "sorteio": sorteio, "fontes": fontes, "diagnosticos": diagnosticos}


# ---------------------------------------------------------------- registro

def commit_atual() -> str | None:
    if os.environ.get("GITHUB_SHA"):
        return os.environ["GITHUB_SHA"]
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=RAIZ, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def execucao() -> dict:
    if os.environ.get("GITHUB_RUN_ID"):
        return {"origem": "github-actions", "evento": os.environ.get("GITHUB_EVENT_NAME"),
                "url": f"{os.environ.get('GITHUB_SERVER_URL')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ['GITHUB_RUN_ID']}"}
    return {"origem": "local"}


def gravar(metodo: str, agora: datetime, carreiras: dict, res: Resultado, detalhes: dict, indice: dict) -> Path:
    REGISTROS.mkdir(parents=True, exist_ok=True)
    ident = base = f"{agora:%Y%m%d-%H%M%S}-{metodo}"
    seq = 1
    while (REGISTROS / f"{ident}.json").exists():  # duas execuções no mesmo segundo não se sobrescrevem
        seq += 1
        ident = f"{base}-{seq}"
    sem_auditar = metodo == "recontagem" and not any(m.get("carreiras") for m in detalhes["meses"].values())
    resultado = "erro" if sem_auditar else "divergente" if res.divergencias else "ok"
    registro = {
        "id": ident,
        "data": agora.isoformat(timespec="seconds"),
        "metodo": {"id": metodo, "descricao": METODOS[metodo]},
        "resultado": resultado,
        "commit": commit_atual(),
        "execucao": execucao(),
        "auditado": {"carreiras": sorted(carreiras), **{k: v for k, v in detalhes.items() if k != "diagnosticos"}},
        "verificacoes": res.verificacoes,
        "divergencias": res.divergencias,
        "avisos": res.avisos,
    }
    if detalhes.get("diagnosticos"):
        registro["diagnosticos"] = detalhes["diagnosticos"]
    destino = REGISTROS / f"{ident}.json"
    destino.write_text(json.dumps(registro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    indice.setdefault("registros", []).append({
        "id": ident, "data": registro["data"], "metodo": metodo, "resultado": resultado,
        "verificacoes": res.verificacoes, "divergencias": len(res.divergencias),
        "meses": sorted(detalhes["meses"]) if metodo == "recontagem" else "todos",
        "arquivo": f"registros/{destino.name}",
    })
    if metodo == "recontagem":
        cobertura = indice.setdefault("cobertura_recontagem", {})
        for mes, info in detalhes["meses"].items():
            if info.get("carreiras"):
                cobertura[mes] = {"data": registro["data"], "registro": ident, "carreiras": info["carreiras"],
                                  "resultado": "divergente" if info["divergencias"] else "ok"}
        indice["cobertura_recontagem"] = dict(sorted(cobertura.items()))
    (AUDITORIA / "index.json").write_text(json.dumps(indice, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return destino


def main() -> int:
    todas = ler_json(DADOS / "carreiras.json")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("metodo", choices=list(METODOS))
    p.add_argument("--carreira", action="append", choices=list(todas), help="só esta carreira (pode repetir)")
    p.add_argument("--mes", action="append", help="recontagem: mês AAAAMM (pode repetir)")
    p.add_argument("--mais-recente", action="store_true", help="recontagem: inclui o mês mais recente publicado")
    p.add_argument("--sortear", type=int, default=0, help="recontagem: sorteia N meses publicados")
    p.add_argument("--semente", type=int, help="recontagem: semente do sorteio (padrão: aleatória, gravada no registro)")
    p.add_argument("--cache", help="recontagem: pasta com AAAAMM_Servidores_SIAPE.zip já baixados")
    args = p.parse_args()
    for mes in args.mes or []:
        if not re.fullmatch(r"20\d{2}(0[1-9]|1[0-2])", mes):
            p.error(f"--mes deve ter o formato AAAAMM (recebido: {mes})")

    carreiras = {c: todas[c] for c in (args.carreira or todas)}
    arq_indice = AUDITORIA / "index.json"
    indice = ler_json(arq_indice) if arq_indice.exists() else {}
    res = Resultado()
    agora = datetime.now(timezone.utc)
    detalhes = auditar_coerencia(carreiras, res) if args.metodo == "coerencia" else auditar_recontagem(args, carreiras, res, indice)
    destino = gravar(args.metodo, agora, carreiras, res, detalhes, indice)

    resultado = ler_json(destino)["resultado"]
    print(f"{args.metodo}: {resultado} — {res.verificacoes} verificações, {len(res.divergencias)} divergências, "
          f"{len(res.avisos)} avisos. Registro: {destino.relative_to(RAIZ)}")
    for d in res.divergencias[:30]:
        # Formato de anotação do GitHub Actions; no terminal aparece como texto comum.
        print(f"::error::{d.get('carreira')}/{d.get('mes', '-')} {d['campo']}: publicado {d['publicado']}, recalculado {d['recalculado']}")
    for aviso in res.avisos:
        print(f"::warning::{aviso}")
    return 0 if resultado == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
