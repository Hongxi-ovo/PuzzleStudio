param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$editorPath = $PSScriptRoot
$workspacePath = (Resolve-Path (Join-Path $editorPath '..\..')).Path
$environmentPath = Join-Path $workspacePath '.local-setup\puzzle-studio\build-env'
$buildPython = Join-Path $environmentPath 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath (Join-Path $editorPath 'resources\manifest.json'))) {
    throw 'Embedded resources are missing. Run freeze_resources.py first; see README.md.'
}
if (-not (Test-Path -LiteralPath $buildPython)) {
    & $Python -m venv $environmentPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not create build environment' }
}
& $buildPython -m pip install --disable-pip-version-check -r (Join-Path $editorPath 'requirements-build.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install build dependencies' }
$destination = Join-Path $workspacePath 'Dist\PuzzleStudio-0.2.1'
$buildPath = Join-Path $workspacePath '.local-setup\puzzle-studio\pyinstaller'
& $buildPython -m PyInstaller --noconfirm --distpath $destination --workpath $buildPath (Join-Path $editorPath 'PuzzleStudio.spec')
if ($LASTEXITCODE -ne 0) { throw 'EXE build failed' }
& $buildPython (Join-Path $editorPath 'package_windows.py') --directory $destination
if ($LASTEXITCODE -ne 0) { throw 'Package assembly failed' }
Write-Output (Join-Path $destination 'PuzzleStudio.exe')
