"""Orquestación: ubica la página del certificado, la lee y valida los campos.

- PDF con texto (descargado del portal): lectores locales por formato (gratis y exactos).
- Escaneo: modelo de visión de OpenAI sobre la página del certificado únicamente.
  Si no hay API key o la llamada falla, se usa el OCR local como respaldo.
"""
from __future__ import annotations

import logging
import re
import time

from app import vision
from app.formats import nueva_eps, sura
from app.normalize import cie10, digits, plain
from app.reader import MIN_TEXT_CHARS, Page, header_text, image_dpi as page_image_dpi, open_document, read_page
from app.schema import Entity, ExtractedField, ExtractionResult
from app.validate import validate

log = logging.getLogger("extractor")

# Lectores locales. Para agregar uno (Mutualser, una ARL...): un módulo con
# FORMAT, ENTITY, matches(text) y parse(page), y registrarlo aquí.
FORMATS = [nueva_eps, sura]

# Formatos sin lector local que se reconocen por su título (los lee la IA).
# Mutualser: "Mutualser EPS / Certificado de Incapacidad"
TITLE_ONLY_FORMATS = {"MUTUALSER": ("MUTUALSER",)}

# Máximo de páginas a revisar: el archivo puede traer la historia clínica completa
MAX_PAGES = 15
# Máximo de páginas que se envían al modelo si el título no se pudo identificar
MAX_VISION_CALLS = 2


def detect(text: str):
    for module in FORMATS:
        if module.matches(text):
            return module
    return None


def _format_name(module, header: str, entity: Entity) -> str:
    if module:
        return module.FORMAT
    compact = re.sub(r"\s+", "", plain(header + " " + (entity.name or "")))
    for name, keywords in TITLE_ONLY_FORMATS.items():
        if any(k in compact for k in keywords):
            return name
    return f"AI_{entity.type}" if entity.type != "UNKNOWN" else "UNKNOWN"


def _is_certificate_header(text: str) -> bool:
    t = re.sub(r"\s+", "", plain(text))
    return "INCAPACIDAD" in t and ("CERTIFICADO" in t or "EMISION" in t) or "LICENCIA" in t and "CERTIFICADO" in t


def _low_resolution(page: Page, fields: dict[str, ExtractedField], keep: tuple[str, ...] = ()) -> list[str]:
    """En imágenes borrosas nada queda como "alta" confianza salvo lo validado contra el sistema (`keep`)."""
    if not page.low_resolution:
        return []
    for key, item in fields.items():
        if item.confidence == "high" and key not in keep:
            item.confidence = "medium"
    return [
        f"LOW_RESOLUTION: image of about {page.dpi} dpi; values may be misread, "
        "verify every field (scan at 200 dpi or more for reliable results)"
    ]


def _normalize_vision_fields(fields: dict[str, ExtractedField]) -> None:
    """Asegura el mismo formato que los lectores locales (solo dígitos, CIE-10)."""
    for key in ("certificateNumber", "authorizationNumber", "entityFilingNumber", "consecutiveNumber",
                "workerDocumentNumber", "employerNit", "ipsCode", "professionalDocument", "medicalRegistry"):
        if key in fields and fields[key].value is not None:
            fields[key].value = digits(str(fields[key].value)) or None
    if "employerNit" in fields and fields["employerNit"].value:
        fields["employerNit"].value = fields["employerNit"].value[:9]
    if "diagnosisPrincipal" in fields and fields["diagnosisPrincipal"].value is not None:
        code = cie10(str(fields["diagnosisPrincipal"].value))
        if code:
            fields["diagnosisPrincipal"].value = code
        else:
            del fields["diagnosisPrincipal"]
    if "diagnosesRelated" in fields:
        principal = fields["diagnosisPrincipal"].value if "diagnosisPrincipal" in fields else None
        codes: list[str] = []
        for value in fields["diagnosesRelated"].value or []:
            code = cie10(str(value))
            if code and code != principal and code not in codes:
                codes.append(code)
        fields["diagnosesRelated"].value = codes or None
    for key in [k for k, f in fields.items() if f.value in (None, "")]:
        del fields[key]


def _add_usage(total: dict | None, usage: dict) -> dict:
    """Suma el consumo de varias llamadas (se cobran también las páginas descartadas)."""
    if total is None:
        return dict(usage)
    for key in ("inputTokens", "outputTokens", "totalTokens", "costUsd"):
        total[key] = round(total[key] + usage[key], 6) if key == "costUsd" else total[key] + usage[key]
    return total


