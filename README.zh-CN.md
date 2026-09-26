# Codex Code Explainer

[English README](README.md)

独立开发的第三方 VS Code 扩展，非 OpenAI / Microsoft 官方产品。版本：**0.2.4**。

[下载安装包](https://github.com/ggghhh16/codex-code-explain/releases/latest) · [安全与数据说明](SECURITY.md)

在 VS Code 中框选函数、变量、参数或数据，右键 **Explain with Codex**。从 0.2.0 起，讲解直接出现在选区附近的 **原生悬停框** 中，与原来的类型提示共存，不打开新标签页或并排面板。当前版本的界面、默认讲解和生成的笔记均使用英文。

## 安装和使用

1. 安装并登录本机 Codex CLI，或使用 Codex 桌面版附带的程序。扩展复用 Codex 登录，不保存或展示 Token。
2. 从 Releases 下载最新的 `.vsix` 安装包，然后 VS Code → 扩展 → 右上角菜单 → **从 VSIX 安装**；如提示重载，执行重载窗口。
3. 在受信任工作区打开代码，选中一段，右键 **Explain with Codex**。
4. 讲解完成后，在悬停框中点击 **Follow up**，使用 VS Code 原生输入框提问。回答仍显示在原选区的悬停框中。
5. 点击 **Follow up with quote**，选择已完成回答中的一段，再输入问题。点击 **Settings**，选择模型、思考档位或快速模式。
6. 点击 **Save note**，生成包含 Origin、Structure、Usage 的简要英文笔记，追加到 `.md` 文件。未设置路径时弹出文件选择器。
7. 悬停框关闭后，将鼠标放回选区即可查看已有讲解，不重新调用模型。也可使用 VS Code 的“显示或聚焦悬停”命令（通常为 `Ctrl+K`、`Ctrl+I`）。修改源码或关闭文件会清除该文件的旧讲解。

旧版并排界面保留在命令面板 **Codex Code Explainer: Explain in Side Panel (Legacy)**，只有显式执行这个命令才打开。

0.2.3 起发布者标识为 `Principia`。如果安装过发布者为 `local-learning` 的早期 VSIX，请先卸载旧扩展再安装新版，避免同时出现两组命令。

## 设置

VS Code 设置中搜索 `Codex Code Explainer`：

| 设置 | 用途 |
| --- | --- |
| `codexExplain.notesPath` | `.md` 绝对路径或相对当前代码工作区的路径；留空时首次保存选择 |
| `codexExplain.codexPath` | 原生 Codex 程序绝对路径；留空自动查找 |
| `codexExplain.contextLines` | 选区前后代码行数，默认各 35 行 |
| `codexExplain.maxContextCharacters` | 代码材料字符上限，默认 24000 |

模型列表、思考强度和快速模式支持情况来自当前 Codex 返回的模型目录。切换在下一次提问生效；快速模式使用真实 `serviceTier: fast`，不是降低思考强度。服务档位可能增加额度消耗，具体由账户决定。不修改用户的全局 Codex 配置。

## 上下文与数据处理

每个选区开启独立的临时 Codex 对话。发送选区快照、有限附近代码，以及最多四个不同标识符的语言服务定义和类型。工作区外的文件只使用 `external/filename` 标签。只在右键命令、明确追问或主动生成笔记时调用模型，普通悬停只读取缓存。语言服务缺失时明确标注缺少定义；运行时数据无法仅凭类型提示确认。

Codex 使用只读、受限读取的会话，并禁用继承的命令、MCP 和应用集成；扩展本身从 VS Code 语言服务收集材料。模型输出中的 HTML、远程图片和命令链接不会执行。常见凭据文件不发送，常见密钥字面量会隐藏；这不是完整的敏感信息识别器，源码仍按本机 Codex 账户和服务提供方的规则传输。

## 当前边界

- 原生悬停框允许格式化文字和命令链接，不能嵌入自定义输入框、滑条或旁挂设置窗。因此追问与设置使用 VS Code 原生输入框/选择菜单；窗口位置与缩放由 VS Code 管理。
- 原生 Hover 的文字选区不对普通扩展开放，引用使用“选择回答片段”，不是直接读取鼠标框选的文字。若必须保留全部原位控件，需要编辑器本体开发，详见[可行性说明](docs/native-hover-feasibility.md)。
- 原生 Hover 没有公开的逐字更新接口；生成期间显示状态，完成后刷新。在等待期间重新悬停可读取当前已生成的内容，不主动高频关闭和重开窗口。
- 缓存最多保留 8 个选区；关闭悬停框不会删除缓存，关闭文件、编辑内容或清除讲解会结束对应会话。重新启动 VS Code 不恢复聊天。
- 官方 Codex 扩展的回答不能被本插件直接框选接管；引用追问只支持本插件自己的回答。
- 首版面向本地 VS Code 桌面工作区。未验证 Remote SSH、WSL、容器和网页 VS Code。
- 笔记仅追加。文件有未保存编辑时拒绝追加，避免覆盖编辑内容；跨多个 VS Code 窗口同时保存同一笔记不保证去重。
- 若连接失败，请检查 Codex 登录和程序路径，再点击悬停框中的重试。
- 模型正文不允许创建可执行命令链接；扩展自身生成的操作栏单独使用命令白名单。

## 开发

无需安装运行时 npm 依赖。VS Code 打开本目录，按 F5 启动扩展开发宿主。

```powershell
node --test test/*.test.js
node scripts/smoke.js
node scripts/smoke.js --generate
node scripts/smoke.js --full
node scripts/host-test.js
node scripts/native-ui-test.js
python scripts/package.py
```

真实生成测试会使用本机 Codex 账户额度，仅发送脚本内置的非敏感示例代码。`host-test.js` 验证真实代码到 Codex 回答、原生 Hover 和没有新增标签页。`native-ui-test.js` 使用固定回答验证真实 VS Code 悬停框里的点击操作并生成截图；它需要 Playwright，可通过 `PLAYWRIGHT_MODULE` 指向安装目录。所有 VS Code 测试都使用隔离配置并在结束后退出。旧界面的测试脚本为 `scripts/ui-test.js`。打包脚本生成标准 VSIX。

Marketplace 发布使用微软官方工具打包：`npx @vscode/vsce package --no-dependencies`。`.vscodeignore` 限定发布文件范围；提交前确认 `package.json` 中的 `publisher` 是当前账号拥有的发布者 ID。

[需求评估与设计](docs/design.md) · [验证记录](docs/validation.md)

主要文件：`src/native-hover.js` 负责原生 Hover、命令与生命周期，`hover-content.js` 负责安全渲染和引用片段，`context.js` 收集材料，`codex.js` 管理临时对话，`rpc.js` 处理 App Server 协议，`notes.js` 追加笔记。`panel-extension.js` 与 `media/` 为可选旧版界面。

## 设计依据

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)
- [VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code HoverProvider](https://code.visualstudio.com/api/references/vscode-api#HoverProvider)
- 本机 Codex `app-server generate-ts --experimental` 生成的协议（实现时版本：`0.155.0-alpha.16`）。
