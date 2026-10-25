"""Local Puzzle Studio. Python 3.10+, no third-party dependencies."""
from __future__ import annotations

import argparse
from contextlib import closing
import io
import gzip
import hashlib
import json
import mimetypes
import re
import sqlite3
import threading
import tempfile
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from card_images import CardPictures

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WEB = HERE / "web"
GRANT_TEXT = re.compile(r"获得以下效果|得到以下效果|追加以下效果|作为.{0,30}素材.{0,100}(?:获得|得到|以下效果)", re.S)


class Resources:
    def __init__(self, root: Path, locale: str, bundled=True, cache_dir=None):
        self.root = root
        self.cards = {}
        self.raw_cards = {}
        self.pack_images = {}
        self.sources = []
        self.script_sources = {}
        self.bundled = bundled
        if bundled:
            assets = HERE / "resources"
            if not (assets / "manifest.json").is_file():
                raise RuntimeError("缺少内置卡库资源，请先运行 freeze_resources.py 准备资源")
            with gzip.open(assets / "database.json.gz", "rt", encoding="utf-8") as stream:
                snapshot = json.load(stream)
            self.cards = {c["id"]: c for c in snapshot["cards"]}
            self.raw_cards = {c["id"]: c for c in snapshot["rawCards"]}
            self.sources = ["内置卡库"]
            self.scripts_path = assets / "scripts.zip"
            with zipfile.ZipFile(self.scripts_path) as archive:
                for code, path in snapshot["scriptPaths"].items():
                    self.script_sources[int(code)] = (archive.read(f"c{code}.lua").decode("utf-8-sig"), path)
            self.pictures = CardPictures(assets, cache_dir)
            self.build_index()
            return
        base = root / "Data" / "locales" / locale / "cards.cdb"
        if not base.exists():
            base = root / "Data/locales/zh-CN/cards.cdb"
        self.load_db(base)
        expansion = root / "Expansions"
        if expansion.exists():
            for db in sorted(expansion.glob("*.cdb")):
                self.load_db(db)
            for pack in sorted(expansion.iterdir()):
                if pack.suffix.lower() not in (".ypk", ".zip"):
                    continue
                try:
                    with zipfile.ZipFile(pack) as archive:
                        for name in sorted(archive.namelist()):
                            if name.lower().endswith(".cdb"):
                                self.load_db_bytes(archive.read(name), f"{pack.name}/{name}")
                            match = re.search(r"(?:^|/)(pics|art2?|picture/art2?)/([0-9]+)\.(jpg|png|webp)$", name, re.I)
                            if match:
                                code = int(match[2])
                                full = match[1].lower() == "pics"
                                old = self.pack_images.get(code)
                                if old is None or full or not old[2]:
                                    self.pack_images[code] = (pack, name, full)
                except (zipfile.BadZipFile, OSError, sqlite3.Error):
                    continue
        if not self.cards:
            raise RuntimeError(f"No cards found in {base}")
        self.sorted_cards = sorted(self.cards.values(), key=lambda c: (c["alias"] != 0, -c["id"]))
        # Scan the final script for every local card, including expansion overrides.
        for pack in [root / "Data/script.zip", *sorted(expansion.glob("*.zip")), *sorted(expansion.glob("*.ypk"))]:
            if not pack.is_file():
                continue
            try:
                with zipfile.ZipFile(pack) as archive:
                    for name in archive.namelist():
                        match = re.fullmatch(r"(?:script/)?c([0-9]+)\.lua", name)
                        if match and int(match[1]) in self.cards:
                            code = int(match[1])
                            self.script_sources[code] = (archive.read(name).decode("utf-8-sig"), f"{pack.name}/{name}")
            except (OSError, zipfile.BadZipFile, UnicodeError):
                continue
        for local in sorted((root / "script").glob("c*.lua")):
            match = re.fullmatch(r"c([0-9]+)\.lua", local.name)
            if match and int(match[1]) in self.cards:
                self.script_sources[int(match[1])] = (local.read_text(encoding="utf-8-sig"), f"script/{local.name}")
        self.build_index()

    def build_index(self):
        self.sorted_cards = sorted(self.cards.values(), key=lambda c: (c["alias"] != 0, -c["id"]))
        self.grant_candidates = []
        for code, (source, path) in self.script_sources.items():
            card = self.cards[code]
            if not card["type"] & 1:
                continue
            if any(marker in source for marker in ("EFFECT_TYPE_XMATERIAL", "EVENT_BE_MATERIAL", "GetReasonCard()")) or GRANT_TEXT.search(card["desc"]):
                self.grant_candidates.append({"code": code, "name": card["name"], "description": card["desc"],
                                              "summary": card["desc"].split("●")[-1].strip(), "source": source,
                                              "path": path, "hash": hashlib.sha256(source.encode("utf-8")).hexdigest()})
        self.grant_candidates.sort(key=lambda c: c["code"])

    def grant_sources(self):
        return self.grant_candidates

    def load_db(self, path):
        if not path.exists():
            return
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
            self.read_db(db, str(path.relative_to(self.root)))

    def load_db_bytes(self, data, source):
        # In-memory deserialization is not available in every bundled Python build.
        if hasattr(sqlite3.Connection, "deserialize"):
            with closing(sqlite3.connect(":memory:")) as db:
                db.deserialize(data)
                self.read_db(db, source)
        else:
            with tempfile.TemporaryDirectory(prefix="puzzle-cdb-") as directory:
                file = Path(directory) / "cards.cdb"
                file.write_bytes(data)
                with closing(sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True)) as db:
                    self.read_db(db, source)

    def read_db(self, db, source):
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT d.*,t.name,t.desc FROM datas d JOIN texts t ON d.id=t.id")
        for row in rows:
            r = dict(row)
            code = int(r["id"])
            self.raw_cards[code] = r
            self.cards[code] = {
                "id": code, "name": r["name"] or str(code), "desc": r["desc"] or "",
                "type": r["type"], "atk": r["atk"], "def": r["def"],
                "level": r["level"] & 255, "lscale": (r["level"] >> 24) & 255,
                "rscale": (r["level"] >> 16) & 255,
                "linkMarker": r["def"] if r["type"] & 0x4000000 else 0,
                "race": r["race"], "attribute": r["attribute"], "alias": r["alias"],
                "source": source,
            }
        self.sources.append(source)

    def search(self, query, category, offset, limit):
        words = query.casefold().split()
        mask = {"monster": 1, "spell": 2, "trap": 4, "pendulum": 0x1000000, "link": 0x4000000, "xyz": 0x800000}.get(category, 0)
        matches = [c for c in self.sorted_cards
                   if (not mask or c["type"] & mask)
                   and all(w in (str(c["id"]) + " " + c["name"] + " " + c["desc"]).casefold() for w in words)]
        return {"total": len(matches), "cards": matches[offset:offset + limit]}

    def picture(self, code):
        if self.bundled:
            return self.pictures.picture(code)
        entry = self.pack_images.get(code)
        if entry and entry[2]:
            pack, name, _ = entry
            with zipfile.ZipFile(pack) as archive:
                return archive.read(name), mimetypes.guess_type(name)[0] or "image/jpeg", True
        return None



