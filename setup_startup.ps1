$Shell = New-Object -ComObject WScript.Shell
$StartupFolder = [Environment]::GetFolderPath("Startup")
$Shortcut = $Shell.CreateShortcut("$StartupFolder\Jarvis.lnk")
$Shortcut.TargetPath = "python.exe"
$Shortcut.Arguments = "d:\programs\raghavendra-exp\jarvis.py"
$Shortcut.WorkingDirectory = "d:\programs\raghavendra-exp"
$Shortcut.Description = "Start Autonomous Jarvis AI"
$Shortcut.WindowStyle = 7 # Minimized
$Shortcut.Save()
Write-Host "Jarvis added to system startup successfully at $StartupFolder"
