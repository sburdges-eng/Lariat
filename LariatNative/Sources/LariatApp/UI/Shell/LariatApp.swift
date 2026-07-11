import SwiftUI
import LariatDB
import LariatModel
#if canImport(AppKit)
import AppKit

/// Unbundled executables (`swift run LariatApp`, no `.app` wrapper/Info.plist)
/// never activate themselves: the window opens behind Terminal and every
/// keyboard-first affordance (⌘K palette, ⌘R, ⌘1…⌘9, field focus) is inert
/// until the user clicks the window. Promote to a regular app and activate on
/// launch — harmless when bundled, essential when run from the CLI.
final class LariatAppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate()

    // Launch sweeps (audit P0-6): heal/mirror the sick-note media key into
    // Keychain, encrypt any legacy plaintext files, and clear stale decrypted
    // temp copies. Filesystem-only — the migrator never touches the DB
    // schema, so this is safe to run pre-Phase-C-flip. Off the main actor
    // (Task.detached) and entirely best-effort (`try?`) so a failure here can
    // never delay or crash launch.
    Task.detached(priority: .utility) {
      let dataDir = URL(fileURLWithPath: LariatDB.resolveDataDirectory())
      SickNoteKeychain.healAndMirror(dataDir: dataDir)
      if let key = try? SickNoteKeyStore().loadOrCreate(dataDir: dataDir) {
        _ = try? SickNoteMigrator().encryptLegacyFiles(dataDir: dataDir, key: key)
      }
      let now = Date()
      let tmpDir = SickNoteTempStore.directory()
      if let items = try? FileManager.default.contentsOfDirectory(
        at: tmpDir, includingPropertiesForKeys: [.contentModificationDateKey]
      ) {
        for item in items {
          let mod = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
          if SickNoteTempStore.isStale(modifiedAt: mod, now: now) {
            try? FileManager.default.removeItem(at: item)
          }
        }
      }
    }
  }
}

/// Tracks whether *any* window currently has a sheet attached (board forms,
/// PIN entry, the palette itself). Menu commands stay live while a sheet is
/// up, so without this guard ⌘K latches the palette behind a form sheet and
/// ⌘1…⌘9 swaps the detail view underneath an open form, tearing it down and
/// discarding the operator's typed data (shell-level twin of the BeoBoard
/// modal-vs-modal fix in PR #401). Recounts across all windows, so it is
/// multi-window-safe (H6d).
@Observable @MainActor
final class SheetPresenceMonitor {
  static let shared = SheetPresenceMonitor()

  private(set) var isSheetPresented = false
  @ObservationIgnored private var observers: [NSObjectProtocol] = []

  private init() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(
      forName: NSWindow.willBeginSheetNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.isSheetPresented = true }
    })
    observers.append(center.addObserver(
      forName: NSWindow.didEndSheetNotification, object: nil, queue: .main
    ) { [weak self] _ in
      // Recount from real window state (async so AppKit finishes detaching):
      // another window's sheet may still be up.
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          self?.isSheetPresented = NSApp.windows.contains { $0.attachedSheet != nil }
        }
      }
    })
  }
}
#endif

@main
struct LariatApp: App {
  #if canImport(AppKit)
  @NSApplicationDelegateAdaptor(LariatAppDelegate.self) private var appDelegate
  #endif

  private let sharedDatabase: LariatDatabase?
  private let sharedWriteDatabase: LariatWriteDatabase?
  private let stationCatalog: StationCatalog?
  /// Why the station catalog failed to load, for the shell banner — a bare
  /// `try?` used to swallow this, so one malformed cache file silently
  /// degraded the 86/Stations boards with a message blaming the write DB.
  private let stationCatalogError: String?

  init() {
    let path = resolveDatabasePath()
    sharedDatabase = try? LariatDatabase(path: path)
    sharedWriteDatabase = try? LariatWriteDatabase(path: path)
    do {
      stationCatalog = try StationCatalog.load()
      stationCatalogError = nil
    } catch {
      stationCatalog = nil
      stationCatalogError = error.localizedDescription
    }
  }

  var body: some Scene {
    // H6d — each window is its own `RootWindowView` with per-window selection +
    // freshness; the shared DB/catalog handles are passed in. ⌘N opens another.
    WindowGroup {
      RootWindowView(
        database: sharedDatabase,
        writeDatabase: sharedWriteDatabase,
        catalog: stationCatalog,
        catalogError: stationCatalogError
      )
    }
    #if os(macOS)
    // Endgame H4 → H6d: keyboard-first commands act on the *key* window via
    // `@FocusedValue` (see BoardsCommands / RootWindowView.focusedSceneValue).
    .commands { BoardsCommands() }
    #endif

    #if os(macOS)
    // H6c — menu-bar extra: a live red/amber signal panel that stays reachable
    // when the main window is buried, reusing H6a AlertMonitor's existing poll.
    // "Open Command Board" routes through WindowRouter to the primary window (H6d).
    MenuBarExtra {
      MenuBarPanelView(onOpenCommand: {
        WindowRouter.shared.navigate(AlertNotificationRouting.commandFeatureId)
      })
    } label: {
      MenuBarStatusLabel()
    }
    .menuBarExtraStyle(.window)
    #endif
  }
}

#if os(macOS)
/// H6d — the "Boards" menu, resolving its target from the key window's published
/// focus values so ⌘K / ⌘R / ⌘1…⌘0 act on whichever window is frontmost. Disabled
/// when no window is focused (`chrome == nil`) or a sheet is up.
struct BoardsCommands: Commands {
  @FocusedValue(\.windowChrome) private var chrome
  @FocusedValue(\.activeBoardPoller) private var activePoller

  var body: some Commands {
    CommandMenu("Boards") {
      Button("Jump to Board…") { chrome?.showPalette() }
        .keyboardShortcut("k", modifiers: .command)
        .disabled(chrome?.isModalUp ?? true)
      // Endgame H5: immediate re-poll of the key window's active board. Disabled
      // on static/aggregate screens (no poller).
      Button("Refresh Now") { activePoller?.refreshNow() }
        .keyboardShortcut("r", modifiers: .command)
        .disabled(activePoller == nil)
      Divider()
      // Jump to the first enabled board of each tier, in sidebar order; ⌘1…⌘9
      // then ⌘0 for the tenth (only 10 digit keys), later tiers menu-only.
      ForEach(Array(FeatureTier.allCases.enumerated()), id: \.element) { index, tier in
        Button(tier.rawValue) { chrome?.jumpToTier(tier) }
          .keyboardShortcut(Self.tierShortcut(at: index))
          .disabled(chrome?.isModalUp ?? true)
      }
    }
  }

  private static func tierShortcut(at index: Int) -> KeyboardShortcut? {
    switch index {
    case 0..<9: return KeyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
    case 9: return KeyboardShortcut("0", modifiers: .command)
    default: return nil
    }
  }
}
#endif
