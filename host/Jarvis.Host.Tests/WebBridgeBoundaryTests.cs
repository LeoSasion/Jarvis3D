using System.Text.Json;
using System.Text;
using System.Runtime.InteropServices;
using Jarvis.Host.Bridge;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class WebBridgeBoundaryTests
{
    [Fact]
    public void TaskbarMethodAllowlistIsExact()
    {
        var expected = new[]
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
        var actual = WebBridgeSurfacePolicy.KnownMethods
            .Where(method => WebBridgeSurfacePolicy.AllowsMethod(WebBridgeSurface.Taskbar, method))
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(expected.Order(StringComparer.Ordinal), actual);
    }

    [Theory]
    [InlineData("agent.getState")]
    [InlineData("feed.getSnapshot")]
    [InlineData("feed.reportFault")]
    [InlineData("lifecycle.showDesktop")]
    [InlineData("shell.listApplications")]
    [InlineData("shell.open")]
    [InlineData("shell.openApplication")]
    [InlineData("taskbar.closeWindow")]
    [InlineData("taskbar.getSnapshot")]
    [InlineData("taskbar.hideFlyout")]
    [InlineData("taskbar.showFlyout")]
    [InlineData("taskbar.toggleDesktop")]
    [InlineData("taskbar.toggleWindow")]
    [InlineData("tray.getSnapshot")]
    public void TaskbarAllowsOnlyItsRequiredMethods(string method)
    {
        Assert.True(WebBridgeSurfacePolicy.AllowsMethod(WebBridgeSurface.Taskbar, method));
    }

    [Theory]
    [InlineData("agent.abort")]
    [InlineData("agent.getMessages")]
    [InlineData("agent.newSession")]
    [InlineData("agent.prompt")]
    [InlineData("clipboard.read")]
    [InlineData("explorer.browse")]
    [InlineData("knowledgeGraph.chooseVault")]
    [InlineData("knowledgeGraph.getDefaultChunk")]
    [InlineData("knowledgeGraph.getDefaultManifest")]
    [InlineData("knowledgeGraph.getDefaultSource")]
    [InlineData("graphVisual.read")]
    [InlineData("graphVisual.write")]
    [InlineData("lifecycle.exitToWindows")]
    [InlineData("session.prepare")]
    [InlineData("taskbarMode.setMode")]
    [InlineData("terminal.create")]
    [InlineData("tray.setMuted")]
    [InlineData("windowAppearance.setMode")]
    public void TaskbarRejectsAgentExecutionAndUnrelatedCapabilities(string method)
    {
        Assert.True(WebBridgeSurfacePolicy.IsKnownMethod(method));
        Assert.False(WebBridgeSurfacePolicy.AllowsMethod(WebBridgeSurface.Taskbar, method));
    }

    [Fact]
    public void DesktopExplicitlyAllowsEveryKnownMethod()
    {
        Assert.All(
            WebBridgeSurfacePolicy.KnownMethods,
            method => Assert.True(
                WebBridgeSurfacePolicy.AllowsMethod(WebBridgeSurface.Desktop, method),
                $"Desktop method {method} was not explicitly allowed."));
    }

    [Fact]
    public void SwitcherHasNoWebBridgeCapabilities()
    {
        Assert.All(
            WebBridgeSurfacePolicy.KnownMethods,
            method => Assert.False(
                WebBridgeSurfacePolicy.AllowsMethod(WebBridgeSurface.Switcher, method)));
        Assert.False(
            WebBridgeSurfacePolicy.AllowsEvent(
                WebBridgeSurface.Switcher,
                "agent.stateChanged"));
    }

    [Fact]
    public void TaskbarReceivesAgentStateButNotConversationEvents()
    {
        Assert.True(
            WebBridgeSurfacePolicy.AllowsEvent(
                WebBridgeSurface.Taskbar,
                "agent.stateChanged"));
        Assert.False(
            WebBridgeSurfacePolicy.AllowsEvent(
                WebBridgeSurface.Taskbar,
                "agent.event"));
        Assert.False(
            WebBridgeSurfacePolicy.AllowsEvent(
                WebBridgeSurface.Taskbar,
                "desktop.entriesChanged"));
    }

    [Fact]
    public void TaskbarEventAllowlistContainsOnlyPresentationState()
    {
        var knownEvents = new[]
        {
            "agent.event",
            "agent.stateChanged",
            "desktop.entriesChanged",
            "desktop.externalDrop",
            "display.changed",
            "explorer.transferChanged",
            "feed.snapshot",
            "knowledgeGraph.changed",
            "shell.applicationsChanged",
            "system.snapshot",
            "taskbar.snapshot",
            "taskbarMode.changed",
            "terminal.exited",
            "terminal.output",
            "tray.snapshot",
            "windowAppearance.changed"
        };
        var allowed = knownEvents
            .Where(eventName => WebBridgeSurfacePolicy.AllowsEvent(
                WebBridgeSurface.Taskbar,
                eventName))
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            new[]
            {
                "agent.stateChanged",
                "feed.snapshot",
                "shell.applicationsChanged",
                "taskbar.snapshot",
                "tray.snapshot"
            },
            allowed);
    }

    [Fact]
    public void RequestParserRejectsPayloadAboveUtf8Limit()
    {
        var payload = new string('é', WebBridgeRequestPolicy.MaximumPayloadBytes / 2 + 1);

        var exception = Assert.Throws<BridgeFaultException>(
            () => WebBridgeRequestPolicy.Parse(payload));

        Assert.Equal("REQUEST_TOO_LARGE", exception.Code);
    }

    [Fact]
    public void RequestParserRejectsExcessiveJsonDepth()
    {
        var payload = new string('[', WebBridgeRequestPolicy.MaximumJsonDepth + 2) +
                      "0" +
                      new string(']', WebBridgeRequestPolicy.MaximumJsonDepth + 2);

        Assert.ThrowsAny<JsonException>(() => WebBridgeRequestPolicy.Parse(payload));
    }

    [Fact]
    public void RequestGateRejectsOverflowAndReleasesCapacityExactlyOnce()
    {
        var gate = new WebBridgeRequestGate(maximumConcurrentRequests: 2);

        Assert.True(gate.TryEnter(out var first));
        Assert.True(gate.TryEnter(out var second));
        Assert.False(gate.TryEnter(out var rejected));
        Assert.Null(rejected);
        Assert.Equal(2, gate.ActiveRequests);

        first.Dispose();
        first.Dispose();
        Assert.Equal(1, gate.ActiveRequests);
        Assert.True(gate.TryEnter(out var replacement));

        second.Dispose();
        replacement.Dispose();
        Assert.Equal(0, gate.ActiveRequests);
    }

    [Fact]
    public void KnowledgeGraphChunkRequestAcceptsZeroLimitForAnExhaustedSide()
    {
        using var document = JsonDocument.Parse(
            """
            {
              "revision": "obsidian-v1-0123456789abcdef",
              "nodeOffset": 842,
              "nodeLimit": 0,
              "edgeOffset": 100,
              "edgeLimit": 256
            }
            """);

        var request = WebBridge.GetKnowledgeGraphChunkRequest(document.RootElement);

        Assert.Equal("obsidian-v1-0123456789abcdef", request.Revision);
        Assert.Equal(842, request.NodeOffset);
        Assert.Equal(0, request.NodeLimit);
        Assert.Equal(100, request.EdgeOffset);
        Assert.Equal(256, request.EdgeLimit);
    }

    [Theory]
    [InlineData("{\"revision\":\"obsidian-v1-aa\",\"nodeOffset\":0,\"nodeLimit\":513,\"edgeOffset\":0,\"edgeLimit\":0}")]
    [InlineData("{\"revision\":\"../../private\",\"nodeOffset\":0,\"nodeLimit\":1,\"edgeOffset\":0,\"edgeLimit\":0}")]
    [InlineData("{\"revision\":\"obsidian-v1-aa\",\"nodeOffset\":0,\"nodeLimit\":1,\"edgeOffset\":0,\"edgeLimit\":0,\"path\":\"C:/private\"}")]
    public void KnowledgeGraphChunkRequestRejectsUnboundedOrUnknownParameters(string json)
    {
        using var document = JsonDocument.Parse(json);

        var exception = Assert.Throws<BridgeFaultException>(() =>
            WebBridge.GetKnowledgeGraphChunkRequest(document.RootElement));

        Assert.Equal("INVALID_PARAMS", exception.Code);
    }

    [Fact]
    public void ResponseSerializerEnforcesUtf8BudgetBeforeProducingJson()
    {
        var payload = new
        {
            id = "response-1",
            ok = true,
            result = new string('é', 2048)
        };

        var exception = Assert.Throws<WebBridgePayloadTooLargeException>(() =>
            WebBridgePayloadPolicy.Serialize(payload, maximumBytes: 1024));

        Assert.Equal(1024, exception.MaximumBytes);
    }

    [Fact]
    public void ResponseSerializerPreservesCamelCaseWithinItsBudget()
    {
        var json = WebBridgePayloadPolicy.Serialize(
            new { ProviderLabel = "Pi Agent", Capabilities = new[] { "chat", "streaming" } },
            maximumBytes: 1024);
        using var document = JsonDocument.Parse(json);

        Assert.Equal("Pi Agent", document.RootElement.GetProperty("providerLabel").GetString());
        Assert.Equal(2, document.RootElement.GetProperty("capabilities").GetArrayLength());
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(json) <= 1024);
    }

    [Fact]
    public void EventBudgetIsStrictlySmallerThanResponseBudget()
    {
        Assert.True(WebBridgePayloadPolicy.MaximumEventBytes > WebBridgeRequestPolicy.MaximumPayloadBytes);
        Assert.True(WebBridgePayloadPolicy.MaximumEventBytes < WebBridgePayloadPolicy.MaximumResponseBytes);
    }

    [Fact]
    public void MessageDeliveryReportsPayloadOverflowWithoutCallingTransport()
    {
        var transportCalled = false;

        var result = WebBridgeMessageDelivery.TryPost(
            new { value = new string('é', 2048) },
            maximumBytes: 1024,
            _ => transportCalled = true);

        Assert.False(result.Delivered);
        Assert.Equal(WebBridgeDeliveryFailure.PayloadTooLarge, result.Failure);
        Assert.False(transportCalled);
    }

    [Fact]
    public void MessageDeliveryReportsSerializationFailureWithoutCallingTransport()
    {
        var transportCalled = false;

        var result = WebBridgeMessageDelivery.TryPost(
            new ThrowingPayload(),
            maximumBytes: 1024,
            _ => transportCalled = true);

        Assert.False(result.Delivered);
        Assert.Equal(WebBridgeDeliveryFailure.Serialization, result.Failure);
        Assert.False(transportCalled);
    }

    [Fact]
    public void MessageDeliveryContainsWebViewInvalidStateFailure()
    {
        var result = WebBridgeMessageDelivery.TryPost(
            new { ok = true },
            maximumBytes: 1024,
            _ => throw new InvalidOperationException("Document is reloading."));

        Assert.False(result.Delivered);
        Assert.Equal(WebBridgeDeliveryFailure.TransportUnavailable, result.Failure);
        Assert.Equal(nameof(InvalidOperationException), result.ExceptionType);
    }

    [Fact]
    public void MessageDeliveryContainsWebViewComDisconnectFailure()
    {
        var result = WebBridgeMessageDelivery.TryPost(
            new { ok = true },
            maximumBytes: 1024,
            _ => throw new COMException(
                "The WebView2 renderer disconnected.",
                unchecked((int)0x80010108)));

        Assert.False(result.Delivered);
        Assert.Equal(WebBridgeDeliveryFailure.TransportUnavailable, result.Failure);
        Assert.Equal(nameof(COMException), result.ExceptionType);
    }

    [Fact]
    public void MessageDeliveryContainsUnexpectedNonfatalTransportFailure()
    {
        var result = WebBridgeMessageDelivery.TryPost(
            new { ok = true },
            maximumBytes: 1024,
            _ => throw new IOException("Transport stream failed."));

        Assert.False(result.Delivered);
        Assert.Equal(WebBridgeDeliveryFailure.Delivery, result.Failure);
        Assert.Equal(nameof(IOException), result.ExceptionType);
    }

    [Fact]
    public void TerminalOutputBufferRemainsBoundedWhenRendererDoesNotFlush()
    {
        var buffer = new PendingTerminalOutputBuffer();
        var chunk = new string('é', 8 * 1024);

        for (var sequence = 1; sequence <= 10_000; sequence++)
        {
            buffer.Enqueue(new TerminalOutputChunk("terminal-1", sequence, chunk));
        }

        Assert.Equal(1, buffer.PendingSessionCount);
        var output = Assert.Single(buffer.Drain());
        Assert.Equal(10_000, output.Sequence);
        Assert.Contains(PendingTerminalOutputBuffer.OutputOverflowMarker, output.Data);
        Assert.Equal(
            1,
            CountOccurrences(output.Data, PendingTerminalOutputBuffer.OutputOverflowMarker));
        Assert.True(
            output.Data.Length <= PendingTerminalOutputBuffer.MaximumCharactersPerSession);
        Assert.True(
            Encoding.UTF8.GetByteCount(output.Data) <=
            PendingTerminalOutputBuffer.MaximumUtf8BytesPerSession);
    }

    [Fact]
    public void TerminalOutputBufferCapsPendingSessionsAndReportsDroppedSessions()
    {
        var buffer = new PendingTerminalOutputBuffer();
        var attemptedSessions = PendingTerminalOutputBuffer.MaximumPendingSessionCount * 8;

        for (var index = 0; index < attemptedSessions; index++)
        {
            buffer.Enqueue(new TerminalOutputChunk($"terminal-{index}", index, "ready\r\n"));
        }

        Assert.Equal(
            PendingTerminalOutputBuffer.MaximumPendingSessionCount,
            buffer.PendingSessionCount);
        var output = buffer.Drain();
        Assert.Equal(PendingTerminalOutputBuffer.MaximumPendingSessionCount, output.Length);
        Assert.Contains(
            output,
            chunk => chunk.Data.Contains(
                PendingTerminalOutputBuffer.SessionOverflowMarker,
                StringComparison.Ordinal));
        Assert.All(
            output,
            chunk =>
            {
                Assert.True(
                    chunk.Data.Length <= PendingTerminalOutputBuffer.MaximumCharactersPerSession);
                Assert.True(
                    Encoding.UTF8.GetByteCount(chunk.Data) <=
                    PendingTerminalOutputBuffer.MaximumUtf8BytesPerSession);
            });
    }

    [Fact]
    public void TerminalOutputBufferKeepsItsBoundsUnderConcurrentProducers()
    {
        var buffer = new PendingTerminalOutputBuffer();

        Parallel.For(
            0,
            20_000,
            index => buffer.Enqueue(new TerminalOutputChunk(
                $"terminal-{index % 128}",
                index,
                new string('x', 512))));

        Assert.True(
            buffer.PendingSessionCount <=
            PendingTerminalOutputBuffer.MaximumPendingSessionCount);
        Assert.All(
            buffer.Drain(),
            chunk =>
            {
                Assert.True(
                    chunk.Data.Length <= PendingTerminalOutputBuffer.MaximumCharactersPerSession);
                Assert.True(
                    Encoding.UTF8.GetByteCount(chunk.Data) <=
                    PendingTerminalOutputBuffer.MaximumUtf8BytesPerSession);
            });
    }

    private static int CountOccurrences(string value, string candidate)
    {
        var count = 0;
        var offset = 0;
        while ((offset = value.IndexOf(candidate, offset, StringComparison.Ordinal)) >= 0)
        {
            count++;
            offset += candidate.Length;
        }

        return count;
    }

    private sealed class ThrowingPayload
    {
        public string Value => throw new InvalidOperationException("Getter failed.");
    }
}
