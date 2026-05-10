[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "opencode-im-bridge",
  [ValidateSet("Logon", "Startup")]
  [string]$Trigger = "Logon",
  [string]$RepoRoot,
  [string]$BunPath,
  [string]$ConfigId,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $scriptRoot = Split-Path -Parent $PSCommandPath
  $RepoRoot = Split-Path -Parent $scriptRoot
}

if ($Remove) {
  if ($PSCmdlet.ShouldProcess($TaskName, "Remove scheduled task")) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Removed scheduled task: $TaskName"
  }
  exit 0
}

function Resolve-BunPath {
  param([string]$ConfiguredPath)

  if ($ConfiguredPath) {
    if (-not (Test-Path -LiteralPath $ConfiguredPath)) {
      throw "Configured BunPath does not exist: $ConfiguredPath"
    }
    return (Resolve-Path -LiteralPath $ConfiguredPath).Path
  }

  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    throw "Could not find 'bun' in PATH. Install Bun first or pass -BunPath."
  }

  return $bunCommand.Source
}

if (-not (Test-Path -LiteralPath $RepoRoot)) {
  throw "Repository root does not exist: $RepoRoot"
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

$BunPath = Resolve-BunPath -ConfiguredPath $BunPath
$launcherPath = Join-Path (Split-Path -Parent $PSCommandPath) "windows-start-bridge.ps1"

if (-not (Test-Path -LiteralPath $launcherPath)) {
  throw "Launcher script not found: $launcherPath"
}

if ($PSCmdlet.ShouldProcess($TaskName, "Register scheduled task")) {
  $powerShellPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  $actionArgsArr = @(
    "-NoProfile"
    "-ExecutionPolicy"
    "Bypass"
    "-File"
    ('"{0}"' -f $launcherPath)
    "-RepoRoot"
    ('"{0}"' -f $RepoRoot)
    "-BunPath"
    ('"{0}"' -f $BunPath)
  )
  
  if ($ConfigId) {
    $actionArgsArr += "-ConfigId"
    $actionArgsArr += ('"{0}"' -f $ConfigId)
  }

  $actionArgs = $actionArgsArr -join " "

  $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $actionArgs

  if ($Trigger -eq "Startup") {
    $taskTrigger = New-ScheduledTaskTrigger -AtStartup
  } else {
    $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  }

  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $taskTrigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Start opencode-im-bridge automatically on Windows" `
    -Force | Out-Null

  Write-Output "Registered scheduled task: $TaskName"
  Write-Output "Trigger: $Trigger"
  Write-Output "RepoRoot: $RepoRoot"
  Write-Output "BunPath: $BunPath"
  Write-Output ""
  Write-Output "Manage it with:"
  Write-Output "  Get-ScheduledTask -TaskName `"$TaskName`""
  Write-Output "  Start-ScheduledTask -TaskName `"$TaskName`""
  Write-Output "  .\scripts\setup-autostart.ps1 -Remove"
}