def _result(started: float, **kwargs) -> ExtractionResult:
    return ExtractionResult(elapsedMs=int((time.perf_counter() - started) * 1000), **kwargs)


def extract(
    data: bytes,
    filename: str = "",
    expected_dni: str | None = None,
    expected_employer_nit: str | None = None,
    engine: str | None = None,
) -> ExtractionResult:
    """engine: None = automático (visión para escaneos si hay API key), "local" o "openai"."""
    started = time.perf_counter()
    doc, image_dpi = open_document(data, filename)
    pages = range(min(doc.page_count, MAX_PAGES))

    # 1) PDF con texto: lector local del formato
    for index in pages:
        if len(doc[index].get_text().strip()) >= MIN_TEXT_CHARS:
            page = read_page(doc, index)
            module = detect(page.text)
            if module:
                fields = module.parse(page)
                return _result(
                    started, format=module.FORMAT, source="text", engine="local", page=page.number,
                    entity=module.ENTITY, fields=fields,
                    warnings=validate(fields, page.text, expected_dni, expected_employer_nit),
                    pagesRead=index + 1,
                )

    # 2) Escaneo: se identifica la página del certificado por su título
    headers = {index: header_text(doc[index]) for index in pages}
    candidates = [i for i in pages if _is_certificate_header(headers[i])] or list(pages)
    use_vision = engine == "openai" or (engine is None and vision.enabled())
    warnings: list[str] = []

    if use_vision:
        total_usage: dict | None = None
        for index in candidates[:MAX_VISION_CALLS]:
            try:
                result = vision.read_certificate(doc[index])
            except vision.VisionUnavailable as error:  # sin créditos o clave rechazada
                log.warning("AI unavailable: %s", error)
                warnings.append(f"{error.code}: {error}; local OCR was used, verify every field")
                break
            except Exception as error:  # sin conexión, tiempo agotado...
                log.exception("OpenAI vision failed")
                warnings.append(f"AI_UNAVAILABLE: the AI model could not read the document ({type(error).__name__}); local OCR was used")
                break
            total_usage = _add_usage(total_usage, result.usage)
            if not result.is_certificate:
                # La llamada se cobró aunque la página no fuera el certificado
                warnings.append(f"AI_SKIPPED_PAGE: page {index + 1} is not a certificate")
                continue
            fields = result.fields
            _normalize_vision_fields(fields)
            module = detect(headers[index])
            entity = Entity(**result.entity)
            if module and not entity.nit:
                entity = module.ENTITY
            if module is nueva_eps and "certificateNumber" in fields:
                # En Nueva EPS el "Nro" es a la vez el número de la incapacidad y el radicado de la EPS
                fields["entityFilingNumber"] = fields["certificateNumber"].model_copy()
            page = Page(number=index + 1, source="ocr", dpi=image_dpi or page_image_dpi(doc[index]))
            page_warnings = validate(fields, headers[index], expected_dni, expected_employer_nit)
            # La cédula comparada con el trabajador seleccionado sí es confiable aunque la imagen sea borrosa
            validated = ("workerDocumentNumber",) if expected_dni and not any(w.startswith("WORKER_MISMATCH") for w in page_warnings) else ()
            page_warnings = _low_resolution(page, fields, keep=validated) + page_warnings
            return _result(
                started, format=_format_name(module, headers[index], entity),
                source="ocr", engine="openai", page=page.number, entity=entity, fields=fields,
                warnings=[w for w in warnings if not w.startswith("AI_SKIPPED")] + page_warnings,
                pagesRead=len(headers), usage=total_usage,
            )
        else:
            if candidates[:MAX_VISION_CALLS]:
                return _result(
                    started, format="UNKNOWN", source="ocr", engine="openai",
                    warnings=["FORMAT_UNKNOWN: no inability certificate page was found; fill in the form manually"],
                    pagesRead=len(headers), usage=total_usage,
                )

    # 3) Respaldo: OCR local completo de las páginas candidatas
    for index in candidates[:3]:
        page = read_page(doc, index, image_dpi)
        module = detect(page.text)
        if module:
            fields = module.parse(page)
            return _result(
                started, format=module.FORMAT, source="ocr", engine="local", page=page.number,
                entity=module.ENTITY, fields=fields,
                warnings=warnings + _low_resolution(page, fields) + validate(fields, page.text, expected_dni, expected_employer_nit),
                pagesRead=len(headers),
            )

    return _result(
        started, format="UNKNOWN", source="ocr", engine="local",
        warnings=warnings + ["FORMAT_UNKNOWN: no supported certificate format was found; fill in the form manually"],
        pagesRead=len(headers),
    )
