using System.Text.Json;
using Jarvis.Host.Agents;
using Jarvis.Host.Infrastructure;
using Jarvis.Host.Localization;
using Jarvis.Host.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using System.Windows.Threading;

namespace Jarvis.Host.Bridge;

internal sealed class WebBridge : IDisposable
{
    private const string TrustedOrigin = "https://jarvis.local/";
    private static readonly HashSet<string> RendererFaultParameterNames =
        new(StringComparer.Ordinal)
        {
            "source",
            "severity",
            "title",
            "detail",
            "actionId"
        };
    private readonly CoreWebView2 _webView;
    private readonly Dispatcher _dispatcher;
    private readonly RuntimeSnapshotFeed _snapshotFeed;
    private readonly SystemDetailsService _systemDetailsService = new();
    private readonly DesktopService _desktopService;
    private readonly ShellService _shellService;
    private readonly FileExplorerService _fileExplorerService;
    private readonly ObsidianGraphService _obsidianGraphService = new();
    private readonly GraphVisualSettingsStore _graphVisualSettings = new();
    private readonly FileTransferCoordinator _fileTransferCoordinator = new();
    private readonly TerminalSessionService _terminalSessionService;
    private readonly WindowTaskbarService _taskbarService;
    private readonly NativeWindowAppearanceService _windowAppearanceService;
    private readonly TaskbarModeService _taskbarModeService;
    private readonly TrayStatusService _trayStatusService;
    private readonly SystemFeedService _systemFeedService;
    private readonly RuntimeDiagnosticsService _runtimeDiagnosticsService;
    private readonly SystemSessionActionService? _systemSessionActionService;
    private readonly AgentCoordinator? _agentCoordinator;
    private readonly WindowsNotificationHistoryService _notificationHistoryService = new();
    private readonly DesktopClipboardService _clipboardService = new();
    private readonly Action _requestExit;
    private readonly Action<string?> _showDesktop;
    private readonly Action<TaskbarFlyoutRequest>? _showTaskbarFlyout;
    private readonly Action? _hideTaskbarFlyout;
    private readonly WebBridgeSurface _surface;
    private readonly WebBridgeRequestGate _requestGate = new();
    private readonly CancellationTokenSource _shutdown = new();
    private readonly PendingTerminalOutputBuffer _pendingTerminalOutput = new();

    private bool _attached;
    private bool _telemetryAttached;
    private bool _disposed;

    public WebBridge(
        CoreWebView2 webView,
        Dispatcher dispatcher,
        RuntimeSnapshotFeed snapshotFeed,
        DesktopService desktopService,
        ShellService shellService,
        FileExplorerService fileExplorerService,
        TerminalSessionService terminalSessionService,
        WindowTaskbarService taskbarService,
        NativeWindowAppearanceService windowAppearanceService,
        TaskbarModeService taskbarModeService,
        TrayStatusService trayStatusService,
        SystemFeedService systemFeedService,
        RuntimeDiagnosticsService runtimeDiagnosticsService,
        Action requestExit,
        Action<string?> showDesktop,
        Action<TaskbarFlyoutRequest>? showTaskbarFlyout = null,
        Action? hideTaskbarFlyout = null,
        SystemSessionActionService? systemSessionActionService = null,
        AgentCoordinator? agentCoordinator = null,
        WebBridgeSurface surface = WebBridgeSurface.Desktop)
    {
        _webView = webView;
        _dispatcher = dispatcher;
        _snapshotFeed = snapshotFeed;
        _desktopService = desktopService;
        _shellService = shellService;
        _fileExplorerService = fileExplorerService;
        _terminalSessionService = terminalSessionService;
        _taskbarService = taskbarService;
        _windowAppearanceService = windowAppearanceService;
        _taskbarModeService = taskbarModeService;
        _trayStatusService = trayStatusService;
        _systemFeedService = systemFeedService;
        _runtimeDiagnosticsService = runtimeDiagnosticsService;
        _systemSessionActionService = systemSessionActionService;
        _agentCoordinator = agentCoordinator;
        _requestExit = requestExit;
        _showDesktop = showDesktop;
        _showTaskbarFlyout = showTaskbarFlyout;
        _hideTaskbarFlyout = hideTaskbarFlyout;
        _surface = surface;
    }

