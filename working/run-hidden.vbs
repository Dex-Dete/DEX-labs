' Launches the DEX Labs tray app hidden (no console flash, no window).
' The tray app itself starts the actual Node server as its own child
' process, and gives you a system tray icon with Console/Update/Exit.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir
WshShell.Run "powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & scriptDir & "\tray.ps1""", 0, False
