# PowerShell Auto-Push Script
$folder = "c:\Users\user\Desktop\ระบบติดตามห้องประชุม"
$filter = '*.*'

$fsw = New-Object IO.FileSystemWatcher $folder, $filter -Property @{
    IncludeSubdirectories = $true
    NotifyFilter = [IO.NotifyFilters]::FileName, [IO.NotifyFilters]::LastWrite
}

Write-Host "Monitoring changes in $folder ... (Press Ctrl+C to stop)" -ForegroundColor Green

$action = {
    $path = $Event.SourceEventArgs.FullPath
    $changeType = $Event.SourceEventArgs.ChangeType
    
    # Ignore .git folder changes
    if ($path -like "*\.git\*") { return }
    
    Write-Host "Detected change ($changeType): $path" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    
    git add .
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    git commit -m "Auto push on change: $timestamp"
    git push
    Write-Host "Successfully auto-pushed to GitHub!" -ForegroundColor Green
}

Register-ObjectEvent $fsw Created -Action $action | Out-Null
Register-ObjectEvent $fsw Changed -Action $action | Out-Null
Register-ObjectEvent $fsw Deleted -Action $action | Out-Null

while ($true) { Start-Sleep -Seconds 5 }
