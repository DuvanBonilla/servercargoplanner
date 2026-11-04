"""Lectura del certificado con un modelo de visión de OpenAI (escaneos).

Se envía SOLO la página del certificado como imagen y el modelo devuelve los
mismos campos que los lectores locales, con un esquema JSON estricto. Cada
llamada reporta tokens y costo para registrarlos en la base de datos.
"""
from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from functools import lru_cache

import pymupdf

from app.schema import ExtractedField

# Precios estándar (USD por 1M de tokens) tomados de la página oficial de OpenAI
# (octubre 2026). Se pueden sobrescribir con OPENAI_PRICE_INPUT_PER_1M y
# OPENAI_PRICE_OUTPUT_PER_1M si cambian o se usa otro modelo.
PRICES_PER_1M = {
    "gpt-6-luna": (0.10, 0.50),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-5-nano": (0.05, 0.40),
    "gpt-5-mini": (0.25, 2.00),
}
DEFAULT_MODEL = "gpt-6-luna"
IMAGE_DPI = 200

FIELD_KEYS = [
    "certificateNumber", "authorizationNumber", "entityFilingNumber", "consecutiveNumber",
    "issueDate", "receptionDate", "workerDocumentType", "workerDocumentNumber", "workerName",
    "employerNit", "employerName", "ipsCode", "ipsName", "days", "startDate", "endDate",
    "classification", "diagnosisPrincipal", "diagnosesRelated", "origin", "attentionType",
    "generationType", "serviceModality", "retroactive", "professionalDocument",
    "professionalName", "medicalRegistry", "professionalSpecialty",
    # Texto tal como aparece en el certificado (auditoría; los campos de arriba van normalizados)
    "contingencyText", "presumedOriginText", "attentionCauseText", "extensionText", "certificateStatus",
    "filingDate", "issuePlace",
    # Liquidación de la entidad (Mutualser y otras la imprimen): base para el recobro
    "ibc", "entityPaidDays", "paymentPercentage", "subsidyValue", "adjustmentValue", "approvedTotal",
]


def _nullable(kind: str, enum: list[str] | None = None, description: str = "") -> dict:
    schema: dict = {"type": [kind, "null"], "description": description}
    if enum:
        schema["enum"] = enum + [None]
    return schema


SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["isCertificate", "entityType", "entityName", "entityNit", *FIELD_KEYS, "uncertainFields"],
    "properties": {
        "isCertificate": {"type": "boolean", "description": "true if the page is an inability/leave certificate (not a medical history or other support)"},
        "entityType": {"type": "string", "enum": ["EPS", "ARL", "UNKNOWN"]},
        "entityName": _nullable("string", description="EPS/ARL responsible for the inability, as printed. In clinic/IPS formats (header with the clinic name) it is the value of 'Entidad Promotora de Salud (EPS)' / 'Entidad Adaptada' / ARL, never the clinic"),
        "entityNit": _nullable("string", description="NIT of that EPS/ARL with check digit if printed, e.g. 900156264-2; null if only the clinic NIT is printed"),
        "certificateNumber": _nullable("string", description="Inability number of the entity (digits only). Nueva EPS: 'Nro' (on the same row as the first 'No. de') or 'Nro. Incapacidad EPS'; Sura: 'Nro. 0 - NNNN' -> NNNN; Mutualser: 'No. Incapacidad'"),
        "authorizationNumber": _nullable("string", description="Authorization number, digits only. Nueva EPS: the FIRST 'No. de' (top row, next to 'Nro') or 'No. de Aut Servicio'. Never the number next to 'Oficina'"),
        "entityFilingNumber": _nullable("string", description="Filing (radicado) number only when it is printed as a separate field from the certificate number; otherwise null. Never the number next to 'Oficina'"),
        "consecutiveNumber": _nullable("string", description="'Consecutivo' if printed, digits only"),
        "issueDate": _nullable("string", description="Issue/expedition date YYYY-MM-DD"),
        "receptionDate": _nullable("string", description="'Fecha Recepción' YYYY-MM-DD"),
        "filingDate": _nullable("string", description="'Fecha Radicación' printed by the entity, YYYY-MM-DD"),
        "issuePlace": _nullable("string", description="'Lugar de Expedición' as printed, e.g. MAGDALENA - SANTA MARTA"),
        "workerDocumentType": _nullable("string", ["CC", "CE", "TI", "PA", "PT", "RC"]),
        "workerDocumentNumber": _nullable("string", description="Document of the affiliate/cotizante, digits only"),
        "workerName": _nullable("string", description="Full name of the affiliate/cotizante"),
        "employerNit": _nullable("string", description="Employer NIT, digits only without check digit"),
        "employerName": _nullable("string"),
        "ipsCode": _nullable("string", description="NIT or code of the IPS that attended, digits only"),
        "ipsName": _nullable("string"),
        "days": _nullable("integer", description="Days of inability as printed"),
        "startDate": _nullable("string", description="Start date YYYY-MM-DD"),
        "endDate": _nullable("string", description="End date YYYY-MM-DD"),
        "classification": _nullable("string", ["INITIAL", "EXTENSION"], "INICIAL -> INITIAL; PRÓRROGA/Prórroga SI -> EXTENSION; Prórroga NO -> INITIAL"),
        "diagnosisPrincipal": _nullable("string", description="Principal diagnosis CIE-10 code, uppercase without dots, e.g. K409"),
        "diagnosesRelated": {
            "type": ["array", "null"],
            "items": {"type": "string"},
            "description": "EVERY related/secondary diagnosis CIE-10 code printed (Diagnóstico relacionado 1, 2, 3...), in order; null if none or 'NO REGISTRA'/'No aplica'",
        },
        "origin": _nullable("string", ["GENERAL", "LABOR", "MATERNITY", "PATERNITY"], "Enfermedad general/común and accidente de tránsito -> GENERAL; accidente de trabajo/enfermedad laboral -> LABOR; licencia de maternidad -> MATERNITY; paternidad -> PATERNITY"),
        "attentionType": _nullable("string", ["OUTPATIENT", "INPATIENT"], "AMBULATORIA -> OUTPATIENT; HOSPITALARIA -> INPATIENT"),
        "generationType": _nullable("string", ["GENERATION", "TRANSCRIPTION"]),
        "serviceModality": _nullable("string", description="e.g. INTRAMURAL, EXTRAMURAL, TELEMEDICINA"),
        "retroactive": _nullable("boolean"),
        "professionalDocument": _nullable("string", description="Document of the responsible professional, digits only"),
        "professionalName": _nullable("string"),
        "medicalRegistry": _nullable("string", description="Medical registry number, digits only"),
        "professionalSpecialty": _nullable("string"),
        "contingencyText": _nullable("string", description="'Contingencia' exactly as printed, e.g. 'Incapacidad Enfermedad General'"),
        "presumedOriginText": _nullable("string", description="'Presunto Origen' exactly as printed, e.g. 'Común'"),
        "attentionCauseText": _nullable("string", description="'Causa de la Atención' / 'Causa que motiva la atención' exactly as printed"),
        "extensionText": _nullable("string", description="Prórroga/Clasificación value exactly as printed, e.g. 'Sí', 'NO', 'PRORROGA', 'INICIAL'"),
        "certificateStatus": _nullable("string", description="'Estado' exactly as printed, e.g. 'AUTORIZADA', 'En proceso de liquidación'"),
        "ibc": _nullable("number", description="'IBC' / 'Ingreso Base de Cotización/Liquidación' in pesos as a plain number (1,781,970 -> 1781970); null if empty"),
        "entityPaidDays": _nullable("integer", description="Days liquidated by the entity, e.g. 'Días LIQ EPS'"),
        "paymentPercentage": _nullable("number", description="Liquidation percentage as a number, e.g. '66.67 %' -> 66.67"),
        "subsidyValue": _nullable("number", description="'Valor Subsidio' in pesos as a plain number"),
        "adjustmentValue": _nullable("number", description="'Valor Ajuste' in pesos as a plain number"),
        "approvedTotal": _nullable("number", description="'Total Aprobado' in pesos as a plain number"),
        "uncertainFields": {
            "type": "array",
            "items": {"type": "string", "enum": FIELD_KEYS},
            "description": "Fields whose characters are blurry, partially hidden or ambiguous (e.g. a year digit that could be 5 or 6)",
        },
    },
}

