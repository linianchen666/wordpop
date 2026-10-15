$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
  throw 'Installer verification must run on a disposable GitHub Actions Windows runner.'
}
$installer = (Get-ChildItem 'build/WordPop Setup *.exe' | Select-Object -First 1).FullName
if (-not $installer) { throw 'No built installer found' }
$installDir = Join-Path $env:RUNNER_TEMP 'WordPop-icon-audit'
$exe = Join-Path $installDir 'WordPop.exe'
$icon = Join-Path $installDir 'resources/wordpop-launcher-v2.ico'
$shell = New-Object -ComObject WScript.Shell
$desktop = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'WordPop.lnk'
$personal = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'WordPop.lnk'
$menu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'WordPop.lnk'
function Install-WordPop {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', '/allusers', "/D=$installDir") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
function Verify-Link($file) {
  if (-not (Test-Path $file)) { throw "Missing shortcut: $file" }
  $link = $shell.CreateShortcut($file)
  if ($link.TargetPath -ne $exe) { throw "Stale shortcut target: $file -> $($link.TargetPath)" }
  if ($link.IconLocation.Replace('"', '') -ne "$icon,0") { throw "Stale shortcut icon: $file -> $($link.IconLocation)" }
}
Install-WordPop
Verify-Link $desktop
Verify-Link $menu
# Reproduce a retained Electron icon and a per-user shortcut shadowing the
# public desktop shortcut, then exercise the actual same-version upgrade path.
foreach ($file in @($desktop, $personal, $menu)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
  $link = $shell.CreateShortcut($file)
  $link.TargetPath = $exe
  $link.IconLocation = (Resolve-Path 'node_modules/electron/dist/electron.exe').Path + ',0'
  $link.Save()
}
Install-WordPop
foreach ($file in @($desktop, $personal, $menu)) { Verify-Link $file }
if ((Get-FileHash $icon).Hash -ne (Get-FileHash 'assets/icon.ico').Hash) { throw 'Installed shortcut artwork differs from brand icon' }
Add-Type -AssemblyName System.Drawing
$actual = [Drawing.Icon]::ExtractAssociatedIcon($exe)
$expected = [Drawing.Icon]::new((Resolve-Path 'assets/icon.ico').Path, $actual.Width, $actual.Height)
function Render-Icon($value) {
  $bitmap = [Drawing.Bitmap]::new($actual.Width, $actual.Height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([Drawing.Color]::White)
  $graphics.DrawIcon($value, 0, 0)
  $graphics.Dispose()
  return $bitmap
}
$left = Render-Icon $actual
$right = Render-Icon $expected
$different = 0
for ($y = 0; $y -lt $left.Height; $y++) {
  for ($x = 0; $x -lt $left.Width; $x++) {
    $a = $left.GetPixel($x, $y); $b = $right.GetPixel($x, $y)
    if ([Math]::Abs($a.R-$b.R) + [Math]::Abs($a.G-$b.G) + [Math]::Abs($a.B-$b.B) -gt 15) { $different++ }
  }
}
if ($different -gt $left.Width*$left.Height*0.02) { throw "Installed EXE does not display the brand icon: $different pixels differ" }
$left.Dispose(); $right.Dispose(); $actual.Dispose(); $expected.Dispose()
Write-Host 'Verified actual installer, EXE icon, desktop/start-menu icons and repair of retained legacy shortcuts.'
