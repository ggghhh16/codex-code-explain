# Native hover feasibility

The reference screenshot shows an editor hover, not a Webview. An ordinary extension can use `registerHoverProvider` to add content to that hover without splitting the editor or opening a new tab.

| Requirement | Public native hover API |
| --- | --- |
| Show an explanation near a symbol or selection | Supported through Markdown content and a range |
| Keep existing type signatures and library documentation | Supported; VS Code combines results from providers |
| Replace signatures supplied by other language extensions | No general public API; one provider does not own another |
| Click follow-up, save, and settings actions in the hover | Supported through extension-handled command links |
| Fixed chat input at the bottom of the hover | Unsupported; use VS Code's native InputBox |
| Sliders or an attached custom settings panel | Unsupported; use native QuickPick controls |
| Read text selected inside the native hover | No general public API; choose an answer passage, paste a quote, or modify the editor itself |
| Custom resizing from all four corners | Managed by VS Code; extensions cannot add arbitrary corner controls |

Changing VS Code's hover control directly requires a custom editor build or patch and ongoing maintenance. For explanations near code, the native HoverProvider covers the primary behavior.

Official references:

- https://code.visualstudio.com/api/references/vscode-api#HoverProvider
- https://code.visualstudio.com/api/references/vscode-api#MarkdownString
- https://code.visualstudio.com/api/extension-guides/command#command-uris
- https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/hover/browser/hoverActions.ts

`editor.action.showHover` and `editor.action.hideHover` can show or refresh a hover at the selection. They do not expose the hover DOM or permit embedded inputs.