INSTRUCTIONS = (
    "You read Colombian inability certificates (certificados de incapacidad o licencia) issued by EPS or ARL "
    "(Nueva EPS, Sura, Mutualser, ARL...). Extract ONLY what is printed on the image; never infer or complete values "
    "that are not visible (for example, do not compute a start date from the number of days). Use null when a field "
    "is not present or not legible. Normalize dates to YYYY-MM-DD and numbers to digits only. Ignore stamps, "
    "handwritten notes and watermarks. If any character of a value is blurry or ambiguous, still give your best "
    "reading but list the field in uncertainFields. If the page is not an inability certificate (e.g. a medical "
    "history page), set isCertificate to false. Fill both the normalized fields (classification, origin...) and the "
    "*Text fields with the literal printed values. In money values the separators are thousands separators."
)


@dataclass
class VisionResult:
    is_certificate: bool
    entity: dict
    fields: dict[str, ExtractedField]
    usage: dict


# Si la cuenta se queda sin créditos o la clave es inválida, no se reintenta en
# cada documento (cada intento demora): se pausa el uso de la IA unos minutos
PAUSE_SECONDS = 10 * 60
_paused_until = 0.0
_pause_reason = ""


class VisionUnavailable(Exception):
    """La IA no se puede usar por ahora (sin créditos, clave inválida o pausada)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def enabled() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def _pause(code: str, message: str) -> VisionUnavailable:
    global _paused_until, _pause_reason
    _paused_until = time.monotonic() + PAUSE_SECONDS
    _pause_reason = code
    return VisionUnavailable(code, message)


def model_name() -> str:
    return os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)


@lru_cache(maxsize=1)
def _client():
    from openai import OpenAI

    return OpenAI(timeout=float(os.environ.get("OPENAI_TIMEOUT_SECONDS", "60")), max_retries=1)


def _prices(model: str) -> tuple[float, float]:
    base = next((p for name, p in PRICES_PER_1M.items() if model.startswith(name)), (0.0, 0.0))
    return (
        float(os.environ.get("OPENAI_PRICE_INPUT_PER_1M", base[0])),
        float(os.environ.get("OPENAI_PRICE_OUTPUT_PER_1M", base[1])),
    )


def page_image(page: pymupdf.Page) -> str:
    """Página como JPEG en base64 (data URL) para enviarla al modelo."""
    pix = page.get_pixmap(dpi=IMAGE_DPI)
    data = pix.tobytes("jpeg", jpg_quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")


def read_certificate(page: pymupdf.Page, model: str | None = None) -> VisionResult:
    from openai import AuthenticationError, PermissionDeniedError, RateLimitError

    if time.monotonic() < _paused_until:
        raise VisionUnavailable(_pause_reason, "AI use is paused after a previous account error")
    model = model or model_name()
    try:
        response = _create(page, model)
    except RateLimitError as error:
        if "insufficient_quota" in str(error) or "no credits" in str(error).lower():
            raise _pause("AI_NO_CREDITS", "the OpenAI account has no credits") from error
        raise
    except (AuthenticationError, PermissionDeniedError) as error:
        raise _pause("AI_INVALID_KEY", "the OpenAI API key was rejected") from error
    return _parse(response, model)


def _create(page: pymupdf.Page, model: str):
    return _client().responses.create(
        model=model,
        instructions=INSTRUCTIONS,
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Extract the fields of this certificate."},
                {"type": "input_image", "image_url": page_image(page), "detail": "high"},
            ],
        }],
        text={"format": {"type": "json_schema", "name": "inability_certificate", "schema": SCHEMA, "strict": True}},
    )


def _parse(response, model: str) -> VisionResult:
    data = json.loads(response.output_text)
    uncertain = set(data.get("uncertainFields") or [])
    # Lo que el modelo lee de una imagen no es "seguro" hasta validarlo contra
    # el sistema (cédula del trabajador, días contra fechas): medium por defecto
    fields = {
        key: ExtractedField(value=data.get(key), confidence="low" if key in uncertain else "medium")
        for key in FIELD_KEYS
        if data.get(key) not in (None, "")
    }

    input_price, output_price = _prices(model)
    usage = response.usage
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    return VisionResult(
        is_certificate=bool(data.get("isCertificate")),
        entity={"type": data.get("entityType") or "UNKNOWN", "name": data.get("entityName"), "nit": data.get("entityNit")},
        fields=fields,
        usage={
            "provider": "openai",
            "model": model,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": input_tokens + output_tokens,
            "costUsd": round((input_tokens * input_price + output_tokens * output_price) / 1_000_000, 6),
        },
    )
