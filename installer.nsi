; WordPop NSIS Installer Script
; Generated for WordPop v1.0.0

!include "MUI2.nsh"
!include "FileFunc.nsh"

; --- General ---
Name "WordPop"
OutFile "WordPop_Setup_1.0.0.exe"
Unicode True
InstallDir "$PROGRAMFILES64\WordPop"
InstallDirRegKey HKLM "Software\WordPop" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 64

; --- Interface ---
!define MUI_ABORTWARNING
!define MUI_ICON "assets\icon.ico"
!define MUI_UNICON "assets\icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; --- Install Section ---
Section "Install"
  SetOutPath "$INSTDIR"

  ; Copy all files from win-unpacked
  File /r "build\win-unpacked\*.*"

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Registry
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "DisplayName" "WordPop"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "DisplayIcon" "$\"$INSTDIR\WordPop.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "Publisher" "WordPop Team"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "DisplayVersion" "1.0.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "URLInfoAbout" "https://github.com/wordpop"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop" \
    "NoRepair" 1

  ; Store install dir
  WriteRegStr HKLM "Software\WordPop" "InstallDir" "$INSTDIR"

  ; Create shortcuts
  CreateDirectory "$SMPROGRAMS\WordPop"
  CreateShortcut "$SMPROGRAMS\WordPop\WordPop.lnk" "$INSTDIR\WordPop.exe"
  CreateShortcut "$SMPROGRAMS\WordPop\Uninstall WordPop.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\WordPop.lnk" "$INSTDIR\WordPop.exe"
SectionEnd

; --- Uninstall Section ---
Section "Uninstall"
  ; Remove shortcuts
  Delete "$SMPROGRAMS\WordPop\WordPop.lnk"
  Delete "$SMPROGRAMS\WordPop\Uninstall WordPop.lnk"
  RMDir "$SMPROGRAMS\WordPop"
  Delete "$DESKTOP\WordPop.lnk"

  ; Remove files
  RMDir /r "$INSTDIR"

  ; Remove registry
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\WordPop"
  DeleteRegKey HKLM "Software\WordPop"
SectionEnd
