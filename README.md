# Codex Code Explainer

A third-party VS Code extension developed independently of OpenAI and Microsoft. Version **0.2.4**.

[Download the latest VSIX](https://github.com/ggghhh16/codex-code-explain/releases/latest) · [简体中文 README](README.zh-CN.md) · [Security and data handling](SECURITY.md)

Select a function, variable, parameter, or data structure in VS Code and choose **Explain with Codex** from the context menu. Since 0.2.0, explanations appear in VS Code's native hover near the selection, alongside existing type information. No new editor tab or side panel opens.

## Install and use

1. Install and sign in to the local Codex CLI, or use the executable bundled with Codex desktop. The extension uses your existing Codex sign-in and does not store or display tokens.
2. Download the latest `.vsix` from Releases. In VS Code, open Extensions → **⋯** → **Install from VSIX**, then reload if prompted.
3. Open code in a trusted workspace, select a passage, and right-click **Explain with Codex**.
4. When the explanation is ready, click **Follow up** in the hover and enter a question in VS Code's input box. The answer appears in the same hover.
5. Click **Follow up with quote** to choose a passage from a completed answer, then ask a question. Use **Settings** to choose the model, reasoning effort, or fast mode.
6. Click **Save note** to generate a short note about origin, structure, and usage and append it to a Markdown file. If no path is configured, a file picker opens.
7. To revisit an explanation after closing the hover, hover over the original selection. This reads the cache without another model request. You can also run VS Code's **Show or Focus Hover** command (usually `Ctrl+K`, `Ctrl+I`). Editing or closing a file clears its previous explanations.

The former side-by-side interface is available only through the explicit command **Codex Code Explainer: Explain in Side Panel (Legacy)**.

Since 0.2.3, the publisher ID is `Principia`. If you installed an older VSIX published as `local-learning`, uninstall it before installing the current version to avoid duplicate commands.

## Settings

Search for `Codex Code Explainer` in VS Code Settings:

| Setting | Purpose |
| --- | --- |
| `codexExplain.notesPath` | Absolute Markdown path or path relative to the current code workspace; a file picker opens on first save when empty |
| `codexExplain.codexPath` | Absolute path to the native Codex executable; automatically detected when empty |
| `codexExplain.contextLines` | Lines of code before and after the selection; default: 35 each |
| `codexExplain.maxContextCharacters` | Character limit for code context; default: 24,000 |

Available models, reasoning efforts, and fast mode support come from the current Codex model catalog. Changes apply to the next question. Fast mode sends the actual `serviceTier: fast` setting; it does not reduce reasoning effort. It may consume more account quota. The extension does not change your global Codex configuration.

## Context and data handling

Each selection starts an independent, temporary Codex conversation. The extension sends a snapshot of the selection, limited nearby code, and definitions and types from VS Code language services for up to four distinct identifiers. Files outside the workspace use short `external/filename` labels. Model requests happen only when you run the context-menu command, explicitly follow up, or save a note. Ordinary hovering reads cached content. Missing language-service definitions are identified as missing; runtime values cannot be inferred from types alone.

Codex runs with a restricted, read-only permission profile and inherited shell, MCP, and app integrations disabled. The extension itself collects context through VS Code language services. Model-supplied HTML, remote images, and command links are not executed. Common credential files are excluded and common key literals are redacted. These filters cannot detect every secret; source code is still processed under your local Codex account and service provider's terms.

## Current limitations

- Native hover supports formatted text and command links, but cannot host a custom input field, slider, or attached settings pane. Follow-ups and settings use VS Code's native input and selection menus; VS Code controls hover placement and size.
- Extensions cannot read text selected inside the native hover through a general public API. Quoting uses a choice of answer passages rather than direct mouse selection. See the [feasibility notes](docs/native-hover-feasibility.md).
- Native hover has no public token-by-token update API. A status appears during generation and the hover refreshes when the answer finishes. Rehovering while waiting can show content generated so far.
- Up to eight selections are cached. Closing the hover retains the cache; closing the file, editing it, or clearing an explanation ends its session. Conversations do not persist across VS Code restarts.
- This extension cannot take over selected text from the official Codex extension. Quoted follow-ups work only with this extension's answers.
- The initial release targets local VS Code desktop workspaces. Remote SSH, WSL, containers, and web VS Code have not been verified.
- Notes are append-only. Appending is refused when the file has unsaved edits. Deduplication across separate VS Code windows is not guaranteed.
- If the connection fails, check Codex sign-in and the executable path, then click **Retry** in the hover.
- Model-generated text cannot create executable command links; the extension's own action bar uses a separate command allowlist.

## Development

There are no runtime npm dependencies. Open this directory in VS Code and press F5 to launch an Extension Development Host.

```powershell
node --test test/*.test.js
node scripts/smoke.js
node scripts/smoke.js --generate
node scripts/smoke.js --full
node scripts/host-test.js
node scripts/native-ui-test.js
python scripts/package.py
```

Live generation tests consume quota from your local Codex account and send only the scripts' built-in, non-sensitive sample code. `host-test.js` checks a real code-to-Codex response, native hover, and the absence of extra tabs. `native-ui-test.js` clicks controls in a real VS Code hover using a fixed answer and saves screenshots. It requires Playwright; set `PLAYWRIGHT_MODULE` to its installation path if needed. VS Code tests use isolated configurations and exit afterward. `scripts/ui-test.js` tests the legacy interface. The packaging script builds a standard VSIX.

For Marketplace publishing, use Microsoft's official packager: `npx @vscode/vsce package --no-dependencies`. `.vscodeignore` limits published files. Confirm that `package.json` uses a publisher ID you own before release.

[Design notes](docs/design.md) · [Validation record](docs/validation.md)

Key files: `src/native-hover.js` handles native hover, commands, and lifecycle; `src/hover-content.js` handles safe rendering and quote choices; `src/context.js` gathers context; `src/codex.js` manages temporary conversations; `src/rpc.js` implements the App Server protocol; and `src/notes.js` appends notes. `src/panel-extension.js` and `media/` implement the optional legacy interface.

## References

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code HoverProvider](https://code.visualstudio.com/api/references/vscode-api#HoverProvider)
- Protocol generated locally by `codex app-server generate-ts --experimental` (implementation version: `0.155.0-alpha.16`).
