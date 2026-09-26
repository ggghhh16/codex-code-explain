# Initial requirements and design

> Updated in 0.2.0: native hover became the default after further user feedback. The side-by-side design below describes 0.1.0; the optional legacy interface remains available. See the [README](../README.md) and [feasibility notes](native-hover-feasibility.md) for current behavior and limits.

## Problem

Understanding code often requires knowing where a name comes from, while the question interface is too far from the code. Project variables, helpers, configuration, and business data should be explained against the current implementation. Third-party APIs can also have reusable usage notes.

A mechanism seen in only one project may still apply elsewhere: function references versus calls, shared objects, callback timing, and data shapes are examples. The extension first explains the concrete behavior, then distinguishes project choices from reusable rules.

## Alternatives

| Approach | Suitable content | Gap for this use |
| --- | --- | --- |
| VS Code hover and Go to Definition | Type signatures, definition locations, library comments | Limited plain-language explanation of object flow |
| Existing Codex conversation | Broad reasoning and project discussion | Requires switching views or creating a separate conversation |
| Project README and API docs | Shared conventions and maintained facts | Cannot cover each temporary selection and follow-up automatically |
| This extension | Bounded context for the current selection | Must maintain protocol compatibility and context accuracy |

## Confirmed 0.1.0 scope

- Show a draggable, four-corner-resizable window inside a side-by-side VS Code panel.
- Send the selection, nearby code, and language-service definitions and types without searching the entire project.
- Use local Codex sign-in and a separate temporary conversation per selection.
- Provide a follow-up input and allow quotes from answers rendered by this extension.
- Save a short note through the flag button; open attached settings through the gear icon.
- Read models, supported reasoning efforts, and fast-mode capability from local Codex.
- Store the note path in VS Code settings and append only on an explicit save.

## Constraints and handling

**Window hosting:** The public Webview API cannot float a full custom interface over source code. The initial release used an internal window in a side panel. In a narrow panel, settings may cover part of that window; closing settings restores the reading area.

**Incomplete origin evidence:** Missing, inactive, or unsupported language services cannot establish origin. Context displays its collection scope, file positions, and truncation. Models can still be wrong; inspect source definitions to verify.

**Ambiguous selections:** Large selections and multiple symbols need more context. The initial release limits selection length and asks the language service about up to four distinct identifiers. Select a full expression or relevant block. Dynamic framework properties and runtime values may remain unknown.

**Quote scope:** Only this extension's rendered answers can be quoted. The official Codex extension, Codex desktop, and ThoughtDAG do not expose a general interface for this extension to read their chats.

**Note maintenance:** Short notes include a source position and timestamp, not a guarantee that code will remain unchanged. Identical completed content is deduplicated by digest. Incomplete answers are excluded. Unsaved file edits block appending. Concurrent writes from separate VS Code windows can still race.

**Model capabilities:** Models and tiers are not hardcoded. Fast mode is unavailable when the model does not advertise it. Settings affect later turns.

## Data flow and implementation

```text
VS Code selection
  → selection snapshot, limited nearby code, language-service definitions/types
  → temporary Codex App Server conversation
  → streaming explanation and quoted follow-up in Webview
  → user clicks the flag
  → a separate temporary conversation summarizes completed content
  → append to the chosen Markdown file
```

The model does not perform the local file write. The extension appends after an explicit save. A generated note is cached so a failed write can be retried without another generation request.

Explanation conversations start in a neutral directory, disable inherited tool integrations, and use a named permission profile limited to minimal platform resources and reading that directory. Global Codex settings are not changed. The implementation was adapted to local `codex-cli 0.155.0-alpha.16`; older unsupported protocol versions produce an error rather than broader permissions.
