!include nsDialogs.nsh
!define NM_SETUP_SCRIPT "${__FILEDIR__}\install-chocolatey.ps1"
!ifndef BUILD_UNINSTALLER
Var ChocoCheckbox
Var ChocoSelected
!macro customPageAfterChangeDir
Function ChocoPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Package manager setup" "Choose whether to install Chocolatey."
  ${NSD_CreateLabel} 0 0 100% 40u "Node Manager can use Chocolatey to install and uninstall Node.js packages. Independent side-by-side versions work without Chocolatey."
  Pop $0
  ${NSD_CreateCheckbox} 0 50u 100% 22u "Install Chocolatey if it is not already installed"
  Pop $ChocoCheckbox
  ${NSD_Check} $ChocoCheckbox
  ${NSD_CreateLabel} 0 83u 100% 55u "This option downloads and runs the official setup script from https://community.chocolatey.org/install.ps1 with administrator access. An internet connection is required. Chocolatey is maintained separately and will remain installed if you remove Node Manager."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ChocoPageLeave
  ${NSD_GetState} $ChocoCheckbox $ChocoSelected
FunctionEnd
  Page custom ChocoPageCreate ChocoPageLeave
!macroend

!macro customInstall
  ${If} $ChocoSelected == ${BST_CHECKED}
    DetailPrint "Checking Chocolatey setup..."
    File /oname=$PLUGINSDIR\install-chocolatey.ps1 "${NM_SETUP_SCRIPT}"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-chocolatey.ps1"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Node Manager was installed, but Chocolatey setup failed. You can retry from the Chocolatey page in Node Manager as administrator."
    ${EndIf}
  ${EndIf}
!macroend
!endif
