# Publishes the current app to GitHub Pages. Phones pick up the new version
# the next time SagBook is opened. Run via "Update SagBook.cmd".
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (git status --porcelain)) {
  Write-Host 'Nothing has changed since the last update.' -ForegroundColor Yellow
  exit 0
}

# Stamp a new version so phones know to refresh.
$version = Get-Date -Format 'yyyy.MM.dd-HHmm'
foreach ($file in 'app\sw.js', 'app\app.js') {
  $path = Join-Path $root $file
  $text = [IO.File]::ReadAllText($path)
  $text = [regex]::Replace($text, "const (VERSION|APP_VERSION) = '[^']*';", "const `$1 = '$version';")
  [IO.File]::WriteAllText($path, $text)
}

git add -A
git commit -q -m "Update $version"
git push -q
if ($LASTEXITCODE -ne 0) { throw 'Push failed. Check your internet connection and try again.' }

Write-Host ''
Write-Host "Published version $version." -ForegroundColor Green
Write-Host 'It goes live in about a minute. Open SagBook on your phone and it updates itself.'
Write-Host 'https://kieranburton30.github.io/sagbook/'
