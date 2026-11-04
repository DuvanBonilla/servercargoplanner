"""Pruebas con certificados reales.

Los documentos y los valores esperados contienen datos de salud, así que NO están
en el repositorio: se leen de la carpeta indicada en SAMPLES_DIR, que debe tener
un archivo expected.json con la forma:

    {"NUEVA EPS.pdf": {"expectedDni": "...", "format": "NUEVA_EPS", "fields": {"days": 30, ...}}}

Si SAMPLES_DIR no está definida, estas pruebas se omiten.
"""
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.extract import extract
from app.main import app

SAMPLES_DIR = os.environ.get("SAMPLES_DIR")
pytestmark = pytest.mark.skipif(not SAMPLES_DIR, reason="SAMPLES_DIR not set (real certificates are not versioned)")


def _cases():
    if not SAMPLES_DIR:
        return []
    expected = json.loads((Path(SAMPLES_DIR) / "expected.json").read_text(encoding="utf-8"))
    return sorted(expected.items())


@pytest.mark.parametrize("name,case", _cases())
def test_certificate(name, case):
    data = (Path(SAMPLES_DIR) / name).read_bytes()
    # Motor local: estas pruebas no deben consumir créditos de la IA
    result = extract(data, name, expected_dni=case.get("expectedDni"), engine="local")
    assert result.format == case["format"]
    for key, value in case["fields"].items():
        assert result.fields[key].value == value, f"{name}: {key}"
    assert not [w for w in result.warnings if w.startswith(("WORKER_MISMATCH", "FIELDS_MISSING", "DAYS_MISMATCH"))], result.warnings


def test_api_requires_key_and_extracts(monkeypatch):
    monkeypatch.setenv("EXTRACTOR_API_KEY", "test-key")
    client = TestClient(app)
    name, case = _cases()[0]
    data = (Path(SAMPLES_DIR) / name).read_bytes()
    files = {"file": (name, data, "application/pdf")}

    assert client.post("/extract", files=files).status_code == 401
    response = client.post("/extract", files=files, data={"expectedDni": case.get("expectedDni"), "engine": "local"}, headers={"X-API-Key": "test-key"})
    assert response.status_code == 200
    assert response.json()["format"] == case["format"]
