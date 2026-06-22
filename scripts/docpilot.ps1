param(
  [Parameter(Position = 0)]
  [string]$Command = "open",
  [switch]$DryRun,
  [switch]$Help,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Show-Usage {
  @"
Usage:
  powershell -ExecutionPolicy Bypass -File scripts/docpilot.ps1 install-skill [-DryRun]
  powershell -ExecutionPolicy Bypass -File scripts/docpilot.ps1 open [path]
  powershell -ExecutionPolicy Bypass -File scripts/docpilot.ps1 [path]

Commands:
  install-skill  Install the /docpilot Claude Code skill.
  open           Start the bridge and open the editor.

If no command is given, docpilot opens the editor for the given path or searches
the current directory for markdown folders.
"@
}

function Forward-Args {
  $forward = @()
  if ($DryRun) {
    $forward += "--dry-run"
  }
  $forward += $Rest
  return $forward
}

if ($Help) {
  Show-Usage
  exit 0
}

switch ($Command) {
  "install-skill" {
    $Forward = Forward-Args
    & node (Join-Path $ScriptDir "install-skill.js") @Forward
    exit $LASTEXITCODE
  }
  "open" {
    & node (Join-Path $ScriptDir "launch-docpilot.js") @Rest
    exit $LASTEXITCODE
  }
  "help" {
    Show-Usage
  }
  "--help" {
    Show-Usage
  }
  "-h" {
    Show-Usage
  }
  default {
    & node (Join-Path $ScriptDir "launch-docpilot.js") $Command @Rest
    exit $LASTEXITCODE
  }
}
