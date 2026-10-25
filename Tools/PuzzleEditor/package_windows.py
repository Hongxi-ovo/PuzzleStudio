"""Assemble a portable test ZIP beside the built executable."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import zipfile

VERSION = "0.2.1"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    exe = directory / "PuzzleStudio.exe"
    if not exe.is_file():
        raise FileNotFoundError(exe)
    (directory / "使用说明.txt").write_text("""残局编辑器 0.2.1 · Windows x64 测试版

双击 PuzzleStudio.exe 启动，不需要安装 Python 或 Node.js。
卡库、卡片脚本、默认完整卡图与卡背已内置，不需要外部 MDPro3 资源目录。
高清卡图按需下载并存入本地缓存，下次优先读取缓存；断网时使用内置完整卡图。
使用 --choose-root 选择残局读写目录；也可使用 --root "目录" 指定。此目录无需卡库或脚本。

操作：
点击场地格子选卡，点击卡组、墓地、除外区查看已有卡片。
拖动卡片靠近窗口底部，删除区会弹出；松开删除，拖离或 Esc 取消，Ctrl+Z 撤销。
导入印卡残局后会自动显示相关卡片的印卡 Lua。
保存工程用于继续编辑；下载 Lua 或完整包用于测试运行。
“写入 MDPro3”会创建新的残局，同名文件不会覆盖。
选中怪兽后，可在“效果”中扫描本地卡片脚本并提取素材赋予效果。
超量素材类效果通过添加真实素材保留；复杂且无法安全提取的脚本会列为需手动处理。
超量素材支持怪兽、魔法和陷阱卡，可混合添加。
不再提供 DIY 卡制作；仍支持为现有卡片编写 Lua 效果。
顶部“关闭工程”在有修改时提供“是 / 否 / 取消”，保存取消或失败时保留工程。
残局说明与开场提示可逐行增删。场地区域的对方卡片旋转 180 度显示。
守备绕中心逆时针旋转 90 度；翻面旋转 180 度，里侧正面图按 0→70%→0 循环渐显。
场地格（含 EX 区）大小统一，卡片保持相同比例并居中。

运行环境：Windows 10/11 x64、系统 WebView2 Runtime、.NET Framework 4.8。
本机已具备 WebView2；其他机器若缺少，可从微软官方下载：
https://developer.microsoft.com/microsoft-edge/webview2/

编辑器只监听本机 127.0.0.1:18744，关闭窗口后服务一并停止。
独立窗口与浏览器版本的自动存档分开；可以用工程 JSON 或 Lua 在两者间导入。
设置、自动存档和日志位于：%LOCALAPPDATA%\\MDPro3\\PuzzleStudio
高清卡图缓存位于上述目录的 CardImages 文件夹，删除缓存后会重新下载。

技术检查：
PuzzleStudio.exe --check --root "MDPro3目录" --report check.json
PuzzleStudio.exe --smoke-test --root "MDPro3目录" --report renderer-check.json
""", encoding="utf-8-sig")
    packages = ["pywebview", "pythonnet", "clr_loader", "cffi", "pycparser", "bottle",
                "proxy_tools", "typing_extensions", "pyinstaller", "pyinstaller-hooks-contrib"]
    versions = {}
    for name in packages:
        dist = importlib.metadata.distribution(name)
        versions[name] = dist.version
        for file in dist.files or []:
            if file.name.lower() not in ("license", "license.txt", "license.md", "copying", "notice"):
                continue
            source = Path(dist.locate_file(file))
            if source.is_file():
                destination = directory / "licenses" / name / file.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(source.read_bytes())
    luaparse_license = Path(__file__).resolve().parent / "web/vendor/luaparse.LICENSE"
    if luaparse_license.exists():
        destination = directory / "licenses/luaparse/LICENSE"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(luaparse_license.read_bytes())
    manifest = {"name": "PuzzleStudio", "version": VERSION, "platform": "Windows x64",
                "builtAt": datetime.now(timezone.utc).isoformat(), "bytes": exe.stat().st_size,
                "sha256": hashlib.sha256(exe.read_bytes()).hexdigest(), "dependencies": versions,
                "resources": "Embedded database, Lua scripts, complete fallback pictures and card back; persistent HQ cache"}
    (directory / "build-info.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    archive = directory.parent / f"PuzzleStudio-{VERSION}-Windows-x64.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
        for file in sorted(directory.rglob("*")):
            if file.is_file():
                package.write(file, Path("PuzzleStudio") / file.relative_to(directory))
    print(json.dumps({"exe": str(exe), "zip": str(archive), "MiB": round(exe.stat().st_size / 1048576, 1)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
