param([string]$SourceFile)
$ErrorActionPreference = 'Stop'
$assetsPath = Join-Path $PSScriptRoot 'Tools\PuzzleEditor\resources'
$manifest = Get-Content -LiteralPath (Join-Path $assetsPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$expected = $manifest.files.'pics.zip'
$picturePath = Join-Path $assetsPath 'pics.zip'
function Test-Pictures([string]$Path) {
    return (Test-Path -LiteralPath $Path -PathType Leaf) -and
        (Get-Item -LiteralPath $Path).Length -eq $expected.bytes -and
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected.sha256
}
if (Test-Pictures $picturePath) {
    Write-Output 'pics.zip is ready; SHA-256 verified.'
    return
}
$downloadPath = Join-Path $assetsPath ('pics.zip.download-' + [guid]::NewGuid().ToString('N'))
try {
    if ($SourceFile) {
        Copy-Item -LiteralPath $SourceFile -Destination $downloadPath
    } else {
        $resourceUrl = 'https://github.com/Hongxi-ovo/PuzzleStudio/releases/download/v0.2.1/pics.zip'
        Invoke-WebRequest -Uri $resourceUrl -OutFile $downloadPath -UseBasicParsing
    }
    if (-not (Test-Pictures $downloadPath)) {
        throw 'pics.zip failed size or SHA-256 verification; existing resources were not replaced.'
    }
    Move-Item -LiteralPath $downloadPath -Destination $picturePath -Force
    Write-Output 'pics.zip is ready; SHA-256 verified.'
} finally {
    if (Test-Path -LiteralPath $downloadPath) {
        Remove-Item -LiteralPath $downloadPath
    }
}
