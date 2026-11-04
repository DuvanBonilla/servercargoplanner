"""Validaciones cruzadas: lo que no cuadra se marca para que el usuario lo revise."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.normalize import digits
from app.schema import ExtractedField


# Colombia es siempre UTC-5, sin horario de verano (mismo criterio que dateColombia.ts del backend)
COLOMBIA_TZ = timezone(timedelta(hours=-5))

# Rango esperado para el inicio de una incapacidad respecto a hoy
MAX_DAYS_IN_PAST = 90
MAX_DAYS_IN_FUTURE = 30


def _get(fields: dict[str, ExtractedField], key: str):
    f = fields.get(key)
    return f.value if f else None


def _lower(fields: dict[str, ExtractedField], key: str) -> None:
    if key in fields and fields[key].value is not None:
        fields[key].confidence = "low"


def validate(fields: dict[str, ExtractedField], page_text: str, expected_dni: str | None, expected_employer_nit: str | None) -> list[str]:
    warnings: list[str] = []

    # Trabajador: el certificado debe ser del trabajador seleccionado en CargoPlanner
    if expected_dni:
        expected = digits(expected_dni)
        read = digits(_get(fields, "workerDocumentNumber") or "")
        if read == expected:
            fields["workerDocumentNumber"].confidence = "high"
        elif expected and expected in digits(page_text):
            # El OCR no lo ubicó por etiqueta pero el número sí está en el documento
            fields["workerDocumentNumber"] = ExtractedField(value=expected, confidence="medium")
        else:
            warnings.append(
                f"WORKER_MISMATCH: document number read ({read or 'none'}) does not match the selected worker ({expected})"
            )
            _lower(fields, "workerDocumentNumber")

    if expected_employer_nit and _get(fields, "employerNit"):
        if digits(expected_employer_nit)[:9] != digits(_get(fields, "employerNit"))[:9]:
            warnings.append("EMPLOYER_MISMATCH: employer NIT on the certificate differs from the company of the current contract")
            _lower(fields, "employerNit")

    # Fechas y días: fin = inicio + días - 1
    start, end, days = _get(fields, "startDate"), _get(fields, "endDate"), _get(fields, "days")
    if start and end and not days:
        inferred = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        if inferred > 0:
            fields["days"] = ExtractedField(value=inferred, confidence="medium")
            warnings.append("DAYS_INFERRED: days were not readable and were calculated from the dates")
            days = None  # no se usa para confirmar las fechas
    if start and end:
        start_d, end_d = date.fromisoformat(start), date.fromisoformat(end)
        if end_d < start_d:
            warnings.append("DATES_INVERTED: endDate is before startDate")
            _lower(fields, "startDate")
            _lower(fields, "endDate")
        elif days and (end_d - start_d).days + 1 != days:
            warnings.append(
                f"DAYS_MISMATCH: {days} days on the certificate but the dates cover {(end_d - start_d).days + 1} days"
            )
            _lower(fields, "days")
        elif days:
            for key in ("startDate", "endDate", "days"):
                fields[key].confidence = "high"
    elif days and start and not end:
        warnings.append("END_DATE_MISSING: end date could not be read")

    # Una incapacidad llega a la empresa en días: una fecha muy lejana suele ser un año mal leído
    if start:
        today = datetime.now(COLOMBIA_TZ).date()
        start_d = date.fromisoformat(start)
        if start_d < today - timedelta(days=MAX_DAYS_IN_PAST) or start_d > today + timedelta(days=MAX_DAYS_IN_FUTURE):
            warnings.append(f"DATE_OUT_OF_RANGE: start date {start} is far from today; verify the year")
            for key in ("startDate", "endDate", "issueDate", "receptionDate"):
                _lower(fields, key)

    if not _get(fields, "diagnosisPrincipal"):
        warnings.append("DIAGNOSIS_MISSING: principal diagnosis (CIE-10) could not be read")

    required = ["certificateNumber", "workerDocumentNumber", "startDate", "endDate", "diagnosisPrincipal", "origin"]
    missing = [k for k in required if not _get(fields, k)]
    if missing:
        warnings.append("FIELDS_MISSING: " + ", ".join(missing))
    return warnings
