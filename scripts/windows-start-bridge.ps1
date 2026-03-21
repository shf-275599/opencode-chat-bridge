[CmdletBinding()]
param(
  [string]$RepoRoot,
  [string]$BunPath,
  [string]$ConfigId
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $scriptRoot = Split-Path -Parent $PSCommandPath
  $RepoRoot = Split-Path -Parent $scriptRoot
}

if (-not $BunPath) {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    throw "Could not find 'bun' in PATH. Install Bun first or pass -BunPath."
  }
  $BunPath = $bunCommand.Source
}

if (-not (Test-Path -LiteralPath $RepoRoot)) {
  throw "Repository root does not exist: $RepoRoot"
}

Set-Location -LiteralPath $RepoRoot

if ($ConfigId) {
    & $BunPath "run" "src/index.ts" "--config" $ConfigId
} else {
    & $BunPath "run" "src/index.ts"
}
