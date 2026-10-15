; WordPop NSIS 自定义安装脚本
; 功能：安装前检测 WordPop 是否正在运行，提示关闭后继续

!macro refreshWordPopLink link
  ${If} ${FileExists} "${link}"
    CreateShortCut "${link}" "$appExe" "" "$INSTDIR\resources\wordpop-launcher-v2.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "${link}" "${APP_ID}"
  ${EndIf}
!macroend

!macro customInstall
  ; 检测 WordPop 进程
  nsExec::ExecToStack `tasklist /FI "IMAGENAME eq WordPop.exe" /NH`
  Pop $0
  Pop $1
  StrCpy $2 $1 11
  ${If} $2 == "WordPop.exe"
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "检测到 WordPop 正在运行，请先关闭后点击确定继续安装。" IDOK checkAgain IDCANCEL abortInstall
    
    checkAgain:
      nsExec::ExecToStack `tasklist /FI "IMAGENAME eq WordPop.exe" /NH`
      Pop $0
      Pop $1
      StrCpy $2 $1 11
      ${If} $2 == "WordPop.exe"
        nsExec::ExecToStack `taskkill /F /IM WordPop.exe`
        Pop $0
        Pop $1
        Sleep 1000
      ${EndIf}
      goto done
    
    abortInstall:
      Abort "安装已取消"
    
    done:
  ${EndIf}
  ; electron-builder retains existing links on upgrades. Give them an explicit,
  ; versioned icon file, including a per-user link shadowing the all-users link.
  !insertmacro refreshWordPopLink "$newDesktopLink"
  !insertmacro refreshWordPopLink "$newStartMenuLink"
  SetShellVarContext current
  !insertmacro refreshWordPopLink "$DESKTOP\${SHORTCUT_NAME}.lnk"
  !insertmacro refreshWordPopLink "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
