$ErrorActionPreference = 'Stop'
$chocoRoot = if ($env:ChocolateyInstall) { $env:ChocolateyInstall } else { Join-Path $env:ProgramData 'chocolatey' }
if (Test-Path -LiteralPath (Join-Path $chocoRoot 'bin\choco.exe')) {
    Write-Output 'Chocolatey is already installed.'
    exit 0
}
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Set-ExecutionPolicy Bypass -Scope Process -Force
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    if (-not (Test-Path -LiteralPath (Join-Path $chocoRoot 'bin\choco.exe'))) {
        throw 'Chocolatey setup did not create choco.exe.'
    }
    exit 0
} catch {
    Write-Error $_
    exit 1
}
