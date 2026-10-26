"""Build the portable C5 game: rules, artwork and two frozen original Transformers.

Run: python3 play/build.py
The generated index.html works from file:// without a server or network.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parents[1]
play = root / "play"
pkg = root / "crates/splendor-wasm/pkg"

def b64(path):
    return base64.b64encode(path.read_bytes()).decode("ascii")

def select_art_source(stem):
    """Prefer packed WebP only when it is not older than its PNG original."""
    webp = stem.with_suffix(".webp")
    png = stem.with_suffix(".png")
    if webp.is_file():
        if png.is_file() and png.stat().st_mtime_ns > webp.stat().st_mtime_ns:
            raise RuntimeError(
                f"Stale WebP asset: {webp}. PNG original is newer; "
                "regenerate the WebP copy before building."
            )
        return webp
    return png if png.is_file() else None

def artwork_bundle(allow_incomplete=False):
    """Keep each source image in CSS once, separate from runtime assignments."""
    colours = ["white", "blue", "green", "red", "black"]
    counts = [5, 5, 4]
    expected_count = len(colours) * sum(counts)
    atlas = select_art_source(play / "assets/c5-landscapes")
    if atlas is None:
        raise FileNotFoundError("Missing C5 original atlas: assets/c5-landscapes.png or .webp")
    atlas_mime = "image/webp" if atlas.suffix == ".webp" else "image/png"
    atlas_hash = hashlib.sha256(atlas.read_bytes()).hexdigest()
    # Group atlas users in one rule. A large PNG in a CSS custom property can
    # exceed browsers' variable-expansion limits even though a direct URL works.
    rules = ['.card .art[data-art-key$="-v0"]{background-image:url("data:' + atlas_mime +
             ';base64,' + b64(atlas) + '");background-size:500% 300%}']
    entries, missing, distinct_images = [], [], {}
    for colour, name in enumerate(colours):
        for tier in range(1, 4):
            for variant in range(counts[tier - 1]):
                key = f"{name}-t{tier}-v{variant}"
                entry = {"key": key, "colour": colour, "tier": tier, "variant": variant}
                if variant == 0:
                    entry.update(source=str(atlas.relative_to(play)), sha256=atlas_hash,
                                 atlas_cell=[colour, tier - 1])
                    rules.append(f'.card .art[data-art-key="{key}"]' +
                                 '{' + f'background-position:{colour * 25}% {(tier - 1) * 50}%' + '}')
                else:
                    # WebP copies are optional build assets; preserve PNG originals.
                    stem = play / "assets/c5-variants" / key
                    source = select_art_source(stem)
                    if source is None:
                        missing.append(key)
                        continue
                    raw = source.read_bytes()
                    if source.suffix == ".webp":
                        if not (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"):
                            raise ValueError(f"Invalid WebP file: {source}")
                        mime = "image/webp"
                    else:
                        if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
                            raise ValueError(f"Invalid PNG file: {source}")
                        mime = "image/png"
                    digest = hashlib.sha256(raw).hexdigest()
                    if digest in distinct_images:
                        raise ValueError(f"Duplicate artwork bytes: {key} and {distinct_images[digest]}")
                    distinct_images[digest] = key
                    entry.update(source=str(source.relative_to(play)), sha256=digest)
                    encoded = base64.b64encode(raw).decode("ascii")
                    rules.append(f'.card .art[data-art-key="{key}"]' +
                                 '{background-image:url("data:' + mime + ';base64,' + encoded +
                                 '");background-size:cover;background-position:center}')
                entries.append(entry)
    if missing and not allow_incomplete:
        raise FileNotFoundError(f"C5 requires all {expected_count} artworks; missing {len(missing)}: " +
                                ", ".join(missing) + ". Use --allow-incomplete-art only for development previews.")
    if missing:
        print(f"DEVELOPMENT PREVIEW: {len(entries)}/{expected_count} C5 artworks available; missing variants are not sampled.")
    manifest = {"format": "splendor-c5-art/1", "complete": not missing,
                "expected_count": expected_count, "variants_per_tier": counts, "entries": entries, "missing": missing}
    return manifest, "\n".join(rules)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--allow-incomplete-art", action="store_true",
                    help="Explicit development preview using only currently available artwork")
parser.add_argument("--output-dir", type=pathlib.Path, default=play,
                    help="Build location; use a separate directory for an incomplete preview")
parser.add_argument("--local-game", action="store_true", help="Build the local Python-backed four-level game")
args = parser.parse_args()
if args.local_game and args.output_dir.resolve() == play.resolve():
    parser.error('--local-game requires a separate --output-dir')
art_manifest, art_css = artwork_bundle(args.allow_incomplete_art)

css = (play / "theme.css").read_text() + "\n" + (play / "companion.css").read_text()
css = css.replace("/*__CARD_ART_CSS__*/", art_css)
companions = json.loads((play / "assets/companions/manifest.json").read_text())
for companion in companions:
    for style in companion["styles"].values():
        mime = "image/svg+xml" if style["file"].endswith(".svg") else "image/webp"
        style["src"] = "data:" + mime + ";base64," + b64(play / "assets/companions" / style["file"])
    companion["src"] = companion["styles"]["pet"]["src"]
release = json.loads((play / "model-release.json").read_text())
expected_models = {m["key"]: m for m in release["models"]}
bundles = {}
for key in ("transformer100m", "transformer200m"):
    meta = json.loads((play / "assets" / f"{key}.json").read_text())
    for field in ("model_id", "display_name", "cumulative_samples", "checkpoint_sha256", "weights_sha256", "state_dict_sha256", "architecture_source_sha256"):
        if meta[field] != expected_models[key][field]:
            raise ValueError(f"Frozen release identity mismatch: {key}/{field}")
    weights = play / "assets" / f"{key}.bin"
    if hashlib.sha256(weights.read_bytes()).hexdigest() != meta["weights_sha256"]:
        raise ValueError(f"Model weight hash mismatch: {key}")
    bundles[key] = {"metadata": meta, "weights": b64(weights)}
hint_release = json.loads((play / "hint-policy.json").read_text())
if hint_release["weights_sha256"] != bundles[hint_release["model_key"]]["metadata"]["weights_sha256"]:
    raise ValueError("Hint release weight hash mismatch")
hint_constants = "const HINT_RELEASE = " + json.dumps(hint_release, ensure_ascii=False) + ";\n"
hint_constants += "const HINT_POLICY_META = POLICY_BUNDLES[HINT_RELEASE.model_key].metadata, HINT_POLICY_BASE64 = POLICY_BUNDLES[HINT_RELEASE.model_key].weights;\n"
transformer = (play / "transformer-policy.js").read_text()
if args.local_game:
    native = json.loads((root/'local-models/four-level-20261018/manifest.json').read_text())
    names = {'easy':'AI 简单 · 100M','medium':'AI 中等 · 200M','hard':'AI 困难 · MCTS128','hell':'AI 地狱 · MCTS256'}
    bundles = {key: {'metadata': {'model_id': spec['model'], 'display_name': names[key],
                 'weights_sha256': native['models'][spec['model']]['sha256'], 'simulations': spec['simulations']}}
               for key, spec in native['profiles'].items()}
    hint_release = {'model_key':'medium','label':'提示模型：AI 中等 · 200M'}
    hint_constants = 'const HINT_RELEASE = '+json.dumps(hint_release,ensure_ascii=False)+';\n'
    hint_constants += 'const HINT_POLICY_META=POLICY_BUNDLES.medium.metadata,HINT_POLICY_BASE64="";\n'
worker = "\n".join([ (pkg / "splendor_wasm.js").read_text(), transformer, (play / "hint-format.js").read_text(), (play / "hint-worker.js").read_text() ])
companion_js = hint_constants + (play / "companion.js").read_text().replace("__COMPANIONS_JSON__", json.dumps(companions, ensure_ascii=False)).replace("__HINT_WORKER_JSON__", json.dumps(worker))
local_config = {'api':'/api/infer','version':'local-game/1'} if args.local_game else None
policy_client = 'const LOCAL_GAME = '+json.dumps(local_config)+';\n'
policy_client += (root/'local-game/client.js').read_text() if args.local_game else ''
policy_client += (play / "policy-client.js").read_text().replace("__OPPONENT_WORKER_JSON__", json.dumps('' if args.local_game else transformer + "\n" + (play / "opponent-worker.js").read_text()))
ui = (play / "ui.js").read_text()
ui = ui.replace("/*__COMPANION_JS__*/", companion_js)
ui = ui.replace("/*__HINT_FORMAT_JS__*/", (play / "hint-format.js").read_text())
ui = ui.replace("/*__CARD_ART_JS__*/", (play / "card-art.js").read_text())
ui = ui.replace("__CARD_ART_MANIFEST_JSON__", json.dumps(art_manifest, ensure_ascii=False))
ui = ui.replace("/*__TUTORIAL_JS__*/", (play / "tutorial.js").read_text())
ui = ui.replace("__WASM_B64__", b64(pkg / "splendor_wasm_bg.wasm"))
ui = ui.replace("__POLICY_BUNDLES_JSON__", json.dumps(bundles, ensure_ascii=False))

html = (play / "template.html").read_text()
for marker, content in {
    "/*__THEME_CSS__*/": css,
    "/*__GLUE__*/": (pkg / "splendor_wasm.js").read_text(),
    "/*__POLICY_JS__*/": policy_client,
    "/*__UI_JS__*/": ui,
}.items():
    html = html.replace(marker, content)

unresolved = re.findall(r"__(?:CARD_ART_DATA|CARD_ART_CSS|CARD_ART_JS|CARD_ART_MANIFEST_JSON|POLICY_BUNDLES_JSON|OPPONENT_WORKER_JSON|WASM_B64|TUTORIAL_JS|THEME_CSS|UI_JS|POLICY_JS)__", html)
if unresolved:
    raise RuntimeError("Unresolved build markers: " + ", ".join(unresolved))

# Keep attribution with the standalone HTML when it is shared by itself.
# Escaping '<' prevents a notice containing '</script>' from closing this inert
# application/json element. Nothing in these notices is executed or rendered.
license_root = root / "licenses/rust"
license_manifest = json.loads((license_root / "manifest.json").read_text())
license_files = {}
for package in license_manifest["packages"]:
    for entry in package["license_files"]:
        raw = (license_root / entry["path"]).read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError("Third-party notice hash mismatch: " + entry["path"])
        license_files[entry["path"]] = raw.decode("utf-8")
notices = {
    "project_license": (root / "LICENSE").read_text(),
    "attribution": (root / "THIRD_PARTY_NOTICES.md").read_text(),
    "rust_dependencies": license_manifest,
    "rust_license_texts": license_files,
}
notice_json = json.dumps(notices, ensure_ascii=False).replace("<", "\\u003c")
html = html.replace("</body>", '<script id="third-party-notices" type="application/json">' +
                    notice_json + "</script>\n</body>", 1)

output_dir = args.output_dir.resolve()
output_dir.mkdir(parents=True, exist_ok=True)
out = output_dir / "index.html"
out.write_text(html)
model_summary = 'four local AI levels + independent hints' if args.local_game else 'simple robot + Transformer 100M / 200M'
print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB; {len(art_manifest['entries'])} C5 artworks, {model_summary})")
artifact = html
for tag in ['<!doctype html>', '<html lang="zh-CN">', "<head>", "</head>", "<body>", "</body>", "</html>"]:
    artifact = artifact.replace(tag, "", 1)
(output_dir / "artifact.html").write_text(artifact.strip() + "\n")
print(f"wrote {output_dir / 'artifact.html'}")
manifest_out = play / "assets/c5-art-manifest.json" if output_dir == play else output_dir / "c5-art-manifest.json"
manifest_out.write_text(json.dumps(art_manifest, ensure_ascii=False, indent=2) + "\n")
