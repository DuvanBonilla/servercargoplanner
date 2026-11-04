"""Flujo con el modelo de visión, simulado (sin red ni costo).

Verifica que solo se envía la página del certificado (no la historia clínica),
que se reporta el consumo y que se aplican las validaciones.
"""
from datetime import datetime, timedelta

import pymupdf

from app import extract as extract_module
from app import vision
from app.schema import ExtractedField
from app.validate import COLOMBIA_TZ

TODAY = datetime.now(COLOMBIA_TZ).date()


def _pdf(pages_text: list[str]) -> bytes:
    """PDF de imágenes (sin capa de texto), una página por texto."""
    doc = pymupdf.open()
    for text in pages_text:
        tmp = pymupdf.open()
        page = tmp.new_page(width=612, height=792)
        page.insert_text((72, 80), text, fontsize=16)
        pix = page.get_pixmap(dpi=200)
        img_page = doc.new_page(width=612, height=792)
        img_page.insert_image(img_page.rect, pixmap=pix)
    return doc.tobytes()


def _fields(start, end, days):
    return {
        "certificateNumber": ExtractedField(value="0000000001", confidence="medium"),
        "workerDocumentNumber": ExtractedField(value="1000000001", confidence="medium"),
        "startDate": ExtractedField(value=start.isoformat(), confidence="medium"),
        "endDate": ExtractedField(value=end.isoformat(), confidence="low"),
        "days": ExtractedField(value=days, confidence="medium"),
        "diagnosisPrincipal": ExtractedField(value="j06.9", confidence="medium"),
        "origin": ExtractedField(value="GENERAL", confidence="medium"),
    }


def test_only_certificate_page_is_sent(monkeypatch):
    data = _pdf(["HISTORIA CLINICA - EVOLUCION", "NUEVA EPS S.A CERTIFICADO DE INCAPACIDAD", "HISTORIA CLINICA - ANEXOS"])
    sent_pages = []
    usage = {"provider": "openai", "model": "gpt-6-luna", "inputTokens": 1000, "outputTokens": 200, "totalTokens": 1200, "costUsd": 0.0002}

    def fake_read(page, model=None):
        sent_pages.append(page.number + 1)
        return vision.VisionResult(
            is_certificate=True,
            entity={"type": "EPS", "name": "NUEVA EPS S.A.", "nit": "900156264-2"},
            fields=_fields(TODAY - timedelta(days=5), TODAY - timedelta(days=3), 3),
            usage=usage,
        )

    monkeypatch.setattr(vision, "enabled", lambda: True)
    monkeypatch.setattr(vision, "read_certificate", fake_read)
    result = extract_module.extract(data, "lote.pdf", expected_dni="1000000001")

    assert sent_pages == [2]  # solo la hoja del certificado
    assert result.engine == "openai" and result.page == 2 and result.format == "NUEVA_EPS"
    assert result.usage.costUsd == 0.0002
    assert result.fields["diagnosisPrincipal"].value == "J069"  # normalizado
    assert result.fields["workerDocumentNumber"].confidence == "high"  # validado contra el trabajador
    assert result.fields["days"].confidence == "high"  # días cuadran con las fechas
    assert result.fields["entityFilingNumber"].value == "0000000001"  # Nueva EPS: "Nro" = radicado
    assert not result.warnings


def test_year_far_from_today_is_flagged(monkeypatch):
    """Típico error de lectura del año (2025 en vez de 2026): los días cuadran pero la fecha es de hace un año."""
    data = _pdf(["NUEVA EPS S.A CERTIFICADO DE INCAPACIDAD"])
    one_year_ago = TODAY - timedelta(days=365)
    usage = {"provider": "openai", "model": "gpt-6-luna", "inputTokens": 1, "outputTokens": 1, "totalTokens": 2, "costUsd": 0.0}

    monkeypatch.setattr(vision, "enabled", lambda: True)
    monkeypatch.setattr(vision, "read_certificate", lambda page, model=None: vision.VisionResult(
        is_certificate=True, entity={"type": "EPS", "name": None, "nit": None},
        fields=_fields(one_year_ago, one_year_ago + timedelta(days=2), 3), usage=usage))
    result = extract_module.extract(data, "cert.pdf")
    assert any(w.startswith("DATE_OUT_OF_RANGE") for w in result.warnings)
    assert result.fields["startDate"].confidence == "low"


def test_ai_without_credits_falls_back_to_local(monkeypatch):
    data = _pdf(["NUEVA EPS S.A CERTIFICADO DE INCAPACIDAD"])

    def no_credits(page, model=None):
        raise vision.VisionUnavailable("AI_NO_CREDITS", "the OpenAI account has no credits")

    monkeypatch.setattr(vision, "enabled", lambda: True)
    monkeypatch.setattr(vision, "read_certificate", no_credits)
    result = extract_module.extract(data, "cert.pdf")
    assert result.engine == "local"
    assert any(w.startswith("AI_NO_CREDITS") for w in result.warnings)
