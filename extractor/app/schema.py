"""Estructura del resultado que recibe el backend (claves en inglés, como la API)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Confidence = Literal["high", "medium", "low"]


class ExtractedField(BaseModel):
    value: Any = None
    # high: etiqueta y formato correctos; medium: corregido/inferido; low: heurística
    confidence: Confidence = "low"


class Entity(BaseModel):
    type: Literal["EPS", "ARL", "UNKNOWN"] = "UNKNOWN"
    name: str | None = None
    nit: str | None = None


class AiUsage(BaseModel):
    provider: str = "openai"
    model: str
    inputTokens: int
    outputTokens: int
    totalTokens: int
    costUsd: float


class ExtractionResult(BaseModel):
    format: str = Field(description="Detected certificate format, e.g. NUEVA_EPS, SURA, UNKNOWN")
    source: Literal["text", "ocr"] = Field(description="text = PDF with text layer, ocr = scanned image")
    engine: Literal["local", "openai"] = Field(default="local", description="local = text layer/local OCR, openai = AI vision model")
    page: int | None = Field(default=None, description="Page where the certificate was found")
    entity: Entity = Entity()
    fields: dict[str, ExtractedField] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list, description="Checks the user must review")
    pagesRead: int = 0
    usage: AiUsage | None = Field(default=None, description="AI consumption of this extraction (null when no AI was used)")
    elapsedMs: int = 0
