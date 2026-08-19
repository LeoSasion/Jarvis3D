namespace Jarvis.Host.Bridge;

internal enum WebBridgeSurface
{
    Desktop,
    Taskbar,
    Switcher
}

internal static class WebBridgeSurfacePolicy
{
    private static readonly HashSet<string> DesktopMethods = new(StringComparer.Ordinal)
    {
        "agent.abort",
        "agent.getMessages",
        "agent.getState",
        "agent.newSession",
        "agent.prompt",
        "clipboard.clear",
        "clipboard.read",
        "clipboard.write",
        "desktop.listEntries",
        "display.getTopology",
        "explorer.browse",
        "explorer.cancelTransfer",
        "explorer.createFolder",
        "explorer.getTransfers",
        "explorer.openFile",
        "explorer.openInWindows",
        "explorer.preflightTransfer",
        "explorer.recycle",
        "explorer.rename",
        "explorer.showProperties",
        "explorer.startTransfer",
        "feed.clear",
        "feed.getSnapshot",
        "feed.markAllRead",
        "feed.reportFault",
        "lifecycle.exitToWindows",
        "lifecycle.getRuntimeInfo",
        "lifecycle.runDiagnostics",
        "lifecycle.setStartupEnabled",
        "lifecycle.showDesktop",
        "notifications.getState",
        "notifications.requestAccess",
        "session.cancel",
        "session.commit",
        "session.getState",
        "session.prepare",
        "shell.listApplications",
        "shell.open",
        "shell.openApplication",
        "shell.refreshApplications",
        "system.getDetails",
        "system.getSnapshot",
        "taskbar.activateWindow",
        "taskbar.closeWindow",
        "taskbar.getSnapshot",
        "taskbar.hideFlyout",
        "taskbar.showFlyout",
        "taskbar.toggleDesktop",
        "taskbar.toggleWindow",
        "taskbarMode.getState",
        "taskbarMode.retry",
        "taskbarMode.setMode",
        "terminal.close",
        "terminal.create",
        "terminal.listProfiles",
        "terminal.resize",
        "terminal.write",
        "tray.getSnapshot",
        "tray.setMuted",
        "tray.setVolume",
        "windowAppearance.getState",
        "windowAppearance.removeRule",
        "windowAppearance.setMode",
        "windowAppearance.setRule"
    };

    private static readonly HashSet<string> TaskbarMethods = new(StringComparer.Ordinal)
    {
        "agent.getState",
        "feed.getSnapshot",
        "feed.reportFault",
        "lifecycle.showDesktop",
        "shell.listApplications",
        "shell.open",
        "shell.openApplication",
        "taskbar.closeWindow",
        "taskbar.getSnapshot",
        "taskbar.hideFlyout",
        "taskbar.showFlyout",
        "taskbar.toggleDesktop",
        "taskbar.toggleWindow",
        "tray.getSnapshot"
    };

    private static readonly HashSet<string> DesktopEvents = new(StringComparer.Ordinal)
    {
        "agent.event",
        "agent.stateChanged",
        "desktop.externalDrop",
        "desktop.entriesChanged",
        "display.changed",
        "explorer.transferChanged",
        "feed.snapshot",
        "shell.applicationsChanged",
        "system.snapshot",
        "taskbar.snapshot",
        "taskbarMode.changed",
        "terminal.exited",
        "terminal.output",
        "tray.snapshot",
        "windowAppearance.changed"
    };

    private static readonly HashSet<string> TaskbarEvents = new(StringComparer.Ordinal)
    {
        "agent.stateChanged",
        "feed.snapshot",
        "shell.applicationsChanged",
        "taskbar.snapshot",
        "tray.snapshot"
    };

    public static IReadOnlySet<string> KnownMethods => DesktopMethods;

    public static bool IsKnownMethod(string method) => DesktopMethods.Contains(method);

    public static bool AllowsMethod(WebBridgeSurface surface, string method) => surface switch
    {
        WebBridgeSurface.Desktop => DesktopMethods.Contains(method),
        WebBridgeSurface.Taskbar => TaskbarMethods.Contains(method),
        WebBridgeSurface.Switcher => false,
        _ => false
    };

    public static bool AllowsEvent(WebBridgeSurface surface, string eventName) => surface switch
    {
        WebBridgeSurface.Desktop => DesktopEvents.Contains(eventName),
        WebBridgeSurface.Taskbar => TaskbarEvents.Contains(eventName),
        WebBridgeSurface.Switcher => false,
        _ => false
    };
}
