"""NUEVA EPS S.A - CERTIFICADO DE INCAPACIDAD O LICENCIA POR MATERNIDAD / EMISION DE INCAPACIDAD.

Formato de etiqueta y valor en el mismo renglón, con dos variantes:
- Transcrita: etiquetas cortadas "No. de" (autorización), "Nro" (radicado de la
  EPS), "Días de" (días) y "Fecha de" (expedición).
- Emisión: "Consecutivo", "Nro. Incapacidad EPS", "No. de Aut Servicio",
  "Días Incapacidad", "Diagnóstico Ppal" / "Diagnóstico Secundario".
"""
from __future__ import annotations

import re

from app.formats.common import ORIGINS, field, find_label, keyword, value_after
from app.normalize import cie10, digits, document, iso, parse_numeric_date, plain
from app.reader import Page
from app.schema import Entity, ExtractedField

FORMAT = "NUEVA_EPS"
ENTITY = Entity(type="EPS", name="NUEVA EPS S.A.", nit="900156264-2")
DATE = r"(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4})"
# También acepta fechas a las que el OCR les quitó los separadores ("31072026")
DATE8 = r"(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{4}|\b\d{8}\b)"


def matches(text: str) -> bool:
    # En fotos de baja resolución el OCR pega las palabras ("NUEVAEPSS.A")
    t = re.sub(r"\s+", "", plain(text))
    return "NUEVAEPS" in t and ("CERTIFICADODEINCAPACIDAD" in t or "EMISIONDEINCAPACIDAD" in t)


def parse(page: Page) -> dict[str, ExtractedField]:
    fields: dict[str, ExtractedField] = {}
    text = page.text

    # Renglón "No. de 1000001 | Nro 0000000001": autorización y radicado de la EPS
    for row in page.rows:
        row_text = " | ".join(plain(c.text) for c in row)
        m = re.search(r"NO\.?\s*DE\W+([0-9OIL ]{5,15})\W+NRO\.?\W+([0-9OIL ]{6,15})", row_text)
        if m:
            fields["authorizationNumber"] = field(digits(m.group(1)))
            fields["entityFilingNumber"] = field(digits(m.group(2)))
            break
    # El número del certificado para la EPS es su radicado ("Nro")
    if "entityFilingNumber" in fields:
        fields["certificateNumber"] = fields["entityFilingNumber"]

    # Variante "Emisión": consecutivo, número de incapacidad y autorización del servicio
    if "certificateNumber" not in fields:
        m, ratio = value_after(page, ["Nro. Incapacidad EPS", "Nro Incapacidad EPS"], r"([0-9OIL]{6,15})")
        if m:
            fields["certificateNumber"] = field(digits(m.group(1)), ratio)
        m, ratio = value_after(page, ["Consecutivo"], r"([0-9OIL]{6,15})")
        if m:
            fields["consecutiveNumber"] = field(digits(m.group(1)), ratio)
        m, ratio = value_after(page, ["No. de Aut Servicio", "No de Aut Servicio"], r"([0-9OIL]{6,15})")
        if m:
            fields["authorizationNumber"] = field(digits(m.group(1)), ratio)

    m, ratio = value_after(page, ["Cotizante"], r"(.+)")
    if m:
        doc_type, number = document(m.group(1))
        fields["workerDocumentType"] = field(doc_type, ratio)
        fields["workerDocumentNumber"] = field(number, ratio)
        name = re.search(r"\d{5,}\W*([A-ZÑ ]{6,}?)(?:\s*\||\s+EDAD|$)", m.group(1))
        fields["workerName"] = field(name.group(1).strip() if name else None, ratio, corrected=True)

    m, ratio = value_after(page, ["Fecha Recepción", "Fecha Recepcion"], DATE)
    fields["receptionDate"] = field(iso(parse_numeric_date(m.group(1))) if m else None, ratio)
    m, ratio = value_after(page, ["Fecha Recepción", "Fecha Recepcion"], r"FECHA DE\W+" + DATE)
    if not m:
        m, ratio = value_after(page, ["Fecha Expedición", "Fecha Expedicion", "Fecha de"], DATE8)
    fields["issueDate"] = field(iso(parse_numeric_date(m.group(1))) if m else None, ratio)

    # El OCR puede leer "NT" como "HT"
    m, ratio = value_after(page, ["Empleador"], r"\b(?:[NH]T|NI|NIT)\W*([0-9][0-9OIL.]{5,14})\W*\|?\s*([A-ZÑ][A-ZÑ0-9 .&]+)?")
    if m:
        fields["employerNit"] = field(digits(m.group(1)), ratio)
        fields["employerName"] = field((m.group(2) or "").strip() or None, ratio, corrected=True)

    m, ratio = value_after(page, ["IPS"], r"(?:NT\W*)?([0-9OIL-]{3,15})\W*\|?\s*([A-ZÑ0-9 .&-]{3,})", exclude=("REPS",))
    if m:
        fields["ipsCode"] = field(digits(m.group(1)), ratio)
        fields["ipsName"] = field(m.group(2).strip(), ratio)

    m, ratio = value_after(page, ["Días de", "Dias de", "Días Incapacidad", "Dias Incapacidad"], r"^\W*(\d{1,3})\b")
    fields["days"] = field(int(m.group(1)) if m else None, ratio)
    m, ratio = value_after(page, ["Fecha Inicio", "Fecha Inicia"], DATE8)
    fields["startDate"] = field(iso(parse_numeric_date(m.group(1))) if m else None, ratio)
    m, ratio = value_after(page, ["Fecha Terminación", "Fecha Terminacion"], DATE8)
    fields["endDate"] = field(iso(parse_numeric_date(m.group(1))) if m else None, ratio)

    m, ratio = value_after(page, ["Prórroga", "Prorroga"], r"\b(SI|NO)\b")
    if m:
        fields["classification"] = field("EXTENSION" if m.group(1) == "SI" else "INITIAL", ratio)

    m, ratio = value_after(page, ["Diagnóstico Ppal", "Diagnostico Ppal", "Diagnóstico"], r"([A-Z0-9|]{3,6})", exclude=("SECUNDARIO", "RELACIONADO"))
    code = cie10(m.group(1)) if m else None
    fields["diagnosisPrincipal"] = field(code, ratio, corrected=bool(m and code != plain(m.group(1))))
    if find_label(page, ["Diagnóstico Secundario", "Diagnostico Secundario"]):
        m, ratio = value_after(page, ["Diagnóstico Secundario", "Diagnostico Secundario"], r"([A-Z0-9]{3,6})")
        code = cie10(m.group(1)) if m else None
        fields["diagnosesRelated"] = field([code] if code else None, ratio)

    m, ratio = value_after(page, ["Contingencia"], r"(.+)")
    origin = keyword(m.group(1), ORIGINS) if m else None
    fields["origin"] = field(origin or keyword(text, ORIGINS), ratio if origin else 0.8)
    fields["attentionType"] = field(keyword(text, {"AMBULATORI": "OUTPATIENT", "HOSPITALARI": "INPATIENT"}), 0.9)

    m, ratio = value_after(page, ["Profesional Reg Med", "Profesional Reg"], r"([A-ZÑ ]{6,}?)\s+(?:CC|C\.C\.)\W*(\d{5,12})")
    if m:
        fields["professionalName"] = field(m.group(1).strip(), ratio)
        fields["professionalDocument"] = field(m.group(2), ratio)

    return fields
