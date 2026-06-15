; WordPop NSIS 自定义安装脚本
; 功能：安装前检测 WordPop 是否正在运行，提示关闭后继续

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
!macroend
