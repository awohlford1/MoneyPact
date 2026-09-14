[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Set-Location -LiteralPath $projectRoot
& npm.cmd run agent:cleanup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm.cmd run agent:archive
exit $LASTEXITCODE
