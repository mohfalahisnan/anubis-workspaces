; Custom NSIS macros for the Anubis installer/updater.
;
; Overrides electron-builder's default "is the app running?" check
; (app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh).
;
; The default check decides the app is running by enumerating processes whose
; executable .Path starts with $INSTDIR:
;
;   Get-CimInstance Win32_Process | ? { $_.Path -and $_.Path.StartsWith('$INSTDIR', ...) }
;
; When $INSTDIR is empty at check time, .StartsWith('') is TRUE for EVERY
; process, so the count is non-zero, the installer concludes "app is running",
; tries (and fails) to Stop-Process the whole machine, and finally shows
; "<app> cannot be closed. Please close it manually" — even right after a
; reboot with nothing running. That is the "exit app first" failure users hit
; on every install/update.
;
; Defining customCheckAppRunning makes CHECK_APP_RUNNING use this macro instead
; of the buggy default. We match Anubis by IMAGE NAME (immune to the $INSTDIR
; bug), force-kill it and its process tree (backend Anubis.exe, node-pty
; winpty-agent.exe, bundled qodercli.exe all die as descendants), and proceed
; silently. taskkill /IM "Anubis.exe" never matches the installer itself
; (it runs as "Anubis_<version>.exe").
!include "LogicLib.nsh"

!macro customCheckAppRunning
  ; 1) Kill the app and its whole process tree by image name. Safe no-op
  ;    (exit 128) when nothing is running.
  nsExec::Exec `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0

  ; 2) Belt-and-suspenders: clear any leftover process whose executable lives
  ;    under the install dir (orphaned/reparented winpty-agent.exe or
  ;    qodercli.exe that wouldn't be matched by image name). GUARDED on a
  ;    non-empty $INSTDIR so we never reproduce the StartsWith('') match-all
  ;    bug above.
  ${if} $INSTDIR != ""
    nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance -ClassName Win32_Process | ? { $$_.Path -and $$_.Path.StartsWith('$INSTDIR','CurrentCultureIgnoreCase') } | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
  ${endif}

  ; Give the OS a moment to release file handles before the installer touches
  ; files in $INSTDIR.
  Sleep 500
!macroend
