"""Verify local export boundaries and removal of DIY creation."""
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import quote
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as s


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="puzzle-server-test-")
        self.root = Path(self.temp.name)
        base = self.root / "Data/locales/zh-CN"
        base.mkdir(parents=True)
        db = sqlite3.connect(base / "cards.cdb")
        db.executescript("CREATE TABLE datas(id INTEGER,alias INTEGER,type INTEGER,atk INTEGER,def INTEGER,level INTEGER,race INTEGER,attribute INTEGER);CREATE TABLE texts(id INTEGER,name TEXT,desc TEXT);INSERT INTO datas VALUES(1,0,17,1000,1000,4,1,1);INSERT INTO texts VALUES(1,'测试卡','测试文本');")
        db.commit()
        db.close()
        s.Handler.resources = s.Resources(self.root, "zh-CN", bundled=False)
        self.server = s.ThreadingHTTPServer(("127.0.0.1", 0), s.Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def post(self, route, data, origin=None):
        return urlopen(Request(self.url + route, data=json.dumps(data).encode(), headers={"Content-Type": "application/json", "Origin": origin or self.url}), timeout=5)

    def payload(self):
        return {"name": "测试残局", "lua": "-- Puzzle Studio\nDebug.ShowHint(\"test\")\n", "document": {"schemaVersion": 1, "cards": []}}

    def test_local_reads_and_path_boundary(self):
        with urlopen(self.url + "/api/cards?q=" + quote("测试")) as response:
            self.assertEqual(json.load(response)["total"], 1)
        with self.assertRaises(HTTPError) as error:
            urlopen(self.url + "/api/puzzle?path=../../server.py")
        self.assertEqual(error.exception.code, 404)

    def test_export_package_contains_only_project_and_puzzle(self):
        with self.post("/api/package", self.payload()) as response:
            data = response.read()
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            self.assertEqual(set(package.namelist()), {"Puzzle/测试残局.lua", "测试残局.puzzle.json"})

    def test_diy_creation_is_rejected(self):
        payload = self.payload()
        payload["document"]["diyCards"] = [{"id": 100000001}]
        with self.assertRaises(HTTPError) as error:
            self.post("/api/package", payload)
        self.assertEqual(error.exception.code, 400)
        self.assertFalse((self.root / "Expansions").exists())

    def test_install_and_duplicate_preserves_existing_files(self):
        payload = self.payload()
        with self.post("/api/export", payload) as response:
            self.assertEqual(response.status, 200)
        puzzle = self.root / "Puzzle/测试残局.lua"
        before = puzzle.read_bytes()
        with self.assertRaises(HTTPError) as error:
            self.post("/api/export", payload)
        self.assertEqual(error.exception.code, 409)
        self.assertEqual(before, puzzle.read_bytes())

    def test_cross_origin_and_path_names_cannot_write(self):
        with self.assertRaises(HTTPError) as error:
            self.post("/api/export", self.payload(), "https://example.com")
        self.assertEqual(error.exception.code, 403)
        payload = self.payload()
        payload["name"] = "../other"
        with self.assertRaises(HTTPError) as error:
            self.post("/api/export", payload)
        self.assertEqual(error.exception.code, 400)
        self.assertFalse((self.root / "Puzzle").exists())


if __name__ == "__main__":
    unittest.main()