class Handler(BaseHTTPRequestHandler):
    resources: Resources

    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args) > 1 else "") not in ("200", "304"):
            super().log_message(fmt, *args)

    def respond(self, body, content_type="application/json; charset=utf-8", status=200, cache=False):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "public, max-age=3600" if cache else "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        params = parse_qs(parsed.query)
        try:
            if path == "/api/info":
                return self.respond({"count": len(self.resources.cards), "sources": self.resources.sources,
                                     "root": str(self.resources.root), "version": "0.2.1", "bundled": self.resources.bundled})
            if path == "/api/images":
                codes = [int(c) for c in params.get("codes", [""])[0].split(",") if c.isdecimal()][:120]
                pictures = getattr(self.resources, "pictures", None)
                versions = {str(c): pictures.version(c) if pictures else "" for c in codes if c in self.resources.cards}
                if pictures:
                    for code, version in versions.items():
                        if not version:
                            pictures.request(int(code))
                return self.respond(versions)
            if path == "/card-back.jpg":
                return self.respond((HERE / "resources/cover.jpg").read_bytes(), "image/jpeg", cache=True)
            if path == "/api/cards":
                offset = max(0, int(params.get("offset", [0])[0]))
                limit = min(120, max(1, int(params.get("limit", [40])[0])))
                return self.respond(self.resources.search(params.get("q", [""])[0], params.get("type", ["all"])[0], offset, limit))
            if path == "/api/grants":
                return self.respond(self.resources.grant_sources())
            if path == "/api/puzzles":
                folder = self.resources.root / "Puzzle"
                return self.respond([{"name": p.stem, "path": p.relative_to(folder).as_posix()} for p in sorted(folder.rglob("*.lua"))])
            if path == "/api/puzzle":
                folder = (self.resources.root / "Puzzle").resolve()
                file = (folder / params.get("path", [""])[0]).resolve()
                if not file.is_relative_to(folder) or file.suffix.lower() != ".lua" or not file.is_file():
                    return self.respond({"error": "残局文件不存在"}, status=404)
                return self.respond({"name": file.stem, "source": file.read_text(encoding="utf-8-sig")})
            if path.startswith("/api/card/"):
                card = self.resources.cards.get(int(path.rsplit("/", 1)[1]))
                return self.respond(card or {"error": "卡库中没有这张卡"}, status=200 if card else 404)
            if path.startswith(("/art/", "/card-image/")):
                code = int(path.rsplit("/", 1)[1])
                if code not in self.resources.cards:
                    return self.respond({"error": "未知卡号"}, status=404)
                picture = self.resources.picture(code)
                if picture:
                    data, mime, high = picture
                    return self.respond(data, mime, cache=high)
                svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="580"><rect x="8" y="8" width="384" height="564" rx="12" fill="#17283b" stroke="#49647d" stroke-width="6"/><path d="M200 130 300 275 200 420 100 275Z" fill="none" stroke="#49647d" stroke-width="2"/><text x="200" y="480" text-anchor="middle" fill="#8ca2b8" font-size="22">NO IMAGE</text></svg>'
                return self.respond(svg.encode(), "image/svg+xml")
            file = (WEB / ("index.html" if path == "/" else path.lstrip("/"))).resolve()
            if not file.is_relative_to(WEB) or not file.is_file():
                return self.respond({"error": "Not found"}, status=404)
            mime = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html"}.get(file.suffix, mimetypes.guess_type(file)[0] or "application/octet-stream")
            return self.respond(file.read_bytes(), mime + "; charset=utf-8")
        except (ValueError, OSError, zipfile.BadZipFile) as exc:
            self.respond({"error": str(exc)}, status=400)

    def do_POST(self):
        # Write only a new Lua file in this installation's Puzzle directory.
        origin = self.headers.get("Origin")
        if origin != f"http://{self.headers.get('Host')}":
            return self.respond({"error": "仅允许本地编辑器保存"}, status=403)
        if self.path not in ("/api/export", "/api/package"):
            return self.respond({"error": "Not found"}, status=404)
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > 2_000_000:
                raise ValueError("工程内容过大或为空")
            data = json.loads(self.rfile.read(length))
            name = str(data.get("name", "")).strip()
            if not name or len(name) > 100 or re.search(r'[<>:"/\\|?*\x00-\x1f]', name) or name.endswith((".", " ")):
                raise ValueError("请使用不含路径和特殊字符的文件名")
            lua = data.get("lua")
            if not isinstance(lua, str) or not lua.startswith("-- Puzzle Studio"):
                raise ValueError("无效的残局内容")
            custom = data.get("document", {}).get("diyCards", [])
            if custom:
                raise ValueError("制作 DIY 卡功能已移除；请使用游戏已有卡片并绑定残局 Lua 效果")
            if self.path == "/api/package":
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer,"w",zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr(f"Puzzle/{name}.lua",lua.encode("utf-8"))
                    archive.writestr(f"{name}.puzzle.json",json.dumps(data.get("document",{}),ensure_ascii=False,indent=2).encode("utf-8"))
                return self.respond(buffer.getvalue(),"application/zip")
            folder = self.resources.root / "Puzzle"
            folder.mkdir(exist_ok=True)
            destination = folder / (name + ".lua")
            if destination.exists():
                raise FileExistsError()
            created = []
            try:
                with destination.open("x", encoding="utf-8", newline="\n") as file:
                    created.append(destination)
                    file.write(lua)
            except OSError:
                for file in created:
                    file.unlink(missing_ok=True)
                raise
            self.respond({"path": str(destination)})
        except FileExistsError:
            self.respond({"error": "同名残局已存在，请修改工程名称后再保存"}, status=409)
        except (ValueError, TypeError, OSError) as exc:
            self.respond({"error": str(exc)}, status=400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--port", type=int, default=18743)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    Handler.resources = Resources(args.root.resolve(), args.locale)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Puzzle Studio: {url} ({len(Handler.resources.cards)} cards)", flush=True)
    if args.open:
        threading.Timer(.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        Handler.resources.pictures.close()


if __name__ == "__main__":
    main()
