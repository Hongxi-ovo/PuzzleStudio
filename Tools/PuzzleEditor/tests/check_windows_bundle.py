"""Check the actual EXE, including relocation into a Unicode path with spaces."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
EXE = ROOT / "Dist/PuzzleStudio-0.2.1/PuzzleStudio.exe"
OUT = ROOT / ".local-setup/puzzle-studio"


def run_case(executable, name, arguments, cwd, expected_exit=0):
    report = OUT / (name + ".json")
    process = subprocess.run([str(executable), *arguments, "--report", str(report)], cwd=cwd,
                             creationflags=subprocess.CREATE_NO_WINDOW, timeout=55)
    result = json.loads(report.read_text(encoding="utf-8"))
    assert process.returncode == expected_exit, (name, process.returncode, result)
    assert result["passed"] == (expected_exit == 0), (name, result)
    if expected_exit == 0:
        assert result["frozen"] and Path(result["root"]) == ROOT
        assert result["cards"] > 0 and result["assets"] == 10 and result["packageExport"] and result["bundledResources"]
    return {"name": name, "exitCode": process.returncode, "result": result}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix="puzzle-portable-") as temporary:
        independent = Path(temporary) / "便携 测试"
        independent.mkdir()
        portable = independent / EXE.name
        shutil.copy2(EXE, portable)
        results.append(run_case(EXE, "exe-check", ["--check"], independent))
        results.append(run_case(portable, "exe-relocated-check", ["--check", "--root", str(ROOT)], independent))
        results.append(run_case(portable, "exe-invalid-root", ["--check", "--root", str(independent / "missing")], independent, 1))
        results.append(run_case(EXE, "exe-renderer-check", ["--smoke-test"], independent))
    (OUT / "exe-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"checks": len(results), "passed": True}, ensure_ascii=True))


if __name__ == "__main__":
    main()
