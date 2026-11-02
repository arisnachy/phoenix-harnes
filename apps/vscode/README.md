# PHOENIX HARDNESS for VS Code and Cursor

English | [中文](README.zh.md)

This extension adds a PHOENIX panel to the Explorer with commands to install or update PHOENIX, start the installed local harness, and open its Web interface. On Windows it discovers the default one-line installer location; another checkout can be selected through `phoenix.installPath`.

Package a VSIX with `pnpm --filter phoenix-hardness-vscode run package:vsix` after installing the pinned `@vscode/vsce` release used by CI. The extension does not contain credentials and never reads the PHOENIX credential store.

## Current limit

This first integration controls the local runtime. Conversation, diff, approval, and team views remain in the PHOENIX Web UI until their authenticated IDE RPC projection is implemented.
