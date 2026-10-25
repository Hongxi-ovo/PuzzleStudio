"""Prepare embedded database, scripts and complete fallback pictures (no EXE build)."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
import server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=server.ROOT)
    parser.add_argument("--mobile", required=True, type=Path)
    parser.add_argument("--cover", required=True, type=Path)
    args = parser.parse_args()
    resources = server.Resources(args.root.resolve(), "zh-CN", bundled=False)
    target = server.HERE / "resources"
    target.mkdir(exist_ok=True)
    snapshot = {"cards": list(resources.cards.values()), "rawCards": list(resources.raw_cards.values()),
                "scriptPaths": {code: path for code, (_, path) in resources.script_sources.items()}, "sources": resources.sources}
    with gzip.open(target / "database.json.gz", "wt", encoding="utf-8") as output:
        json.dump(snapshot, output, ensure_ascii=False, separators=(",", ":"))
    scripts = {}
    expansion = args.root / "Expansions"
    for pack in [args.root / "Data/script.zip", *sorted(expansion.glob("*.zip")), *sorted(expansion.glob("*.ypk"))]:
        if pack.exists():
            with zipfile.ZipFile(pack) as source:
                for name in source.namelist():
                    if name.endswith(".lua"):
                        scripts[name.removeprefix("script/")] = source.read(name)
    for code, (source, _) in resources.script_sources.items():
        scripts[f"c{code}.lua"] = source.encode("utf-8")
    with zipfile.ZipFile(target / "scripts.zip", "w", zipfile.ZIP_DEFLATED) as output:
        for name, data in sorted(scripts.items()):
            output.writestr(name, data)
    shutil.copyfile(args.mobile / "mobile/assets/data/pics.zip", target / "pics.zip")
    # Preserve expansion pictures only when they are complete framed cards.
    with zipfile.ZipFile(target / "pics.zip", "a", zipfile.ZIP_DEFLATED) as output:
        names = set(output.namelist())
        for code, (pack, name, full) in resources.pack_images.items():
            if not full:
                continue
            destination = "pics/" + str(code) + Path(name).suffix
            if destination not in names:
                with zipfile.ZipFile(pack) as source:
                    output.writestr(destination, source.read(name))
                names.add(destination)
    shutil.copyfile(args.cover, target / "cover.jpg")
    manifest = {"schemaVersion": 1, "cards": len(resources.cards), "cardScripts": len(resources.script_sources),
                "scriptFiles": len(scripts), "pictureSource": "YGOMobile bundled pics.zip", "files": {}}
    for name in ("database.json.gz", "scripts.zip", "pics.zip", "cover.jpg"):
        file = target / name
        manifest["files"][name] = {"bytes": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=True))


if __name__ == "__main__":
    main()
