from datetime import date

from app.normalize import cie10, digits, document, parse_numeric_date, parse_word_dates


def test_numeric_dates():
    assert parse_numeric_date("17/07/2026") == date(2026, 7, 17)
    assert parse_numeric_date("2026-08-01") == date(2026, 8, 1)
    assert parse_numeric_date("O8/O8/2026 06:51") == date(2026, 8, 8)  # O leída en lugar de 0
    assert parse_numeric_date("31/02/2026") is None


def test_word_dates_split_across_rows():
    # En el escaneo el día y el "MES DE AÑO" quedan en renglones distintos
    text = "Fecha Inicio | SÁBADO 08 DE | Duracion | 15- QUINCE | Fecha Fin | SABADO 22 DE\nAGOSTO DE 2026 | AGOSTO DE:2026"
    assert parse_word_dates(text) == [date(2026, 8, 8), date(2026, 8, 22)]


def test_cie10():
    assert cie10("K409") == "K409"
    assert cie10("IM211") == "M211"  # carácter extra del OCR
    assert cie10("K4O9") == "K409"
    assert cie10("S62X") == "S62X"
    assert cie10("NO APLICA") is None
    assert cie10("NO REGISTRA") is None


def test_document():
    assert document("CC - 1234567890 JUAN PEREZ") == ("CC", "1234567890")
    assert document("CC 9876543 | SOLO NOMBRE") == ("CC", "9876543")
    assert document("CC - 1234567 SANCHEZ") == ("CC", "1234567")  # no toma la S del nombre
    assert digits("1O2I3") == "10213"
