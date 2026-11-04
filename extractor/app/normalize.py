"""Normalización de valores leídos: tildes, errores típicos del OCR, fechas y códigos."""
from __future__ import annotations

import re
import unicodedata
from datetime import date

MONTHS = {
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6,
    "JULIO": 7, "AGOSTO": 8, "SEPTIEMBRE": 9, "SETIEMBRE": 9, "OCTUBRE": 10,
    "NOVIEMBRE": 11, "DICIEMBRE": 12,
}
WEEKDAYS = r"(?:LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)"

# Confusiones típicas del OCR en campos que deben ser numéricos
_DIGIT_FIXES = str.maketrans({"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "|": "1", "S": "5", "B": "8", "Z": "2", "G": "6"})


def plain(text: str) -> str:
    """Mayúsculas sin tildes ni espacios repetidos (para comparar etiquetas)."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text.upper()).strip()


def digits(text: str) -> str:
    """Corrige letras confundidas por el OCR y deja solo dígitos."""
    return re.sub(r"\D", "", plain(text).translate(_DIGIT_FIXES))


def parse_numeric_date(text: str) -> date | None:
    """dd/mm/aaaa, dd-mm-aaaa o aaaa-mm-dd."""
    t = plain(text).translate(_DIGIT_FIXES)
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", t)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", t) or re.search(r"\b(\d{2})(\d{2})(\d{4})\b", t)
        if not m:
            return None
        d, mo, y = map(int, m.groups())
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def parse_word_dates(text: str) -> list[date]:
    """Fechas en palabras ("SÁBADO 08 DE AGOSTO DE 2026"), en el orden en que aparecen.

    En los escaneos el día y el "MES DE AÑO" suelen quedar en renglones distintos,
    así que se emparejan por orden de aparición.
    """
    t = plain(text)
    days = [int(d) for d in re.findall(WEEKDAYS + r"\W+(\d{1,2})\W+DE\b", t)]
    months_years = re.findall(r"\b(" + "|".join(MONTHS) + r")\W+DE\W*(\d{4})\b", t)
    result = []
    for day, (month, year) in zip(days, months_years):
        try:
            result.append(date(int(year), MONTHS[month], day))
        except ValueError:
            continue
    return result


# CIE-10: letra + 2 dígitos + carácter opcional (ej. K409, M211, R522, S62X)
_CIE10 = re.compile(r"^[A-Z]\d{2}[0-9A-Z]?$")


def cie10(text: str) -> str | None:
    """Normaliza un código CIE-10 leído (corrige un carácter extra al inicio, ej. 'IM211')."""
    token = re.sub(r"[^A-Z0-9]", "", plain(text))
    if not token:
        return None
    candidates = [token, token[1:]] if len(token) > 4 else [token]
    for candidate in candidates:
        if len(candidate) >= 3:
            fixed = candidate[0] + candidate[1:3].translate(_DIGIT_FIXES) + candidate[3:]
            if _CIE10.match(fixed):
                return fixed
    return None


def document(text: str) -> tuple[str | None, str | None]:
    """Tipo y número de documento ('CC - 1000000001' -> ('CC', '1000000001'))."""
    t = plain(text)
    # El número empieza y termina en dígito: así no se come la inicial del nombre
    m = re.search(r"\b(CC|CE|TI|PA|PE|PT|RC|NIT|NI|NT)\b\W*([0-9][0-9OIL .-]{3,18}[0-9])", t)
    if m:
        number = digits(m.group(2))
        if 5 <= len(number) <= 12:
            return m.group(1), number
    m = re.search(r"\b(\d{6,12})\b", t)
    return (None, m.group(1)) if m else (None, None)


def iso(value: date | None) -> str | None:
    return value.isoformat() if value else None
