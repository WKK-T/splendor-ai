#!/usr/bin/env python3
"""Download the release inference weights and verify every file before installing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT / "local-models/four-level-20261018"
URL = "https://github.com/WKK-T/splendor-ai/releases/download/v1.0.0/splendor-ai-models-v1.0.0.zip"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def install(archive):
    manifest = json.loads((MODEL_ROOT / "manifest.json").read_text())
    expected = {entry["path"]: entry for entry in manifest["models"].values()}
    # Never extract archive-controlled paths; accept only manifest-listed members.
    with tempfile.TemporaryDirectory(dir=MODEL_ROOT) as directory:
        stage = Path(directory)
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            for name, entry in expected.items():
                if names.count(name) != 1:
                    raise ValueError(f"Missing or duplicate model: {name}")
                info = bundle.getinfo(name)
                if info.file_size != entry["bytes"]:
                    raise ValueError(f"Incorrect size: {name}")
                path = stage / Path(name).name
                with bundle.open(info) as source, path.open("wb") as target:
                    shutil.copyfileobj(source, target)
                if digest(path) != entry["sha256"]:
                    raise ValueError(f"SHA-256 mismatch: {name}")
        for name in expected:
            destination = MODEL_ROOT / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(stage / Path(name).name, destination)
            print(f"Verified: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Use an already downloaded release ZIP")
    args = parser.parse_args()
    if args.archive:
        install(args.archive)
        return
    with tempfile.TemporaryDirectory() as directory:
        archive = Path(directory) / "models.zip"
        request = urllib.request.Request(URL, headers={"User-Agent": "Splendor-AI/1.0.0"})
        print("Downloading v1.0.0 model bundle…")
        with urllib.request.urlopen(request, timeout=120) as response, archive.open("wb") as target:
            shutil.copyfileobj(response, target)
        install(archive)


if __name__ == "__main__":
    main()
