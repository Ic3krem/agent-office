; TiroAgents replaces Agent Office 1.x (appId io.github.ic3krem.agentoffice). The two apps have different app ids, so
; electron-builder would install TiroAgents beside the old app. After installing, remove Agent Office 1.x silently.
; Settings live in ~/.claude/agent-office, which both apps share and neither uninstaller touches; /KEEP_APP_DATA and
; --updated keep Electron's own app data too.
; 297d28b5-... is electron-builder's GUID for the old appId (UUID v5), as written in the old app's registry keys.
!define AO1_GUID "297d28b5-a127-5294-9faf-e524ed472a0c"
!define AO1_RUN "Software\Microsoft\Windows\CurrentVersion\Run"

!macro removeAgentOffice1 ROOT MODE
  ClearErrors
  ReadRegStr $R0 ${ROOT} "Software\${AO1_GUID}" "InstallLocation"
  ${if} $R0 != ""
  ${andIf} ${FileExists} "$R0\Uninstall Agent Office.exe"
    DetailPrint "Removing Agent Office 1.x from $R0"
    ; Both apps use the same Start-with-Windows entry name: if it starts Agent Office, start TiroAgents instead.
    ReadRegStr $R2 HKCU "${AO1_RUN}" "io.github.ic3krem.agentoffice"
    ${if} $R2 == '"$R0\Agent Office.exe" --hidden'
      WriteRegStr HKCU "${AO1_RUN}" "io.github.ic3krem.agentoffice" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --hidden'
    ${endIf}
    ; Same as electron-builder's own old-version removal: run a copy and wait for it (_?= stops it relaunching itself).
    CopyFiles /SILENT "$R0\Uninstall Agent Office.exe" "$PLUGINSDIR\agent-office-1-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\agent-office-1-uninstaller.exe" ${MODE} /S /KEEP_APP_DATA --updated _?=$R0' $R1
    ; With _?= the uninstaller leaves itself behind; remove it, and the folder if nothing else is left.
    Delete "$R0\Uninstall Agent Office.exe"
    RMDir "$R0"
  ${endIf}
!macroend

!macro customInstall
  !insertmacro removeAgentOffice1 HKCU /currentuser
  !insertmacro removeAgentOffice1 HKLM /allusers
!macroend
