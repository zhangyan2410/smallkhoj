$ErrorActionPreference = 'Stop'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$env:LANG = 'C.UTF-8'
$env:LC_ALL = 'C.UTF-8'

# Forward TWD_TOKEN if set (already in env, just ensure it's passed to child process)
if ($env:TWD_TOKEN) {
    $env:TWD_TOKEN = $env:TWD_TOKEN
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$twd  = Join-Path $here 'twd.py'

# Pick interpreter
$exe = $null
$prefix = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
  $exe = (Get-Command py).Source
  $prefix = @('-3')
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $exe = (Get-Command python).Source
} else {
  Write-Error 'twd: no python found in PATH'
  exit 127
}

# Use the invocation operator to splat the args array
$call = $prefix + @($twd) + $args
& $exe @call
exit $LASTEXITCODE
