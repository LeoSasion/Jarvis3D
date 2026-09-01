using System.Text.Json;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Tests;

public sealed class RendererSmokeOptionsTests
{
    private const string Nonce = "0123456789abcdef0123456789abcdef";

    [Fact]
    public void NormalStartupDoesNotEnterRendererSmoke()
    {
        Assert.False(RendererSmokeOptions.IsRequested(["--startup"]));
        Assert.False(RendererSmokeOptions.TryParse(["--startup"], out _, out _));
    }

    [Fact]
    public void ValidSmokeUsesCanonicalIsolatedPaths()
    {
        var root = CreateIsolatedRoot();
        var receipt = Path.Combine(root, "receipts", "renderer.json");

        var parsed = RendererSmokeOptions.TryParse(
            CreateArguments(root, receipt),
            out var options,
            out var error);

        Assert.True(parsed, error);
        Assert.NotNull(options);
        Assert.Equal(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), options.DataRoot);
        Assert.Equal(Path.GetFullPath(receipt), options.ReceiptPath);
        Assert.Equal(Nonce, options.Nonce);
        Assert.Equal("zh-CN", options.CultureName);
    }

    [Fact]
    public void ReceiptCannotEscapeIsolatedRoot()
    {
        var root = CreateIsolatedRoot();
        Assert.False(RendererSmokeOptions.TryParse(
            CreateArguments(root, Path.Combine(root, "..", "renderer.json")),
            out _,
            out _));
    }

    [Fact]
    public void ProductionDataTreeIsRejected()
    {
        var productionRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JARVIS");

        Assert.False(RendererSmokeOptions.TryParse(
            CreateArguments(productionRoot, Path.Combine(productionRoot, "renderer.json")),
            out _,
            out _));
    }

    [Fact]
    public void VolumeRootIsRejected()
    {
        var volumeRoot = Path.GetPathRoot(Path.GetTempPath())!;

        Assert.False(RendererSmokeOptions.TryParse(
            CreateArguments(volumeRoot, Path.Combine(volumeRoot, "renderer.json")),
            out _,
            out _));
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("gggggggggggggggggggggggggggggggg")]
    public void InvalidNonceIsRejected(string nonce)
    {
        var root = CreateIsolatedRoot();
        var arguments = CreateArguments(root, Path.Combine(root, "renderer.json"));
        arguments[3] = $"--renderer-smoke-nonce={nonce}";

        Assert.False(RendererSmokeOptions.TryParse(arguments, out _, out _));
    }

    [Fact]
    public void MissingCultureUsesStableEnglishDefault()
    {
        var root = CreateIsolatedRoot();
        var receipt = Path.Combine(root, "renderer.json");
        var arguments = CreateArguments(root, receipt).Take(4).ToArray();

        Assert.True(RendererSmokeOptions.TryParse(arguments, out var options, out var error), error);
        Assert.Equal(RendererSmokeOptions.DefaultCultureName, options!.CultureName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not a culture")]
    public void InvalidCultureIsRejected(string culture)
    {
        var root = CreateIsolatedRoot();
        var receipt = Path.Combine(root, "renderer.json");
        var arguments = CreateArguments(root, receipt);
        arguments[4] = $"--renderer-smoke-culture={culture}";

        Assert.False(RendererSmokeOptions.TryParse(arguments, out _, out _));
    }

    [Fact]
    public void ReceiptRecordsVerifiedSafeSurfaceResult()
    {
        var root = CreateIsolatedRoot();
        try
        {
            var receiptPath = Path.Combine(root, "renderer.json");
            var options = new RendererSmokeOptions(root, receiptPath, Nonce);
            var result = new RendererSmokeResult(
                ShellReady: true,
                HelpOpened: true,
                HelpClosed: true,
                ExplorerOpened: true,
                AgentOpened: true,
                LinkedWorkspaceReady: true,
                NoticeAvoidsCriticalControls: true,
                GraphSurfaceResolved: true,
                ReducedMotionStylesApplied: true);

            RendererSmokeReceipt.Write(
                options,
                result,
                mainWindowCreated: true,
                error: null);

            using var json = JsonDocument.Parse(File.ReadAllText(receiptPath));
            var rootElement = json.RootElement;
            Assert.True(rootElement.GetProperty("success").GetBoolean());
            Assert.False(rootElement.GetProperty("taskbarTouched").GetBoolean());
            Assert.Equal("renderer-smoke", rootElement.GetProperty("mode").GetString());
            Assert.Equal("en-US", rootElement.GetProperty("culture").GetString());
            Assert.True(rootElement.GetProperty("result").GetProperty("graphSurfaceResolved").GetBoolean());
            Assert.False(File.Exists(receiptPath + "." + Nonce + ".tmp"));
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public void GraphSurfaceResolutionIsRequiredForSuccess()
    {
        var result = new RendererSmokeResult(
            ShellReady: true,
            HelpOpened: true,
            HelpClosed: true,
            ExplorerOpened: true,
            AgentOpened: true,
            LinkedWorkspaceReady: true,
            NoticeAvoidsCriticalControls: true,
            GraphSurfaceResolved: false,
            ReducedMotionStylesApplied: true);

        Assert.False(result.Succeeded);
    }

    [Fact]
    public void StableDisconnectedGraphSurfaceRequiresAReadyRuntime()
    {
        Assert.True(RendererSmokeGraphSurfacePolicy.IsResolved(
            runtimeReady: true,
            graphSourceReady: false,
            stableDisconnectedReady: true,
            stableRuntimeFallback: false));
        Assert.False(RendererSmokeGraphSurfacePolicy.IsResolved(
            runtimeReady: false,
            graphSourceReady: false,
            stableDisconnectedReady: true,
            stableRuntimeFallback: false));
        Assert.True(RendererSmokeGraphSurfacePolicy.IsResolved(
            runtimeReady: false,
            graphSourceReady: false,
            stableDisconnectedReady: false,
            stableRuntimeFallback: true));
        Assert.False(RendererSmokeGraphSurfacePolicy.IsResolved(
            runtimeReady: false,
            graphSourceReady: false,
            stableDisconnectedReady: false,
            stableRuntimeFallback: false));
        Assert.Contains("is-neural-fallback", RendererSmokeGraphSurfacePolicy.BrowserExpression);
        Assert.Contains(
            "[data-runtime-fallback=\"resolved\"]",
            RendererSmokeGraphSurfacePolicy.BrowserExpression);
        Assert.DoesNotContain(
            "core-stage__graphics-fallback",
            RendererSmokeGraphSurfacePolicy.BrowserExpression);
    }

    [Fact]
    public void FailureReceiptDoesNotInventAMainWindow()
    {
        var root = CreateIsolatedRoot();
        try
        {
            var receiptPath = Path.Combine(root, "renderer-failure.json");
            var options = new RendererSmokeOptions(root, receiptPath, Nonce);

            RendererSmokeReceipt.Write(
                options,
                result: null,
                mainWindowCreated: false,
                error: "WebView2 unavailable");

            using var json = JsonDocument.Parse(File.ReadAllText(receiptPath));
            Assert.False(json.RootElement.GetProperty("success").GetBoolean());
            Assert.False(json.RootElement.GetProperty("mainWindowCreated").GetBoolean());
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    private static string[] CreateArguments(string root, string receipt) =>
    [
        "--renderer-smoke",
        $"--renderer-smoke-data-root={root}",
        $"--renderer-smoke-receipt={receipt}",
        $"--renderer-smoke-nonce={Nonce}",
        "--renderer-smoke-culture=zh-CN"
    ];

    private static string CreateIsolatedRoot() => Path.Combine(
        Path.GetTempPath(),
        "jarvis-renderer-smoke-tests",
        Guid.NewGuid().ToString("N"));
}
