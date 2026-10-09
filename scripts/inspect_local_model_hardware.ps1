# Read-only inventory for the bounded CPIN local-model trial.
# No downloads, model calls, configuration changes or machine/user identifiers.
$ErrorActionPreference = 'Stop'
$cpu = @(Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 2)
$gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion)
$nvidia = $null
$command = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($command) {
    $lines = & $command.Source --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits
    if ($LASTEXITCODE -eq 0) { $nvidia = @($lines) }
}
[ordered]@{
    schema = 1
    checkedAt = [DateTime]::UtcNow.ToString('o')
    cpu = $cpu
    ramGiB = $ram
    gpu = $gpu
    nvidiaGpuNameMemoryMiBDriver = $nvidia
    vramLimit = 'Do not infer VRAM from Win32_VideoController.AdapterRAM; its field can overflow. A missing nvidia-smi reading remains unknown.'
    scope = 'Read-only hardware inventory; no local model is installed or benchmarked.'
} | ConvertTo-Json -Depth 5
