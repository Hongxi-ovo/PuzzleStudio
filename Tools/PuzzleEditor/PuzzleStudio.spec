# Build from the dedicated environment described in README.md.
from pathlib import Path

here = Path(SPECPATH)
a = Analysis(
    [str(here / 'desktop.py')],
    pathex=[str(here)],
    binaries=[],
    datas=[(str(here / 'web'), 'web'), (str(here / 'resources'), 'resources')],
    hiddenimports=['webview.platforms.winforms', 'webview.platforms.edgechromium'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'cefpython3',
              'webview.platforms.gtk', 'webview.platforms.cocoa', 'webview.platforms.qt'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='PuzzleStudio',
    debug=False, bootloader_ignore_signals=False,
    strip=False, upx=False,
    console=False, disable_windowed_traceback=False,
    argv_emulation=False, target_arch=None, codesign_identity=None, entitlements_file=None,
)
