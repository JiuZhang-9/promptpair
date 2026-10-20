; PromptPair NSIS 自定义脚本
; 目的：安装/卸载时明确告知素材库位置，避免用户误以为卸载会删掉素材。
; 素材库默认在「文档\PromptPair」，安装目录与它完全分离。

!macro customInstall
  DetailPrint "PromptPair 已安装完成"
  DetailPrint "素材库位置：$DOCUMENTS\PromptPair"
  DetailPrint "卸载不会删除任何素材，可放心升级。"
!macroend

!macro customUnInstall
  DetailPrint "素材库仍保留在：$DOCUMENTS\PromptPair"
!macroend
