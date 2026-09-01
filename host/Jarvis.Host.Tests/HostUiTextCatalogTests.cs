using System.Globalization;
using Jarvis.Host.Localization;

namespace Jarvis.Host.Tests;

public sealed class HostUiTextCatalogTests
{
    [Fact]
    public void ChineseCultureReturnsChineseDialogText()
    {
        var dialog = HostUiTextCatalog.GetDialog(
            HostUiMessage.WebView2Missing,
            CultureInfo.GetCultureInfo("zh-CN"));

        Assert.Equal("JARVIS 启动检查", dialog.Title);
        Assert.Contains("请安装 Evergreen Runtime", dialog.Message, StringComparison.Ordinal);
        Assert.Contains("Windows 原生桌面与任务栏未被修改", dialog.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void EnglishCultureReturnsEnglishDialogText()
    {
        var dialog = HostUiTextCatalog.GetDialog(
            HostUiMessage.FatalHostError,
            CultureInfo.GetCultureInfo("en-US"));

        Assert.Equal("JARVIS", dialog.Title);
        Assert.Equal(
            "JARVIS encountered a host error. The native Windows taskbar was restored, " +
            "and JARVIS will exit safely.",
            dialog.Message);
    }

    [Fact]
    public void UnsupportedCultureFallsBackToEnglish()
    {
        var fallback = HostUiTextCatalog.GetDialog(
            HostUiMessage.AlreadyRunning,
            CultureInfo.GetCultureInfo("fr-FR"));
        var english = HostUiTextCatalog.GetDialog(
            HostUiMessage.AlreadyRunning,
            CultureInfo.GetCultureInfo("en-US"));

        Assert.Equal(english, fallback);
    }

    [Fact]
    public void DefaultLookupFollowsCurrentUiCulture()
    {
        var originalCulture = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("zh-CN");

            var dialog = HostUiTextCatalog.GetDialog(HostUiMessage.AlreadyRunning);

            Assert.Equal("JARVIS 已在当前 Windows 会话中运行。", dialog.Message);
        }
        finally
        {
            CultureInfo.CurrentUICulture = originalCulture;
        }
    }

    [Theory]
    [InlineData("en-US", "Select Obsidian Vault")]
    [InlineData("zh-CN", "选择 Obsidian Vault")]
    public void ObsidianVaultPickerTitleFollowsCurrentUiCulture(
        string cultureName,
        string expectedTitle)
    {
        var originalCulture = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(cultureName);

            Assert.Equal(expectedTitle, HostUiTextCatalog.GetObsidianVaultPickerTitle());
        }
        finally
        {
            CultureInfo.CurrentUICulture = originalCulture;
        }
    }

    [Theory]
    [InlineData("zh-CN")]
    [InlineData("en-US")]
    public void EverySupportedCultureDefinesEveryHostDialog(string cultureName)
    {
        var culture = CultureInfo.GetCultureInfo(cultureName);

        foreach (var message in Enum.GetValues<HostUiMessage>())
        {
            var dialog = HostUiTextCatalog.GetDialog(message, culture);

            Assert.False(string.IsNullOrWhiteSpace(dialog.Title));
            Assert.False(string.IsNullOrWhiteSpace(dialog.Message));
        }
    }
}
