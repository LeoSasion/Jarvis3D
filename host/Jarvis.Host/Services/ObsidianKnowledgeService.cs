using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Jarvis.Host.Services;

// On-demand knowledge operations are separate from the metadata-only scene contract.
internal sealed partial class ObsidianGraphService
{
    internal const int MaximumExcerptCharacters = 6_000;
    internal const int MaximumKnowledgeResults = 100;
    internal const int MaximumNeighborhoodNodes = 512;
    private const long MaximumKnowledgeIndexBytes = 32L * 1024 * 1024;
    private KnowledgeCatalog? _knowledgeCatalog;

    public KnowledgeSearchResult SearchKnowledge(
        string query = "", string tag = "", int offset = 0, int limit = 40,
        CancellationToken cancellationToken = default)
    {
        if (query.Length > 256 || tag.Length > 128) throw new ArgumentException("Search is too long.");
        ArgumentOutOfRangeException.ThrowIfNegative(offset);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(offset, MaximumDiscoveredFileCount);
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(limit, MaximumKnowledgeResults);
        var catalog = GetKnowledgeCatalog(cancellationToken);
        var words = query.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var matches = catalog.Nodes.Where(node =>
            (string.IsNullOrWhiteSpace(tag) || node.Tags.Contains(tag.TrimStart('#'), StringComparer.OrdinalIgnoreCase)) &&
            words.All(word => new[] { node.Title, node.RelativePath }.Concat(node.Aliases).Concat(node.Tags)
                .Any(value => value.Contains(word, StringComparison.OrdinalIgnoreCase))))
            .OrderByDescending(node => node.Title.Equals(query.Trim(), StringComparison.OrdinalIgnoreCase))
            .ThenBy(node => node.Title, StringComparer.OrdinalIgnoreCase).ToArray();
        var page = TakeBoundedPage(matches, offset, limit, MaximumChunkPayloadBytes - 256_000);
        return new KnowledgeSearchResult(catalog.Revision, page,
            matches.Length, offset, offset + page.Count, catalog.Truncated || page.Count < Math.Min(limit, Math.Max(0, matches.Length - offset)),
            catalog.Nodes.SelectMany(node => node.Tags).Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase).Take(256).ToArray());
    }

    public KnowledgeNeighborhood GetKnowledgeNeighborhood(
        string revision, string nodeId, int hops = 1, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(hops, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(hops, 2);
        var catalog = RequireKnowledgeCatalog(revision, nodeId, cancellationToken);
        var selected = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { nodeId };
        var frontier = new HashSet<string>(selected, StringComparer.OrdinalIgnoreCase);
        var truncated = catalog.Truncated;
        for (var hop = 0; hop < hops; hop++)
        {
            var next = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var edge in catalog.Edges)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var adjacent = frontier.Contains(edge.Source) ? edge.Target : frontier.Contains(edge.Target) ? edge.Source : null;
                if (adjacent is null || selected.Contains(adjacent)) continue;
                if (selected.Count >= MaximumNeighborhoodNodes) { truncated = true; continue; }
                selected.Add(adjacent);
                next.Add(adjacent);
            }
            frontier = next;
        }
        var candidates = catalog.Nodes.Where(node => selected.Contains(node.Id))
            .OrderByDescending(node => node.Id.Equals(nodeId, StringComparison.OrdinalIgnoreCase)).ToArray();
        var nodes = TakeBoundedPage(candidates, 0, MaximumNeighborhoodNodes, (MaximumChunkPayloadBytes - 32_000) / 2);
        truncated |= nodes.Count < candidates.Length;
        selected = nodes.Select(node => node.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var edgeCandidates = catalog.Edges.Where(edge => selected.Contains(edge.Source) && selected.Contains(edge.Target)).ToArray();
        var edges = TakeBoundedPage(edgeCandidates, 0, MaximumEdgeChunkSize, (MaximumChunkPayloadBytes - 32_000) / 2);
        var matchingEdges = catalog.Edges.Count(edge => selected.Contains(edge.Source) && selected.Contains(edge.Target));
        return new KnowledgeNeighborhood(catalog.Revision,
            nodes, edges,
            truncated || matchingEdges > edges.Count, hops);
    }

    public KnowledgeExcerpt ReadKnowledgeNote(
        string revision, string nodeId, int startLine = 1, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(startLine, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(startLine, 100_000);
        lock (_scanGate)
        {
            var catalog = RequireKnowledgeCatalog(revision, nodeId, cancellationToken);
            var node = catalog.Nodes.Single(node => node.Id.Equals(nodeId, StringComparison.OrdinalIgnoreCase));
            var path = ResolveKnowledgePath(catalog, node.Id);
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            VerifyOpenedKnowledgePath(stream, path);
            if (stream.Length > MaximumMarkdownFileBytes) throw new InvalidDataException("This note exceeds the reading limit.");
            // Revalidate every path component after opening, while the file cannot be replaced.
            _ = ResolveKnowledgePath(catalog, node.Id);
            using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            var content = new StringBuilder();
            var line = 1;
            var lineStart = 1;
            var lastLine = startLine;
            var truncated = false;
            while (reader.Read() is var value && value >= 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var character = (char)value;
                if (line >= startLine)
                {
                    if (content.Length >= MaximumExcerptCharacters) { truncated = true; break; }
                    content.Append(character);
                    lastLine = line;
                }
                if (character == '\n') line++;
                lineStart = line;
            }
            if (startLine > lineStart && content.Length == 0) throw new ArgumentException("The requested line is past the end of the note.");
            var body = content.ToString();
            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(body)));
            return new KnowledgeExcerpt(node.Id, node.Title, node.RelativePath, catalog.Revision,
                startLine, lastLine, body, truncated, digest);
        }
    }

    public object OpenKnowledgeNote(string revision, string nodeId, CancellationToken cancellationToken = default)
    {
        lock (_scanGate)
        {
            var catalog = RequireKnowledgeCatalog(revision, nodeId, cancellationToken);
            var path = ResolveKnowledgePath(catalog, nodeId);
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            VerifyOpenedKnowledgePath(stream, path);
            cancellationToken.ThrowIfCancellationRequested();
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            return new { opened = true };
        }
    }

    private KnowledgeCatalog RequireKnowledgeCatalog(string revision, string nodeId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(nodeId) || nodeId.Length > 1024) throw new ArgumentException("A valid note identifier is required.");
        var catalog = GetKnowledgeCatalog(cancellationToken);
        if (!catalog.Revision.Equals(revision, StringComparison.Ordinal))
            throw new ObsidianGraphRevisionMismatchException(revision, catalog.Revision);
        if (!catalog.Nodes.Any(node => node.Id.Equals(nodeId, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException("This note is not in the active knowledge source.");
        return catalog;
    }

    private static string ResolveKnowledgePath(KnowledgeCatalog catalog, string nodeId)
    {
        if (!catalog.Nodes.Any(node => node.Id.Equals(nodeId, StringComparison.OrdinalIgnoreCase)))
            throw new ArgumentException("Unknown note identifier.");
        var path = Path.GetFullPath(Path.Combine(catalog.Root, nodeId));
        if (NormalizeDiscoveredRelativePath(catalog.Root, path) is null ||
            !Path.GetExtension(path).Equals(".md", StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("The note is outside the selected source.");
        var relative = Path.GetRelativePath(catalog.Root, path);
        var current = catalog.Root;
        foreach (var component in new[] { "" }.Concat(relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)))
        {
            current = Path.Combine(current, component);
            var attributes = File.GetAttributes(current);
            if (attributes.HasFlag(FileAttributes.ReparsePoint) || attributes.HasFlag(FileAttributes.System))
                throw new UnauthorizedAccessException("Linked or system paths cannot be used as notes.");
        }
        return path;
    }

    private static void VerifyOpenedKnowledgePath(FileStream stream, string expectedPath)
    {
        if (!OperatingSystem.IsWindows()) return;
        var buffer = new StringBuilder(32_768);
        var length = GetFinalPathNameByHandle(stream.SafeFileHandle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0 || length >= buffer.Capacity) throw new UnauthorizedAccessException("The note identity could not be verified.");
        var path = buffer.ToString();
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) path = @"\\" + path[8..];
        else if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) path = path[4..];
        if (!PathsEqual(path, expectedPath)) throw new UnauthorizedAccessException("The opened note no longer matches the selected source.");
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint capacity, uint flags);

    private KnowledgeCatalog GetKnowledgeCatalog(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _ = GetDefaultSource(cancellationToken);
        lock (_scanGate)
        {
            string root;
            long generation;
            lock (_stateGate)
            {
                root = _activeVaultRoot ?? throw new InvalidOperationException("No knowledge source is connected.");
                generation = _changeGeneration;
            }
            if (_knowledgeCatalog is { } cached && cached.Root == root && cached.Generation == generation) return cached;
            var discovery = DiscoverMarkdownFiles(root, cancellationToken);
            var notes = new List<ParsedNote>();
            var bytes = 0L;
            var links = 0;
            var truncated = discovery.Truncated;
            foreach (var file in discovery.Files)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (file.Stamp.Length > MaximumMarkdownFileBytes) { truncated = true; continue; }
                if (bytes + file.Stamp.Length > MaximumKnowledgeIndexBytes) { truncated = true; break; }
                bytes += file.Stamp.Length;
                try
                {
                    ParsedNote? note;
                    lock (_stateGate)
                        note = _noteCache.TryGetValue(file.RelativePath, out var entry) && entry.Stamp == file.Stamp && entry.CompleteForGlobalBudget
                            ? entry.Note : null;
                    note ??= TryParseNote(file, cancellationToken);
                    if (note is null) continue;
                    var remaining = Math.Max(0, MaximumTotalParsedLinkCount - links);
                    if (note.Links.Count > remaining) { note = note with { Links = note.Links.Take(remaining).ToArray() }; truncated = true; }
                    links += note.Links.Count;
                    notes.Add(note);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { truncated = true; }
            }
            var index = new NoteIndex(notes);
            var edges = new List<ObsidianGraphEdge>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var note in notes)
            foreach (var link in note.Links)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var target = index.Resolve(note, link).Target;
                if (target is null) continue;
                var key = new EdgeKey(note.RelativePath, target.RelativePath, link.Kind, link.FragmentKind, link.Fragment, link.RelationType);
                var id = CreateStableEdgeId(key);
                if (!seen.Add(id)) continue;
                if (edges.Count >= MaximumEdgeCount) { truncated = true; continue; }
                edges.Add(new ObsidianGraphEdge(id, note.RelativePath, target.RelativePath, link.Kind, link.Syntax,
                    link.FragmentKind, link.Fragment, link.DisplayText, link.RelationType, link.RelationValues, 1, 1));
            }
            var degrees = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var edge in edges)
            {
                degrees[edge.Source] = degrees.GetValueOrDefault(edge.Source) + 1;
                degrees[edge.Target] = degrees.GetValueOrDefault(edge.Target) + 1;
            }
            var nodes = notes.Select(note => new ObsidianGraphNode(note.RelativePath, note.RelativePath, note.Title, "note",
                GroupForRelativePath(note.RelativePath), note.Tags, note.Aliases, true,
                degrees.GetValueOrDefault(note.RelativePath), 1 + Math.Log2(1 + degrees.GetValueOrDefault(note.RelativePath)), null, null, null)).ToArray();
            var revision = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                root + "\n" + generation + "\n" + CreateStableRevision(nodes, edges))));
            _knowledgeCatalog = new KnowledgeCatalog(root, generation, revision, nodes, edges, truncated);
            return _knowledgeCatalog;
        }
    }

    private sealed record KnowledgeCatalog(string Root, long Generation, string Revision,
        IReadOnlyList<ObsidianGraphNode> Nodes, IReadOnlyList<ObsidianGraphEdge> Edges, bool Truncated);
}

internal sealed record KnowledgeSearchResult(string Revision, IReadOnlyList<ObsidianGraphNode> Items,
    int Total, int Offset, int NextOffset, bool Truncated, IReadOnlyList<string> Tags);
internal sealed record KnowledgeNeighborhood(string Revision, IReadOnlyList<ObsidianGraphNode> Nodes,
    IReadOnlyList<ObsidianGraphEdge> Edges, bool Truncated, int Hops);
internal sealed record KnowledgeExcerpt(string NodeId, string Title, string RelativePath, string Revision,
    int StartLine, int EndLine, string Text, bool Truncated, string Digest);
