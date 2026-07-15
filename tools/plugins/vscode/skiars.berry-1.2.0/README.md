## Berry VSCode Extension

Full-featured Visual Studio Code extension for the **Berry** scripting language,
backed by a dedicated **Language Server** (LSP).

### Features

| Feature | Description |
|---|---|
| **Syntax highlighting** | TextMate grammar for `.be` files |
| **Semantic highlighting** | Token-level highlighting for keywords, classes, functions, parameters, variables, properties, operators, strings, and numbers |
| **Diagnostics** | Reports unmatched `end` keywords and unterminated string literals |
| **Code completion** | Keywords, built-in functions/modules, and all symbols defined in the current file |
| **Hover documentation** | Inline docs for all Berry built-ins (global functions, string/list/map methods, math/json/os/debug/introspect module members) and user-defined symbols |
| **Go to definition** | Navigate to any symbol's declaration within the current file |
| **Document symbols** | File outline showing classes, methods, functions, and variables (with class hierarchy) |
| **Signature help** | Parameter hints while typing function calls |
| **Find references** | Find all uses of a symbol in the current file |

### Requirements

- Visual Studio Code **1.74.0** or newer
- Node.js (bundled with VS Code; no separate installation required)

### Configuration

| Setting | Default | Description |
|---|---|---|
| `berry.diagnostics.enabled` | `true` | Enable/disable Berry diagnostics |
| `berry.trace.server` | `"off"` | LSP message tracing (`off`, `messages`, `verbose`) |

### Building from source

```bash
cd tools/plugins/vscode/skiars.berry-1.2.0
npm install
npm run compile
```
