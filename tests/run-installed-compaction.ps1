#requires -Version 7.0
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\DeepSeek Harness"
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$root = Join-Path $InstallDir 'resources\app.asar\dsh'
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = Join-Path $InstallDir 'DeepSeek Harness.exe'
$psi.WorkingDirectory = $project
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$psi.Environment['ELECTRON_RUN_AS_NODE'] = '1'
foreach ($arg in @((Join-Path $PSScriptRoot 'fixtures\installed-compaction.mjs'), $root)) {
  $psi.ArgumentList.Add($arg)
}
$child = [System.Diagnostics.Process]::Start($psi)
$stdout = $child.StandardOutput.ReadToEndAsync()
$stderr = $child.StandardError.ReadToEndAsync()
if (!$child.WaitForExit(90000)) {
  $child.Kill($true)
  $child.WaitForExit()
  $stdout.GetAwaiter().GetResult()
  $stderr.GetAwaiter().GetResult()
  throw 'Isolated compaction checks timed out.'
}
$stdout.GetAwaiter().GetResult()
$stderr.GetAwaiter().GetResult()
exit $child.ExitCode
