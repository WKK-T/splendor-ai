#!/usr/bin/env python3
"""Build the offline browser ZIP and frozen model ZIP from verified inputs."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
VERSION = "1.0.0"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def add_tree(archive, source, prefix):
    for path in sorted(source.rglob("*")):
        if path.is_file() and not path.name.startswith("."):
            archive.write(path, str(Path(prefix) / path.relative_to(source)))


def build():
    DIST.mkdir(exist_ok=True)
    subprocess.run([sys.executable, str(ROOT / "play/build.py")], check=True)
    browser = DIST / f"splendor-ai-browser-v{VERSION}.zip"
    with zipfile.ZipFile(browser, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.write(ROOT / "play/index.html", "index.html")
        z.write(ROOT / "LICENSE", "LICENSE")
        z.write(ROOT / "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md")
        z.write(ROOT / "docs/models.md", "docs/models.md")
        z.write(ROOT / "play/model-release.json", "play/model-release.json")
        z.write(ROOT / "local-models/four-level-20261018/manifest.json",
                "local-models/four-level-20261018/manifest.json")
        add_tree(z, ROOT / "licenses/rust", "licenses/rust")
        z.writestr("START-HERE.txt", "璀璨宝石 AI · v1.0.0\n由 Codex 完成的 VibeCoding 产品。\n\n"
                   "完整解压，使用桌面 Chrome / Edge 双击打开 index.html。\n"
                   "包含简单机器人、AI模型简单（100M）、AI模型中等（200M）与行动提示。\n"
                   "规则、图片和模型均已内嵌，无需网络或账号。\n"
                   "困难和地狱在 Mac 本地版中提供。\n\n"
                   "Extract the ZIP and open index.html in desktop Chrome or Edge.\n"
                   "Built with Codex through VibeCoding. Works offline.\n"
                   "Source, credits and other downloads: https://github.com/WKK-T/splendor-ai\n")
    model_root = ROOT / "local-models/four-level-20261018"
    manifest = json.loads((model_root / "manifest.json").read_text())
    models = DIST / f"splendor-ai-models-v{VERSION}.zip"
    with zipfile.ZipFile(models, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for entry in manifest["models"].values():
            path = model_root / entry["path"]
            if path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
                raise ValueError(f"Model identity mismatch: {path.name}")
            z.write(path, entry["path"])
        z.write(ROOT / "LICENSE", "LICENSE")
        z.write(ROOT / "docs/models.md", "MODEL-DETAILS.md")
        z.write(model_root / "manifest.json", "manifest.json")
        z.writestr("README.txt", "Splendor AI v1.0.0 frozen inference weights.\n"
                   "Use scripts/download_models.py --archive <this ZIP> from the source repository.\n"
                   "https://github.com/WKK-T/splendor-ai\n")
    for path in [browser, models]:
        with zipfile.ZipFile(path) as z:
            if z.testzip() is not None:
                raise ValueError(f"ZIP checksum failed: {path.name}")
        print(json.dumps({"file": path.name, "bytes": path.stat().st_size, "sha256": digest(path)}))


if __name__ == "__main__":
    build()
