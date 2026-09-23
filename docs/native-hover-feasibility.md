# 原生悬停框可行性

用户截图是编辑器的 Hover，并不是 Webview。普通扩展可以用 `registerHoverProvider` 向同一个悬停框补充内容，代码编辑区不需要分栏或打开新的标签页。

| 需求 | 原生 Hover 的公开接口 |
| --- | --- |
| 在符号或选区附近显示 Codex 中文讲解 | 支持，提供 Markdown 内容与选区范围 |
| 同时保留原本的类型签名、库文档 | 支持；VS Code 合并不同 provider 的结果 |
| 强制替换其他语言扩展给出的类型签名 | 没有通用公开接口；自己的 provider 不拥有其他 provider |
| 在悬停框里点击追问、保存、设置 | 支持命令链接，动作由插件处理 |
| 悬停框底部固定一个聊天输入框 | 不支持；可调用 VS Code 原生 InputBox |
| 框内滑条、旁挂自定义设置面板 | 不支持；可使用原生 QuickPick 选择模型和思考档位 |
| 获取用户在原生 Hover 内框选的回答文字 | 没有通用公开接口；需改成选择回答片段、粘贴引用，或修改编辑器本体 |
| 完整自定义四角缩放 | 由 VS Code 的 Hover 管理，扩展不能指定任意四角控件 |

直接修改 VS Code 的 Hover 控件属于编辑器本体开发，需要维护自定义构建或安装补丁；不等同于修改一个普通扩展。用户仅希望讲解出现在代码附近时，原生 HoverProvider 已能实现这个主要行为。

官方依据：

- https://code.visualstudio.com/api/references/vscode-api#HoverProvider
- https://code.visualstudio.com/api/references/vscode-api#MarkdownString
- https://code.visualstudio.com/api/extension-guides/command#command-uris
- https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/hover/browser/hoverActions.ts

`editor.action.showHover` 和 `editor.action.hideHover` 是编辑器命令，可在当前选区处显示或刷新悬停框；不可借此声称取得 Hover 的 DOM 或嵌入输入框能力。
