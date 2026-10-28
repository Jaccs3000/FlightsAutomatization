Option Explicit

Dim shell, files, root, nodePath, mode, tsxPath, serverPath, command
Dim stoppedAt, attempt, logPath

Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
logPath = files.BuildPath(files.BuildPath(root, "data"), "restart.log")

If WScript.Arguments.Count < 2 Then
  WriteLog "Reinicio cancelado: faltan argumentos del proceso Node."
  WScript.Quit 1
End If

nodePath = WScript.Arguments(0)
mode = WScript.Arguments(1)
tsxPath = files.BuildPath(root, "node_modules\tsx\dist\cli.mjs")
serverPath = files.BuildPath(root, "server.ts")
command = Quote(nodePath) & " " & Quote(tsxPath) & " " & Quote(serverPath) & " " & mode

' Wait until the previous server has stopped, then allow DuckDB to release its file lock.
stoppedAt = 0
For attempt = 1 To 120
  If Not AppReady() Then
    If stoppedAt = 0 Then stoppedAt = Timer
    If ElapsedSeconds(stoppedAt) >= 5 Then Exit For
  Else
    stoppedAt = 0
  End If
  WScript.Sleep 500
Next

If stoppedAt = 0 Or ElapsedSeconds(stoppedAt) < 5 Then
  WriteLog "Reinicio cancelado: no se detecto el cierre del servidor anterior."
  WScript.Quit 2
End If

WriteLog "Iniciando Vuela en segundo plano despues del reinicio."
shell.CurrentDirectory = root
shell.Run command, 0, False

For attempt = 1 To 180
  If AppReady() Then
    WriteLog "Vuela volvio a responder despues del reinicio."
    WScript.Quit 0
  End If
  WScript.Sleep 500
Next

WriteLog "El backend no respondio en 90 segundos despues del reinicio."
WScript.Quit 3

Function AppReady()
  On Error Resume Next
  Dim request
  Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
  request.SetTimeouts 500, 500, 500, 500
  request.Open "GET", "http://127.0.0.1:3030/api/lifecycle/health", False
  request.Send
  AppReady = (Err.Number = 0 And request.Status = 200)
  Err.Clear
  Set request = Nothing
  On Error GoTo 0
End Function

Function ElapsedSeconds(startedAt)
  Dim nowValue
  nowValue = Timer
  If nowValue < startedAt Then nowValue = nowValue + 86400
  ElapsedSeconds = nowValue - startedAt
End Function

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function

Sub WriteLog(message)
  On Error Resume Next
  Dim stream
  Set stream = files.OpenTextFile(logPath, 8, True, 0)
  stream.WriteLine Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & " " & _
    Right("0" & Hour(Now), 2) & ":" & Right("0" & Minute(Now), 2) & ":" & Right("0" & Second(Now), 2) & " " & message
  stream.Close
  On Error GoTo 0
End Sub
