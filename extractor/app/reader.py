"""Lectura de páginas: capa de texto del PDF (digitales) u OCR local (escaneados).

Ambos caminos producen la misma estructura: celdas de texto con su posición,
agrupadas en renglones. Así los lectores de cada formato no dependen de si el
documento vino del portal (con texto) o de la impresora (solo imagen).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property, lru_cache

import numpy as np
import pymupdf

# Una página con menos texto que esto se considera escaneada (solo imagen)
MIN_TEXT_CHARS = 120
# Resolución para el OCR: 200 dpi equilibra precisión y tiempo (~6 s/página)
OCR_DPI = 200
# Tolerancia vertical (en puntos PDF) para considerar dos celdas en el mismo renglón
ROW_TOLERANCE = 5.0
# Por debajo de esta resolución (fotos, capturas de pantalla) el OCR local no es confiable
MIN_RELIABLE_DPI = 150


@dataclass
class Cell:
    text: str
    x: float
    y: float
    score: float = 1.0


@dataclass
class Page:
    number: int
    source: str  # "text" | "ocr"
    cells: list[Cell] = field(default_factory=list)
    # Resolución efectiva de la imagen escaneada (None si la página tiene texto)
    dpi: int | None = None

    @property
    def low_resolution(self) -> bool:
        return self.source == "ocr" and self.dpi is not None and self.dpi < MIN_RELIABLE_DPI

    @cached_property
    def rows(self) -> list[list[Cell]]:
        """Celdas agrupadas por renglón (de arriba a abajo, de izquierda a derecha)."""
        rows: list[list[Cell]] = []
        for cell in sorted(self.cells, key=lambda c: c.y):
            if rows and abs(rows[-1][0].y - cell.y) <= ROW_TOLERANCE:
                rows[-1].append(cell)
            else:
                rows.append([cell])
        return [sorted(r, key=lambda c: c.x) for r in rows]

    @cached_property
    def text(self) -> str:
        """Texto plano: celdas separadas por ' | ' y renglones por salto de línea."""
        return "\n".join(" | ".join(c.text for c in row) for row in self.rows)


@lru_cache(maxsize=1)
def _ocr_engine():
    # Se carga una sola vez: el modelo tarda en inicializar
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR()


def _text_layer_cells(page: pymupdf.Page) -> list[Cell]:
    cells = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = " ".join(span["text"] for span in line["spans"]).strip()
            if text:
                x0, y0, x1, y1 = line["bbox"]
                cells.append(Cell(text=text, x=x0, y=(y0 + y1) / 2))
    return cells


def _ocr_cells(page: pymupdf.Page) -> list[Cell]:
    pix = page.get_pixmap(dpi=OCR_DPI)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    result, _ = _ocr_engine()(image)
    scale = 72 / OCR_DPI  # píxeles -> puntos PDF, para usar la misma tolerancia
    cells = []
    for box, text, score in result or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        cells.append(Cell(text=text.strip(), x=min(xs) * scale, y=sum(ys) / 4 * scale, score=float(score)))
    return cells


IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp")
# Una hoja carta mide 8.5" de ancho: con esto se estima la resolución de una foto
LETTER_WIDTH_INCHES = 8.5


def open_document(data: bytes, filename: str = "") -> tuple[pymupdf.Document, int | None]:
    """Abre un PDF o una imagen (foto/escaneo) como documento de páginas.

    Para imágenes sueltas devuelve también su resolución estimada como si la
    hoja fuera tamaño carta (en un PDF se calcula por página).
    """
    name = filename.lower()
    if name.endswith(".webp"):
        # PyMuPDF no abre WEBP (fotos enviadas por WhatsApp): se convierte a PNG sin pérdida
        import cv2

        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("the WEBP image could not be decoded")
        data, name = cv2.imencode(".png", image)[1].tobytes(), name[: -len(".webp")] + ".png"
    if name.endswith(IMAGE_EXTENSIONS):
        image_doc = pymupdf.open(stream=data, filetype=name.rsplit(".", 1)[-1])
        pixmap = image_doc[0].get_pixmap()
        dpi = round(min(pixmap.width, pixmap.height) / LETTER_WIDTH_INCHES)
        return pymupdf.open("pdf", image_doc.convert_to_pdf()), dpi
    return pymupdf.open(stream=data, filetype="pdf"), None


def header_text(page: pymupdf.Page, fraction: float = 0.3, dpi: int = 150) -> str:
    """Texto de la franja superior de la página (donde va el título del certificado).

    OCR rápido (~1 s) para decidir qué página enviar al modelo de visión sin
    procesar completas las hojas de historia clínica.
    """
    if len(page.get_text().strip()) >= MIN_TEXT_CHARS:
        return page.get_text()
    r = page.rect
    clip = pymupdf.Rect(r.x0, r.y0, r.x1, r.y0 + r.height * fraction)
    pix = page.get_pixmap(dpi=dpi, clip=clip)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    result, _ = _ocr_engine()(image)
    return " ".join(text for _, text, _ in result or [])


def image_dpi(page: pymupdf.Page) -> int | None:
    """Resolución de la imagen más grande de la página (píxeles por pulgada impresa)."""
    best = None
    for info in page.get_image_info():
        x0, _, x1, _ = info["bbox"]
        if x1 - x0 > 0:
            dpi = round(info["width"] / ((x1 - x0) / 72))
            best = dpi if best is None else max(best, dpi)
    return best


def read_page(doc: pymupdf.Document, index: int, assumed_dpi: int | None = None) -> Page:
    page = doc[index]
    if len(page.get_text().strip()) >= MIN_TEXT_CHARS:
        return Page(number=index + 1, source="text", cells=_text_layer_cells(page))
    return Page(number=index + 1, source="ocr", cells=_ocr_cells(page), dpi=assumed_dpi or image_dpi(page))
