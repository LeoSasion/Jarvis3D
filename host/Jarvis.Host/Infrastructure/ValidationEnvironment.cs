using System.IO;

namespace Jarvis.Host.Infrastructure;

internal static class ValidationEnvironment
{
    private static readonly string[] OverrideNames =
    [
        "JARVIS_FRONTEND_DIST",
        "JARVIS_ALLOW_EXTERNAL_PI_RUNTIME",
        "JARVIS_PI_EXECUTABLE",
        "JARVIS_PI_EXECUTABLE_SHA256",
        "JARVIS_TASKBAR_DIAGNOSTIC_FLYOUT_PROCESS",
        "JARVIS_TASKBAR_DIAGNOSTIC_TOGGLE_SEQUENCE",
        "JARVIS_TASKBAR_DIAGNOSTIC_SHOW_DESKTOP_SEQUENCE",
        "JARVIS_DIAGNOSTIC_SHELL_PANEL",
        "JARVIS_WINDOW_SWITCHER_DIAGNOSTIC",
        "JARVIS_WEBVIEW2_DEVTOOLS"
    ];

    internal static bool WebViewDataIsolated { get; private set; }
    internal static bool IsActive { get; private set; }

    // Called only after the native/smoke/lifecycle options validate an isolated
    // root. Production startup continues to honor its existing overrides.
    internal static void Apply(string dataRoot)
    {
        IsActive = true;
        foreach (var name in Environment.GetEnvironmentVariables().Keys.Cast<string>().ToArray())
        {
            if (name.StartsWith("WEBVIEW2_", StringComparison.OrdinalIgnoreCase))
                Environment.SetEnvironmentVariable(name, null);
        }
        foreach (var name in OverrideNames) Environment.SetEnvironmentVariable(name, null);
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(dataRoot, "WebView2"));
        WebViewDataIsolated = false;
    }

    internal static void VerifyWebViewDataDirectory(string actual, string expected)
    {
        if (!Path.GetFullPath(actual).TrimEnd(Path.DirectorySeparatorChar).Equals(
            Path.GetFullPath(expected).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("WebView2 did not use the isolated validation data directory.");
        }
        WebViewDataIsolated = true;
    }
}
