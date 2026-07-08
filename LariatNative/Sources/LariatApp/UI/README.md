# LariatApp UI

Front-end layer for the native macOS/iPad shell. All SwiftUI views, view models, and UI plumbing live here; data and rules stay in `LariatModel` / `LariatDB`.

## Layout

| Folder | Contents |
|--------|----------|
| `Boards/` | Screen-level SwiftUI views (`*View.swift`) — cook, safety, labor, inventory, manager, etc. |
| `ViewModels/` | `@Observable` / presentation state (`*ViewModel.swift`) |
| `Components/` | Reusable controls, tokens, sheets (`DesignTokens`, `PinEntrySheet`, `EmptyState`, …) |
| `Shell/` | App entry, window routing, feature registry, command palette, tier feature lists |
| `Platform/` | macOS integrations — notifications, menu bar, board polling |
| `Stores/` | Session-scoped UI state (`PinSessionStore`, `CookIdentityStore`) |
| `Support/` | View-specific helpers that are not view models (`AssistantSupport`, `ShowsBoardSupport`) |

## Conventions

- New boards: pair `FooView.swift` + `FooViewModel.swift`; register in `Shell/FeatureRegistry.swift`.
- User-facing copy: follow `docs/UI_COPY_RULES.md` (kitchen language, no SaaS jargon).
- Accessibility (H7): VoiceOver labels and Dynamic Type on every new board.
- Do not import GRDB or write to the database from Views — use repositories via view models.

## Verify

```bash
cd LariatNative && swift build && swift test
```
