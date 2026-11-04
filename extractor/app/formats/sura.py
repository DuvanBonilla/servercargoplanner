"""EPS SURAMERICANA S.A. 800088702 - CERTIFICADO DE INCAPACIDAD / LICENCIA Nro. 0 - NNNNNNNN.

Tabla de etiqueta/valor. Las fechas de inicio y fin vienen en palabras
("SÁBADO 08 DE AGOSTO DE 2026") y en el escaneo la marca de agua "EPS SURA"
ensucia el OCR (ej. "Afiliado" se lee "Atade", "M211" se lee "IM211").
"""
from __future__ import annotations

import re

from app.formats.common import ORIGINS, column_value, field, find_label, keyword, value_after
from app.normalize import cie10, digits, document, iso, parse_numeric_date, parse_word_dates, plain
from app.reader import Page
from app.schema import Entity, ExtractedField

FORMAT = "SURA"
ENTITY = Entity(type="EPS", name="EPS SURAMERICANA S.A.", nit="800088702")


def matches(text: str) -> bool:
    t = plain(text)
    return ("SURAMERICANA" in t or "EPS SURA" in t) and "CERTIFICADO" in t and "INCAPACIDAD" in t


def parse(page: Page) -> dict[str, ExtractedField]:
    fields: dict[str, ExtractedField] = {}
    text = plain(page.text)

    m = re.search(r"LICENCIA\W+NRO\.?\W*0\W*[-–]?\W*([0-9OIL]{6,12})", text)
    fields["certificateNumber"] = field(digits(m.group(1)) if m else None, 1.0 if m else 0)

    m, ratio = value_after(page, ["Fecha"], r"(\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{4})", exclude=("INICIO", "FIN"))
    fields["issueDate"] = field(iso(parse_numeric_date(m.group(1))) if m else None, ratio)

    _worker(page, fields)

    m, ratio = value_after(page, ["IPS Atiende"], r"([0-9OIL]{6,12})\W*[-.]?\W*([A-ZÑ0-9 .-]{3,})")
    if m:
        fields["ipsCode"] = field(digits(m.group(1)), ratio, corrected=True)
        fields["ipsName"] = field(re.split(r"\s+-\s+\d", m.group(2))[0].strip(" -."), ratio, corrected=True)

    m, ratio = value_after(page, ["Diagnóstico principal", "Diagnostico principal"], r"([A-Z0-9]{3,6})")
    code = cie10(m.group(1)) if m else None
    fields["diagnosisPrincipal"] = field(code, ratio, corrected=bool(m and code != m.group(1)))
    m, ratio = value_after(page, ["Diagnóstico relacionado", "Diagnostico relacionado"], r"([A-Z][0-9OIL]{2}[0-9A-Z]?)\b", next_rows=1)
    code = cie10(m.group(1)) if m else None
    fields["diagnosesRelated"] = field([code] if code else None, ratio)

    origin_text, ratio = column_value(page, ["Origen"])
    origin = keyword(origin_text, ORIGINS)
    fields["origin"] = field(origin or keyword(text, ORIGINS), ratio if origin else 0.8)
    fields["attentionType"] = field(keyword(text, {"AMBULATORI": "OUTPATIENT", "HOSPITALARI": "INPATIENT"}), 0.9)
    m, ratio = value_after(page, ["Clasificación", "Clasificacion"], r"\b(INICIAL|PRORROGA)\b", next_rows=1)
    if m:
        fields["classification"] = field("EXTENSION" if m.group(1) == "PRORROGA" else "INITIAL", ratio)

    dates = parse_word_dates(text)
    fields["startDate"] = field(iso(dates[0]) if dates else None, 0.9, corrected=True)
    fields["endDate"] = field(iso(dates[1]) if len(dates) > 1 else None, 0.9, corrected=True)
    m, ratio = value_after(page, ["Duración", "Duracion"], r"^\W*(\d{1,3})\s*-")
    fields["days"] = field(int(m.group(1)) if m else None, ratio)

    m, ratio = value_after(page, ["Tipo Generación", "Tipo Generacion"], r"\b(GENERACION|TRASCRIPCION|TRANSCRIPCION)\b")
    if m:
        fields["generationType"] = field("TRANSCRIPTION" if "SCRIPCION" in m.group(1) else "GENERATION", ratio)
    m, ratio = value_after(page, ["Modalidad de la prestación del servicio", "Modalidad de la prestacion del servicio"], r"\b(INTRAMURAL|EXTRAMURAL|TELEMEDICINA|DOMICILIARIA)\b")
    fields["serviceModality"] = field(m.group(1) if m else None, ratio)
    m, ratio = value_after(page, ["Incapacidad retroactiva"], r"^\W*(S|N|SI|NO)\b")
    fields["retroactive"] = field(m.group(1).startswith("S") if m else None, ratio)

    # Profesional: "CC - 1000000002 NOMBRE MEDICO" y "Registro Médico 1000000002 - MEDICO GENERAL"
    m, ratio = value_after(page, ["Profesional Responsable", "Profesional"], r"(.+)", exclude=("INFORMACION",))
    if m:
        _, prof_number = document(m.group(1))
        prof_name = re.search(r"\d{5,}\W+([A-ZÑ ]{6,})", m.group(1))
        fields["professionalDocument"] = field(prof_number, ratio)
        fields["professionalName"] = field(prof_name.group(1).strip() if prof_name else None, ratio, corrected=True)
    m, ratio = value_after(page, ["Registro Médico", "Registro Medico"], r"([0-9OIL]{3,12})\W*-?\W*([A-ZÑ0 .]+)?")
    if m:
        fields["medicalRegistry"] = field(digits(m.group(1)), ratio)
        specialty = re.sub(r"(?<=[A-Z])0|0(?=[A-Z])", "O", (m.group(2) or "")).replace(".", " ").strip()
        fields["professionalSpecialty"] = field(specialty or None, ratio, corrected=True)

    return fields


def _worker(page: Page, fields: dict[str, ExtractedField]) -> None:
    """Documento y nombre del afiliado.

    En el escaneo la marca de agua vuelve ilegible la etiqueta "Afiliado" (o la
    confunde con "IPS Afiliado"), así que se identifica por la forma del dato:
    documento seguido del nombre ("CC - 1000000001 NOMBRE ..."), a diferencia de
    las IPS ("800000001 - NOMBRE IPS ..."), entre la fecha y el diagnóstico.
    """
    start = find_label(page, ["Fecha"], exclude=("INICIO", "FIN"))
    end = find_label(page, ["Diagnóstico principal", "Diagnostico principal"])
    rows = page.rows[(start[0] if start else 0) : (end[0] if end else len(page.rows))]
    for row in rows:
        for cell in row:
            m = re.search(r"(?:\b(CC|CE|TI|PA|PT)\W*)?\b(\d[\d.]{5,14}\d)\s+([A-ZÑ]{3,}[A-ZÑ ]*)", plain(cell.text))
            if m:
                exact = bool(m.group(1))
                fields["workerDocumentType"] = field(m.group(1), 1.0 if exact else 0.8)
                fields["workerDocumentNumber"] = field(digits(m.group(2)), 1.0 if exact else 0.8, corrected=not exact)
                fields["workerName"] = field(m.group(3).strip(), 0.8, corrected=True)
                return
