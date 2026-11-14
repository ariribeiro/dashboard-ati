"""Testes do pipeline de economicidade da ATI (dados sintéticos, sem rede).

    python -m pytest scripts/test_economicidade.py     # ou: python scripts/test_economicidade.py
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import economicidade_ati as e  # noqa: E402


def test_chave_pncp():
    assert e.chave_pncp("26664015000148-2-000005/2024") == ("26664015000148", 2024, 5)
    assert e.chave_pncp("26664015000148-1-000005/2024") is None  # compra, não contrato
    assert e.chave_pncp(None) is None


def test_eh_tic():
    assert e.eh_tic({"nomeCategoria": "Informática (TIC)", "objeto": "qualquer"})
    assert e.eh_tic({"nomeCategoria": "Serviços", "objeto": "Contratação de links de internet para a sede"})
    assert not e.eh_tic({"nomeCategoria": "Mão de Obra", "objeto": "Serviços de limpeza e conservação"})
    assert not e.eh_tic({"nomeCategoria": "Compras", "objeto": "Aquisição de água mineral"})


def test_acrescimo_ignora_reajuste_e_conta_so_acrescimo():
    termos = [
        # reajuste: o valor sobe, mas não é acréscimo de escopo
        {"sequencialTermoContrato": 1, "valorGlobal": 110.0, "qualificacaoReajuste": True, "qualificacaoAcrescimoSupressao": False},
        # acréscimo sem valorAcrescido informado: mede contra o valor anterior (110 -> 130)
        {"sequencialTermoContrato": 2, "valorGlobal": 130.0, "qualificacaoAcrescimoSupressao": True},
        # supressão: não conta como perda
        {"sequencialTermoContrato": 3, "valorGlobal": 120.0, "qualificacaoAcrescimoSupressao": True},
        # prorrogação de 365 dias
        {"sequencialTermoContrato": 4, "valorGlobal": 120.0, "qualificacaoVigencia": True, "prazoAditadoDias": 365},
    ]
    acrescimo, dias = e.acrescimo_do_contrato(100.0, termos)
    assert acrescimo == 20.0
    assert dias == 365


def test_acrescimo_usa_valor_acrescido_quando_informado():
    termos = [{"sequencialTermoContrato": 1, "valorGlobal": 150.0, "valorAcrescido": 40.0, "qualificacaoAcrescimoSupressao": True}]
    assert e.acrescimo_do_contrato(100.0, termos)[0] == 40.0


def test_acrescimo_termos_fora_de_ordem():
    termos = [
        {"sequencialTermoContrato": 2, "valorGlobal": 130.0, "qualificacaoAcrescimoSupressao": True},
        {"sequencialTermoContrato": 1, "valorGlobal": 110.0, "qualificacaoAcrescimoSupressao": True},
    ]
    assert e.acrescimo_do_contrato(100.0, termos)[0] == 30.0  # 10 + 20, na ordem do sequencial


def test_t_critico_conhecidos():
    assert abs(e.t_critico(30) - 2.042) < 0.01
    assert abs(e.t_critico(60) - 2.000) < 0.01
    assert abs(e.t_critico(10) - 2.228) < 0.02


def _painel(beta, ruido, g=40, anos=5, seed=1):
    rng = np.random.default_rng(seed)
    org, ano, x, y = [], [], [], []
    for i in range(g):
        efeito_org = rng.normal(0, 0.05)
        base_x = rng.uniform(1, 8)
        for t in range(anos):
            xi = max(base_x + rng.normal(0, 1.5), 0.1)
            org.append(i); ano.append(2021 + t); x.append(xi)
            y.append(efeito_org + 0.01 * t + beta * xi + rng.normal(0, ruido))
    return np.array(y), np.array(x), np.array(org), np.array(ano)


def test_efeitos_fixos_recupera_efeito_conhecido():
    y, x, org, ano = _painel(beta=-0.01, ruido=0.01)
    r = e.efeitos_fixos(y, x, org, ano)
    assert abs(r["beta"] - (-0.01)) < 0.002
    assert r["ic95"][0] < -0.01 < r["ic95"][1]
    assert r["ic95"][1] < 0  # efeito forte e pouco ruído: intervalo todo negativo
    assert r["orgaos"] == 40


def test_efeitos_fixos_sem_efeito_cobre_zero():
    y, x, org, ano = _painel(beta=0.0, ruido=0.05)
    r = e.efeitos_fixos(y, x, org, ano)
    assert r["ic95"][0] < 0 < r["ic95"][1]
    assert e.veredito(r["ic95"]) == "inconclusiva"


def test_efeitos_fixos_ignora_diferenca_fixa_entre_orgaos():
    # Órgãos com mais ATI têm perda maior só por nível (confusão); dentro do órgão, x não importa.
    rng = np.random.default_rng(3)
    org, ano, x, y = [], [], [], []
    for i in range(40):
        nivel = i / 10.0
        for t in range(5):
            org.append(i); ano.append(2021 + t)
            x.append(nivel + rng.normal(0, 0.3)); y.append(0.1 * nivel + rng.normal(0, 0.01))
    r = e.efeitos_fixos(np.array(y), np.array(x), np.array(org), np.array(ano))
    assert abs(r["beta"]) < 0.02  # sem efeito fixo, daria ~0,1


def test_efeitos_fixos_amostra_pequena_devolve_none():
    y, x, org, ano = _painel(beta=-0.01, ruido=0.01, g=5)
    assert e.efeitos_fixos(y, x, org, ano) is None


def test_veredito():
    assert e.veredito([-0.02, -0.005]) == "confirmada"
    assert e.veredito([-0.02, 0.01]) == "inconclusiva"
    assert e.veredito([0.005, 0.02]) == "refutada"
    assert e.veredito(None) == "sem_dados"


def test_taxa_saida_ignora_meses_de_entrada():
    meses = [{"mes": f"2024-{m:02d}", "total": t} for m, t in enumerate([100, 99, 98, 150, 149, 148], start=1)]
    # saldos: -1, -1, +52 (entrada, ignorado), -1, -1  -> 4 perdas sobre base 100+99+150+149
    taxa = e.taxa_saida_mensal(meses, janela=60, limiar=10)
    assert abs(taxa - 4 / (100 + 99 + 150 + 149)) < 1e-9


def test_extrapolacao_da_amostra_e_proporcional():
    assert e.ef_amostra(500, 1000, 200) == 100


if __name__ == "__main__":
    falhas = 0
    for nome, fn in sorted(globals().items()):
        if nome.startswith("test_") and callable(fn):
            try:
                fn()
                print("ok  ", nome)
            except AssertionError as ex:
                falhas += 1
                print("FALHA", nome, ex)
    sys.exit(1 if falhas else 0)
