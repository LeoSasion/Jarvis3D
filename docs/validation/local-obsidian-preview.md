# Local Obsidian graph testing

The current test Vault is `C:\Users\Administrator\Documents\服装行业知识库`.
The desktop relationship graph stays attached to the Vault when File Explorer opens, navigates, or closes.

For localhost development, set `JARVIS_OBSIDIAN_VAULT` in `frontend/.env.local` and run the Vite development server. This file is ignored by Git. The graph API is enabled only in development and accepts loopback requests with a local Host and same origin. It does not expose a browser-selectable filesystem path or note bodies.

The development bridge builds `host/Jarvis.GraphPreview` with .NET 8 and keeps its process alive until Vite closes. This console project directly compiles the native host's `ObsidianGraphService` and `ObsidianVaultWatcher`; there is no second Markdown parser. The regular graph refresh checks manifests, the watcher invalidates changed notes, and the Rescan button requests a full reparse. Errors are shown instead of silently substituting mock data.

The native Windows app already defaults to the Documents folder's `服装行业知识库`, with `JARVIS_OBSIDIAN_VAULT` or the native Vault picker taking precedence. A production frontend build does not include the localhost graph bridge or any Vault data.

Compatibility currently covered by native parser tests: recursive Markdown discovery, YAML frontmatter tags and aliases, wikilinks, embedded note links, heading/block fragments, relative Markdown links, typed relations, revisioned chunks, incremental changes, rename/delete, and bounds on files/links. These tests target graph indexing; they do not claim full Obsidian plugin or rendering compatibility.

Validation on the configured Vault: 808 Markdown files, 808 graph nodes, 7,809 graph edges, no truncation and no unresolved links. Two parsed links were skipped by the scanner. Counts may change as the Vault changes.