    public void Attach()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_attached)
        {
            return;
        }

        _webView.WebMessageReceived += OnWebMessageReceived;
        if (AllowsEvent("shell.applicationsChanged"))
        {
            _shellService.ApplicationCatalogChanged += OnApplicationCatalogChanged;
        }
        if (AllowsEvent("desktop.entriesChanged"))
        {
            _desktopService.EntriesChanged += OnDesktopEntriesChanged;
        }
        if (AllowsEvent("windowAppearance.changed"))
        {
            _windowAppearanceService.StateChanged += OnWindowAppearanceChanged;
        }
        if (AllowsEvent("taskbarMode.changed"))
        {
            _taskbarModeService.StateChanged += OnTaskbarModeChanged;
        }
        if (AllowsEvent("tray.snapshot"))
        {
            _trayStatusService.SnapshotChanged += OnTraySnapshotChanged;
        }
        if (AllowsEvent("feed.snapshot"))
        {
            _systemFeedService.SnapshotChanged += OnSystemFeedChanged;
        }
        if (AllowsEvent("explorer.transferChanged"))
        {
            _fileTransferCoordinator.TransferChanged += OnFileTransferChanged;
        }
        if (AllowsEvent("knowledgeGraph.changed"))
        {
            _obsidianGraphService.SnapshotChanged += OnKnowledgeGraphChanged;
        }
        if (_agentCoordinator is not null)
        {
            if (AllowsEvent("agent.stateChanged"))
            {
                _agentCoordinator.StateChanged += OnAgentStateChanged;
            }
            if (AllowsEvent("agent.event"))
            {
                _agentCoordinator.EventReceived += OnAgentEventReceived;
            }
        }
        if (AllowsEvent("terminal.output"))
        {
            _terminalSessionService.OutputReceived += OnTerminalOutputReceived;
            _terminalSessionService.SessionExited += OnTerminalSessionExited;
        }
        _attached = true;
    }

    public Task StartTelemetryAsync()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_telemetryAttached)
        {
            _snapshotFeed.SnapshotAvailable += OnSnapshotAvailable;
            _telemetryAttached = true;
            _snapshotFeed.Start();
            _trayStatusService.Start();
            _systemFeedService.Start();
        }

        if (AllowsEvent("windowAppearance.changed"))
        {
            PostEvent("windowAppearance.changed", _windowAppearanceService.GetState());
        }
        if (AllowsEvent("taskbarMode.changed"))
        {
            PostEvent("taskbarMode.changed", _taskbarModeService.GetState());
        }
        if (AllowsEvent("tray.snapshot"))
        {
            PostEvent("tray.snapshot", _trayStatusService.GetSnapshot());
        }
        if (AllowsEvent("feed.snapshot"))
        {
            PostEvent("feed.snapshot", _systemFeedService.GetSnapshot());
        }
        if (AllowsEvent("desktop.entriesChanged"))
        {
            PostEvent("desktop.entriesChanged", _desktopService.ListEntries());
        }
        if (_agentCoordinator is not null && AllowsEvent("agent.stateChanged"))
        {
            PostEvent("agent.stateChanged", _agentCoordinator.GetStateSnapshot());
        }

        return Task.CompletedTask;
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement requestId = default;
        IDisposable? requestLease = null;

        try
        {
            if (!IsTrustedSource(e.Source))
            {
                HostLog.Warning($"Rejected bridge message from untrusted origin: {e.Source}");
                return;
            }

            using var document = WebBridgeRequestPolicy.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                throw new BridgeFaultException("INVALID_REQUEST", "Bridge request must be a JSON object.");
            }

            if (!root.TryGetProperty("id", out var id) ||
                id.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                throw new BridgeFaultException("INVALID_REQUEST", "Bridge request requires a non-null id.");
            }

            requestId = id.Clone();
            if (!root.TryGetProperty("method", out var methodElement) ||
                methodElement.ValueKind != JsonValueKind.String)
            {
                throw new BridgeFaultException("INVALID_REQUEST", "Bridge request requires a method string.");
            }

            var method = methodElement.GetString()!;
            if (!WebBridgeSurfacePolicy.IsKnownMethod(method))
            {
                throw new BridgeFaultException(
                    "METHOD_NOT_FOUND",
                    $"Unknown bridge method: {method}");
            }
            if (!WebBridgeSurfacePolicy.AllowsMethod(_surface, method))
            {
                throw new BridgeFaultException(
                    "METHOD_NOT_AVAILABLE",
                    $"Bridge method {method} is unavailable on the {_surface.ToString().ToLowerInvariant()} surface.");
            }
            if (!_requestGate.TryEnter(out requestLease))
            {
                throw new BridgeFaultException(
                    "TOO_MANY_REQUESTS",
                    "The renderer has too many bridge requests in progress.");
            }

            var parameters = root.TryGetProperty("params", out var paramsElement)
                ? paramsElement.Clone()
                : EmptyObject();
            var result = await DispatchAsync(method, parameters, _shutdown.Token);

            PostSuccess(requestId, result);

            if (method.Equals("lifecycle.exitToWindows", StringComparison.Ordinal))
            {
                await Task.Delay(80);
                _requestExit();
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // Host shutdown intentionally cancels in-flight bridge work.
        }
        catch (BridgeFaultException ex)
        {
            PostFailure(requestId, ex.Code, ex.Message);
        }
        catch (JsonException ex)
        {
            PostFailure(requestId, "INVALID_JSON", ex.Message);
        }
        catch (Exception ex)
        {
            HostLog.Error("Bridge request failed.", ex);
            PostFailure(requestId, "HOST_ERROR", "The native host could not complete the request.");
        }
        finally
        {
            requestLease?.Dispose();
        }
    }

    private async Task<object> DispatchAsync(
        string method,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        if (method.StartsWith("agent.", StringComparison.Ordinal))
        {
            return await DispatchAgentAsync(method, parameters, cancellationToken);
        }

        return method switch
        {
            "graphVisual.read" => await Task.Run(() => (object)_graphVisualSettings.Read(), cancellationToken),
            "graphVisual.write" => await Task.Run(() => (object)_graphVisualSettings.Write(
                parameters.GetProperty("settings"), parameters.GetProperty("revision").GetString()), cancellationToken),
            "system.getSnapshot" => await Task.Run(
                () => (object)_snapshotFeed.GetSystemSnapshot(),
                cancellationToken),
            "system.getDetails" => await Task.Run(
                () => (object)_systemDetailsService.Capture(),
                cancellationToken),
            "desktop.listEntries" => await Task.Run(
                () => (object)_desktopService.ListEntries(),
                cancellationToken),
            "display.getTopology" => await Task.Run(
                () => (object)NativeDisplay.CaptureTopology(),
                cancellationToken),
            "clipboard.read" => _clipboardService.Read(),
            "clipboard.write" => _clipboardService.Write(
                GetRequiredPaths(parameters),
                GetRequiredString(parameters, "mode")),
            "clipboard.clear" => _clipboardService.Clear(),
            "explorer.browse" => await Task.Run(
                () => (object)_fileExplorerService.Browse(GetOptionalPath(parameters)),
                cancellationToken),
            "knowledgeGraph.getDefaultSource" => await Task.Run(
                () => (object)_obsidianGraphService.GetDefaultSource(cancellationToken),
                cancellationToken),
            "knowledgeGraph.getDefaultManifest" => await Task.Run(
                () => (object)(GetOptionalBoolean(parameters, "force", defaultValue: false)
                    ? _obsidianGraphService.RefreshDefaultManifest(cancellationToken)
                    : _obsidianGraphService.GetDefaultManifest(cancellationToken)),
                cancellationToken),
            "knowledgeGraph.getDefaultChunk" => await Task.Run(
                () => GetKnowledgeGraphChunk(parameters, cancellationToken),
                cancellationToken),
            "knowledgeGraph.chooseVault" => await ChooseKnowledgeGraphVaultAsync(
                parameters,
                cancellationToken),
            "explorer.openFile" => _fileExplorerService.OpenFile(GetRequiredPath(parameters)),
            "explorer.openInWindows" => _fileExplorerService.OpenInWindows(GetRequiredPath(parameters)),
            "explorer.showProperties" => _fileExplorerService.ShowProperties(GetRequiredPath(parameters)),
            "explorer.createFolder" => await RunFileOperationAsync(
                "create-folder",
                () => (object)_fileExplorerService.CreateFolder(
                    GetRequiredPath(parameters),
                    GetRequiredString(parameters, "name")),
                cancellationToken),
            "explorer.rename" => await RunFileOperationAsync(
                "rename",
                () => (object)_fileExplorerService.Rename(
                    GetRequiredPath(parameters),
                    GetRequiredString(parameters, "name")),
                cancellationToken),
            "explorer.preflightTransfer" => await Task.Run(
                () => (object)_fileTransferCoordinator.Preflight(
                    GetRequiredPaths(parameters),
                    GetRequiredString(parameters, "destinationPath"),
                    GetRequiredString(parameters, "mode")),
                cancellationToken),
            "explorer.startTransfer" => _fileTransferCoordinator.Start(
                GetRequiredPaths(parameters),
                GetRequiredString(parameters, "destinationPath"),
                GetRequiredString(parameters, "mode"),
                GetRequiredString(parameters, "conflictPolicy")),
            "explorer.cancelTransfer" => _fileTransferCoordinator.Cancel(
                GetRequiredString(parameters, "jobId")),
            "explorer.getTransfers" => _fileTransferCoordinator.GetTransfers(),
            "explorer.recycle" => await RunFileOperationAsync(
                "recycle",
                () => (object)_fileExplorerService.Recycle(GetRequiredPaths(parameters)),
                cancellationToken),
            "terminal.listProfiles" => _terminalSessionService.ListProfiles(),
            "terminal.create" => await Task.Run(
                () => (object)_terminalSessionService.Create(
                    GetOptionalTerminalProfile(parameters),
                    GetRequiredBoundedInt(parameters, "columns", 20, 400),
                    GetRequiredBoundedInt(parameters, "rows", 5, 200)),
                cancellationToken),
            "terminal.write" => await _terminalSessionService.WriteAsync(
                GetRequiredTerminalSessionId(parameters),
                GetRequiredTerminalData(parameters),
                cancellationToken),
            "terminal.resize" => _terminalSessionService.Resize(
                GetRequiredTerminalSessionId(parameters),
                GetRequiredBoundedInt(parameters, "columns", 20, 400),
                GetRequiredBoundedInt(parameters, "rows", 5, 200)),
            "terminal.close" => _terminalSessionService.Close(
                GetRequiredTerminalSessionId(parameters)),
            "taskbar.getSnapshot" => await Task.Run(
                () => (object)_snapshotFeed.GetTaskbarSnapshot(),
                cancellationToken),
            "taskbar.activateWindow" => _taskbarService.Activate(GetRequiredWindowId(parameters)),
            "taskbar.toggleWindow" => _taskbarService.Toggle(GetRequiredWindowId(parameters)),
            "taskbar.closeWindow" => _taskbarService.Close(GetRequiredWindowId(parameters)),
            "taskbar.toggleDesktop" => ToggleDesktop(
                GetOptionalBoolean(
                    parameters,
                    "hasVisibleInternalWindow",
                    defaultValue: false)),
            "taskbar.showFlyout" => ShowTaskbarFlyout(GetFlyoutRequest(parameters)),
            "taskbar.hideFlyout" => HideTaskbarFlyout(),
            "taskbarMode.getState" => _taskbarModeService.GetState(),
            "taskbarMode.setMode" => _taskbarModeService.SetRequestedMode(
                GetRequiredTaskbarMode(parameters)),
            "taskbarMode.retry" => RetryTaskbarMode(),
            "tray.getSnapshot" => _trayStatusService.GetSnapshot(),
            "tray.setVolume" => _trayStatusService.SetVolume(
                GetRequiredBoundedInt(parameters, "volumePercent", 0, 100)),
            "tray.setMuted" => _trayStatusService.SetMuted(
                GetRequiredBoolean(parameters, "muted")),
            "feed.getSnapshot" => _systemFeedService.GetSnapshot(),
            "feed.markAllRead" => _systemFeedService.MarkAllRead(),
            "feed.clear" => _systemFeedService.Clear(),
            "feed.reportFault" => ReportRendererFault(parameters),
            "notifications.getState" => _notificationHistoryService.GetState(),
            "notifications.requestAccess" => _notificationHistoryService.RequestAccess(),
            "session.getState" => GetSystemSessionActionService().GetState(),
            "session.prepare" => GetSystemSessionActionService().Prepare(
                GetRequiredString(parameters, "actionId")),
            "session.commit" => GetSystemSessionActionService().Commit(
                GetRequiredString(parameters, "actionId"),
                GetRequiredString(parameters, "token")),
            "session.cancel" => GetSystemSessionActionService().Cancel(),
            "windowAppearance.getState" => _windowAppearanceService.GetState(),
            "windowAppearance.setMode" => _windowAppearanceService.SetMode(
                GetRequiredWindowAppearanceMode(parameters)),
            "windowAppearance.setRule" => SetWindowAppearanceRule(parameters),
            "windowAppearance.removeRule" => RemoveWindowAppearanceRule(parameters),
            "shell.listApplications" => await Task.Run(
                () => (object)_shellService.ListApplications(),
                cancellationToken),
            "shell.refreshApplications" => await Task.Run(
                () => (object)_shellService.RefreshApplications(),
                cancellationToken),
            "shell.openApplication" => _shellService.OpenApplication(
                GetRequiredString(parameters, "applicationId")),
            "shell.open" => _shellService.Open(GetRequiredTarget(parameters)),
            "lifecycle.getRuntimeInfo" => await Task.Run(
                () => (object)_runtimeDiagnosticsService.CaptureRuntimeInfo(),
                cancellationToken),
            "lifecycle.setStartupEnabled" => await Task.Run(
                () => (object)_runtimeDiagnosticsService.SetStartupEnabled(
                    GetRequiredBoolean(parameters, "enabled")),
                cancellationToken),
            "lifecycle.runDiagnostics" => await RunDiagnosticsAsync(cancellationToken),
            "lifecycle.exitToWindows" => new { exiting = true },
            "lifecycle.showDesktop" => ShowDesktop(GetRequestedPanel(parameters)),
            _ => throw new BridgeFaultException("METHOD_NOT_FOUND", $"Unknown bridge method: {method}")
        };
    }

    private async Task<object> DispatchAgentAsync(
        string method,
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        if (_agentCoordinator is null)
        {
            throw new BridgeFaultException(
                "METHOD_NOT_AVAILABLE",
                "Agent commands are available only on the JARVIS desktop surface.");
        }

        return method switch
        {
            "agent.getState" => await _agentCoordinator.GetStateAsync(cancellationToken),
            "agent.getMessages" => await _agentCoordinator.GetMessagesAsync(cancellationToken),
            "agent.prompt" => await _agentCoordinator.PromptAsync(
                GetRequiredAgentMessage(parameters),
                GetRequiredClientMessageId(parameters),
                cancellationToken),
            "agent.abort" => await _agentCoordinator.AbortAsync(cancellationToken),
            "agent.newSession" => await _agentCoordinator.NewSessionAsync(cancellationToken),
            _ => throw new BridgeFaultException(
                "METHOD_NOT_FOUND",
                $"Unknown bridge method: {method}")
        };
    }

    private async Task<object> RunFileOperationAsync(
        string operation,
        Func<object> run,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await Task.Run(run, cancellationToken);
            _systemFeedService.Add(
                $"explorer.{operation}.completed",
                "ok",
                "File operation completed",
                $"JARVIS File Explorer completed {operation}.",
                actionId: null,
                deduplicationKey: $"explorer:{operation}:completed");
            return result;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _systemFeedService.Add(
                $"explorer.{operation}.failed",
                "error",
                "File operation failed",
                $"JARVIS File Explorer could not complete {operation}.",
                actionId: null,
                deduplicationKey: $"explorer:{operation}:failed");
            throw;
        }
    }

    private async Task<object> RunDiagnosticsAsync(CancellationToken cancellationToken)
    {
        var result = await Task.Run(
            _runtimeDiagnosticsService.RunDiagnostics,
            cancellationToken);
        if (!string.Equals(result.OverallStatus, "READY", StringComparison.Ordinal))
        {
            _systemFeedService.Add(
                "diagnostics.attention",
                "warning",
                "Runtime diagnostics need attention",
                $"Diagnostics completed with status {result.OverallStatus}.",
                "open-runtime-settings",
                $"diagnostics:{result.OverallStatus}");
        }

        return result;
    }

    private object ShowDesktop(string? panel)
    {
        _showDesktop(panel);
        return new { shown = true, panel };
    }

    private ShowDesktopToggleResult ToggleDesktop(bool hasVisibleInternalWindow)
    {
        _hideTaskbarFlyout?.Invoke();
        var result = _taskbarService.ToggleDesktop(hasVisibleInternalWindow);
        if (result.Action == "shown" ||
            result.RestoreJarvisForeground)
        {
            _showDesktop(null);
        }

        HostLog.Info(
            $"Show Desktop action {result.Action}; " +
            $"{result.AffectedWindowCount} native window(s) affected; " +
            $"restore available: {result.RestoreAvailable}.");
        return result;
    }

    private object ShowTaskbarFlyout(TaskbarFlyoutRequest request)
    {
        if (_showTaskbarFlyout is null)
        {
            throw new BridgeFaultException(
                "METHOD_NOT_AVAILABLE",
                "Taskbar flyouts are only available on the native taskbar surface.");
        }

        _showTaskbarFlyout(request);
        return new { shown = true, request.Mode, count = GetTaskbarFlyoutItemCount(request) };
    }

    internal static int GetTaskbarFlyoutItemCount(TaskbarFlyoutRequest request) =>
        request.Mode == "overflow" && request.OverflowItems.Count > 0
            ? request.OverflowItems.Count
            : request.WindowIds.Count;

    private object HideTaskbarFlyout()
    {
        _hideTaskbarFlyout?.Invoke();
        return new { hidden = true };
    }

    private object GetKnowledgeGraphChunk(
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        var request = GetKnowledgeGraphChunkRequest(parameters);
        try
        {
            return _obsidianGraphService.GetDefaultChunk(
                request.Revision,
                request.NodeOffset,
                request.NodeLimit,
                request.EdgeOffset,
                request.EdgeLimit,
                cancellationToken);
        }
        catch (ObsidianGraphRevisionMismatchException exception)
        {
            throw new BridgeFaultException("GRAPH_REVISION_STALE", exception.Message);
        }
        catch (ArgumentException exception)
        {
            throw new BridgeFaultException("INVALID_PARAMS", exception.Message);
        }
    }

    private async Task<object> ChooseKnowledgeGraphVaultAsync(
        JsonElement parameters,
        CancellationToken cancellationToken)
    {
        RequireEmptyParameters(parameters, "knowledgeGraph.chooseVault");
        cancellationToken.ThrowIfCancellationRequested();
        var dialog = new OpenFolderDialog
        {
            Title = HostUiTextCatalog.GetObsidianVaultPickerTitle(),
            Multiselect = false
        };

        if (dialog.ShowDialog() is not true)
        {
            return new ObsidianVaultSelectionResult(
                Canceled: true,
                Manifest: _obsidianGraphService.GetDefaultManifest(cancellationToken));
        }

        try
        {
            var selectedFolder = dialog.FolderName;
            var manifest = await Task.Run(
                () => _obsidianGraphService.ConfigureVault(selectedFolder, cancellationToken),
                cancellationToken);
            return new ObsidianVaultSelectionResult(
                Canceled: false,
                Manifest: manifest);
        }
        catch (ArgumentException exception)
        {
            throw new BridgeFaultException("INVALID_VAULT", exception.Message);
        }
    }

    internal static ObsidianGraphChunkRequest GetKnowledgeGraphChunkRequest(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "knowledgeGraph.getDefaultChunk requires a params object.");
        }

        var allowedNames = new HashSet<string>(StringComparer.Ordinal)
        {
            "revision",
            "nodeOffset",
            "nodeLimit",
            "edgeOffset",
            "edgeLimit"
        };
        foreach (var property in parameters.EnumerateObject())
        {
            if (!allowedNames.Contains(property.Name))
            {
                throw new BridgeFaultException(
                    "INVALID_PARAMS",
                    $"knowledgeGraph.getDefaultChunk does not accept params.{property.Name}.");
            }
        }

        return new ObsidianGraphChunkRequest(
            GetRequiredGraphRevision(parameters),
            GetRequiredBoundedInt(parameters, "nodeOffset", 0, ObsidianGraphService.MaximumNodeCount),
            GetRequiredBoundedInt(parameters, "nodeLimit", 0, ObsidianGraphService.MaximumNodeChunkSize),
            GetRequiredBoundedInt(parameters, "edgeOffset", 0, ObsidianGraphService.MaximumEdgeCount),
            GetRequiredBoundedInt(parameters, "edgeLimit", 0, ObsidianGraphService.MaximumEdgeChunkSize));
    }

    private static string GetRequiredGraphRevision(JsonElement parameters)
    {
        if (!parameters.TryGetProperty("revision", out var revisionElement) ||
            revisionElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "knowledgeGraph.getDefaultChunk requires string params.revision.");
        }

        var revision = revisionElement.GetString();
        if (string.IsNullOrWhiteSpace(revision) ||
            revision.Length > 128 ||
            revision.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_')))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "knowledgeGraph.getDefaultChunk params.revision is malformed.");
        }

        return revision;
    }

    private static void RequireEmptyParameters(JsonElement parameters, string method)
    {
        if (parameters.ValueKind != JsonValueKind.Object || parameters.EnumerateObject().Any())
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"{method} does not accept renderer-supplied parameters.");
        }
    }

    private void OnKnowledgeGraphChanged(object? sender, ObsidianGraphManifest manifest)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("knowledgeGraph.changed", manifest);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final graph update.
        }
    }

    private void OnSnapshotAvailable(RuntimeTelemetrySnapshot snapshot)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        if (snapshot.SystemChanged && AllowsEvent("system.snapshot"))
                        {
                            PostEvent("system.snapshot", snapshot.System);
                        }

                        if (snapshot.TaskbarChanged && AllowsEvent("taskbar.snapshot"))
                        {
                            PostEvent("taskbar.snapshot", snapshot.Taskbar);
                        }
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing window can reject the final shared telemetry dispatch.
        }
    }

    private void OnWindowAppearanceChanged(NativeWindowAppearanceState state)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(state.FallbackReason))
        {
            _systemFeedService.Add(
                "window-appearance.fallback",
                "warning",
                "Window appearance mode fell back",
                state.FallbackReason,
                "open-runtime-settings",
                $"window-appearance:{state.EffectiveMode}:{state.FallbackReason}");
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("windowAppearance.changed", state);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final appearance-state update.
        }
    }

    private void OnTaskbarModeChanged(TaskbarModeState state)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("taskbarMode.changed", state);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final taskbar-mode update.
        }
    }

    private void OnTraySnapshotChanged(TrayStatusSnapshot snapshot)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("tray.snapshot", snapshot);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final tray-state update.
        }
    }

    private void OnSystemFeedChanged(SystemFeedSnapshot snapshot)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("feed.snapshot", snapshot);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final system-feed update.
        }
    }

    public void PublishDisplayTopology()
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        var topology = NativeDisplay.CaptureTopology();
        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("display.changed", topology);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final display-topology update.
        }
    }

    public void PublishExternalFileDrop(IReadOnlyList<string> paths, double clientX, double clientY)
    {
        if (_disposed || _shutdown.IsCancellationRequested || paths.Count == 0)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent(
                            "desktop.externalDrop",
                            new { paths, source = "windows", clientX, clientY });
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final external-drop event.
        }
    }

    private void OnApplicationCatalogChanged(
        object? sender,
        StartMenuApplicationCatalog catalog)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("shell.applicationsChanged", catalog);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final application-catalog update.
        }
    }

    private void OnDesktopEntriesChanged(object? sender, DesktopEntriesResult snapshot)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("desktop.entriesChanged", snapshot);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final desktop watcher update.
        }
    }

    private void OnFileTransferChanged(object? sender, ExplorerTransferSnapshot snapshot)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        if (snapshot.Status is "completed" or "completed-with-errors" or "cancelled" or "failed")
        {
            var severity = snapshot.Status switch
            {
                "completed" => "ok",
                "cancelled" => "warning",
                _ => "error"
            };
            var detail = snapshot.Status switch
            {
                "completed" => $"{snapshot.CompletedItems} item(s) transferred.",
                "cancelled" => "The transfer was cancelled and partial output was cleaned up.",
                _ => $"{snapshot.CompletedItems} completed, {snapshot.FailedItems} failed, {snapshot.SkippedItems} skipped."
            };
            _systemFeedService.Add(
                $"explorer.transfer.{snapshot.Status}",
                severity,
                $"File transfer {snapshot.Status.Replace('-', ' ')}",
                detail,
                actionId: null,
                deduplicationKey: $"explorer:transfer:{snapshot.JobId}:{snapshot.Status}");
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent("explorer.transferChanged", snapshot);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final transfer update.
        }
    }

    private void OnAgentStateChanged(AgentStateSnapshot state)
    {
        PostAgentEvent("agent.stateChanged", state);
    }

    private void OnAgentEventReceived(AgentUiEvent value)
    {
        PostAgentEvent("agent.event", value);
    }

    private void PostAgentEvent(string eventName, object data)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    if (!_disposed)
                    {
                        PostEvent(eventName, data);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing desktop renderer can reject its final agent event.
        }
    }

    private void OnTerminalOutputReceived(TerminalOutputChunk chunk)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        if (_pendingTerminalOutput.Enqueue(chunk))
        {
            _ = ScheduleTerminalOutputFlushAsync();
        }
    }

    private async Task ScheduleTerminalOutputFlushAsync()
    {
        try
        {
            await Task.Delay(12, _shutdown.Token).ConfigureAwait(false);
            _ = _dispatcher.BeginInvoke(
                FlushTerminalOutput,
                DispatcherPriority.Background);
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // Closing the bridge cancels a pending output batch.
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject its final output batch.
        }
    }

    private void OnTerminalSessionExited(TerminalSessionExit exit)
    {
        if (_disposed || _shutdown.IsCancellationRequested)
        {
            return;
        }

        try
        {
            if (exit.ExitCode is not (null or 0))
            {
                _systemFeedService.Add(
                    "terminal.exited",
                    "warning",
                    "Terminal session ended unexpectedly",
                    $"The terminal process exited with code {exit.ExitCode}.",
                    actionId: null,
                    deduplicationKey: $"terminal:exit:{exit.ExitCode}");
            }
            _ = _dispatcher.BeginInvoke(
                () =>
                {
                    FlushTerminalOutput();
                    if (!_disposed)
                    {
                        PostEvent("terminal.exited", exit);
                    }
                },
                DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // A closing renderer can reject the final terminal exit event.
        }
    }

    private void FlushTerminalOutput()
    {
        var chunks = _pendingTerminalOutput.Drain();

        if (_disposed)
        {
            return;
        }

        foreach (var chunk in chunks)
        {
            PostEvent("terminal.output", chunk);
        }
    }

    private static string GetRequiredTarget(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("target", out var targetElement) ||
            targetElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(targetElement.GetString()))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "shell.open requires a non-empty params.target string.");
        }

        return targetElement.GetString()!;
    }

    private SystemSessionActionService GetSystemSessionActionService() =>
        _systemSessionActionService ?? throw new BridgeFaultException(
            "METHOD_NOT_AVAILABLE",
            "Windows session actions are available only on the JARVIS desktop surface.");

    private static string GetRequiredPath(JsonElement parameters)
    {
        var path = GetOptionalPath(parameters);
        if (string.IsNullOrWhiteSpace(path))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "The explorer request requires a non-empty params.path string.");
        }

        return path;
    }

    private static string? GetOptionalPath(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("path", out var pathElement) ||
            pathElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        if (pathElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "The explorer path must be a string or null.");
        }

        return pathElement.GetString();
    }

    private static string GetRequiredString(JsonElement parameters, string name)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var valueElement) ||
            valueElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(valueElement.GetString()))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"The explorer request requires a non-empty params.{name} string.");
        }

        return valueElement.GetString()!;
    }

    private object ReportRendererFault(JsonElement parameters)
    {
        var report = GetRendererFaultReport(parameters);
        try
        {
            return _systemFeedService.ReportRendererFault(report);
        }
        catch (ArgumentException exception)
        {
            throw new BridgeFaultException("INVALID_PARAMS", exception.Message);
        }
    }

    internal static RendererFaultReport GetRendererFaultReport(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "feed.reportFault requires a params object.");
        }

        foreach (var property in parameters.EnumerateObject())
        {
            if (!RendererFaultParameterNames.Contains(property.Name))
            {
                throw new BridgeFaultException(
                    "INVALID_PARAMS",
                    $"feed.reportFault does not accept params.{property.Name}.");
            }
        }

        return new RendererFaultReport(
            GetRequiredRendererFaultString(parameters, "source"),
            GetRequiredRendererFaultString(parameters, "severity"),
            GetRequiredRendererFaultString(parameters, "title"),
            GetOptionalRendererFaultString(parameters, "detail"),
            GetOptionalRendererFaultString(parameters, "actionId"));
    }

    private static string GetRequiredRendererFaultString(JsonElement parameters, string name)
    {
        if (!parameters.TryGetProperty(name, out var valueElement) ||
            valueElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(valueElement.GetString()))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"feed.reportFault requires a non-empty params.{name} string.");
        }

        return valueElement.GetString()!;
    }

    private static string? GetOptionalRendererFaultString(JsonElement parameters, string name)
    {
        if (!parameters.TryGetProperty(name, out var valueElement) ||
            valueElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        if (valueElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"feed.reportFault params.{name} must be a string or null.");
        }

        return valueElement.GetString();
    }

    private static string GetRequiredAgentMessage(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("message", out var messageElement) ||
            messageElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(messageElement.GetString()))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "agent.prompt requires a non-empty params.message string.");
        }

        var message = messageElement.GetString()!;
        if (message.Length > 16_384 || message.Contains('\0'))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "agent.prompt params.message exceeds the chat-only input limit.");
        }

        return message;
    }

    private static string GetRequiredClientMessageId(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("clientMessageId", out var idElement) ||
            idElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "agent.prompt requires params.clientMessageId.");
        }

        var clientMessageId = idElement.GetString()?.Trim();
        if (string.IsNullOrWhiteSpace(clientMessageId) ||
            clientMessageId.Length > 128 ||
            clientMessageId.Any(character =>
                !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.' or ':')))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "agent.prompt params.clientMessageId is malformed.");
        }

        return clientMessageId;
    }

    private static string? GetOptionalTerminalProfile(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("profileId", out var profileElement) ||
            profileElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        if (profileElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "terminal.create params.profileId must be a string or null.");
        }

        var profileId = profileElement.GetString()?.Trim();
        if (profileId is not ("powershell" or "cmd" or "wsl"))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "terminal.create accepts powershell, cmd, or wsl profiles.");
        }

        return profileId;
    }

    private static string GetRequiredTerminalSessionId(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("sessionId", out var sessionElement) ||
            sessionElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "The terminal request requires params.sessionId.");
        }

        var sessionId = sessionElement.GetString();
        if (sessionId is null ||
            sessionId.Length != 32 ||
            !sessionId.All(character => char.IsAsciiHexDigit(character)))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "The terminal session identifier is invalid.");
        }

        return sessionId;
    }

    private static string GetRequiredTerminalData(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("data", out var dataElement) ||
            dataElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "terminal.write requires string params.data.");
        }

        var data = dataElement.GetString() ?? string.Empty;
        if (data.Length > 65_536)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "terminal.write accepts at most 65536 characters per request.");
        }

        return data;
    }

    private static int GetRequiredBoundedInt(
        JsonElement parameters,
        string name,
        int minimum,
        int maximum)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var valueElement) ||
            valueElement.ValueKind != JsonValueKind.Number ||
            !valueElement.TryGetInt32(out var value) ||
            value < minimum ||
            value > maximum)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"Bridge request requires integer params.{name} between {minimum} and {maximum}.");
        }

        return value;
    }

    private static IReadOnlyList<string> GetRequiredPaths(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("paths", out var pathsElement) ||
            pathsElement.ValueKind != JsonValueKind.Array)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "The explorer request requires a params.paths array.");
        }

        var paths = pathsElement
            .EnumerateArray()
            .Where(element => element.ValueKind == JsonValueKind.String)
            .Select(element => element.GetString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(129)
            .ToArray();
        if (paths.Length == 0)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "The explorer request requires at least one valid path.");
        }

        return paths;
    }

    private static string GetRequiredWindowId(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("windowId", out var windowIdElement) ||
            windowIdElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(windowIdElement.GetString()))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbar.toggleWindow requires a non-empty params.windowId string.");
        }

        return windowIdElement.GetString()!;
    }

    internal static TaskbarFlyoutRequest GetFlyoutRequest(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("mode", out var modeElement) ||
            modeElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbar.showFlyout requires params.mode.");
        }

        var mode = modeElement.GetString();
        if (mode is not ("windows" or "overflow" or "context"))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbar.showFlyout mode must be windows, overflow, or context.");
        }

        if (!parameters.TryGetProperty("windowIds", out var windowIdsElement) ||
            windowIdsElement.ValueKind != JsonValueKind.Array)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbar.showFlyout requires params.windowIds.");
        }

        var windowIds = windowIdsElement
            .EnumerateArray()
            .Where(element => element.ValueKind == JsonValueKind.String)
            .Select(element => element.GetString())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(24)
            .ToArray();

        IReadOnlyList<TaskbarOverflowItem> overflowItems = Array.Empty<TaskbarOverflowItem>();
        if (mode == "overflow" && parameters.TryGetProperty("items", out var itemsElement))
        {
            if (itemsElement.ValueKind != JsonValueKind.Array)
            {
                throw new BridgeFaultException(
                    "INVALID_PARAMS",
                    "taskbar.showFlyout params.items must be an array.");
            }

            var requestedItems = itemsElement.EnumerateArray().ToArray();
            if (requestedItems.Length > 24)
            {
                throw new BridgeFaultException(
                    "INVALID_PARAMS",
                    "taskbar.showFlyout accepts at most 24 overflow items.");
            }

            var parsedItems = requestedItems
                .Select(ParseTaskbarOverflowItem)
                .GroupBy(
                    item => $"{item.ItemId}\u001f{item.WindowId ?? string.Empty}",
                    StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToArray();
            overflowItems = parsedItems;
        }

        if (windowIds.Length == 0 &&
            mode != "context" &&
            (mode != "overflow" || overflowItems.Count == 0))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbar.showFlyout requires at least one valid window or overflow item.");
        }

        var anchorX = GetRequiredFiniteNumber(parameters, "anchorX");
        var viewportWidth = GetRequiredFiniteNumber(parameters, "viewportWidth");
        if (viewportWidth <= 0 || anchorX < 0 || anchorX > viewportWidth)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbar.showFlyout received an invalid anchor position.");
        }

        string? itemId = null;
        string? label = null;
        IReadOnlyList<string> actions = Array.Empty<string>();
        if (mode == "context")
        {
            itemId = GetRequiredTaskbarContextText(parameters, "itemId", 256);
            label = GetRequiredTaskbarContextText(parameters, "label", 128);
            if (!parameters.TryGetProperty("actions", out var actionsElement) ||
                actionsElement.ValueKind != JsonValueKind.Array)
            {
                throw new BridgeFaultException(
                    "INVALID_PARAMS",
                    "Taskbar context menus require params.actions.");
            }

            var requestedActions = actionsElement.EnumerateArray().ToArray();
            if (requestedActions.Length is < 1 or > 3 ||
                requestedActions.Any(element =>
                    element.ValueKind != JsonValueKind.String ||
                    element.GetString() is not ("launch" or "close" or "unpin")))
            {
                throw new BridgeFaultException(
                    "INVALID_PARAMS",
                    "Taskbar context actions must contain one to three supported action identifiers.");
            }

            actions = requestedActions
                .Select(element => element.GetString()!)
                .Distinct(StringComparer.Ordinal)
                .ToArray();
        }

        return new TaskbarFlyoutRequest(
            mode,
            windowIds,
            overflowItems,
            anchorX,
            viewportWidth,
            itemId,
            label,
            actions);
    }

    private static TaskbarOverflowItem ParseTaskbarOverflowItem(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object ||
            item.EnumerateObject().Any(property =>
                property.Name is not ("itemId" or "label" or "meta" or "windowId")))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "Taskbar overflow items must contain only itemId, label, meta, and windowId.");
        }

        var itemId = GetRequiredTaskbarOverflowText(item, "itemId", 256);
        var label = GetRequiredTaskbarOverflowText(item, "label", 128);
        var meta = GetRequiredTaskbarOverflowText(item, "meta", 96);
        string? windowId = null;
        if (item.TryGetProperty("windowId", out var windowIdElement) &&
            windowIdElement.ValueKind != JsonValueKind.Null)
        {
            windowId = GetRequiredTaskbarOverflowText(item, "windowId", 256);
        }

        return new TaskbarOverflowItem(itemId, label, meta, windowId);
    }

    private static string GetRequiredTaskbarOverflowText(
        JsonElement item,
        string name,
        int maximumLength)
    {
        if (!item.TryGetProperty(name, out var valueElement) ||
            valueElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(valueElement.GetString()))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"Taskbar overflow items require a non-empty {name} string.");
        }

        var value = valueElement.GetString()!.Trim();
        if (value.Length > maximumLength || value.Any(char.IsControl))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"Taskbar overflow item {name} is malformed.");
        }

        return value;
    }

    private static string GetRequiredTaskbarContextText(
        JsonElement parameters,
        string name,
        int maximumLength)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var valueElement) ||
            valueElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(valueElement.GetString()))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"Taskbar context menus require a non-empty params.{name} string.");
        }

        var value = valueElement.GetString()!.Trim();
        if (value.Length > maximumLength || value.Any(char.IsControl))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"Taskbar context params.{name} is malformed.");
        }

        return value;
    }

    private static double GetRequiredFiniteNumber(JsonElement parameters, string name)
    {
        if (!parameters.TryGetProperty(name, out var value) ||
            value.ValueKind != JsonValueKind.Number ||
            !value.TryGetDouble(out var number) ||
            !double.IsFinite(number))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"taskbar.showFlyout requires a finite params.{name} number.");
        }

        return number;
    }

    private static bool GetRequiredBoolean(JsonElement parameters, string name)
    {
        if (!parameters.TryGetProperty(name, out var value) ||
            value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"Bridge request requires a boolean params.{name} value.");
        }

        return value.GetBoolean();
    }

    private static bool GetOptionalBoolean(
        JsonElement parameters,
        string name,
        bool defaultValue)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var value))
        {
            return defaultValue;
        }

        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                $"Bridge request params.{name} must be a boolean when provided.");
        }

        return value.GetBoolean();
    }

    private static string GetRequiredWindowAppearanceMode(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("mode", out var modeElement) ||
            modeElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "windowAppearance.setMode requires params.mode.");
        }

        var mode = modeElement.GetString();
        if (mode is null ||
            !new[] { "off", "conservative", "enhanced", "immersive" }
                .Contains(mode, StringComparer.OrdinalIgnoreCase))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "windowAppearance.setMode accepts off, conservative, enhanced, or immersive.");
        }

        return mode;
    }

    private object SetWindowAppearanceRule(JsonElement parameters)
    {
        var processName = GetRequiredWindowAppearanceProcessName(parameters);
        if (!parameters.TryGetProperty("action", out var actionElement) ||
            actionElement.ValueKind != JsonValueKind.String ||
            !NativeWindowAppearanceRuleSet.TryParseAction(actionElement.GetString(), out _))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "windowAppearance.setRule requires params.action set to allow or deny.");
        }

        try
        {
            return _windowAppearanceService.SetRule(processName, actionElement.GetString()!);
        }
        catch (ArgumentException exception)
        {
            throw new BridgeFaultException("INVALID_PARAMS", exception.Message);
        }
    }

    private object RemoveWindowAppearanceRule(JsonElement parameters)
    {
        var processName = GetRequiredWindowAppearanceProcessName(parameters);
        try
        {
            return _windowAppearanceService.RemoveRule(processName);
        }
        catch (ArgumentException exception)
        {
            throw new BridgeFaultException("INVALID_PARAMS", exception.Message);
        }
    }

    private static string GetRequiredWindowAppearanceProcessName(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("processName", out var processNameElement) ||
            processNameElement.ValueKind != JsonValueKind.String ||
            !NativeWindowAppearanceRuleSet.TryNormalizeProcessName(
                processNameElement.GetString(),
                out var processName))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "Window appearance rules require a process filename without a path.");
        }

        return processName;
    }

    private static string GetRequiredTaskbarMode(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("mode", out var modeElement) ||
            modeElement.ValueKind != JsonValueKind.String)
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbarMode.setMode requires params.mode.");
        }

        var mode = modeElement.GetString();
        if (!TaskbarModeService.TryParseMode(mode, out _))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "taskbarMode.setMode accepts native, hybrid, or full.");
        }

        return mode!;
    }

    private TaskbarModeState RetryTaskbarMode()
    {
        try
        {
            return _taskbarModeService.RequestRetry();
        }
        catch (InvalidOperationException ex)
        {
            throw new BridgeFaultException(
                "TASKBAR_RETRY_BLOCKED",
                ex.Message);
        }
    }

    internal static string? GetRequestedPanel(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (parameters.TryGetProperty("panel", out var panelElement) &&
            panelElement.ValueKind == JsonValueKind.String)
        {
            var panel = panelElement.GetString();
            if (panel is "command" or "start" or "quick-settings" or "date-time" or "notifications" or "session" or "explorer" or "settings" or "terminal" or "help")
            {
                return panel;
            }

            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "lifecycle.showDesktop received an unsupported panel name.");
        }

        return parameters.TryGetProperty("openCommand", out var legacyValue) &&
               legacyValue.ValueKind == JsonValueKind.True
            ? "command"
            : null;
    }

    private static bool IsTrustedSource(string? source)
    {
        return Uri.TryCreate(source, UriKind.Absolute, out var uri) &&
               uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
               uri.Host.Equals("jarvis.local", StringComparison.OrdinalIgnoreCase) &&
               uri.AbsoluteUri.StartsWith(TrustedOrigin, StringComparison.OrdinalIgnoreCase);
    }

    private bool AllowsEvent(string eventName) =>
        WebBridgeSurfacePolicy.AllowsEvent(_surface, eventName);

    private static JsonElement EmptyObject()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }

    private void PostFailure(JsonElement requestId, string code, string message)
    {
        try
        {
            var payload = requestId.ValueKind is JsonValueKind.Undefined
                ? new { id = (object?)null, ok = false, error = new { code, message } }
                : (object)new { id = requestId, ok = false, error = new { code, message } };

            _ = PostBounded(
                payload,
                WebBridgePayloadPolicy.MaximumResponseBytes,
                "bridge failure");
        }
        catch (Exception exception) when (!WebBridgeMessageDelivery.IsFatal(exception))
        {
            // A failure response is a best-effort notification. It must never
            // escape into an async WebView2 callback when the document is gone.
            HostLog.Warning(
                $"Dropped bridge failure after an unexpected {exception.GetType().Name}.");
        }
    }

    private void PostSuccess(JsonElement requestId, object result)
    {
        var delivery = PostBounded(
            new { id = requestId, ok = true, result },
            WebBridgePayloadPolicy.MaximumResponseBytes,
            "bridge response");
        if (delivery.Delivered ||
            delivery.Failure is not WebBridgeDeliveryFailure.PayloadTooLarge)
        {
            return;
        }

        PostFailure(
            requestId,
            "RESPONSE_TOO_LARGE",
            "The native result exceeded the bounded renderer response limit.");
    }

    private void PostEvent(string eventName, object data)
    {
        if (AllowsEvent(eventName))
        {
            _ = PostBounded(
                new { @event = eventName, data },
                WebBridgePayloadPolicy.MaximumEventBytes,
                $"bridge event {eventName}");
        }
    }

    private WebBridgeDeliveryResult PostBounded(
        object payload,
        int maximumBytes,
        string description)
    {
        if (_disposed)
        {
            return new WebBridgeDeliveryResult(
                false,
                WebBridgeDeliveryFailure.TransportUnavailable,
                nameof(ObjectDisposedException));
        }

        var delivery = WebBridgeMessageDelivery.TryPost(
            payload,
            maximumBytes,
            _webView.PostWebMessageAsJson);
        switch (delivery.Failure)
        {
            case WebBridgeDeliveryFailure.None:
                break;
            case WebBridgeDeliveryFailure.PayloadTooLarge:
                HostLog.Warning(
                    $"Dropped {description} because it exceeded {maximumBytes} UTF-8 bytes.");
                break;
            case WebBridgeDeliveryFailure.Serialization:
                HostLog.Warning(
                    $"Dropped {description} because it could not be serialized: " +
                    delivery.ExceptionType);
                break;
            case WebBridgeDeliveryFailure.TransportUnavailable:
                HostLog.Warning(
                    $"Dropped {description} because the renderer transport was unavailable: " +
                    delivery.ExceptionType);
                break;
            case WebBridgeDeliveryFailure.Delivery:
                HostLog.Warning(
                    $"Dropped {description} because delivery failed: " +
                    delivery.ExceptionType);
                break;
            default:
                HostLog.Warning($"Dropped {description} for an unknown delivery reason.");
                break;
        }

        return delivery;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _shutdown.Cancel();
        _pendingTerminalOutput.Clear();
        if (_telemetryAttached)
        {
            _snapshotFeed.SnapshotAvailable -= OnSnapshotAvailable;
            _telemetryAttached = false;
        }

        if (_attached)
        {
            _webView.WebMessageReceived -= OnWebMessageReceived;
            _shellService.ApplicationCatalogChanged -= OnApplicationCatalogChanged;
            _desktopService.EntriesChanged -= OnDesktopEntriesChanged;
            _windowAppearanceService.StateChanged -= OnWindowAppearanceChanged;
            _taskbarModeService.StateChanged -= OnTaskbarModeChanged;
            _trayStatusService.SnapshotChanged -= OnTraySnapshotChanged;
            _systemFeedService.SnapshotChanged -= OnSystemFeedChanged;
            _fileTransferCoordinator.TransferChanged -= OnFileTransferChanged;
            _obsidianGraphService.SnapshotChanged -= OnKnowledgeGraphChanged;
            if (_agentCoordinator is not null)
            {
                _agentCoordinator.StateChanged -= OnAgentStateChanged;
                _agentCoordinator.EventReceived -= OnAgentEventReceived;
            }
            _terminalSessionService.OutputReceived -= OnTerminalOutputReceived;
            _terminalSessionService.SessionExited -= OnTerminalSessionExited;
        }

        _fileTransferCoordinator.Dispose();
        _obsidianGraphService.Dispose();
        _shutdown.Dispose();
    }
}

internal sealed record TaskbarFlyoutRequest(
    string Mode,
    IReadOnlyList<string> WindowIds,
    IReadOnlyList<TaskbarOverflowItem> OverflowItems,
    double AnchorX,
    double ViewportWidth,
    string? ItemId,
    string? Label,
    IReadOnlyList<string> Actions);

internal sealed record TaskbarOverflowItem(
    string ItemId,
    string Label,
    string Meta,
    string? WindowId);

internal sealed record ObsidianGraphChunkRequest(
    string Revision,
    int NodeOffset,
    int NodeLimit,
    int EdgeOffset,
    int EdgeLimit);

internal sealed record ObsidianVaultSelectionResult(
    bool Canceled,
    ObsidianGraphManifest Manifest);
