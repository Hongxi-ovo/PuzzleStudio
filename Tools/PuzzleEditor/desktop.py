"""Windows desktop entry point; game resources remain in the MDPro3 folder."""
from __future__ import annotations

import argparse
import ctypes
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from urllib.request import Request, urlopen
import zipfile
import io

import server as editor

VERSION = "0.2.1"
APP_DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MDPro3/PuzzleStudio"
SETTINGS = APP_DATA / "settings.json"


class ProjectFiles:
    def __init__(self):
        self._window = None

    def save_project(self, content, filename):
        """The native Save dialog is also the user's choice of destination."""
        try:
            if not isinstance(content, str) or len(content.encode("utf-8")) > 2_000_000:
                raise ValueError("工程过大或内容无效")
            document = json.loads(content)
            if document.get("schemaVersion") != 1 or not isinstance(document.get("cards"), list):
                raise ValueError("无效的残局工程")
            import re
            import webview
            filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(filename))[:140]
            selected = self._window.create_file_dialog(webview.FileDialog.SAVE, save_filename=filename,
                                                     file_types=("残局工程 (*.puzzle.json)",))
            if not selected:
                return {"saved": False}
            path = Path(selected[0] if isinstance(selected, (list, tuple)) else selected)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(content)
                os.replace(temporary, path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            return {"saved": True, "path": str(path)}
        except Exception as error:
            logging.exception("Saving project failed")
            return {"saved": False, "error": str(error)}


def valid_root(path):
    return path.is_dir() and any((path / "Data/locales" / language / "cards.cdb").is_file()
                                 for language in ("zh-CN", "en-US"))


def find_root(explicit=None, settings=None, executable=None, cwd=None):
    if explicit is not None:
        root = Path(explicit).expanduser().resolve()
        if not valid_root(root):
            raise ValueError("此目录没有 MDPro3 的 Data/locales/*/cards.cdb：" + str(root))
        return root
    executable = Path(executable or (sys.executable if getattr(sys, "frozen", False) else __file__)).resolve()
    settings = settings or {}
    # Prefer resources beside the program, so moving it to another MDPro3 works.
    candidates = [executable.parent, *list(executable.parent.parents)[:4]]
    if settings.get("root"):
        candidates.append(Path(settings["root"]))
    candidates.append(Path(cwd or Path.cwd()))
    for candidate in candidates:
        if valid_root(candidate):
            return candidate.resolve()
    return None


def choose_root():
    import tkinter as tk
    from tkinter import filedialog
    owner = tk.Tk()
    owner.withdraw()
    try:
        directory = filedialog.askdirectory(title="选择残局读写目录（无需卡库或脚本）", parent=owner)
        return Path(directory).resolve() if directory else None
    finally:
        owner.destroy()


def notify(message, error=False):
    if sys.platform == "win32":
        ctypes.windll.user32.MessageBoxW(None, str(message), "残局编辑器", 0x10 if error else 0x40)
    elif sys.stderr:
        print(message, file=sys.stderr)


def emit_report(data, path):
    if path:
        path = Path(path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if sys.stdout:
        print(json.dumps(data, ensure_ascii=True), flush=True)


def check_bundle(httpd):
    origin = f"http://127.0.0.1:{httpd.server_port}"
    assets = ["/", "/app.mjs", "/model.mjs", "/lua-import.mjs", "/lua-card-scripts.mjs",
              "/grant-effects.mjs", "/field-layout.mjs", "/card-display.mjs", "/style.css", "/vendor/luaparse.js"]
    for asset in assets:
        with urlopen(origin + asset, timeout=10) as response:
            if response.status != 200 or not response.read():
                raise RuntimeError("打包缺少页面资源：" + asset)
    with urlopen(origin + "/api/info", timeout=10) as response:
        info = json.load(response)
    with urlopen(origin + "/api/grants", timeout=10) as response:
        grants = json.load(response)
    payload = {"name": "DesktopSelfCheck", "lua": "-- Puzzle Studio\naux.BeginPuzzle()\n", "document": {"schemaVersion": 1, "cards": []}}
    request = Request(origin + "/api/package", json.dumps(payload).encode(),
                      headers={"Origin": origin, "Content-Type": "application/json"})
    with urlopen(request, timeout=10) as response:
        with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
            if "Puzzle/DesktopSelfCheck.lua" not in archive.namelist():
                raise RuntimeError("导出包结构不完整")
    return {"version": VERSION, "frozen": bool(getattr(sys, "frozen", False)), "root": info["root"],
            "bundledResources": info["bundled"],
            "cards": info["count"], "grantSources": len(grants), "assets": len(assets),
            "packageExport": True, "passed": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--port", type=int, default=18744)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--choose-root", action="store_true")
    parser.add_argument("--check", action="store_true", help="Check the frozen bundle without a window")
    parser.add_argument("--smoke-test", action="store_true", help="Open a hidden WebView2, verify the page, then exit")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    APP_DATA.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=APP_DATA / "desktop.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")
    httpd = None
    mutex = None
    profile = None
    try:
        try:
            settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            settings = {}
        if args.choose_root:
            root = choose_root()
            if root is None:
                return 0
        elif args.root is not None:
            root = args.root.expanduser().resolve()
            if not root.is_dir():
                raise ValueError("残局读写目录不存在：" + str(root))
        else:
            saved_root = Path(settings.get("root", "")) if settings.get("root") else None
            root = saved_root if saved_root and saved_root.is_dir() else (APP_DATA / "Workspace" if getattr(sys, "frozen", False) else editor.ROOT)
            root.mkdir(parents=True, exist_ok=True)
        if not (args.check or args.smoke_test):
            # A single desktop instance keeps the autosave origin stable.
            kernel = ctypes.windll.kernel32
            kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
            kernel.CreateMutexW.restype = ctypes.c_void_p
            mutex = kernel.CreateMutexW(None, False, "Local\\MDPro3PuzzleStudio")
            if not mutex:
                raise ctypes.WinError()
            if kernel.GetLastError() == 183:
                notify("残局编辑器已经运行，请切换到现有窗口。")
                return 0
            SETTINGS.write_text(json.dumps({"root": str(root)}, ensure_ascii=False, indent=2), encoding="utf-8")
        def request_log(self, fmt, *values):
            # Windowed EXEs have no stderr stream for BaseHTTPRequestHandler.
            if len(values) > 1 and str(values[1]) not in ("200", "304"):
                logging.warning(fmt, *values)

        handler = type("DesktopHandler", (editor.Handler,),
                       {"resources": editor.Resources(root, args.locale), "log_message": request_log})
        httpd = editor.ThreadingHTTPServer(("127.0.0.1", 0 if args.check or args.smoke_test else args.port), handler)
        httpd.daemon_threads = True
        service = threading.Thread(target=httpd.serve_forever, daemon=True)
        service.start()
        logging.info("Started desktop %s; root=%s; port=%d", VERSION, root, httpd.server_port)
        result = check_bundle(httpd)
        if args.check:
            emit_report(result, args.report)
            return 0
        import webview
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.settings["ALLOW_FILE_URLS"] = False
        if args.smoke_test:
            profile = tempfile.TemporaryDirectory(prefix="puzzle-desktop-smoke-")
            storage = profile.name
        else:
            storage = str(APP_DATA / "WebView2")
        project_files = ProjectFiles()
        window = webview.create_window("残局编辑器 · Puzzle Studio", f"http://127.0.0.1:{httpd.server_port}/", js_api=project_files,
                                       width=1440, height=960, min_size=(1100, 720),
                                       background_color="#090f19", text_select=True, draggable=True,
                                       hidden=args.smoke_test, focus=not args.smoke_test)
        project_files._window = window
        loaded = threading.Event()
        window.events.loaded += loaded.set
        errors = []

        def smoke():
            try:
                if not loaded.wait(30):
                    raise RuntimeError("WebView2 未能加载编辑器")
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    # ExecuteScriptAsync returns this expression directly on
                    # WebView2; don't use eval or weaken the page's CSP.
                    state = window.run_js("JSON.stringify({title:document.title, count:document.getElementById('library-total')?.textContent, deleteZone:!!document.getElementById('delete-drop-zone')})")
                    if isinstance(state, str):
                        state = json.loads(state)
                    if state and state.get("count") == f"{result['cards']:,}":
                        result.update({"renderer": "edgechromium", "page": state,
                                       "pywebview": importlib.metadata.version("pywebview")})
                        emit_report(result, args.report)
                        break
                    time.sleep(.2)
                else:
                    raise RuntimeError("页面未完成卡库初始化")
            except Exception as exc:
                errors.append(str(exc))
                logging.exception("Desktop renderer smoke failed")
                emit_report({"passed": False, "error": str(exc)}, args.report)
            finally:
                window.destroy()

        webview.start(smoke if args.smoke_test else None, gui="edgechromium", debug=False,
                      private_mode=False, storage_path=storage)
        return 1 if errors else 0
    except Exception as exc:
        logging.exception("Desktop startup failed")
        emit_report({"passed": False, "error": str(exc)}, args.report)
        if not (args.check or args.smoke_test):
            notify(f"启动失败：{exc}\n\n可用 --root 指定残局读写目录。\n日志：{APP_DATA / 'desktop.log'}", error=True)
        return 1
    finally:
        if httpd:
            httpd.shutdown()
            httpd.server_close()
            httpd.RequestHandlerClass.resources.pictures.close()
        if profile:
            try:
                profile.cleanup()
            except OSError:
                logging.info("WebView2 smoke profile is still releasing")
        if mutex:
            ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(mutex))


if __name__ == "__main__":
    sys.exit(main())
