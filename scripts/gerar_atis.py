"""Gera dados agregados da carreira de Analista em Tecnologia da Informação (ATI).

Fonte: Portal da Transparência, download mensal "Servidores_SIAPE"
(https://portaldatransparencia.gov.br/download-de-dados/servidores).
Cada ZIP mensal contém AAAAMM_Cadastro.csv e AAAAMM_Remuneracao.csv
(latin-1, separador ";", decimais com vírgula).

Somente dados agregados são gravados — nenhum nome, CPF, matrícula ou
identificador individual sai deste script (LGPD).

Uso:
    python scripts/gerar_atis.py              # mês mais recente disponível
    python scripts/gerar_atis.py --mes 202607 # mês específico
    python scripts/gerar_atis.py --force      # reprocessa mesmo se já existir
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import requests

RAIZ = Path(__file__).resolve().parent.parent
DIR_DADOS = RAIZ / "data"
DIR_CACHE = RAIZ / ".cache"
ARQ_COORDENADAS = DIR_DADOS / "orgaos_coordenadas.csv"

URL_DOWNLOAD = "https://portaldatransparencia.gov.br/download-de-dados/servidores/{mes}_Servidores_SIAPE"
URL_PAGINA = "https://portaldatransparencia.gov.br/download-de-dados/servidores"
USER_AGENT = "Mozilla/5.0 (dashboard-ati; +https://github.com)"

# No SIAPE o cargo aparece abreviado ("ANALISTA EM TECNOL DA INFORMACAO").
# A regex é aplicada sobre o texto normalizado (sem acentos, maiúsculo).
PADRAO_CARGO = r"^ANALISTA EM TECNOL(OGIA)? DA INFORMACAO$"

COLS_CADASTRO = [
    "Id_SERVIDOR_PORTAL", "DESCRICAO_CARGO", "CLASSE_CARGO", "PADRAO_CARGO",
    "SIGLA_FUNCAO", "ORG_LOTACAO", "ORG_EXERCICIO", "SITUACAO_VINCULO", "UF_EXERCICIO",
]
COL_ID = "Id_SERVIDOR_PORTAL"
COL_REM = "REMUNERAÇÃO BÁSICA BRUTA (R$)"
# Valores de "vazio" no SIAPE: "-1", "Sem informaç" (truncado), "Inválido".
SEM_VALOR = re.compile(r"^(-1|SEM INFORM.*|INVALIDO)?$")
TAMANHO_CHUNK = 200_000

# Faixas fixas (R$) para manter o histograma comparável entre meses.
FAIXAS = [0, 10_000, 12_500, 15_000, 17_500, 20_000, 22_500, 25_000, 30_000, 35_000]
ROMANOS = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}


def normalizar(texto) -> str:
    if not isinstance(texto, str):
        return ""
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sem_acento).strip().upper()


def vazio(serie: pd.Series) -> pd.Series:
    return serie.isna() | serie.map(normalizar).str.match(SEM_VALOR)


# ---------------------------------------------------------------- download

def sessao() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    return s


def com_retry(func, tentativas: int = 4, espera: float = 5.0):
    for i in range(1, tentativas + 1):
        try:
            return func()
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as erro:
            resp = getattr(erro, "response", None)
            if resp is not None and resp.status_code < 500 and resp.status_code != 429:
                raise
            if i == tentativas:
                raise
            print(f"  falha ({erro}); nova tentativa em {espera:.0f}s", file=sys.stderr)
            time.sleep(espera)
            espera *= 2


def mes_disponivel(s: requests.Session, mes: str) -> bool:
    """O portal redireciona para o bucket; mês inexistente responde 403/404."""
    def tentar():
        r = s.head(URL_DOWNLOAD.format(mes=mes), allow_redirects=True, timeout=60)
        if r.status_code >= 500 or r.status_code == 429:
            r.raise_for_status()
        return r.status_code == 200
    return com_retry(tentar)


def descobrir_mes(s: requests.Session, hoje: date, recuo: int = 3) -> str | None:
    ano, mes = hoje.year, hoje.month
    for _ in range(recuo + 1):
        candidato = f"{ano}{mes:02d}"
        print(f"Verificando {candidato}...")
        if mes_disponivel(s, candidato):
            return candidato
        ano, mes = (ano - 1, 12) if mes == 1 else (ano, mes - 1)
    return None


def baixar(s: requests.Session, mes: str) -> Path:
    DIR_CACHE.mkdir(exist_ok=True)
    destino = DIR_CACHE / f"{mes}_Servidores_SIAPE.zip"
    if destino.exists() and zipfile.is_zipfile(destino):
        print(f"Usando cache {destino.name}")
        return destino

    def tentar():
        parcial = destino.with_suffix(".part")
        with s.get(URL_DOWNLOAD.format(mes=mes), stream=True, timeout=(30, 300)) as r:
            r.raise_for_status()
            with open(parcial, "wb") as f:
                for bloco in r.iter_content(chunk_size=1 << 20):
                    f.write(bloco)
        if not zipfile.is_zipfile(parcial):
            raise requests.ConnectionError("arquivo baixado não é um ZIP válido")
        parcial.rename(destino)

    print(f"Baixando {mes}...")
    com_retry(tentar)
    print(f"  {destino.stat().st_size / 1e6:.0f} MB")
    return destino


# ---------------------------------------------------------------- leitura

def ler_csv(arquivo_zip: zipfile.ZipFile, nome: str, colunas: list[str]):
    with arquivo_zip.open(nome) as f:
        yield from pd.read_csv(
            f, sep=";", encoding="latin-1", dtype=str, usecols=colunas,
            chunksize=TAMANHO_CHUNK,
        )


def ler_cadastro(zf: zipfile.ZipFile, mes: str, padrao: re.Pattern) -> pd.DataFrame:
    """Retorna uma linha por ATI, com UF e indicador de função consolidados."""
    nome = f"{mes}_Cadastro.csv"

    # 1ª passada: linhas do cargo ATI.
    partes = []
    for chunk in ler_csv(zf, nome, COLS_CADASTRO):
        cargo = chunk["DESCRICAO_CARGO"].map(normalizar)
        partes.append(chunk[cargo.str.match(padrao)])
    atis = pd.concat(partes).drop_duplicates(COL_ID).set_index(COL_ID)
    ids = set(atis.index)

    # 2ª passada: linhas sem cargo do mesmo servidor (função comissionada,
    # exercício descentralizado). Linhas de outro cargo/vínculo são ignoradas.
    partes = []
    for chunk in ler_csv(zf, nome, COLS_CADASTRO):
        extra = chunk[chunk[COL_ID].isin(ids)]
        partes.append(extra[vazio(extra["DESCRICAO_CARGO"])])
    extras = pd.concat(partes)

    com_funcao = extras[~vazio(extras["SIGLA_FUNCAO"])]
    atis["FUNCAO"] = com_funcao.drop_duplicates(COL_ID).set_index(COL_ID)["SIGLA_FUNCAO"]

    uf_extra = extras[~vazio(extras["UF_EXERCICIO"])].drop_duplicates(COL_ID).set_index(COL_ID)["UF_EXERCICIO"]
    atis["UF"] = atis["UF_EXERCICIO"].mask(vazio(atis["UF_EXERCICIO"])).fillna(uf_extra).fillna("Não informado")
    return atis


def ler_remuneracao(zf: zipfile.ZipFile, mes: str, ids: set[str]) -> pd.Series:
    partes = []
    for chunk in ler_csv(zf, f"{mes}_Remuneracao.csv", [COL_ID, COL_REM]):
        partes.append(chunk[chunk[COL_ID].isin(ids)])
    rem = pd.concat(partes)
    valores = pd.to_numeric(rem[COL_REM].str.replace(".", "", regex=False).str.replace(",", ".", regex=False), errors="coerce")
    return valores.groupby(rem[COL_ID]).sum()


# ---------------------------------------------------------------- agregação

def contagem(serie: pd.Series) -> list[dict]:
    cont = serie.fillna("Não informado").value_counts()
    return [{"nome": str(k), "qtd": int(v)} for k, v in cont.items()]


def histograma(valores: pd.Series) -> list[dict]:
    limites = FAIXAS + [float("inf")]
    faixas = []
    for minimo, maximo in zip(limites[:-1], limites[1:]):
        qtd = int(((valores >= minimo) & (valores < maximo)).sum())
        faixas.append({"min": minimo, "max": None if maximo == float("inf") else maximo, "qtd": qtd})
    return faixas


def chave_padrao(p: str) -> int:
    return ROMANOS.get(p, int(p) if p.isdigit() else 99)


def agregar(atis: pd.DataFrame, rem: pd.Series, mes: str) -> dict:
    classe_padrao = (
        atis.assign(CLASSE_CARGO=atis["CLASSE_CARGO"].fillna("?"), PADRAO_CARGO=atis["PADRAO_CARGO"].fillna("?"))
        .groupby(["CLASSE_CARGO", "PADRAO_CARGO"]).size().reset_index(name="qtd")
    )
    classe_padrao = classe_padrao.sort_values(
        ["CLASSE_CARGO", "PADRAO_CARGO"], key=lambda c: c.map(chave_padrao) if c.name == "PADRAO_CARGO" else c
    )

    valores = rem.reindex(atis.index)
    valores = valores[valores > 0]

    return {
        "referencia": f"{mes[:4]}-{mes[4:]}",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fonte": {
            "nome": "Portal da Transparência — Servidores SIAPE",
            "url": URL_PAGINA,
            "arquivo": URL_DOWNLOAD.format(mes=mes),
        },
        "filtro_cargo": PADRAO_CARGO,
        "total": int(len(atis)),
        "por_situacao": contagem(atis["SITUACAO_VINCULO"]),
        "por_orgao_exercicio": contagem(atis["ORG_EXERCICIO"]),
        "por_orgao_lotacao": contagem(atis["ORG_LOTACAO"]),
        "por_uf": contagem(atis["UF"]),
        "por_classe_padrao": [
            {"classe": r.CLASSE_CARGO, "padrao": r.PADRAO_CARGO, "qtd": int(r.qtd)}
            for r in classe_padrao.itertuples()
        ],
        "funcao": {
            "com_funcao": int(atis["FUNCAO"].notna().sum()),
            "por_sigla": contagem(atis["FUNCAO"].dropna()),
        },
        "remuneracao_basica_bruta": {
            "n": int(len(valores)),
            "media": round(float(valores.mean()), 2),
            "mediana": round(float(valores.median()), 2),
            "p10": round(float(valores.quantile(0.10)), 2),
            "p90": round(float(valores.quantile(0.90)), 2),
            "histograma": histograma(valores),
        },
    }


# ---------------------------------------------------------------- saída

def salvar(resumo: dict, mes: str) -> None:
    DIR_DADOS.mkdir(exist_ok=True)
    texto = json.dumps(resumo, ensure_ascii=False, indent=2)
    (DIR_DADOS / f"{mes}.json").write_text(texto, encoding="utf-8")
    atualizar_indice()


def atualizar_indice() -> None:
    """Reconstrói index.json e latest.json a partir dos AAAAMM.json existentes."""
    meses = []
    for arq in sorted(DIR_DADOS.glob("[0-9]" * 6 + ".json")):
        d = json.loads(arq.read_text(encoding="utf-8"))
        meses.append({
            "mes": d["referencia"],
            "arquivo": arq.name,
            "total": d["total"],
            "mediana": d["remuneracao_basica_bruta"]["mediana"],
        })
    if not meses:
        return
    # Só regrava quando a lista muda; senão cada execução geraria um commit só com o horário.
    arq_indice = DIR_DADOS / "index.json"
    anterior = json.loads(arq_indice.read_text(encoding="utf-8")) if arq_indice.exists() else {}
    if anterior.get("meses") != meses:
        indice = {"atualizado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "meses": meses}
        arq_indice.write_text(json.dumps(indice, ensure_ascii=False, indent=2), encoding="utf-8")
    ultimo = DIR_DADOS / meses[-1]["arquivo"]
    (DIR_DADOS / "latest.json").write_text(ultimo.read_text(encoding="utf-8"), encoding="utf-8")


def verificar_coordenadas() -> None:
    """Avisa sobre órgãos de exercício do mês mais recente sem linha em orgaos_coordenadas.csv."""
    latest = DIR_DADOS / "latest.json"
    if not latest.exists() or not ARQ_COORDENADAS.exists():
        return
    conhecidos = set(pd.read_csv(ARQ_COORDENADAS, sep=";", dtype=str)["orgao_siape"])
    orgaos = json.loads(latest.read_text(encoding="utf-8"))["por_orgao_exercicio"]
    for o in orgaos:
        if o["nome"] not in conhecidos:
            # Formato de anotação do GitHub Actions; no terminal aparece como texto comum.
            print(f"::warning::Órgão sem coordenadas em {ARQ_COORDENADAS.name}: {o['nome']} ({o['qtd']} ATIs)")


def processar(s: requests.Session, mes: str, padrao: re.Pattern, manter_zip: bool) -> dict:
    caminho = baixar(s, mes)
    try:
        with zipfile.ZipFile(caminho) as zf:
            print("Lendo cadastro...")
            atis = ler_cadastro(zf, mes, padrao)
            print(f"  {len(atis)} ATIs")
            print("Lendo remuneração...")
            rem = ler_remuneracao(zf, mes, set(atis.index))
        return agregar(atis, rem, mes)
    finally:
        if not manter_zip:
            caminho.unlink(missing_ok=True)


def main() -> int:
    global PADRAO_CARGO
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mes", help="mês AAAAMM; padrão: mais recente disponível")
    p.add_argument("--force", action="store_true", help="reprocessa mesmo se data/AAAAMM.json existir")
    p.add_argument("--padrao-cargo", default=PADRAO_CARGO, help="regex aplicada a DESCRICAO_CARGO normalizada")
    p.add_argument("--manter-zip", action="store_true", help="mantém o ZIP em .cache/ após processar")
    args = p.parse_args()
    PADRAO_CARGO = args.padrao_cargo
    padrao = re.compile(PADRAO_CARGO)

    s = sessao()
    mes = args.mes or descobrir_mes(s, date.today())
    if not mes:
        print("Nenhum mês disponível nos últimos meses.", file=sys.stderr)
        return 1
    if (DIR_DADOS / f"{mes}.json").exists() and not args.force:
        print(f"{mes} já processado; use --force para refazer.")
        atualizar_indice()
        verificar_coordenadas()
        return 0

    resumo = processar(s, mes, padrao, args.manter_zip)
    if resumo["total"] == 0:
        print("Nenhum servidor corresponde ao padrão de cargo; nada salvo.", file=sys.stderr)
        return 1
    salvar(resumo, mes)
    print(f"Salvo data/{mes}.json — {resumo['total']} ATIs, "
          f"mediana R$ {resumo['remuneracao_basica_bruta']['mediana']:,.2f}")
    verificar_coordenadas()
    return 0


if __name__ == "__main__":
    sys.exit(main())
