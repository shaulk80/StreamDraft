# Refresh PATH in the current PowerShell session from the Machine and User
# environment variables. Run it after installing a tool: . .\scripts\env.ps1
# Dot-source it (leading dot and space) so the change stays in the session.
$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = $machine + ';' + $user
Write-Host 'PATH refreshed from Machine and User variables.'
