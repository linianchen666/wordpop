param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$Asset,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP -or -not $env:GITHUB_REPOSITORY) { throw 'Run on GitHub Actions' }
$encodedTag = [Uri]::EscapeDataString($Tag)
$release = gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/$encodedTag" | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $release.draft -or $release.prerelease) { throw 'A published stable source release is required' }
$original = $release.assets | Where-Object { $_.name -eq $Asset }
if (-not $original -or $original.state -ne 'uploaded' -or $original.size -le 0) { throw "Missing source installer: $Asset" }
$temporary = Join-Path $env:RUNNER_TEMP ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  gh release download $Tag --repo $env:GITHUB_REPOSITORY --pattern $Asset --pattern SHA256SUMS.txt --dir $temporary
  if ($LASTEXITCODE -ne 0) { throw 'Cannot download the original installer/checksums' }
  $expected = $null
  foreach ($line in Get-Content (Join-Path $temporary 'SHA256SUMS.txt')) {
    if ($line -match '^([a-fA-F0-9]{64})  (.+)$' -and $Matches[2] -eq $Asset) { $expected = $Matches[1].ToLowerInvariant() }
  }
  $file = Join-Path $temporary $Asset
  $actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $expected -or $actual -ne $expected) { throw 'Original installer checksum mismatch' }
  if ($original.digest -and $original.digest -ne "sha256:$actual") { throw 'Original GitHub asset digest mismatch' }
  if ((Get-Item $file).Length -ne $original.size) { throw 'Original installer size mismatch' }
  New-Item -ItemType Directory -Force -Path (Split-Path $Destination) | Out-Null
  Copy-Item $file $Destination
  Write-Host "Reused $Asset from $Tag with identical SHA-256: $actual"
} finally {
  Remove-Item $temporary -Recurse -Force
}
