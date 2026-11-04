# Extractor de certificados de incapacidad

Servicio Python (FastAPI) que lee un certificado de incapacidad —PDF del portal o
escaneo de la impresora— y devuelve sus campos para prellenar el registro en
CargoPlanner. Solo lo consume el backend Nest; debe escuchar únicamente en localhost.

- PDF con texto (descargado del portal): se lee la capa de texto (~0,2 s, gratis).
- Escaneo (solo imagen): modelo de visión de OpenAI. Se envía **solo la hoja del
  certificado** (identificada por su título con un OCR rápido del encabezado); las hojas
  de historia clínica no se envían. Cada lectura reporta tokens y costo (`usage`).
- Sin API key, sin créditos o si la IA falla: OCR local con RapidOCR como respaldo.
- Formatos soportados: Nueva EPS, Sura. Para agregar otro (Mutualser, ARL...) se crea un
  módulo en `app/formats/` y se registra en `app/extract.py`.

## Ejecutar

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Variables en `extractor/.env` (nunca se versiona):

| Variable | Uso |
|---|---|
| `EXTRACTOR_API_KEY` | Clave compartida con el backend (header `X-API-Key`) |
| `OPENAI_API_KEY` | Activa la lectura de escaneos con IA |
| `OPENAI_MODEL` | Modelo de visión (por defecto `gpt-6-luna`) |
| `OPENAI_PRICE_INPUT_PER_1M` / `OPENAI_PRICE_OUTPUT_PER_1M` | Precio en USD por millón de tokens si cambia la tarifa o el modelo |

`POST /extract` (multipart): `file`, `expectedDni` (cédula del trabajador seleccionado) y
`expectedEmployerNit` opcionales. Devuelve el formato detectado, cada campo con su
confianza (`high` / `medium` / `low`) y las advertencias a revisar.

## Pruebas

```bash
.venv/Scripts/python -m pytest
```

Las pruebas con certificados reales se ejecutan solo si `SAMPLES_DIR` apunta a una carpeta
con los PDF y su `expected.json`. Esos archivos contienen datos de salud y **nunca** se
versionan.
