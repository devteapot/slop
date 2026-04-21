from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SDK_SRC = ROOT.parent / "slop-ai" / "src"
PLUGIN_SRC = ROOT / "src"

for path in (str(PLUGIN_SRC), str(SDK_SRC)):
    if path not in sys.path:
        sys.path.insert(0, path)
