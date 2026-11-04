"""Servicio de extracción de certificados de incapacidad (lo consume el backend Nest).

Ejecutar:  uvicorn app.main:app --host 127.0.0.1 --port 8001
Solo debe escuchar en localhost: el backend es el único cliente.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.extract import FORMATS, extract
from app.schema import ExtractionResult

def _load_env_file(path: Path) -> None:
    """Carga extractor/.env (KEY=valor) sin pisar variables ya definidas en el entorno."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file(Path(__file__).resolve().parents[1] / ".env")

MAX_FILE_BYTES = 15 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/tiff", "image/webp", "application/octet-stream"}

app = FastAPI(title="CargoPlanner inability extractor", version="1.0.0")


def _check_key(api_key: str | None) -> None:
    # La clave compartida con el backend va en EXTRACTOR_API_KEY (nunca en el código)
    expected = os.environ.get("EXTRACTOR_API_KEY")
    if expected and not (api_key and secrets.compare_digest(api_key, expected)):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


@app.get("/health")
def health():
    from app import vision

    return {"status": "ok", "formats": [m.FORMAT for m in FORMATS], "ai": vision.enabled(), "model": vision.model_name() if vision.enabled() else None}


@app.post("/extract", response_model=ExtractionResult)
async def extract_certificate(
    file: UploadFile = File(..., description="Scanned or digital certificate (PDF or image)"),
    expectedDni: str | None = Form(None, description="Document number of the selected worker"),
    expectedEmployerNit: str | None = Form(None, description="NIT of the company of the current contract"),
    engine: str | None = Form(None, description="Optional: 'local' to skip the AI model, 'openai' to force it"),
    x_api_key: str | None = Header(None),
):
    _check_key(x_api_key)
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type {file.content_type}")
    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 15 MB")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if engine not in (None, "", "local", "openai"):
        raise HTTPException(status_code=400, detail="engine must be 'local' or 'openai'")
    try:
        # OCR y llamadas al modelo bloquean: se ejecutan fuera del event loop
        return await run_in_threadpool(extract, data, file.filename or "", expectedDni, expectedEmployerNit, engine or None)
    except Exception as error:  # documento dañado o ilegible
        raise HTTPException(status_code=422, detail=f"Could not read the document: {error}") from error
