"""Utilidades compartidas por los lectores de cada formato de certificado."""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from app.normalize import plain
from app.reader import Cell, Page
from app.schema import ExtractedField

ORIGINS = {
    # Texto del certificado -> tipo de origen del sistema
    "ENFERMEDAD GENERAL": "GENERAL",
    "ACCIDENTE DE TRANSITO": "GENERAL",  # para la empresa se trata como enfermedad general
    "ACCIDENTE DE TRABAJO": "LABOR",
    "ENFERMEDAD LABORAL": "LABOR",
    "ENFERMEDAD PROFESIONAL": "LABOR",
    "LICENCIA DE MATERNIDAD": "MATERNITY",
    "LICENCIA POR MATERNIDAD": "MATERNITY",
    "LICENCIA DE PATERNIDAD": "PATERNITY",
    "LICENCIA POR PATERNIDAD": "PATERNITY",
}


def similar(a: str, b: str) -> float:
    return SequenceMatcher(None, plain(a), plain(b)).ratio()


def find_label(page: Page, labels: list[str], min_ratio: float = 0.78, exclude: tuple[str, ...] = ()) -> tuple[int, int, float] | None:
    """Ubica la celda que mejor coincide con alguna etiqueta (tolerante a errores del OCR).

    Devuelve (renglón, columna, similitud). `exclude` descarta celdas que contengan
    esas palabras (ej. 'IPS' para no confundir 'IPS Afiliado' con 'Afiliado').
    """
    best = None
    for r, row in enumerate(page.rows):
        for c, cell in enumerate(row):
            text = plain(cell.text)
            if any(word in text for word in exclude):
                continue
            for label in labels:
                lab = plain(label)
                # La celda puede traer etiqueta + valor juntos: se compara su inicio
                head = text[: len(lab) + 2]
                ratio = 1.0 if text.startswith(lab) else max(similar(text, lab), similar(head, lab))
                if ratio >= min_ratio and (best is None or ratio > best[2]):
                    best = (r, c, ratio)
    return best


def value_after(page: Page, labels: list[str], pattern: str, *, next_rows: int = 0, exclude: tuple[str, ...] = (), flags=re.I) -> tuple[re.Match | None, float]:
    """Busca `pattern` en lo que sigue a la etiqueta en el mismo renglón (y opcionalmente en los siguientes)."""
    found = find_label(page, labels, exclude=exclude)
    if not found:
        return None, 0.0
    r, c, ratio = found
    rows = page.rows
    label_cell = rows[r][c]
    # El valor puede venir en la misma celda que la etiqueta (texto digital)
    own = plain(label_cell.text)
    for lab in labels:
        lab_p = plain(lab)
        if own.startswith(lab_p):
            own = own[len(lab_p):]
            break
    else:
        own = ""
    candidates = [own + " | " + " | ".join(plain(cell.text) for cell in rows[r][c + 1:])]
    for extra in rows[r + 1 : r + 1 + next_rows]:
        candidates.append(" | ".join(plain(cell.text) for cell in extra))
    for text in candidates:
        m = re.search(pattern, text, flags)
        if m:
            return m, ratio
    return None, ratio


def column_value(page: Page, labels: list[str], rows_below: int = 1, max_dx: float = 25.0, exclude: tuple[str, ...] = ()) -> tuple[str, float]:
    """Valor de la celda a la derecha de la etiqueta más lo que continúa debajo en la misma columna.

    En las tablas los valores largos se parten en dos renglones (ej. "ENFERMEDAD" /
    "GENERAL"); se unen las celdas de abajo alineadas con la primera.
    """
    found = find_label(page, labels, exclude=exclude)
    if not found:
        return "", 0.0
    r, c, ratio = found
    rows = page.rows
    if c + 1 >= len(rows[r]):
        return "", ratio
    first = rows[r][c + 1]
    parts = [first.text]
    for row in rows[r + 1 : r + 1 + rows_below]:
        below = [cell for cell in row if abs(cell.x - first.x) <= max_dx]
        if below:
            parts.append(below[0].text)
    return plain(" ".join(parts)), ratio


def field(value, ratio: float = 1.0, corrected: bool = False) -> ExtractedField:
    """Confianza: high si la etiqueta coincide bien y no hubo correcciones."""
    if value in (None, ""):
        return ExtractedField(value=None, confidence="low")
    if ratio >= 0.95 and not corrected:
        return ExtractedField(value=value, confidence="high")
    return ExtractedField(value=value, confidence="medium" if ratio >= 0.78 else "low")


def keyword(text: str, options: dict[str, str]) -> str | None:
    """Primer término conocido que aparece en el texto (ej. orígenes, tipo de atención)."""
    t = plain(text)
    hits = [(t.find(k), v) for k, v in options.items() if k in t]
    return min(hits)[1] if hits else None


def cells_text(cells: list[Cell]) -> str:
    return " | ".join(c.text for c in cells)
