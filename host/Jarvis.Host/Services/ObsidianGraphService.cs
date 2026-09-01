using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Jarvis.Host.Services;

internal sealed partial class ObsidianGraphService : IDisposable
{
    internal const string VaultEnvironmentVariable = "JARVIS_OBSIDIAN_VAULT";
    internal const string DefaultVaultDirectoryName = "服装行业知识库";
    internal const int MaximumNodeCount = 4096;
    internal const int MaximumEdgeCount = 32_768;
    internal const int MaximumMarkdownFileBytes = 2 * 1024 * 1024;
    internal const int MaximumLinksPerNote = 1024;
    internal const int DefaultNodeChunkSize = 256;
    internal const int DefaultEdgeChunkSize = 1024;
    internal const int MaximumNodeChunkSize = 512;
    internal const int MaximumEdgeChunkSize = 2048;
    internal const int MaximumChunkPayloadBytes = 1_500_000;
    internal const int MaximumTotalParsedLinkCount = 131_072;

    private const int MaximumDiscoveredFileCount = 16_384;
    private const int MaximumMetadataValues = 64;
    private const int MaximumTitleLength = 512;
    private const int MaximumTagLength = 128;
    private const int MaximumAliasLength = 256;
    private const int MaximumFragmentLength = 512;
    private const int MaximumWatcherRetryMilliseconds = 30_000;

