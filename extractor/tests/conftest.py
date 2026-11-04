import sys
from pathlib import Path

# Permite importar el paquete `app` al correr pytest desde la carpeta extractor
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
