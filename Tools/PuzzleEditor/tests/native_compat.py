"""Compare original/imported/exported puzzles using the actual MDPro3 Windows core.

No player actions are automated. Initial field state and startup messages through
the first core input request are compared; this is not a proof of full solutions.
"""
import argparse
import ctypes as C
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
spec = importlib.util.spec_from_file_location("puzzle_server", HERE.parent / "server.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROOT = Path(os.environ.get("MDPRO3_ROOT", module.ROOT)).resolve()


class CardData(C.Structure):
    _fields_ = [("code", C.c_uint32), ("alias", C.c_uint32), ("setcode", C.c_uint16 * 16),
                *[(key, C.c_uint32) for key in ("type", "level", "attribute", "race")],
                ("attack", C.c_int32), ("defense", C.c_int32),
                *[(key, C.c_uint32) for key in ("lscale", "rscale", "link_marker")]]


class Core:
    def __init__(self, resources):
        self.resources = resources
        self.scripts = {}
        self.buffers = {}
        self.errors = []
        self.puzzle = b""
        paths = [resources.scripts_path] if resources.bundled else [ROOT / "Data/script.zip", *sorted((ROOT / "Expansions").glob("*.ypk")), *sorted((ROOT / "Expansions").glob("*.zip"))]
        for path in paths:
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    if name.endswith(".lua"):
                        self.scripts[name.lstrip("./")] = z.read(name)
                        if resources.bundled and not name.startswith("script/"):
                            self.scripts["script/" + name.lstrip("./")] = z.read(name)
        self.directory = os.add_dll_directory(str(ROOT / "Assets/Plugins/Windows"))
        self.dll = C.CDLL(str(ROOT / "Assets/Plugins/Windows/ocgcore.dll"))
        self.script_callback = C.CFUNCTYPE(C.c_void_p, C.c_char_p, C.POINTER(C.c_int))(self.read_script)
        self.card_callback = C.CFUNCTYPE(C.c_uint32, C.c_uint32, C.POINTER(CardData))(self.read_card)
        self.log_callback = C.CFUNCTYPE(C.c_uint32, C.c_void_p, C.c_uint32)(self.log)
        self.dll.set_script_reader(self.script_callback)
        self.dll.set_card_reader(self.card_callback)
        self.dll.set_message_handler(self.log_callback)
        self.dll.create_duel.argtypes = [C.c_uint32]
        self.dll.create_duel.restype = C.c_void_p
        self.dll.end_duel.argtypes = [C.c_void_p]
        self.dll.preload_script.argtypes = [C.c_void_p, C.c_char_p]
        self.dll.preload_script.restype = C.c_int32
        self.dll.query_field_info.argtypes = [C.c_void_p, C.c_void_p]
        self.dll.query_field_info.restype = C.c_int32
        self.dll.query_field_card.argtypes = [C.c_void_p, C.c_uint8, C.c_uint8, C.c_uint32, C.c_void_p, C.c_int32]
        self.dll.query_field_card.restype = C.c_int32
        self.dll.get_log_message.argtypes = [C.c_void_p, C.c_void_p]
        self.dll.start_duel.argtypes = [C.c_void_p, C.c_uint32]
        self.dll.process.argtypes = [C.c_void_p]
        self.dll.process.restype = C.c_uint32
        self.dll.get_message.argtypes = [C.c_void_p, C.c_void_p]
        self.dll.get_message.restype = C.c_int32

    def read_script(self, name, length):
        key = name.decode("utf-8").replace("\\", "/").lstrip("./")
        data = self.puzzle if key == "puzzle_studio_test.lua" else self.scripts.get(key)
        if data is None:
            length[0] = 0
            return 0
        if key not in self.buffers or key == "puzzle_studio_test.lua":
            self.buffers[key] = C.create_string_buffer(data)
        length[0] = len(data)
        return C.addressof(self.buffers[key])

    def read_card(self, code, pointer):
        r = self.resources.raw_cards.get(code)
        data = CardData()
        if r:
            data.code = code
            data.alias = r["alias"]
            sets = r["setcode"] & ((1 << 64) - 1)
            for i in range(4):
                data.setcode[i] = (sets >> (i * 16)) & 65535
            data.type, data.level, data.attribute, data.race = r["type"], r["level"] & 255, r["attribute"], r["race"]
            data.attack, data.defense = r["atk"], r["def"]
            data.lscale, data.rscale = (r["level"] >> 24) & 255, (r["level"] >> 16) & 255
            data.link_marker = r["def"] if r["type"] & 0x4000000 else 0
        pointer[0] = data
        return code if r else 0

    def log(self, duel, kind):
        buffer = C.create_string_buffer(8192)
        self.dll.get_log_message(duel, buffer)
        self.errors.append(buffer.value.decode("utf-8", "replace"))
        return 0

    def field(self, duel):
        buffer = C.create_string_buffer(1_000_000)
        result = []
        size = self.dll.query_field_info(duel, buffer)
        result.append(bytes(buffer[:size]))
        # Query exact card data, targets, equipment, overlays, counters, status,
        # scales, link markers, and owner. Avoid cache so both runs are comparable.
        flags = 0xFFFFFF
        for player in (0, 1):
            for location in (1, 2, 4, 8, 16, 32, 64):
                size = self.dll.query_field_card(duel, player, location, flags, buffer, 0)
                result.append(bytes(buffer[:size]))
        return b"".join(len(x).to_bytes(4, "little") + x for x in result)

    def run(self, source):
        self.errors = []
        self.puzzle = source.encode("utf-8")
        duel = self.dll.create_duel(123456)
        try:
            loaded = self.dll.preload_script(duel, b"puzzle_studio_test.lua")
            initial = self.field(duel)
            startup = []
            if loaded:
                self.dll.start_duel(duel, 0)
                buffer = C.create_string_buffer(1_000_000)
                for _ in range(200):
                    result = self.dll.process(duel)
                    size = self.dll.get_message(duel, buffer)
                    if size:
                        startup.append(bytes(buffer[:size]))
                    if result & 0xF0000000:
                        break
                else:
                    raise RuntimeError("Core did not reach an input boundary")
            return {"loaded": bool(loaded), "initial": hashlib.sha256(initial).hexdigest(),
                    "startup": hashlib.sha256(b"".join(startup)).hexdigest(),
                    "after_start": hashlib.sha256(self.field(duel)).hexdigest(),
                    "errors": [re.sub(r'\[string "[^"]+"\]:\d+:', '[script]:', x) for x in self.errors]}
        finally:
            self.dll.end_duel(duel)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extra", type=Path, action="append", default=[])
    args = parser.parse_args()
    resources = module.Resources(ROOT, "zh-CN")
    files = sorted((ROOT / "Puzzle").rglob("*.lua")) + args.extra
    out = ROOT / ".local-setup/puzzle-studio"
    out.mkdir(parents=True, exist_ok=True)
    input_path, output_path = out / "input.json", out / "roundtrip.json"
    input_path.write_text(json.dumps({"cards": list(resources.cards.values()), "files": [{"name": str(p), "source": p.read_text(encoding="utf-8-sig")} for p in files]}, ensure_ascii=False), encoding="utf-8")
    subprocess.run(["node", str(HERE / "roundtrip.mjs"), str(input_path), str(output_path)], check=True)
    cases = json.loads(output_path.read_text(encoding="utf-8"))
    core = Core(resources)
    reports = []
    for index, case in enumerate(cases):
        item = {"name": case["name"], "import": case["ok"]}
        if case["ok"]:
            before, after = core.run(case["original"]), core.run(case["exported"])
            item.update({"baseline": before, "roundtrip": after, "identical": before == after,
                         "cards": case["cards"], "preservedStatements": case["rawStatements"], "warnings": case["warnings"]})
        else:
            item["error"] = case["error"]
        reports.append(item)
        if (index + 1) % 25 == 0:
            print(f"Checked {index + 1}/{len(cases)}", flush=True)
    result = {"total": len(reports), "imported": sum(x["import"] for x in reports),
              "nativeIdentical": sum(x.get("identical", False) for x in reports),
              "baselineLoads": sum(x.get("baseline", {}).get("loaded", False) for x in reports),
              "cases": reports}
    (out / "native-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "cases"}, ensure_ascii=False), flush=True)
    mismatches = [x for x in reports if not x.get("identical")]
    if mismatches:
        print(json.dumps(mismatches, ensure_ascii=False, indent=2), flush=True)
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