    private static readonly HashSet<string> IgnoredDirectoryNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ".agents",
        ".cache",
        ".codex",
        ".git",
        ".obsidian",
        ".venv",
        ".vscode",
        "__pycache__",
        "anythingllm-storage",
        "bin",
        "build",
        "cache",
        "dist",
        "env",
        "node_modules",
        "obj",
        "temp",
        "tmp",
        "venv"
    };

    private static readonly JsonSerializerOptions ChunkJsonOptions = new(JsonSerializerDefaults.Web);

    private readonly Func<string?> _readConfiguredVault;
    private readonly Func<string> _readDocumentsDirectory;
    private readonly IObsidianVaultWatcherFactory _watcherFactory;
    private readonly Func<string, string> _readAllText;
    private readonly string? _configurationFilePath;
    private readonly object _scanGate = new();
    private readonly object _stateGate = new();
    private readonly Dictionary<string, CachedNote> _noteCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _pendingChanges = new(StringComparer.OrdinalIgnoreCase);
    private readonly CancellationTokenSource _lifetimeCancellation = new();

    private WatcherRegistration? _watcher;
    private Timer? _changeTimer;
    private ObsidianGraphSnapshot? _lastSnapshot;
    private string? _activeVaultRoot;
    private string? _configuredVaultOverride;
    private string? _configuredResolutionOverride;
    private bool _dirty = true;
    private bool _forceFullRescan;
    private bool _refreshRunning;
    private bool _lastScanFailed;
    private bool _disposed;
    private int _watcherRefreshFailureCount;
    private long _changeGeneration;

    public ObsidianGraphService()
        : this(
            ReadConfiguredVault,
            () => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            FileSystemObsidianVaultWatcherFactory.Instance,
            File.ReadAllText,
            GetConfigurationFilePath())
    {
    }

    internal ObsidianGraphService(
        Func<string?> readConfiguredVault,
        Func<string> readDocumentsDirectory)
        : this(
            readConfiguredVault,
            readDocumentsDirectory,
            FileSystemObsidianVaultWatcherFactory.Instance,
            File.ReadAllText,
            configurationFilePath: null)
    {
    }

    internal ObsidianGraphService(
        Func<string?> readConfiguredVault,
        Func<string> readDocumentsDirectory,
        IObsidianVaultWatcherFactory watcherFactory,
        Func<string, string>? readAllText = null,
        string? configurationFilePath = null)
    {
        _readConfiguredVault = readConfiguredVault ?? throw new ArgumentNullException(nameof(readConfiguredVault));
        _readDocumentsDirectory = readDocumentsDirectory ??
                                  throw new ArgumentNullException(nameof(readDocumentsDirectory));
        _watcherFactory = watcherFactory ?? throw new ArgumentNullException(nameof(watcherFactory));
        _readAllText = readAllText ?? File.ReadAllText;
        _configurationFilePath = configurationFilePath;
        _changeTimer = new Timer(OnChangeTimer, null, Timeout.Infinite, Timeout.Infinite);
    }

    public ObsidianGraphSnapshot GetDefaultSource(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return EnsureSnapshot(cancellationToken);
    }

    public ObsidianGraphManifest GetDefaultManifest(CancellationToken cancellationToken = default)
    {
        var snapshot = GetDefaultSource(cancellationToken);
        return CreateManifest(snapshot);
    }

    public ObsidianGraphManifest RefreshDefaultManifest(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        cancellationToken.ThrowIfCancellationRequested();
        lock (_stateGate)
        {
            _dirty = true;
            _forceFullRescan = true;
            _changeGeneration++;
        }

        return GetDefaultManifest(cancellationToken);
    }

    public ObsidianGraphChunk GetDefaultChunk(
        string revision,
        int nodeOffset,
        int nodeLimit,
        int edgeOffset,
        int edgeLimit,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(revision) || revision.Length > 128)
        {
            throw new ArgumentException("A bounded graph revision is required.", nameof(revision));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(nodeOffset);
        ArgumentOutOfRangeException.ThrowIfNegative(edgeOffset);
        ArgumentOutOfRangeException.ThrowIfNegative(nodeLimit);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(nodeLimit, MaximumNodeChunkSize);
        ArgumentOutOfRangeException.ThrowIfNegative(edgeLimit);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(edgeLimit, MaximumEdgeChunkSize);

        var snapshot = GetDefaultSource(cancellationToken);
        if (!snapshot.Source.Revision.Equals(revision, StringComparison.Ordinal))
        {
            throw new ObsidianGraphRevisionMismatchException(revision, snapshot.Source.Revision);
        }

        if (nodeOffset > snapshot.Nodes.Count || edgeOffset > snapshot.Edges.Count)
        {
            throw new ArgumentOutOfRangeException(
                nodeOffset > snapshot.Nodes.Count ? nameof(nodeOffset) : nameof(edgeOffset),
                "Graph offsets cannot exceed the manifest counts.");
        }

        var nodeBudget = edgeLimit > 0 ? (MaximumChunkPayloadBytes - 32_000) / 2 : MaximumChunkPayloadBytes - 32_000;
        var edgeBudget = nodeLimit > 0 ? (MaximumChunkPayloadBytes - 32_000) / 2 : MaximumChunkPayloadBytes - 32_000;
        var nodes = TakeBoundedPage(snapshot.Nodes, nodeOffset, nodeLimit, nodeBudget);
        var edges = TakeBoundedPage(snapshot.Edges, edgeOffset, edgeLimit, edgeBudget);
        var nextNodeOffset = nodeOffset + nodes.Count;
        var nextEdgeOffset = edgeOffset + edges.Count;

        return new ObsidianGraphChunk(
            SchemaVersion: snapshot.SchemaVersion,
            Revision: snapshot.Source.Revision,
            Nodes: nodes,
            Edges: edges,
            NextNodeOffset: nextNodeOffset,
            NextEdgeOffset: nextEdgeOffset,
            Complete: nextNodeOffset >= snapshot.Nodes.Count && nextEdgeOffset >= snapshot.Edges.Count);
    }

    public ObsidianGraphManifest ConfigureVault(string vaultRoot, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentException.ThrowIfNullOrWhiteSpace(vaultRoot);
        cancellationToken.ThrowIfCancellationRequested();

        var candidate = CreateCandidate(vaultRoot, "native-picker");
        if (candidate.FullPath is null || !Directory.Exists(candidate.FullPath))
        {
            throw new ArgumentException("The selected Obsidian vault is unavailable.", nameof(vaultRoot));
        }

        var rootAttributes = File.GetAttributes(candidate.FullPath);
        if (rootAttributes.HasFlag(FileAttributes.ReparsePoint) ||
            rootAttributes.HasFlag(FileAttributes.System))
        {
            throw new ArgumentException("The selected Obsidian vault cannot be a system or linked directory.", nameof(vaultRoot));
        }

        using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            _lifetimeCancellation.Token);
        cancellationToken = linkedCancellation.Token;

        lock (_scanGate)
        {
            cancellationToken.ThrowIfCancellationRequested();
            WatcherRegistration? candidateWatcher = null;
            var candidateWatcherIsStaged = false;
            try
            {
                lock (_stateGate)
                {
                    if (_watcher is not null &&
                        PathsEqual(_watcher.VaultRoot, candidate.FullPath))
                    {
                        candidateWatcher = _watcher;
                    }
                }

                if (candidateWatcher is null)
                {
                    candidateWatcher = CreateStartedWatcher(candidate.FullPath);
                    candidateWatcherIsStaged = true;
                }

                long watcherGeneration;
                lock (_stateGate)
                {
                    watcherGeneration = candidateWatcher.ChangeGeneration;
                }

                var scanResult = ScanVault(candidate, forceFullRescan: true, cancellationToken);
                PersistConfiguredVault(candidate.FullPath);
                CommitConfiguredVault(candidate, scanResult, candidateWatcher, watcherGeneration);
                candidateWatcherIsStaged = false;
                return CreateManifest(scanResult.Snapshot);
            }
            finally
            {
                if (candidateWatcherIsStaged)
                {
                    DisposeWatcher(candidateWatcher);
                }
            }
        }
    }

    private ObsidianGraphSnapshot EnsureSnapshot(CancellationToken cancellationToken)
    {
        using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            _lifetimeCancellation.Token);
        cancellationToken = linkedCancellation.Token;
        cancellationToken.ThrowIfCancellationRequested();
        lock (_scanGate)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidate = ResolveDefaultVault();
            var vaultRoot = candidate.FullPath;
            var vaultAvailable = vaultRoot is not null && Directory.Exists(vaultRoot);
            ObsidianGraphSnapshot? previous;
            bool requiresScan;
            bool forceFullRescan;
            long scanGeneration;

            lock (_stateGate)
            {
                previous = _lastSnapshot;
                var sameRoot = PathsEqual(_activeVaultRoot, vaultRoot);
                var availabilityChanged = previous is not null &&
                                          previous.Source.Available != vaultAvailable;
                requiresScan = !sameRoot || availabilityChanged || _dirty || previous is null;
                forceFullRescan = !sameRoot || availabilityChanged || _forceFullRescan;
                if (!requiresScan && previous is not null)
                {
                    return previous;
                }
            }

            if (!vaultAvailable)
            {
                lock (_stateGate)
                {
                    scanGeneration = _changeGeneration;
                }
                var unavailable = EmptySnapshot(candidate.Name, candidate.Resolution);
                CommitSnapshot(
                    candidate,
                    unavailable,
                    nextCache: null,
                    clearCache: true,
                    scanGeneration,
                    keepDirty: false);
                return unavailable;
            }

            try
            {
                var watcherReady = EnsureWatcher(vaultRoot!);
                lock (_stateGate)
                {
                    scanGeneration = _changeGeneration;
                }

                var scanResult = ScanVault(candidate, forceFullRescan, cancellationToken);
                CommitSnapshot(
                    candidate,
                    scanResult.Snapshot,
                    scanResult.Cache,
                    clearCache: false,
                    scanGeneration,
                    keepDirty: !watcherReady);
                return scanResult.Snapshot;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception) when (!IsFatal(exception))
            {
                lock (_stateGate)
                {
                    _dirty = true;
                    _lastScanFailed = true;
                }

                return previous ?? EmptySnapshot(candidate.Name, candidate.Resolution);
            }
        }
    }

    private VaultScanResult ScanVault(
        VaultCandidate candidate,
        bool forceFullRescan,
        CancellationToken cancellationToken)
    {
        var vaultRoot = candidate.FullPath!;
        var discovery = DiscoverMarkdownFiles(vaultRoot, cancellationToken);
        var parsedNotes = new List<ParsedNote>(Math.Min(discovery.Files.Count, MaximumNodeCount));
        var skippedFileCount = discovery.SkippedFileCount;
        var truncated = discovery.Truncated;
        Dictionary<string, CachedNote> reusableCache;
        HashSet<string> invalidatedPaths;

        lock (_stateGate)
        {
            reusableCache = forceFullRescan
                ? new Dictionary<string, CachedNote>(StringComparer.OrdinalIgnoreCase)
                : new Dictionary<string, CachedNote>(_noteCache, StringComparer.OrdinalIgnoreCase);
            invalidatedPaths = forceFullRescan
                ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(_pendingChanges, StringComparer.OrdinalIgnoreCase);
        }

        var nextCache = new Dictionary<string, CachedNote>(StringComparer.OrdinalIgnoreCase);
        var reusedFileCount = 0;
        var remainingLinkBudget = MaximumTotalParsedLinkCount;

        foreach (var file in discovery.Files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (parsedNotes.Count >= MaximumNodeCount)
            {
                truncated = true;
                break;
            }

            var parsed = GetOrParseNote(
                file,
                reusableCache,
                invalidatedPaths,
                cancellationToken,
                out var reused);
            if (reused)
            {
                reusedFileCount++;
            }
            if (parsed is null)
            {
                nextCache[file.RelativePath] = new CachedNote(
                    file.Stamp,
                    parsed,
                    CompleteForGlobalBudget: true);
                skippedFileCount++;
                continue;
            }

            var completeForGlobalBudget = true;
            if (parsed.Links.Count > remainingLinkBudget)
            {
                parsed = parsed with
                {
                    Links = parsed.Links.Take(remainingLinkBudget).ToArray(),
                    LinksTruncated = true
                };
                completeForGlobalBudget = false;
                truncated = true;
            }
            remainingLinkBudget -= parsed.Links.Count;
            nextCache[file.RelativePath] = new CachedNote(
                file.Stamp,
                parsed,
                completeForGlobalBudget);

            parsedNotes.Add(parsed);
            truncated |= parsed.LinksTruncated;
        }

        parsedNotes.Sort(ParsedNoteComparer.Instance);
        var index = new NoteIndex(parsedNotes);
        var edgeAggregates = new Dictionary<EdgeKey, EdgeAggregate>();
        var unresolvedLinkCount = 0;
        var skippedLinkCount = 0;
        var parsedLinkCount = 0;
        var resolvedLinkCount = 0;

        foreach (var note in parsedNotes)
        {
            foreach (var link in note.Links)
            {
                cancellationToken.ThrowIfCancellationRequested();
                parsedLinkCount++;
                var resolution = index.Resolve(note, link);
                if (resolution.Status == LinkResolutionStatus.Invalid)
                {
                    skippedLinkCount++;
                    continue;
                }

                if (resolution.Target is null)
                {
                    unresolvedLinkCount++;
                    continue;
                }

                resolvedLinkCount++;

                var key = new EdgeKey(
                    note.RelativePath,
                    resolution.Target.RelativePath,
                    link.Kind,
                    link.FragmentKind,
                    link.Fragment,
                    link.RelationType);
                if (edgeAggregates.TryGetValue(key, out var aggregate))
                {
                    aggregate.AddOccurrence(link);
                    continue;
                }

                if (edgeAggregates.Count >= MaximumEdgeCount)
                {
                    truncated = true;
                    break;
                }

                edgeAggregates.Add(
                    key,
                    new EdgeAggregate(link));
            }

            if (edgeAggregates.Count >= MaximumEdgeCount)
            {
                break;
            }
        }

        var edges = edgeAggregates
            .OrderBy(entry => entry.Key.Source, StablePathComparer.Instance)
            .ThenBy(entry => entry.Key.Target, StablePathComparer.Instance)
            .ThenBy(entry => entry.Key.Kind, StringComparer.Ordinal)
            .ThenBy(entry => entry.Key.FragmentKind, StringComparer.Ordinal)
            .ThenBy(entry => entry.Key.Fragment, StringComparer.Ordinal)
            .ThenBy(entry => entry.Key.RelationType, StringComparer.Ordinal)
            .Select(entry => new ObsidianGraphEdge(
                CreateStableEdgeId(entry.Key),
                entry.Key.Source,
                entry.Key.Target,
                entry.Key.Kind,
                entry.Value.Syntax,
                entry.Key.FragmentKind,
                entry.Key.Fragment,
                entry.Value.DisplayText,
                entry.Key.RelationType,
                entry.Value.RelationValues,
                entry.Value.OccurrenceCount,
                entry.Value.OccurrenceCount))
            .ToArray();
        var degrees = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var edge in edges)
        {
            degrees[edge.Source] = degrees.GetValueOrDefault(edge.Source) + 1;
            degrees[edge.Target] = degrees.GetValueOrDefault(edge.Target) + 1;
        }

        var nodes = parsedNotes
            .Select(note =>
            {
                var degree = degrees.GetValueOrDefault(note.RelativePath);
                return new ObsidianGraphNode(
                    Id: note.RelativePath,
                    RelativePath: note.RelativePath,
                    Title: note.Title,
                    Kind: "note",
                    Group: GroupForRelativePath(note.RelativePath),
                    Tags: note.Tags,
                    Aliases: note.Aliases,
                    Resolved: true,
                    Degree: degree,
                    Weight: 1 + Math.Log2(degree + 1),
                    X: null,
                    Y: null,
                    Z: null);
            })
            .ToArray();
        var revision = CreateStableRevision(nodes, edges);

        var snapshot = new ObsidianGraphSnapshot(
            SchemaVersion: 1,
            UpdatedAtUtc: DateTimeOffset.UtcNow,
            Source: new ObsidianGraphSource(
                Kind: "obsidian-vault",
                Name: candidate.Name,
                Available: true,
                Resolution: candidate.Resolution,
                Simulation: false,
                Revision: revision),
            Nodes: nodes,
            Edges: edges,
            Stats: new ObsidianGraphStats(
                DiscoveredFileCount: discovery.Files.Count,
                NodeCount: nodes.Length,
                EdgeCount: edges.Length,
                ParsedLinkCount: parsedLinkCount,
                ResolvedLinkCount: resolvedLinkCount,
                UnresolvedLinkCount: unresolvedLinkCount,
                SkippedLinkCount: skippedLinkCount,
                SkippedFileCount: skippedFileCount,
                SkippedDirectoryCount: discovery.SkippedDirectoryCount,
                Truncated: truncated,
                Incremental: !forceFullRescan,
                ReusedFileCount: reusedFileCount));

        return new VaultScanResult(snapshot, nextCache);
    }

    private ObsidianGraphManifest CreateManifest(ObsidianGraphSnapshot snapshot)
    {
        bool lastScanFailed;
        lock (_stateGate)
        {
            lastScanFailed = _lastScanFailed;
        }

        return new ObsidianGraphManifest(
            SchemaVersion: snapshot.SchemaVersion,
            Available: snapshot.Source.Available,
            Revision: snapshot.Source.Revision,
            NodeCount: snapshot.Nodes.Count,
            EdgeCount: snapshot.Edges.Count,
            NodeChunkSize: DefaultNodeChunkSize,
            EdgeChunkSize: DefaultEdgeChunkSize,
            Source: snapshot.Source,
            Stats: snapshot.Stats,
            UpdatedAtUtc: snapshot.UpdatedAtUtc,
            Status: lastScanFailed
                ? "stale"
                : snapshot.Source.Available ? "ready" : "unavailable");
    }

    private static IReadOnlyList<T> TakeBoundedPage<T>(
        IReadOnlyList<T> source,
        int offset,
        int limit,
        int byteBudget)
    {
        if (limit == 0 || offset >= source.Count)
        {
            return Array.Empty<T>();
        }

        var result = new List<T>(Math.Min(limit, source.Count - offset));
        var consumedBytes = 2;
        var end = Math.Min(source.Count, offset + limit);
        for (var index = offset; index < end; index++)
        {
            var item = source[index];
            var itemBytes = JsonSerializer.SerializeToUtf8Bytes(item, ChunkJsonOptions).Length + 1;
            if (result.Count > 0 && consumedBytes + itemBytes > byteBudget)
            {
                break;
            }

            result.Add(item);
            consumedBytes += itemBytes;
        }

        return result;
    }

    private ParsedNote? GetOrParseNote(
        DiscoveredMarkdownFile file,
        IReadOnlyDictionary<string, CachedNote> reusableCache,
        IReadOnlySet<string> invalidatedPaths,
        CancellationToken cancellationToken,
        out bool reused)
    {
        if (!invalidatedPaths.Contains(file.RelativePath) &&
            reusableCache.TryGetValue(file.RelativePath, out var cached) &&
            cached.CompleteForGlobalBudget &&
            cached.Stamp == file.Stamp)
        {
            reused = true;
            return cached.Note;
        }

        reused = false;
        return TryParseNote(file, cancellationToken);
    }

    private void CommitSnapshot(
        VaultCandidate candidate,
        ObsidianGraphSnapshot snapshot,
        IReadOnlyDictionary<string, CachedNote>? nextCache,
        bool clearCache,
        long scanGeneration,
        bool keepDirty)
    {
        WatcherRegistration? staleWatcher = null;
        lock (_stateGate)
        {
            if (!snapshot.Source.Available ||
                _watcher is not null && !PathsEqual(_watcher.VaultRoot, candidate.FullPath))
            {
                staleWatcher = _watcher;
                if (staleWatcher is not null)
                {
                    staleWatcher.AcceptingEvents = false;
                }
                _watcher = null;
            }

            _activeVaultRoot = candidate.FullPath;
            _lastSnapshot = snapshot;
            _lastScanFailed = false;
            _watcherRefreshFailureCount = 0;
            var changedDuringScan = keepDirty || _changeGeneration != scanGeneration;
            _dirty = changedDuringScan;
            if (!changedDuringScan)
            {
                _forceFullRescan = false;
                _pendingChanges.Clear();
                _watcher?.PendingChanges.Clear();
                if (_watcher is not null)
                {
                    _watcher.ForceFullRescan = false;
                }
            }
            else if (keepDirty)
            {
                _forceFullRescan = true;
            }
            if (clearCache || nextCache is not null)
            {
                _noteCache.Clear();
                if (nextCache is not null)
                {
                    foreach (var entry in nextCache)
                    {
                        _noteCache.Add(entry.Key, entry.Value);
                    }
                }
            }
        }

        DisposeWatcher(staleWatcher);
    }

    private void CommitConfiguredVault(
        VaultCandidate candidate,
        VaultScanResult scanResult,
        WatcherRegistration candidateWatcher,
        long watcherGeneration)
    {
        WatcherRegistration? staleWatcher;
        bool changedDuringScan;
        lock (_stateGate)
        {
            changedDuringScan = candidateWatcher.ChangeGeneration != watcherGeneration;
            staleWatcher = ReferenceEquals(_watcher, candidateWatcher) ? null : _watcher;
            if (staleWatcher is not null)
            {
                staleWatcher.AcceptingEvents = false;
            }

            _configuredVaultOverride = candidate.FullPath;
            _configuredResolutionOverride = "native-picker";
            _watcher = candidateWatcher;
            _activeVaultRoot = candidate.FullPath;
            _lastSnapshot = scanResult.Snapshot;
            _lastScanFailed = false;
            _watcherRefreshFailureCount = 0;
            _dirty = changedDuringScan;
            _forceFullRescan = changedDuringScan && candidateWatcher.ForceFullRescan;
            _pendingChanges.Clear();
            if (changedDuringScan)
            {
                _pendingChanges.UnionWith(candidateWatcher.PendingChanges);
            }
            else
            {
                candidateWatcher.PendingChanges.Clear();
                candidateWatcher.ForceFullRescan = false;
            }

            _noteCache.Clear();
            foreach (var entry in scanResult.Cache)
            {
                _noteCache.Add(entry.Key, entry.Value);
            }

            _changeGeneration++;
            if (changedDuringScan)
            {
                _changeTimer?.Change(140, Timeout.Infinite);
            }
        }

        DisposeWatcher(staleWatcher);
    }

    private bool EnsureWatcher(string vaultRoot)
    {
        lock (_stateGate)
        {
            if (_watcher is not null && PathsEqual(_watcher.VaultRoot, vaultRoot))
            {
                return true;
            }

            if (_disposed)
            {
                return false;
            }
        }

        WatcherRegistration? created = null;
        WatcherRegistration? staleWatcher = null;
        var installed = false;
        try
        {
            created = CreateStartedWatcher(vaultRoot);

            lock (_stateGate)
            {
                if (!_disposed)
                {
                    staleWatcher = _watcher;
                    if (staleWatcher is not null)
                    {
                        staleWatcher.AcceptingEvents = false;
                    }

                    _watcher = created;
                    if (created.ChangeGeneration > 0)
                    {
                        _dirty = true;
                        _forceFullRescan |= created.ForceFullRescan;
                        _pendingChanges.UnionWith(created.PendingChanges);
                        _changeGeneration++;
                    }

                    created = null;
                    installed = true;
                }
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            lock (_stateGate)
            {
                _dirty = true;
                _forceFullRescan = true;
                _changeGeneration++;
            }
        }
        finally
        {
            DisposeWatcher(created);
            DisposeWatcher(staleWatcher);
        }

        return installed;
    }

    private WatcherRegistration CreateStartedWatcher(string vaultRoot)
    {
        var watcher = _watcherFactory.Create(vaultRoot);
        var registration = new WatcherRegistration(watcher, vaultRoot);
        registration.ChangedHandler = (_, change) => OnWatcherChanged(registration, change);
        registration.OverflowedHandler = (_, _) => OnWatcherOverflowed(registration);
        watcher.Changed += registration.ChangedHandler;
        watcher.Overflowed += registration.OverflowedHandler;
        try
        {
            watcher.Start();
            return registration;
        }
        catch
        {
            registration.AcceptingEvents = false;
            DisposeWatcher(registration);
            throw;
        }
    }

    private void OnWatcherChanged(WatcherRegistration registration, ObsidianVaultChange change)
    {
        lock (_stateGate)
        {
            if (_disposed || !registration.AcceptingEvents)
            {
                return;
            }

            if (change.Kind == ObsidianVaultChangeKind.Changed &&
                !Path.GetExtension(change.FullPath).Equals(".md", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var queued = AddPendingRelativePath(
                registration.VaultRoot,
                change.FullPath,
                registration.PendingChanges);
            if (change.OldFullPath is not null)
            {
                queued |= AddPendingRelativePath(
                    registration.VaultRoot,
                    change.OldFullPath,
                    registration.PendingChanges);
            }

            if (!queued)
            {
                return;
            }

            registration.ChangeGeneration++;
            if (ReferenceEquals(_watcher, registration))
            {
                _pendingChanges.UnionWith(registration.PendingChanges);
                _dirty = true;
                _changeGeneration++;
                _changeTimer?.Change(140, Timeout.Infinite);
            }
        }
    }

    private void OnWatcherOverflowed(WatcherRegistration registration)
    {
        lock (_stateGate)
        {
            if (_disposed || !registration.AcceptingEvents)
            {
                return;
            }

            registration.ForceFullRescan = true;
            registration.ChangeGeneration++;
            registration.PendingChanges.Clear();
            if (ReferenceEquals(_watcher, registration))
            {
                _dirty = true;
                _forceFullRescan = true;
                _changeGeneration++;
                _pendingChanges.Clear();
                _changeTimer?.Change(0, Timeout.Infinite);
            }
        }
    }

    private static bool AddPendingRelativePath(
        string vaultRoot,
        string fullPath,
        ISet<string> pendingChanges)
    {
        var relativePath = NormalizeDiscoveredRelativePath(vaultRoot, fullPath);
        if (relativePath is null || IsIgnoredRelativePath(relativePath))
        {
            return false;
        }

        var extension = Path.GetExtension(relativePath);
        if (extension.Length > 0 && !extension.Equals(".md", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        pendingChanges.Add(relativePath);
        return true;
    }

    private static bool IsIgnoredRelativePath(string relativePath) =>
        relativePath.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Any(IgnoredDirectoryNames.Contains);

    private void OnChangeTimer(object? state)
    {
        lock (_stateGate)
        {
            if (_disposed || _refreshRunning || !_dirty)
            {
                return;
            }

            _refreshRunning = true;
        }

        _ = Task.Run(RefreshAfterWatcherChange);
    }

    private void RefreshAfterWatcherChange()
    {
        try
        {
            var manifest = GetDefaultManifest(_lifetimeCancellation.Token);
            bool scanSucceeded;
            lock (_stateGate)
            {
                scanSucceeded = !_dirty;
            }

            if (scanSucceeded)
            {
                SnapshotChanged?.Invoke(this, manifest);
            }
        }
        catch (Exception exception) when (!IsFatal(exception))
        {
            // Keep the last valid snapshot; the next manifest request retries the scan.
        }
        finally
        {
            lock (_stateGate)
            {
                _refreshRunning = false;
                if (!_disposed && _dirty)
                {
                    var retryDelay = 140;
                    if (_lastScanFailed)
                    {
                        _watcherRefreshFailureCount = Math.Min(
                            _watcherRefreshFailureCount + 1,
                            16);
                        retryDelay = GetWatcherRetryDelayMilliseconds(
                            _watcherRefreshFailureCount);
                    }
                    _changeTimer?.Change(retryDelay, Timeout.Infinite);
                }
            }
        }
    }

    internal static int GetWatcherRetryDelayMilliseconds(int failureCount)
    {
        var exponent = Math.Clamp(failureCount - 1, 0, 6);
        return Math.Min(MaximumWatcherRetryMilliseconds, 750 * (1 << exponent));
    }

    private static bool PathsEqual(string? left, string? right) =>
        left is null || right is null
            ? left is null && right is null
            : Path.GetFullPath(left).Equals(Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);

    private static bool IsFatal(Exception exception) => exception is
        OutOfMemoryException or
        StackOverflowException or
        AccessViolationException;

    private void DisposeWatcher(WatcherRegistration? registration)
    {
        if (registration is null)
        {
            return;
        }

        lock (_stateGate)
        {
            registration.AcceptingEvents = false;
        }

        registration.Watcher.Changed -= registration.ChangedHandler;
        registration.Watcher.Overflowed -= registration.OverflowedHandler;
        registration.Watcher.Dispose();
    }

    private static string? ReadConfiguredVault()
    {
        var environment = Environment.GetEnvironmentVariable(VaultEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(environment))
        {
            return environment;
        }

        var path = GetConfigurationFilePath();
        try
        {
            return File.Exists(path) ? File.ReadAllText(path).Trim() : null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string GetConfigurationFilePath() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Jarvis",
        "obsidian-vault.txt");

    private void PersistConfiguredVault(string vaultRoot)
    {
        if (string.IsNullOrWhiteSpace(_configurationFilePath))
        {
            return;
        }

        var directory = Path.GetDirectoryName(_configurationFilePath)!;
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(
            directory,
            $".{Path.GetFileName(_configurationFilePath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(temporaryPath, vaultRoot);
            File.Move(temporaryPath, _configurationFilePath, overwrite: true);
        }
        finally
        {
            try
            {
                File.Delete(temporaryPath);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                // Preserve the original persistence failure if temporary cleanup is unavailable.
            }
        }
    }

    public event EventHandler<ObsidianGraphManifest>? SnapshotChanged;

    private VaultCandidate ResolveDefaultVault()
    {
        lock (_stateGate)
        {
            if (!string.IsNullOrWhiteSpace(_configuredVaultOverride))
            {
                return CreateCandidate(
                    _configuredVaultOverride,
                    _configuredResolutionOverride ?? "native-picker");
            }
        }

        var configured = _readConfiguredVault()?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
        {
            var environment = Environment.GetEnvironmentVariable(VaultEnvironmentVariable)?.Trim();
            var resolution = _configurationFilePath is not null &&
                             !configured.Equals(environment, StringComparison.OrdinalIgnoreCase)
                ? "native-picker"
                : "environment";
            return CreateCandidate(configured, resolution);
        }

        var documents = _readDocumentsDirectory()?.Trim();
        if (string.IsNullOrWhiteSpace(documents))
        {
            return new VaultCandidate(null, DefaultVaultDirectoryName, "documents-default");
        }

        return CreateCandidate(
            Path.Combine(documents, DefaultVaultDirectoryName),
            "documents-default");
    }

    private static VaultCandidate CreateCandidate(string rawPath, string resolution)
    {
        var expanded = Environment.ExpandEnvironmentVariables(rawPath.Trim().Trim('"'));
        var name = SafeVaultName(expanded);
        try
        {
            if (!Path.IsPathFullyQualified(expanded))
            {
                return new VaultCandidate(null, name, resolution);
            }

            return new VaultCandidate(Path.GetFullPath(expanded), name, resolution);
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return new VaultCandidate(null, name, resolution);
        }
    }

    private static string SafeVaultName(string path)
    {
        try
        {
            var trimmed = Path.TrimEndingDirectorySeparator(path);
            return SanitizeValue(Path.GetFileName(trimmed), 128, DefaultVaultDirectoryName);
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return DefaultVaultDirectoryName;
        }
    }

    private static ObsidianGraphSnapshot EmptySnapshot(string name, string resolution) => new(
        SchemaVersion: 1,
        UpdatedAtUtc: DateTimeOffset.UtcNow,
        Source: new ObsidianGraphSource(
            Kind: "obsidian-vault",
            Name: name,
            Available: false,
            Resolution: resolution,
            Simulation: false,
            Revision: "unavailable"),
        Nodes: Array.Empty<ObsidianGraphNode>(),
        Edges: Array.Empty<ObsidianGraphEdge>(),
        Stats: new ObsidianGraphStats(
            DiscoveredFileCount: 0,
            NodeCount: 0,
            EdgeCount: 0,
            ParsedLinkCount: 0,
            ResolvedLinkCount: 0,
            UnresolvedLinkCount: 0,
            SkippedLinkCount: 0,
            SkippedFileCount: 0,
            SkippedDirectoryCount: 0,
            Truncated: false,
            Incremental: false,
            ReusedFileCount: 0));

    private static DiscoveryResult DiscoverMarkdownFiles(
        string vaultRoot,
        CancellationToken cancellationToken)
    {
        var files = new List<DiscoveredMarkdownFile>();
        var pending = new Stack<string>();
        pending.Push(vaultRoot);
        var skippedDirectories = 0;
        var skippedFiles = 0;
        var truncated = false;

        while (pending.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = pending.Pop();
            string[] entries;
            try
            {
                entries = Directory.GetFileSystemEntries(directory);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                if (PathsEqual(directory, vaultRoot))
                {
                    throw;
                }

                skippedDirectories++;
                continue;
            }

            Array.Sort(entries, StablePathComparer.Instance);
            var childDirectories = new List<string>();
            foreach (var entry in entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                FileAttributes attributes;
                try
                {
                    attributes = File.GetAttributes(entry);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    skippedFiles++;
                    continue;
                }

                if (attributes.HasFlag(FileAttributes.Directory))
                {
                    var directoryName = Path.GetFileName(Path.TrimEndingDirectorySeparator(entry));
                    if (attributes.HasFlag(FileAttributes.ReparsePoint) ||
                        attributes.HasFlag(FileAttributes.System) ||
                        IgnoredDirectoryNames.Contains(directoryName))
                    {
                        skippedDirectories++;
                        continue;
                    }

                    childDirectories.Add(entry);
                    continue;
                }

                if (attributes.HasFlag(FileAttributes.ReparsePoint) ||
                    attributes.HasFlag(FileAttributes.System) ||
                    !Path.GetExtension(entry).Equals(".md", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (files.Count >= MaximumDiscoveredFileCount)
                {
                    truncated = true;
                    break;
                }

                try
                {
                    var info = new FileInfo(entry);
                    var relativePath = NormalizeDiscoveredRelativePath(vaultRoot, entry);
                    if (relativePath is null)
                    {
                        skippedFiles++;
                        continue;
                    }

                    files.Add(new DiscoveredMarkdownFile(
                        FullPath: entry,
                        RelativePath: relativePath,
                        Stamp: new FileStamp(info.LastWriteTimeUtc.Ticks, info.Length)));
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    skippedFiles++;
                }
            }

            if (truncated)
            {
                break;
            }

            for (var index = childDirectories.Count - 1; index >= 0; index--)
            {
                pending.Push(childDirectories[index]);
            }
        }

        files.Sort((left, right) =>
            StablePathComparer.Instance.Compare(left.RelativePath, right.RelativePath));
        return new DiscoveryResult(files, skippedDirectories, skippedFiles, truncated);
    }

    private ParsedNote? TryParseNote(
        DiscoveredMarkdownFile file,
        CancellationToken cancellationToken)
    {
        if (file.Stamp.Length > MaximumMarkdownFileBytes)
        {
            return null;
        }

        cancellationToken.ThrowIfCancellationRequested();
        var content = _readAllText(file.FullPath);
        cancellationToken.ThrowIfCancellationRequested();
        var parsedContent = ParseFrontMatter(content);
        var fallbackTitle = FileNameWithoutMarkdownExtension(file.RelativePath);
        var title = SanitizeExportValue(parsedContent.Title, MaximumTitleLength, fallbackTitle);
        var tags = NormalizeMetadataValues(parsedContent.Tags, MaximumTagLength, removeLeadingHash: true);
        var aliases = NormalizeMetadataValues(parsedContent.Aliases, MaximumAliasLength, removeLeadingHash: false);
        var links = ParseLinks(MaskIgnoredMarkdown(parsedContent.Body), out var linksTruncated);
        return new ParsedNote(
            RelativePath: file.RelativePath,
            Title: title,
            Tags: tags,
            Aliases: aliases,
            Links: links,
            LinksTruncated: linksTruncated);
    }

    private static string? NormalizeDiscoveredRelativePath(string vaultRoot, string fullPath)
    {
        var relative = Path.GetRelativePath(vaultRoot, fullPath);
        if (Path.IsPathRooted(relative) ||
            relative.Equals("..", StringComparison.Ordinal) ||
            relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
            relative.StartsWith($"..{Path.AltDirectorySeparatorChar}", StringComparison.Ordinal))
        {
            return null;
        }

        return relative.Replace(Path.DirectorySeparatorChar, '/').Replace(Path.AltDirectorySeparatorChar, '/');
    }

    private static ParsedFrontMatter ParseFrontMatter(string content)
    {
        var normalized = content.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        var lines = normalized.Split('\n');
        if (lines.Length < 3 || !lines[0].Trim().Equals("---", StringComparison.Ordinal))
        {
            return new ParsedFrontMatter(null, Array.Empty<string>(), Array.Empty<string>(), normalized);
        }

        var closingLine = -1;
        for (var index = 1; index < Math.Min(lines.Length, 258); index++)
        {
            var marker = lines[index].Trim();
            if (marker.Equals("---", StringComparison.Ordinal) || marker.Equals("...", StringComparison.Ordinal))
            {
                closingLine = index;
                break;
            }
        }

        if (closingLine < 0)
        {
            return new ParsedFrontMatter(null, Array.Empty<string>(), Array.Empty<string>(), normalized);
        }

        string? title = null;
        var tags = new List<string>();
        var aliases = new List<string>();
        string? activeList = null;

        for (var index = 1; index < closingLine; index++)
        {
            var line = lines[index];
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#'))
            {
                continue;
            }

            if (char.IsWhiteSpace(line[0]) && activeList is not null && trimmed.StartsWith("- ", StringComparison.Ordinal))
            {
                AddMetadataValue(activeList == "tags" ? tags : aliases, trimmed[2..]);
                continue;
            }

            activeList = null;
            var separator = line.IndexOf(':');
            if (separator <= 0 || char.IsWhiteSpace(line[0]))
            {
                continue;
            }

            var key = line[..separator].Trim();
            var value = line[(separator + 1)..].Trim();
            if (key.Equals("title", StringComparison.OrdinalIgnoreCase))
            {
                title = UnquoteYamlScalar(value);
                continue;
            }

            if (key.Equals("tags", StringComparison.OrdinalIgnoreCase))
            {
                activeList = "tags";
                AddMetadataValues(tags, value);
                continue;
            }

            if (key.Equals("aliases", StringComparison.OrdinalIgnoreCase) ||
                key.Equals("alias", StringComparison.OrdinalIgnoreCase))
            {
                activeList = "aliases";
                AddMetadataValues(aliases, value);
            }
        }

        var body = string.Join('\n', lines[(closingLine + 1)..]);
        return new ParsedFrontMatter(title, tags, aliases, body);
    }

    private static void AddMetadataValues(List<string> destination, string rawValue)
    {
        if (destination.Count >= MaximumMetadataValues || string.IsNullOrWhiteSpace(rawValue))
        {
            return;
        }

        var value = rawValue.Trim();
        if (!(value.StartsWith('[') && value.EndsWith(']')))
        {
            AddMetadataValue(destination, value);
            return;
        }

        var item = new StringBuilder();
        var quote = '\0';
        for (var index = 1; index < value.Length - 1; index++)
        {
            var character = value[index];
            if (quote != '\0')
            {
                item.Append(character);
                if (character == quote)
                {
                    if (quote == '\'' && index + 1 < value.Length - 1 && value[index + 1] == '\'')
                    {
                        item.Append(value[++index]);
                    }
                    else if (index == 0 || value[index - 1] != '\\')
                    {
                        quote = '\0';
                    }
                }
                continue;
            }

            if (character is '\'' or '"')
            {
                quote = character;
                item.Append(character);
                continue;
            }

            if (character == ',')
            {
                AddMetadataValue(destination, item.ToString());
                item.Clear();
                if (destination.Count >= MaximumMetadataValues)
                {
                    return;
                }
                continue;
            }

            item.Append(character);
        }

        AddMetadataValue(destination, item.ToString());
    }

    private static void AddMetadataValue(List<string> destination, string rawValue)
    {
        if (destination.Count >= MaximumMetadataValues)
        {
            return;
        }

        var value = UnquoteYamlScalar(rawValue);
        if (!string.IsNullOrWhiteSpace(value))
        {
            destination.Add(value);
        }
    }

    private static string UnquoteYamlScalar(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.Length >= 2 && trimmed[0] == '\'' && trimmed[^1] == '\'')
        {
            return trimmed[1..^1].Replace("''", "'", StringComparison.Ordinal);
        }

        if (trimmed.Length >= 2 && trimmed[0] == '"' && trimmed[^1] == '"')
        {
            return trimmed[1..^1]
                .Replace("\\\"", "\"", StringComparison.Ordinal)
                .Replace("\\\\", "\\", StringComparison.Ordinal);
        }

        return trimmed;
    }

    private static string[] NormalizeMetadataValues(
        IEnumerable<string> values,
        int maximumLength,
        bool removeLeadingHash)
    {
        var normalized = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in values)
        {
            var value = SanitizeExportValue(candidate, maximumLength, string.Empty);
            if (removeLeadingHash)
            {
                value = value.TrimStart('#');
            }

            if (value.Length > 0)
            {
                normalized.Add(value);
            }
        }

        return normalized
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ThenBy(value => value, StringComparer.Ordinal)
            .Take(MaximumMetadataValues)
            .ToArray();
    }

    private static IReadOnlyList<LinkReference> ParseLinks(string body, out bool truncated)
    {
        var links = new List<LinkReference>();
        truncated = false;
        try
        {
            foreach (Match match in WikiLinkPattern().Matches(body))
            {
                var parsed = ParseWikiReference(body, match);
                if (parsed is not null)
                {
                    links.Add(parsed);
                }

                if (links.Count >= MaximumLinksPerNote)
                {
                    truncated = true;
                    return links;
                }
            }

            foreach (Match match in MarkdownLinkPattern().Matches(body))
            {
                var parsed = ParseMarkdownReference(body, match);
                if (parsed is not null)
                {
                    links.Add(parsed);
                }

                if (links.Count >= MaximumLinksPerNote)
                {
                    truncated = true;
                    return links;
                }
            }
        }
        catch (RegexMatchTimeoutException)
        {
            truncated = true;
        }

        return links;
    }

    private static LinkReference? ParseWikiReference(string body, Match match)
    {
        var destination = match.Groups["destination"].Value.Trim();
        var aliasSeparator = destination.IndexOf('|');
        string? displayText = null;
        if (aliasSeparator >= 0)
        {
            displayText = SanitizeOptionalExportValue(
                destination[(aliasSeparator + 1)..],
                MaximumTitleLength);
            destination = destination[..aliasSeparator].Trim();
        }

        var parsed = ParseTargetAndFragment(destination, markdownLink: false);
        var annotation = ExtractRelationAnnotation(body, match);
        return parsed is null
            ? null
            : new LinkReference(
                parsed.Value.Target,
                match.Groups["embed"].Success ? "embed" : "link",
                "wikilink",
                parsed.Value.FragmentKind,
                parsed.Value.Fragment,
                displayText,
                annotation.RelationType,
                annotation.RelationValues);
    }

    private static LinkReference? ParseMarkdownReference(string body, Match match)
    {
        var destination = ExtractMarkdownDestination(match.Groups["destination"].Value);
        if (destination is null)
        {
            return null;
        }

        var parsed = ParseTargetAndFragment(destination, markdownLink: true);
        var annotation = ExtractRelationAnnotation(body, match);
        return parsed is null
            ? null
            : new LinkReference(
                parsed.Value.Target,
                match.Groups["embed"].Success ? "embed" : "link",
                "markdown",
                parsed.Value.FragmentKind,
                parsed.Value.Fragment,
                SanitizeOptionalExportValue(match.Groups["display"].Value, MaximumTitleLength),
                annotation.RelationType,
                annotation.RelationValues);
    }

    private static RelationAnnotation ExtractRelationAnnotation(string body, Match match)
    {
        var lineEnd = body.IndexOfAny(['\r', '\n'], match.Index + match.Length);
        if (lineEnd < 0)
        {
            lineEnd = body.Length;
        }

        var suffix = body[(match.Index + match.Length)..lineEnd];
        var annotation = RelationAnnotationPattern().Match(suffix);
        if (!annotation.Success)
        {
            return RelationAnnotation.Empty;
        }

        var relationType = SanitizeOptionalExportValue(
            annotation.Groups["type"].Value,
            MaximumTagLength);
        if (relationType is null)
        {
            return RelationAnnotation.Empty;
        }

        var values = annotation.Groups["values"].Value
            .Split(['、', ',', '，', ';', '；', '|'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(value => SanitizeOptionalExportValue(
                value.Trim().TrimEnd('.', '。'),
                MaximumAliasLength))
            .Where(value => value is not null)
            .Cast<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ThenBy(value => value, StringComparer.Ordinal)
            .Take(MaximumMetadataValues)
            .ToArray();
        return new RelationAnnotation(relationType, values);
    }

    private static string? ExtractMarkdownDestination(string rawValue)
    {
        var value = rawValue.Trim();
        if (value.StartsWith('<'))
        {
            var closing = value.IndexOf('>');
            return closing > 1 ? value[1..closing].Trim() : null;
        }

        var markdownExtension = value.IndexOf(".md", StringComparison.OrdinalIgnoreCase);
        if (markdownExtension < 0)
        {
            return null;
        }

        var destinationEnd = markdownExtension + 3;
        if (destinationEnd < value.Length && value[destinationEnd] == '#')
        {
            destinationEnd++;
            while (destinationEnd < value.Length)
            {
                if (char.IsWhiteSpace(value[destinationEnd]) &&
                    destinationEnd + 1 < value.Length &&
                    value[destinationEnd + 1] is '\'' or '"')
                {
                    break;
                }
                destinationEnd++;
            }
        }

        return value[..destinationEnd].Trim();
    }

    private static (string Target, string? FragmentKind, string? Fragment)? ParseTargetAndFragment(
        string rawDestination,
        bool markdownLink)
    {
        var destination = rawDestination.Trim();
        if (destination.Length == 0)
        {
            return null;
        }

        try
        {
            destination = Uri.UnescapeDataString(destination);
        }
        catch (UriFormatException)
        {
            return null;
        }

        var fragmentSeparator = destination.IndexOf('#');
        var target = fragmentSeparator >= 0 ? destination[..fragmentSeparator].Trim() : destination;
        var rawFragment = fragmentSeparator >= 0 ? destination[(fragmentSeparator + 1)..].Trim() : null;
        string? fragmentKind = null;
        string? fragment = null;
        if (!string.IsNullOrWhiteSpace(rawFragment))
        {
            fragmentKind = rawFragment.StartsWith('^') ? "block" : "heading";
            fragment = SanitizeExportValue(
                fragmentKind == "block" ? rawFragment[1..] : rawFragment,
                MaximumFragmentLength,
                string.Empty);
            if (fragment.Length == 0)
            {
                fragmentKind = null;
                fragment = null;
            }
        }
        else if (!markdownLink && target.StartsWith('^'))
        {
            fragmentKind = "block";
            fragment = SanitizeExportValue(target[1..], MaximumFragmentLength, string.Empty);
            target = string.Empty;
        }

        if (markdownLink && !target.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (!markdownLink && target.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
        {
            target = target[..^3];
        }

        return (target, fragmentKind, fragment);
    }

    private static string MaskIgnoredMarkdown(string markdown)
    {
        var output = new StringBuilder(markdown.Length);
        var inFence = false;
        var fenceCharacter = '\0';
        var fenceLength = 0;
        var inComment = false;
        using var reader = new StringReader(markdown);
        while (reader.ReadLine() is { } line)
        {
            var trimmed = line.TrimStart();
            var markerLength = CountFenceMarker(trimmed, out var markerCharacter);
            if (!inComment && markerLength >= 3)
            {
                if (!inFence)
                {
                    inFence = true;
                    fenceCharacter = markerCharacter;
                    fenceLength = markerLength;
                    output.AppendLine();
                    continue;
                }

                if (markerCharacter == fenceCharacter && markerLength >= fenceLength)
                {
                    inFence = false;
                    output.AppendLine();
                    continue;
                }
            }

            if (inFence)
            {
                output.AppendLine();
                continue;
            }

            output.Append(MaskInlineCodeAndComments(line, ref inComment));
            output.AppendLine();
        }

        return output.ToString();
    }

    private static int CountFenceMarker(string line, out char marker)
    {
        marker = line.Length > 0 ? line[0] : '\0';
        if (marker is not ('`' or '~'))
        {
            return 0;
        }

        var count = 0;
        while (count < line.Length && line[count] == marker)
        {
            count++;
        }

        return count;
    }

    private static string MaskInlineCodeAndComments(string line, ref bool inComment)
    {
        var output = new StringBuilder(line.Length);
        for (var index = 0; index < line.Length;)
        {
            if (inComment)
            {
                var commentEnd = line.IndexOf("-->", index, StringComparison.Ordinal);
                if (commentEnd < 0)
                {
                    return output.ToString();
                }

                inComment = false;
                index = commentEnd + 3;
                continue;
            }

            if (line.AsSpan(index).StartsWith("<!--", StringComparison.Ordinal))
            {
                inComment = true;
                index += 4;
                continue;
            }

            if (line[index] != '`')
            {
                output.Append(line[index++]);
                continue;
            }

            var runLength = 1;
            while (index + runLength < line.Length && line[index + runLength] == '`')
            {
                runLength++;
            }

            var closing = line.IndexOf(new string('`', runLength), index + runLength, StringComparison.Ordinal);
            index = closing < 0 ? line.Length : closing + runLength;
        }

        return output.ToString();
    }

    private static string SanitizeValue(string? value, int maximumLength, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        var normalized = new string(value
            .Where(character => !char.IsControl(character))
            .ToArray())
            .Trim();
        if (normalized.Length == 0)
        {
            return fallback;
        }

        return normalized.Length <= maximumLength ? normalized : normalized[..maximumLength];
    }

    private static string SanitizeExportValue(string? value, int maximumLength, string fallback)
    {
        var normalized = SanitizeValue(value, maximumLength, string.Empty);
        return normalized.Length == 0 || LooksLikeAbsolutePath(normalized)
            ? fallback
            : normalized;
    }

    private static string? SanitizeOptionalExportValue(string? value, int maximumLength)
    {
        var normalized = SanitizeExportValue(value, maximumLength, string.Empty);
        return normalized.Length == 0 ? null : normalized;
    }

    private static bool LooksLikeAbsolutePath(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.StartsWith('/') ||
            trimmed.StartsWith('\\') ||
            trimmed.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        for (var index = 0; index + 2 < trimmed.Length; index++)
        {
            if (char.IsLetter(trimmed[index]) &&
                trimmed[index + 1] == ':' &&
                trimmed[index + 2] is '/' or '\\')
            {
                return true;
            }
        }

        return trimmed.Contains("\\\\", StringComparison.Ordinal);
    }

    private static string FileNameWithoutMarkdownExtension(string relativePath)
    {
        var slash = relativePath.LastIndexOf('/');
        var fileName = slash >= 0 ? relativePath[(slash + 1)..] : relativePath;
        return fileName.EndsWith(".md", StringComparison.OrdinalIgnoreCase)
            ? fileName[..^3]
            : fileName;
    }

    private static string GroupForRelativePath(string relativePath)
    {
        var separator = relativePath.IndexOf('/');
        return separator > 0 ? relativePath[..separator] : "vault-root";
    }

    private static string CreateStableEdgeId(EdgeKey edge)
    {
        var value = string.Join(
            '\u001f',
            edge.Source,
            edge.Target,
            edge.Kind,
            edge.FragmentKind ?? string.Empty,
            edge.Fragment ?? string.Empty);
        if (!string.IsNullOrWhiteSpace(edge.RelationType))
        {
            value += $"\u001f{edge.RelationType}";
        }

        return $"edge-{ComputeStableHash(value):x16}";
    }

    private static string CreateStableRevision(
        IEnumerable<ObsidianGraphNode> nodes,
        IEnumerable<ObsidianGraphEdge> edges)
    {
        var value = new StringBuilder();
        foreach (var node in nodes)
        {
            value.Append(node.Id).Append('\u001f')
                .Append(node.RelativePath).Append('\u001f')
                .Append(node.Title).Append('\u001f')
                .Append(node.Kind).Append('\u001f')
                .Append(node.Group).Append('\u001f')
                .AppendJoin('\u001e', node.Tags).Append('\u001f')
                .AppendJoin('\u001e', node.Aliases).Append('\u001f')
                .Append(node.Resolved ? '1' : '0').Append('\u001f')
                .Append(node.Degree.ToString(CultureInfo.InvariantCulture)).Append('\u001f')
                .Append(StableDoubleBits(node.Weight)).Append('\u001f')
                .Append(StableNullableDoubleBits(node.X)).Append('\u001f')
                .Append(StableNullableDoubleBits(node.Y)).Append('\u001f')
                .Append(StableNullableDoubleBits(node.Z)).Append('\u001d');
        }

        foreach (var edge in edges)
        {
            value.Append(edge.Id).Append('\u001f')
                .Append(edge.Source).Append('\u001f')
                .Append(edge.Target).Append('\u001f')
                .Append(edge.Kind).Append('\u001f')
                .Append(edge.Syntax).Append('\u001f')
                .Append(edge.FragmentKind).Append('\u001f')
                .Append(edge.Fragment).Append('\u001f')
                .Append(edge.DisplayText).Append('\u001f')
                .Append(edge.RelationType).Append('\u001f')
                .AppendJoin('\u001e', edge.RelationValues).Append('\u001f')
                .Append(edge.OccurrenceCount.ToString(CultureInfo.InvariantCulture)).Append('\u001f')
                .Append(StableDoubleBits(edge.Weight)).Append('\u001d');
        }

        return $"obsidian-v1-{ComputeStableHash(value.ToString()):x16}";
    }

    private static string StableDoubleBits(double value) =>
        BitConverter.DoubleToInt64Bits(value).ToString("x16", CultureInfo.InvariantCulture);

    private static string StableNullableDoubleBits(double? value) =>
        value.HasValue ? StableDoubleBits(value.Value) : "null";

    private static ulong ComputeStableHash(string value)
    {
        const ulong offset = 14695981039346656037;
        const ulong prime = 1099511628211;
        var hash = offset;
        foreach (var octet in Encoding.UTF8.GetBytes(value))
        {
            hash ^= octet;
            hash *= prime;
        }

        return hash;
    }

    [GeneratedRegex(
        @"(?<embed>!)?\[\[(?<destination>[^\]\r\n]{1,2048})\]\]",
        RegexOptions.CultureInvariant,
        matchTimeoutMilliseconds: 500)]
    private static partial Regex WikiLinkPattern();

    [GeneratedRegex(
        @"(?<embed>!)?\[(?<display>[^\]\r\n]{0,1024})\]\(\s*(?<destination><[^>\r\n]{1,2048}>|[^)\r\n]{1,2048})\s*\)",
        RegexOptions.CultureInvariant,
        matchTimeoutMilliseconds: 500)]
    private static partial Regex MarkdownLinkPattern();

    [GeneratedRegex(
        @"^[ \t]*(?:—|–|-{1,2})[ \t]*(?<type>[^：:\r\n]{1,128})[ \t]*[：:][ \t]*(?<values>[^\r\n]{0,1024})",
        RegexOptions.CultureInvariant,
        matchTimeoutMilliseconds: 100)]
    private static partial Regex RelationAnnotationPattern();

    private sealed class NoteIndex
    {
        private readonly Dictionary<string, ParsedNote> _byPath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, List<ParsedNote>> _byFileName = new(StringComparer.OrdinalIgnoreCase);

        public NoteIndex(IEnumerable<ParsedNote> notes)
        {
            foreach (var note in notes)
            {
                var key = WithoutMarkdownExtension(note.RelativePath);
                _byPath[key] = note;
                var fileName = FileNameWithoutMarkdownExtension(note.RelativePath);
                if (!_byFileName.TryGetValue(fileName, out var matches))
                {
                    matches = new List<ParsedNote>();
                    _byFileName.Add(fileName, matches);
                }

                matches.Add(note);
            }

            foreach (var matches in _byFileName.Values)
            {
                matches.Sort(ParsedNoteComparer.Instance);
            }
        }

        public LinkResolution Resolve(ParsedNote source, LinkReference link)
        {
            if (string.IsNullOrWhiteSpace(link.Target))
            {
                return new LinkResolution(LinkResolutionStatus.Resolved, source);
            }

            if (!TryNormalizeLinkTarget(link.Target, out var target))
            {
                return new LinkResolution(LinkResolutionStatus.Invalid, null);
            }

            var sourceDirectory = RelativeDirectory(source.RelativePath);
            var candidateKeys = new List<string>(2);
            if (link.Syntax == "markdown")
            {
                AddCandidate(candidateKeys, NormalizeRelativeSegments(sourceDirectory, target));
                AddCandidate(candidateKeys, NormalizeRelativeSegments(string.Empty, target));
            }
            else if (target.Contains('/'))
            {
                AddCandidate(candidateKeys, NormalizeRelativeSegments(string.Empty, target));
                AddCandidate(candidateKeys, NormalizeRelativeSegments(sourceDirectory, target));
            }
            else
            {
                AddCandidate(candidateKeys, NormalizeRelativeSegments(sourceDirectory, target));
                AddCandidate(candidateKeys, NormalizeRelativeSegments(string.Empty, target));
            }

            foreach (var candidate in candidateKeys)
            {
                if (_byPath.TryGetValue(candidate, out var note))
                {
                    return new LinkResolution(LinkResolutionStatus.Resolved, note);
                }
            }

            if (candidateKeys.Count == 0 &&
                target.Split('/', StringSplitOptions.RemoveEmptyEntries)
                    .Any(segment => segment.Equals("..", StringComparison.Ordinal)))
            {
                return new LinkResolution(LinkResolutionStatus.Invalid, null);
            }

            var fileName = FileNameWithoutMarkdownExtension(target);
            return _byFileName.TryGetValue(fileName, out var matches) && matches.Count > 0
                ? new LinkResolution(LinkResolutionStatus.Resolved, matches[0])
                : new LinkResolution(LinkResolutionStatus.NotFound, null);
        }

        private static bool TryNormalizeLinkTarget(string rawTarget, out string target)
        {
            target = rawTarget.Trim().Replace('\\', '/');
            if (target.Length == 0 || target.Length > 2048 || target.IndexOf('\0') >= 0)
            {
                return false;
            }

            if (target.StartsWith('/') || target.StartsWith("//", StringComparison.Ordinal) ||
                target.Contains("://", StringComparison.Ordinal) ||
                (target.Length >= 2 && char.IsLetter(target[0]) && target[1] == ':'))
            {
                return false;
            }

            if (target.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
            {
                target = target[..^3];
            }

            return target.Length > 0;
        }

        private static void AddCandidate(List<string> candidates, string? candidate)
        {
            if (candidate is not null && !candidates.Contains(candidate, StringComparer.OrdinalIgnoreCase))
            {
                candidates.Add(candidate);
            }
        }

        private static string? NormalizeRelativeSegments(string baseDirectory, string target)
        {
            var segments = new List<string>();
            if (!string.IsNullOrWhiteSpace(baseDirectory))
            {
                segments.AddRange(baseDirectory.Split('/', StringSplitOptions.RemoveEmptyEntries));
            }

            foreach (var segment in target.Split('/', StringSplitOptions.RemoveEmptyEntries))
            {
                if (segment.Equals(".", StringComparison.Ordinal))
                {
                    continue;
                }

                if (segment.Equals("..", StringComparison.Ordinal))
                {
                    if (segments.Count == 0)
                    {
                        return null;
                    }

                    segments.RemoveAt(segments.Count - 1);
                    continue;
                }

                segments.Add(segment);
            }

            return segments.Count == 0 ? null : string.Join('/', segments);
        }

        private static string WithoutMarkdownExtension(string relativePath) =>
            relativePath.EndsWith(".md", StringComparison.OrdinalIgnoreCase)
                ? relativePath[..^3]
                : relativePath;

        private static string RelativeDirectory(string relativePath)
        {
            var slash = relativePath.LastIndexOf('/');
            return slash > 0 ? relativePath[..slash] : string.Empty;
        }
    }

    private sealed class StablePathComparer : IComparer<string>
    {
        public static StablePathComparer Instance { get; } = new();

        public int Compare(string? left, string? right)
        {
            var insensitive = StringComparer.OrdinalIgnoreCase.Compare(left, right);
            return insensitive != 0 ? insensitive : StringComparer.Ordinal.Compare(left, right);
        }
    }

    private sealed class ParsedNoteComparer : IComparer<ParsedNote>
    {
        public static ParsedNoteComparer Instance { get; } = new();

        public int Compare(ParsedNote? left, ParsedNote? right) =>
            StablePathComparer.Instance.Compare(left?.RelativePath, right?.RelativePath);
    }

    private enum LinkResolutionStatus
    {
        Resolved,
        NotFound,
        Invalid
    }

    private sealed record VaultCandidate(string? FullPath, string Name, string Resolution);

    private sealed record DiscoveryResult(
        List<DiscoveredMarkdownFile> Files,
        int SkippedDirectoryCount,
        int SkippedFileCount,
        bool Truncated);

    private readonly record struct FileStamp(long LastWriteTimeUtcTicks, long Length);

    private sealed record DiscoveredMarkdownFile(
        string FullPath,
        string RelativePath,
        FileStamp Stamp);

    private sealed record CachedNote(
        FileStamp Stamp,
        ParsedNote? Note,
        bool CompleteForGlobalBudget);

    private sealed record VaultScanResult(
        ObsidianGraphSnapshot Snapshot,
        IReadOnlyDictionary<string, CachedNote> Cache);

    private sealed class WatcherRegistration
    {
        public WatcherRegistration(IObsidianVaultWatcher watcher, string vaultRoot)
        {
            Watcher = watcher;
            VaultRoot = vaultRoot;
        }

        public IObsidianVaultWatcher Watcher { get; }

        public string VaultRoot { get; }

        public HashSet<string> PendingChanges { get; } = new(StringComparer.OrdinalIgnoreCase);

        public EventHandler<ObsidianVaultChange> ChangedHandler { get; set; } = null!;

        public EventHandler OverflowedHandler { get; set; } = null!;

        public long ChangeGeneration { get; set; }

        public bool ForceFullRescan { get; set; }

        public bool AcceptingEvents { get; set; } = true;
    }

    private sealed record ParsedNote(
        string RelativePath,
        string Title,
        string[] Tags,
        string[] Aliases,
        IReadOnlyList<LinkReference> Links,
        bool LinksTruncated);

    private sealed record ParsedFrontMatter(
        string? Title,
        IReadOnlyList<string> Tags,
        IReadOnlyList<string> Aliases,
        string Body);

    private sealed record LinkReference(
        string Target,
        string Kind,
        string Syntax,
        string? FragmentKind,
        string? Fragment,
        string? DisplayText,
        string? RelationType,
        IReadOnlyList<string> RelationValues);

    private sealed record RelationAnnotation(
        string? RelationType,
        IReadOnlyList<string> RelationValues)
    {
        public static RelationAnnotation Empty { get; } = new(null, Array.Empty<string>());
    }

    private readonly record struct EdgeKey(
        string Source,
        string Target,
        string Kind,
        string? FragmentKind,
        string? Fragment,
        string? RelationType);

    private sealed class EdgeAggregate
    {
        private readonly HashSet<string> _relationValues = new(StringComparer.OrdinalIgnoreCase);

        public EdgeAggregate(LinkReference link)
        {
            Syntax = link.Syntax;
            DisplayText = link.DisplayText;
            AddRelationValues(link.RelationValues);
            OccurrenceCount = 1;
        }

        public string Syntax { get; }

        public string? DisplayText { get; private set; }

        public int OccurrenceCount { get; private set; }

        public string[] RelationValues => _relationValues
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ThenBy(value => value, StringComparer.Ordinal)
            .ToArray();

        public void AddOccurrence(LinkReference link)
        {
            OccurrenceCount++;
            DisplayText ??= link.DisplayText;
            AddRelationValues(link.RelationValues);
        }

        private void AddRelationValues(IEnumerable<string> relationValues)
        {
            foreach (var value in relationValues)
            {
                if (_relationValues.Count >= MaximumMetadataValues)
                {
                    return;
                }

                _relationValues.Add(value);
            }
        }
    }

    private readonly record struct LinkResolution(
        LinkResolutionStatus Status,
        ParsedNote? Target);

    public void Dispose()
    {
        try
        {
            _lifetimeCancellation.Cancel();
        }
        catch (ObjectDisposedException)
        {
            return;
        }
        WatcherRegistration? watcher;
        Timer? timer;
        lock (_scanGate)
        {
            lock (_stateGate)
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                watcher = _watcher;
                if (watcher is not null)
                {
                    watcher.AcceptingEvents = false;
                }
                _watcher = null;
                timer = _changeTimer;
                _changeTimer = null;
                _pendingChanges.Clear();
                _noteCache.Clear();
                SnapshotChanged = null;
            }
        }

        timer?.Dispose();
        DisposeWatcher(watcher);
        _lifetimeCancellation.Dispose();
    }
}

internal sealed record ObsidianGraphSnapshot(
    int SchemaVersion,
    DateTimeOffset UpdatedAtUtc,
    ObsidianGraphSource Source,
    IReadOnlyList<ObsidianGraphNode> Nodes,
    IReadOnlyList<ObsidianGraphEdge> Edges,
    ObsidianGraphStats Stats);

internal sealed record ObsidianGraphSource(
    string Kind,
    string Name,
    bool Available,
    string Resolution,
    bool Simulation,
    string Revision);

internal sealed record ObsidianGraphNode(
    string Id,
    string RelativePath,
    string Title,
    string Kind,
    string Group,
    IReadOnlyList<string> Tags,
    IReadOnlyList<string> Aliases,
    bool Resolved,
    int Degree,
    double Weight,
    double? X,
    double? Y,
    double? Z);

internal sealed record ObsidianGraphEdge(
    string Id,
    string Source,
    string Target,
    string Kind,
    string Syntax,
    string? FragmentKind,
    string? Fragment,
    string? DisplayText,
    string? RelationType,
    IReadOnlyList<string> RelationValues,
    int OccurrenceCount,
    double Weight);

internal sealed record ObsidianGraphStats(
    int DiscoveredFileCount,
    int NodeCount,
    int EdgeCount,
    int ParsedLinkCount,
    int ResolvedLinkCount,
    int UnresolvedLinkCount,
    int SkippedLinkCount,
    int SkippedFileCount,
    int SkippedDirectoryCount,
    bool Truncated,
    bool Incremental,
    int ReusedFileCount);

internal sealed record ObsidianGraphManifest(
    int SchemaVersion,
    bool Available,
    string Revision,
    int NodeCount,
    int EdgeCount,
    int NodeChunkSize,
    int EdgeChunkSize,
    ObsidianGraphSource Source,
    ObsidianGraphStats Stats,
    DateTimeOffset UpdatedAtUtc,
    string Status);

internal sealed record ObsidianGraphChunk(
    int SchemaVersion,
    string Revision,
    IReadOnlyList<ObsidianGraphNode> Nodes,
    IReadOnlyList<ObsidianGraphEdge> Edges,
    int NextNodeOffset,
    int NextEdgeOffset,
    bool Complete);

internal sealed class ObsidianGraphRevisionMismatchException : Exception
{
    public ObsidianGraphRevisionMismatchException(string requestedRevision, string currentRevision)
        : base("The requested graph revision is stale; fetch a new manifest before continuing.")
    {
        RequestedRevision = requestedRevision;
        CurrentRevision = currentRevision;
    }

    public string RequestedRevision { get; }

    public string CurrentRevision { get; }
}
