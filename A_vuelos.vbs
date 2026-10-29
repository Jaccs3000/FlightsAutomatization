Option Explicit
Dim shell, files, folder, scriptPath, startupPage, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
startupPage = files.BuildPath(folder, "inicio-vuela.html")
scriptPath = files.BuildPath(folder, "iniciar-vuela.ps1")

' Open the browser immediately. The local startup page waits for the backend
' and redirects this same tab as soon as the app responds.
shell.Run """" & startupPage & """", 1, False
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """ -BrowserAlreadyOpened"
shell.Run command, 0, False
