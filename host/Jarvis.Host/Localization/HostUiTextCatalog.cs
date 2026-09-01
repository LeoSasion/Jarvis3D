using System.Globalization;

namespace Jarvis.Host.Localization;

internal enum HostUiMessage
{
    AlreadyRunning,
    WebView2Missing,
    FatalHostError,
}

internal readonly record struct HostUiDialogText(string Title, string Message);

internal static class HostUiTextCatalog
{
    private static readonly IReadOnlyDictionary<HostUiMessage, HostUiDialogText> English =
        new Dictionary<HostUiMessage, HostUiDialogText>
        {
            [HostUiMessage.AlreadyRunning] = new(
                "JARVIS",
                "JARVIS is already running in this Windows session."),
            [HostUiMessage.WebView2Missing] = new(
                "JARVIS Startup Check",
                "JARVIS requires Microsoft Edge WebView2 Runtime. " +
                "Install the Evergreen Runtime, then restart JARVIS.\n\n" +
                "The native Windows desktop and taskbar were not modified."),
            [HostUiMessage.FatalHostError] = new(
                "JARVIS",
                "JARVIS encountered a host error. The native Windows taskbar was restored, " +
                "and JARVIS will exit safely."),
        };

    private static readonly IReadOnlyDictionary<HostUiMessage, HostUiDialogText> Chinese =
        new Dictionary<HostUiMessage, HostUiDialogText>
        {
            [HostUiMessage.AlreadyRunning] = new(
                "JARVIS",
                "JARVIS 已在当前 Windows 会话中运行。"),
            [HostUiMessage.WebView2Missing] = new(
                "JARVIS 启动检查",
                "JARVIS 需要 Microsoft Edge WebView2 Runtime。" +
                "请安装 Evergreen Runtime 后重新启动 JARVIS。\n\n" +
                "Windows 原生桌面与任务栏未被修改。"),
            [HostUiMessage.FatalHostError] = new(
                "JARVIS",
                "JARVIS 宿主遇到错误，已恢复 Windows 原生任务栏并安全退出。"),
        };

    public static HostUiDialogText GetDialog(
        HostUiMessage message,
        CultureInfo? culture = null)
    {
        var selectedCulture = culture ?? CultureInfo.CurrentUICulture;
        var catalog = UsesChineseText(selectedCulture) ? Chinese : English;

        return catalog[message];
    }

    public static string GetObsidianVaultPickerTitle(CultureInfo? culture = null) =>
        UsesChineseText(culture ?? CultureInfo.CurrentUICulture)
            ? "选择 Obsidian Vault"
            : "Select Obsidian Vault";

    private static bool UsesChineseText(CultureInfo culture) =>
        culture.TwoLetterISOLanguageName.Equals(
            "zh",
            StringComparison.OrdinalIgnoreCase);
}
