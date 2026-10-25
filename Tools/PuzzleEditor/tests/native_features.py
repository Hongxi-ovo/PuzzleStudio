"""Run emitted editor features and automatically discovered grants against the real core."""
import io
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import zipfile
import native_compat as n


def main():
    out = n.ROOT / ".local-setup/puzzle-studio"
    subprocess.run(["node", str(n.HERE / "features.mjs"), str(out / "input.json"), str(out / "features.json")], check=True)
    resources = n.module.Resources(n.ROOT, "zh-CN")
    (out / "grant-sources.json").write_text(json.dumps(resources.grant_sources(), ensure_ascii=False), encoding="utf-8")
    subprocess.run(["node", str(n.HERE / "grant_features.mjs"), str(out / "grant-sources.json"), str(out / "grant-features.json")], check=True)
    core = n.Core(resources)
    results = []
    for case in json.loads((out / "features.json").read_text(encoding="utf-8")):
        result = core.run(case["lua"])
        results.append({"name": case["name"], "passed": result["loaded"] and not result["errors"], "errors": result["errors"]})
    for case in json.loads((out / "grant-features.json").read_text(encoding="utf-8")):
        result = core.run(case["lua"])
        results.append({"name": case["name"], "passed": result["loaded"] and not result["errors"], "errors": result["errors"]})
    (out / "feature-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results, ensure_ascii=True, indent=2))
    assert all(x["passed"] for x in results)


if __name__ == "__main__":
    main()
