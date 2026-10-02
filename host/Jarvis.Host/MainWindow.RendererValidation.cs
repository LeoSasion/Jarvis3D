using Jarvis.Host.Infrastructure;

namespace Jarvis.Host;

public partial class MainWindow
{
    internal int? RendererSmokeExitCode { get; private set; }

    private async Task RunRendererSmokeAsync()
    {
        if (_rendererSmokeOptions is null || _isClosing)
        {
            return;
        }

        RendererSmokeResult? result = null;
        string? error = null;
        try
        {
            var shellReady = await ExecuteRendererSmokeBooleanAsync(
                "Boolean(document.querySelector('.jarvis-shell'))");

            // Require a resolved graphics runtime. A stable disconnected neural surface is valid
            // when no Vault is available, but the transient Suspense fallback is not.
            var graphSurfaceResolved = await WaitForRendererSmokeBooleanAsync(
                RendererSmokeGraphSurfacePolicy.BrowserExpression,
                maximumAttempts: 200);

            if (_rendererSmokeOptions.MeasurePerformance)
            {
                await RunRendererGraphBenchmarkAsync();
            }

            await ExecuteRendererSmokeActionAsync(
                "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))");
            var helpOpened = await WaitForRendererSmokeBooleanAsync(
                $"Boolean(document.querySelector('{HelpCenterSmokeSelector}'))");

            await ExecuteRendererSmokeActionAsync(
                "(document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
            var helpClosed = await WaitForRendererSmokeBooleanAsync(
                $"!document.querySelector('{HelpCenterSmokeSelector}')");

            await ExecuteRendererSmokeActionAsync(
                "window.dispatchEvent(new CustomEvent('jarvis:open-shell-panel', { detail: 'explorer' }))");
            var explorerOpened = await WaitForRendererSmokeBooleanAsync(
                "Boolean(document.querySelector('[data-window-id=\"explorer\"]'))");

            await ExecuteRendererSmokeActionAsync(
                "window.dispatchEvent(new CustomEvent('jarvis:open-shell-panel', { detail: 'agent' }))");
            var agentOpened = await WaitForRendererSmokeBooleanAsync(
                "Boolean(document.querySelector('[data-window-id=\"agent\"]'))");
            var linkedWorkspaceReady = await WaitForRendererSmokeBooleanAsync(
                "Boolean(document.querySelector('[data-window-layout=\"explorer-agent-linked\"]'))");

            await ExecuteRendererSmokeActionAsync(
                "window.dispatchEvent(new CustomEvent('jarvis:shell-feedback', { detail: { version: 1, nonce: 'renderer-smoke-notice', id: 'renderer-smoke-notice', severity: 'warning', source: 'agent', title: 'Renderer smoke notice', detail: 'Bounds verification', timestamp: new Date().toISOString(), persistent: true } }))");
            var noticeAvoidsCriticalControls = await WaitForRendererSmokeBooleanAsync(
                "(() => { const notice = document.querySelector('.system-notice'); const composer = document.querySelector('.agent-composer'); const summary = document.querySelector('.explorer-selection-summary'); if (!notice || !composer || !summary) return false; const box = notice.getBoundingClientRect(); const overlaps = (other) => { const rect = other.getBoundingClientRect(); return box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top; }; return !overlaps(composer) && !overlaps(summary); })()");

            var reducedMotionStylesApplied = await ExecuteRendererSmokeBooleanAsync(
                "(() => { const root = document.documentElement; const previous = root.dataset.motion; root.dataset.motion = 'reduced'; const target = document.querySelector('.core-stage__media'); const applied = Boolean(target) && getComputedStyle(target).transform === 'none'; if (previous) root.dataset.motion = previous; else delete root.dataset.motion; return applied; })()");

            result = new RendererSmokeResult(
                shellReady,
                helpOpened,
                helpClosed,
                explorerOpened,
                agentOpened,
                linkedWorkspaceReady,
                noticeAvoidsCriticalControls,
                graphSurfaceResolved,
                reducedMotionStylesApplied);
            if (!result.Succeeded)
            {
                error = "one or more renderer assertions failed";
            }
        }
        catch (Exception exception)
        {
            error = exception.GetType().Name;
            HostLog.Error("Renderer smoke execution failed.", exception);
        }

        try
        {
            RendererSmokeReceipt.Write(
                _rendererSmokeOptions,
                result,
                mainWindowCreated: true,
                error);
        }
        catch (Exception exception)
        {
            error ??= exception.GetType().Name;
            HostLog.Error("Renderer smoke receipt could not be written.", exception);
        }

        RendererSmokeExitCode = result?.Succeeded == true && error is null ? 0 : 70;
        _ = Dispatcher.BeginInvoke(Close);
    }

    private void CompleteRendererSmokeFailure(string error)
    {
        if (_rendererSmokeOptions is null || RendererSmokeExitCode is not null)
        {
            return;
        }

        try
        {
            RendererSmokeReceipt.Write(
                _rendererSmokeOptions,
                result: null,
                mainWindowCreated: true,
                error);
        }
        catch (Exception exception)
        {
            HostLog.Error("Renderer smoke failure receipt could not be written.", exception);
        }

        RendererSmokeExitCode = 70;
        _ = Dispatcher.BeginInvoke(Close);
    }

    private async Task<bool> ExecuteRendererSmokeBooleanAsync(string expression)
    {
        var serialized = await WebView.CoreWebView2.ExecuteScriptAsync($"Boolean({expression});");
        return string.Equals(serialized, "true", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<bool> WaitForRendererSmokeBooleanAsync(
        string expression,
        int maximumAttempts = 40)
    {
        for (var attempt = 0; attempt < maximumAttempts && !_isClosing; attempt++)
        {
            if (await ExecuteRendererSmokeBooleanAsync(expression))
            {
                return true;
            }

            await Task.Delay(50);
        }

        return false;
    }

    private async Task ExecuteRendererSmokeActionAsync(string statement)
    {
        _ = await WebView.CoreWebView2.ExecuteScriptAsync($"{statement}; true;");
    }

}
