using System.IO;
using System.Text.Json;
using Jarvis.Host.Bridge;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class ObsidianGraphServiceTests
{
    [Fact]
    public void ParsesFrontMatterAndRecursivelyScansNormalVaultDirectories()
    {
        using var vault = new TemporaryVault();
        vault.Write(
            "Root.md",
            """
            ---
            title: "根节点标题"
            tags: [fashion, "知识 图谱", "#Graph"]
            aliases:
              - 根别名
              - 'ROOT Alias'
            original_path: C:\Private\source.md
            original_relation: "[[知识库/不应由 frontmatter 建边]]"
            ---
            这是不会进入结果的正文标记：PRIVATE_BODY_MARKER
            [[知识库/目标]]
            """);
        vault.Write("知识库/目标.md", "# 目标");
        vault.Write("管理索引/索引.md", "[[知识库/目标]]");
        vault.Write("skills/技能.md", "[[知识库/目标]]");
        vault.Write("scripts/脚本.md", "[[知识库/目标]]");
        vault.Write("transcripts/转写.md", "[[知识库/目标]]");
        vault.Write("任意目录/不应扫描.md", "[[知识库/目标]]");
        vault.Write(".obsidian/配置.md", "[[知识库/目标]]");
        vault.Write("知识库/node_modules/依赖.md", "[[知识库/目标]]");

        using var service = vault.CreateService();
        var snapshot = service.GetDefaultSource();

        Assert.True(snapshot.Source.Available);
        Assert.Equal("environment", snapshot.Source.Resolution);
        Assert.Equal(7, snapshot.Nodes.Count);
        Assert.Contains(snapshot.Nodes, node => node.RelativePath == "Root.md");
        Assert.Contains(snapshot.Nodes, node => node.RelativePath == "知识库/目标.md");
        Assert.Contains(snapshot.Nodes, node => node.RelativePath == "管理索引/索引.md");
        Assert.Contains(snapshot.Nodes, node => node.RelativePath == "skills/技能.md");
        Assert.Contains(snapshot.Nodes, node => node.RelativePath == "scripts/脚本.md");
        Assert.Contains(snapshot.Nodes, node => node.RelativePath == "transcripts/转写.md");
        Assert.Contains(snapshot.Nodes, node => node.RelativePath == "任意目录/不应扫描.md");
        Assert.DoesNotContain(snapshot.Nodes, node => node.RelativePath.Contains(".obsidian", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(snapshot.Nodes, node => node.RelativePath.Contains("node_modules", StringComparison.OrdinalIgnoreCase));

        var root = Assert.Single(snapshot.Nodes, node => node.RelativePath == "Root.md");
        Assert.Equal("Root.md", root.Id);
        Assert.Equal("根节点标题", root.Title);
        Assert.Equal(new[] { "fashion", "Graph", "知识 图谱" }, root.Tags);
        Assert.Equal(new[] { "ROOT Alias", "根别名" }, root.Aliases);
        Assert.Equal(6, snapshot.Edges.Count);

        var json = WebBridgePayloadPolicy.Serialize(
            snapshot,
            WebBridgePayloadPolicy.MaximumResponseBytes);
        using var document = JsonDocument.Parse(json);
        Assert.Equal(1, document.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(7, document.RootElement.GetProperty("nodes").GetArrayLength());
        var source = document.RootElement.GetProperty("source");
        Assert.False(source.GetProperty("simulation").GetBoolean());
        Assert.StartsWith("obsidian-v1-", source.GetProperty("revision").GetString());
        Assert.DoesNotContain(vault.Root, json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("C:\\Private", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("PRIVATE_BODY_MARKER", json, StringComparison.Ordinal);
        Assert.DoesNotContain("不应由 frontmatter 建边", json, StringComparison.Ordinal);
    }

    [Fact]
    public void ResolvesWikiEmbedHeadingBlockAndMarkdownLinksWithRelationSemantics()
    {
        using var vault = new TemporaryVault();
        vault.Write("知识库/目标.md", "# 目标\n^block-id");
        vault.Write(
            "Source.md",
            """
            [[知识库/目标|目标显示]] — 共同概念：版型、面料
            ![[知识库/目标#细节]] — 同一主题：工艺
            [[知识库/目标#^block-id]]
            [Markdown 目标](知识库/目标.md#章节)
            [重复显示](知识库/目标.md#章节)
            [[Missing]]
            [[C:\outside.md]]
            [外部](https://example.com/outside.md)
            `[[知识库/目标#代码示例]]`
            <!-- [[知识库/目标#注释]] -->
            ```md
            [[知识库/目标#围栏代码]]
            ```
            """);

        using var service = vault.CreateService();
        var snapshot = service.GetDefaultSource();

        Assert.Equal(2, snapshot.Nodes.Count);
        Assert.Equal(4, snapshot.Edges.Count);
        Assert.Equal(8, snapshot.Stats.ParsedLinkCount);
        Assert.Equal(5, snapshot.Stats.ResolvedLinkCount);
        Assert.Equal(1, snapshot.Stats.UnresolvedLinkCount);
        Assert.Equal(2, snapshot.Stats.SkippedLinkCount);

        var semantic = Assert.Single(snapshot.Edges, edge => edge.RelationType == "共同概念");
        Assert.Equal("目标显示", semantic.DisplayText);
        Assert.Equal(new[] { "版型", "面料" }, semantic.RelationValues);
        Assert.Equal(1, semantic.OccurrenceCount);

        var embed = Assert.Single(snapshot.Edges, edge => edge.Kind == "embed");
        Assert.Equal("heading", embed.FragmentKind);
        Assert.Equal("细节", embed.Fragment);
        Assert.Equal("同一主题", embed.RelationType);
        Assert.Equal(new[] { "工艺" }, embed.RelationValues);

        var block = Assert.Single(snapshot.Edges, edge => edge.FragmentKind == "block");
        Assert.Equal("block-id", block.Fragment);

        var markdown = Assert.Single(snapshot.Edges, edge => edge.Syntax == "markdown");
        Assert.Equal("章节", markdown.Fragment);
        Assert.Equal(2, markdown.OccurrenceCount);
        Assert.Equal("Markdown 目标", markdown.DisplayText);
        Assert.All(snapshot.Edges, edge =>
        {
            Assert.Equal("Source.md", edge.Source);
            Assert.Equal("知识库/目标.md", edge.Target);
        });
    }

    [Fact]
    public void RemovesAbsolutePathsFromResolvedLinkFragments()
    {
        using var vault = new TemporaryVault();
        vault.Write("Target.md", "# target");
        vault.Write(
            "Source.md",
            """
            [[Target#C:\Users\Alice\Vault\secret.md]]
            [[Target#\\server\share\secret.md]]
            [[Target#file:///C:/Users/Alice/Vault/secret.md]]
            [[Target#^D:\Private\block.md]]
            [Target](Target.md#C%3A%5CUsers%5CAlice%5CVault%5Csecret.md)
            """);

        using var service = vault.CreateService();
        var snapshot = service.GetDefaultSource();
        var edge = Assert.Single(snapshot.Edges);
        var json = WebBridgePayloadPolicy.Serialize(
            snapshot,
            WebBridgePayloadPolicy.MaximumResponseBytes);

        Assert.Null(edge.FragmentKind);
        Assert.Null(edge.Fragment);
        Assert.Equal(5, edge.OccurrenceCount);
        Assert.DoesNotContain("C:\\Users", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("D:\\Private", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("server\\share", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("file:", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void KeepsDifferentRelationTypesAsDistinctStableEdges()
    {
        using var vault = new TemporaryVault();
        vault.Write("Target.md", "# target");
        vault.Write(
            "Source.md",
            "[[Target]] — 共同概念：版型\n[[Target]] — 依赖：面料");

        using var service = vault.CreateService();
        var snapshot = service.GetDefaultSource();

        Assert.Equal(2, snapshot.Edges.Count);
        var concept = Assert.Single(snapshot.Edges, edge => edge.RelationType == "共同概念");
        var dependency = Assert.Single(snapshot.Edges, edge => edge.RelationType == "依赖");
        Assert.Equal(new[] { "版型" }, concept.RelationValues);
        Assert.Equal(new[] { "面料" }, dependency.RelationValues);
        Assert.NotEqual(concept.Id, dependency.Id);

        var refreshed = service.RefreshDefaultManifest();
        var refreshedSnapshot = service.GetDefaultSource();
        Assert.Equal(snapshot.Source.Revision, refreshed.Revision);
        Assert.Equal(
            concept.Id,
            Assert.Single(refreshedSnapshot.Edges, edge => edge.RelationType == "共同概念").Id);
        Assert.Equal(
            dependency.Id,
            Assert.Single(refreshedSnapshot.Edges, edge => edge.RelationType == "依赖").Id);
    }

    [Fact]
    public void MissingDocumentsDefaultReturnsAnEmptyUnavailableSnapshot()
    {
        using var documents = new TemporaryVault();
        using var service = new ObsidianGraphService(
            () => null,
            () => documents.Root);

        var snapshot = service.GetDefaultSource();

        Assert.False(snapshot.Source.Available);
        Assert.Equal("服装行业知识库", snapshot.Source.Name);
        Assert.Equal("documents-default", snapshot.Source.Resolution);
        Assert.Empty(snapshot.Nodes);
        Assert.Empty(snapshot.Edges);
        Assert.False(snapshot.Stats.Truncated);
    }

    [Fact]
    public void ConfiguredVaultTakesPriorityEvenWhenItIsMissing()
    {
        using var documents = new TemporaryVault();
        documents.Write("服装行业知识库/Root.md", "# fallback");
        var configured = Path.Combine(documents.Root, "missing-configured-vault");
        using var service = new ObsidianGraphService(
            () => configured,
            () => documents.Root);

        var snapshot = service.GetDefaultSource();

        Assert.False(snapshot.Source.Available);
        Assert.Equal("missing-configured-vault", snapshot.Source.Name);
        Assert.Equal("environment", snapshot.Source.Resolution);
        Assert.Empty(snapshot.Nodes);
    }

    [Fact]
    public void DetectsVaultAvailabilityTransitionsWithoutAWatcherEvent()
    {
        using var parent = new TemporaryVault();
        var vaultRoot = Path.Combine(parent.Root, "SwitchingVault");
        var watcherFactory = new FakeWatcherFactory();
        using var service = new ObsidianGraphService(
            () => vaultRoot,
            () => parent.Root,
            watcherFactory);

        var missing = service.GetDefaultSource();
        Assert.False(missing.Source.Available);

        parent.Write("SwitchingVault/A.md", "# available");
        var available = service.GetDefaultSource();
        Assert.True(available.Source.Available);
        Assert.Single(available.Nodes);

        Directory.Delete(vaultRoot, recursive: true);
        var missingAgain = service.GetDefaultSource();
        Assert.False(missingAgain.Source.Available);
        Assert.Empty(missingAgain.Nodes);
        Assert.True(watcherFactory.Watcher.Disposed);
    }

    [Fact]
    public void RejectsLinksThatEscapeTheVaultAndNeverReturnsAbsolutePathsOrBodies()
    {
        using var vault = new TemporaryVault();
        var outside = Path.Combine(Path.GetDirectoryName(vault.Root)!, "outside.md");
        vault.Write(
            "知识库/安全.md",
            $"""
            ---
            title: 安全节点
            aliases: ["{outside}"]
            ---
            SECRET_BODY_CONTENT
            [越界](../../outside.md)
            [[{outside}]]
            [URI](file:///C:/outside.md)
            """);

        using var service = vault.CreateService();
        var snapshot = service.GetDefaultSource();
        var json = WebBridgePayloadPolicy.Serialize(
            snapshot,
            WebBridgePayloadPolicy.MaximumResponseBytes);

        Assert.Single(snapshot.Nodes);
        Assert.Empty(snapshot.Nodes[0].Aliases);
        Assert.Empty(snapshot.Edges);
        Assert.Equal(3, snapshot.Stats.SkippedLinkCount);
        Assert.DoesNotContain(vault.Root, json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(outside, json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SECRET_BODY_CONTENT", json, StringComparison.Ordinal);
    }

    [Fact]
    public void HandlesEightHundredFortyTwoNodesWithStableVaultRelativeIds()
    {
        using var vault = new TemporaryVault();
        for (var index = 0; index < 842; index++)
        {
            var group = index % 2 == 0 ? "甲组" : "乙组";
            vault.Write($"知识库/{group}/节点-{index:D4}.md", $"[[节点-{(index + 1) % 842:D4}]]");
        }

        using var service = vault.CreateService();
        var first = service.GetDefaultSource();
        var second = service.GetDefaultSource();

        Assert.Equal(842, first.Nodes.Count);
        Assert.False(first.Stats.Truncated);
        Assert.Equal(first.Nodes.Select(node => node.Id), second.Nodes.Select(node => node.Id));
        Assert.Equal(first.Edges.Select(edge => edge.Id), second.Edges.Select(edge => edge.Id));
        Assert.Equal(842, first.Nodes.Select(node => node.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(first.Nodes, node =>
        {
            Assert.Equal(node.RelativePath, node.Id);
            Assert.False(Path.IsPathRooted(node.Id));
            Assert.DoesNotContain('\\', node.Id);
        });
    }

    [Fact]
    public void ReusesUnchangedParsedNotesAndRefreshesOnlyChangedFiles()
    {
        using var vault = new TemporaryVault();
        vault.Write("任意/A.md", "[[B]]");
        vault.Write("另一个深层目录/B.md", "# B");
        var factory = new FakeWatcherFactory();
        var reads = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        using var service = vault.CreateService(
            factory,
            path =>
            {
                reads[path] = reads.GetValueOrDefault(path) + 1;
                return File.ReadAllText(path);
            });

        var first = service.GetDefaultManifest();
        var cached = service.GetDefaultManifest();

        Assert.Equal(first.Revision, cached.Revision);
        Assert.Equal(2, reads.Values.Sum());

        var changedPath = vault.Write(
            "任意/A.md",
            "---\ntitle: changed and longer\n---\n[[B]]");
        factory.Watcher.RaiseChanged(changedPath);
        var refreshed = service.GetDefaultManifest();

        Assert.NotEqual(first.Revision, refreshed.Revision);
        Assert.True(refreshed.Stats.Incremental);
        Assert.Equal(1, refreshed.Stats.ReusedFileCount);
        Assert.Equal(3, reads.Values.Sum());
        Assert.Equal(2, reads[changedPath]);
    }

    [Fact]
    public void WatcherInvalidationWinsWhenLengthAndTimestampAreUnchanged()
    {
        using var vault = new TemporaryVault();
        var note = vault.Write("A.md", "---\ntitle: alpha\n---\n");
        var originalWriteTime = File.GetLastWriteTimeUtc(note);
        var factory = new FakeWatcherFactory();
        var reads = 0;
        using var service = vault.CreateService(
            factory,
            path =>
            {
                Interlocked.Increment(ref reads);
                return File.ReadAllText(path);
            });

        var first = service.GetDefaultSource();
        File.WriteAllText(note, "---\ntitle: bravo\n---\n");
        File.SetLastWriteTimeUtc(note, originalWriteTime);
        factory.Watcher.RaiseChanged(note);
        var second = service.GetDefaultSource();

        Assert.Equal("alpha", first.Nodes[0].Title);
        Assert.Equal("bravo", second.Nodes[0].Title);
        Assert.Equal(2, reads);
    }

    [Fact]
    public void WatcherSyntaxOnlyChangeInvalidatesRevisionAndRejectsStaleChunks()
    {
        using var vault = new TemporaryVault();
        vault.Write("Target.md", "# Target");
        var source = vault.Write("Source.md", "[[Target|Target]]");
        var factory = new FakeWatcherFactory();
        using var service = vault.CreateService(factory);

        var first = service.GetDefaultSource();
        var firstEdge = Assert.Single(first.Edges);
        Assert.Equal("wikilink", firstEdge.Syntax);

        vault.Write("Source.md", "[Target](Target.md)");
        factory.Watcher.RaiseChanged(source);
        var second = service.GetDefaultSource();
        var secondEdge = Assert.Single(second.Edges);

        Assert.Equal("markdown", secondEdge.Syntax);
        Assert.Equal(firstEdge.Id, secondEdge.Id);
        Assert.Equal(firstEdge.DisplayText, secondEdge.DisplayText);
        Assert.NotEqual(first.Source.Revision, second.Source.Revision);
        Assert.Throws<ObsidianGraphRevisionMismatchException>(() =>
            service.GetDefaultChunk(first.Source.Revision, 0, 2, 0, 2));
        Assert.Equal(
            "markdown",
            Assert.Single(service.GetDefaultChunk(
                second.Source.Revision,
                0,
                2,
                0,
                2).Edges).Syntax);
    }

    [Fact]
    public void WatcherCoversChangesThatArriveDuringTheInitialScan()
    {
        using var vault = new TemporaryVault();
        var note = vault.Write("A.md", "---\ntitle: alpha\n---\n");
        var originalWriteTime = File.GetLastWriteTimeUtc(note);
        var factory = new FakeWatcherFactory();
        var changedDuringScan = false;
        var watcherWasStarted = false;
        using var service = vault.CreateService(
            factory,
            path =>
            {
                var content = File.ReadAllText(path);
                if (!changedDuringScan)
                {
                    changedDuringScan = true;
                    watcherWasStarted = factory.Watcher.Started;
                    File.WriteAllText(path, "---\ntitle: bravo\n---\n");
                    File.SetLastWriteTimeUtc(path, originalWriteTime);
                    if (watcherWasStarted)
                    {
                        factory.Watcher.RaiseChanged(path);
                    }
                }

                return content;
            });

        var duringScan = service.GetDefaultSource();
        var refreshed = service.GetDefaultSource();

        Assert.True(watcherWasStarted);
        Assert.Equal("alpha", duringScan.Nodes[0].Title);
        Assert.Equal("bravo", refreshed.Nodes[0].Title);
    }

    [Fact]
    public void ExplicitRefreshForcesAFullReadOnlyReparse()
    {
        using var vault = new TemporaryVault();
        vault.Write("A.md", "[[B]]");
        vault.Write("B.md", "# B");
        var reads = 0;
        using var service = vault.CreateService(
            new FakeWatcherFactory(),
            path =>
            {
                Interlocked.Increment(ref reads);
                return File.ReadAllText(path);
            });

        var initial = service.GetDefaultManifest();
        var cached = service.GetDefaultManifest();
        var refreshed = service.RefreshDefaultManifest();

        Assert.Equal(initial.Revision, cached.Revision);
        Assert.Equal(initial.Revision, refreshed.Revision);
        Assert.Equal(4, reads);
        Assert.False(refreshed.Stats.Incremental);
        Assert.Equal(0, refreshed.Stats.ReusedFileCount);
    }

    [Fact]
    public void RenameAndDeleteEventsReplaceCachedPaths()
    {
        using var vault = new TemporaryVault();
        var source = vault.Write("任意/旧名称.md", "[[目标]]");
        var target = vault.Write("任意/目标.md", "# target");
        var factory = new FakeWatcherFactory();
        using var service = vault.CreateService(factory);
        var first = service.GetDefaultSource();
        Assert.Equal(2, first.Nodes.Count);

        var renamed = vault.Move("任意/旧名称.md", "任意/新名称.md");
        factory.Watcher.RaiseRenamed(source, renamed);
        var afterRename = service.GetDefaultSource();

        Assert.DoesNotContain(afterRename.Nodes, node => node.Id == "任意/旧名称.md");
        Assert.Contains(afterRename.Nodes, node => node.Id == "任意/新名称.md");
        Assert.NotEqual(first.Source.Revision, afterRename.Source.Revision);

        File.Delete(target);
        factory.Watcher.RaiseDeleted(target);
        var afterDelete = service.GetDefaultSource();

        Assert.Single(afterDelete.Nodes);
        Assert.Empty(afterDelete.Edges);
        Assert.Equal(1, afterDelete.Stats.UnresolvedLinkCount);
    }

    [Fact]
    public void OverflowForcesFullReparseThroughTestableWatcherAbstraction()
    {
        using var vault = new TemporaryVault();
        vault.Write("A.md", "[[B]]");
        vault.Write("B.md", "# B");
        var factory = new FakeWatcherFactory();
        var readCount = 0;
        using var service = vault.CreateService(
            factory,
            path =>
            {
                Interlocked.Increment(ref readCount);
                return File.ReadAllText(path);
            });

        _ = service.GetDefaultSource();
        Assert.Equal(2, readCount);

        factory.Watcher.RaiseOverflow();
        Assert.True(SpinWait.SpinUntil(() => Volatile.Read(ref readCount) >= 4, TimeSpan.FromSeconds(3)));
        var refreshed = service.GetDefaultManifest();

        Assert.False(refreshed.Stats.Incremental);
        Assert.Equal(0, refreshed.Stats.ReusedFileCount);
        Assert.True(factory.Watcher.Started);
    }

    [Fact]
    public void ScanFailureKeepsTheLastValidSnapshot()
    {
        using var vault = new TemporaryVault();
        var note = vault.Write("A.md", "---\ntitle: first\n---\n# body");
        var factory = new FakeWatcherFactory();
        var failReads = false;
        using var service = vault.CreateService(
            factory,
            path => failReads
                ? throw new IOException("simulated locked file")
                : File.ReadAllText(path));

        var valid = service.GetDefaultSource();
        vault.Write("A.md", "---\ntitle: second\n---\n# body with changed length");
        failReads = true;
        factory.Watcher.RaiseChanged(note);

        var fallback = service.GetDefaultSource();
        var manifest = service.GetDefaultManifest();

        Assert.Same(valid, fallback);
        Assert.Equal(valid.Source.Revision, fallback.Source.Revision);
        Assert.Equal("first", fallback.Nodes[0].Title);
        Assert.Equal("stale", manifest.Status);
    }

    [Fact]
    public void ConfigureVaultFailurePreservesThePreviousSelectionAndWatcher()
    {
        using var originalVault = new TemporaryVault();
        using var candidateVault = new TemporaryVault();
        using var settings = new TemporaryVault();
        var originalNote = originalVault.Write("A.md", "---\ntitle: original\n---\n");
        candidateVault.Write("B.md", "---\ntitle: candidate\n---\n");
        var configurationPath = settings.Write("obsidian-vault.txt", originalVault.Root);
        var factory = new RecordingWatcherFactory();
        using var service = new ObsidianGraphService(
            () => File.ReadAllText(configurationPath),
            () => throw new InvalidOperationException("Configured vault should take priority."),
            factory,
            path =>
            {
                if (path.StartsWith(
                        candidateVault.Root + Path.DirectorySeparatorChar,
                        StringComparison.OrdinalIgnoreCase))
                {
                    factory.Watchers[^1].RaiseChanged(path);
                    throw new IOException("simulated unreadable candidate");
                }

                return File.ReadAllText(path);
            },
            configurationPath);

        var original = service.GetDefaultSource();
        var originalWatcher = Assert.Single(factory.Watchers);

        Assert.Throws<IOException>(() => service.ConfigureVault(candidateVault.Root));

        Assert.Equal(originalVault.Root, File.ReadAllText(configurationPath));
        Assert.False(originalWatcher.Disposed);
        Assert.Same(original, service.GetDefaultSource());
        Assert.Equal(2, factory.Watchers.Count);
        Assert.True(factory.Watchers[1].Started);
        Assert.True(factory.Watchers[1].Disposed);

        originalVault.Write("A.md", "---\ntitle: refreshed\n---\n");
        originalWatcher.RaiseChanged(originalNote);
        var refreshed = service.GetDefaultSource();

        Assert.Equal("refreshed", refreshed.Nodes[0].Title);
        Assert.Equal(originalVault.Root, File.ReadAllText(configurationPath));
    }

    [Fact]
    public void ConfigureVaultCommitsTheValidatedCandidateAndSwapsWatchers()
    {
        using var originalVault = new TemporaryVault();
        using var candidateVault = new TemporaryVault();
        using var settings = new TemporaryVault();
        originalVault.Write("A.md", "---\ntitle: original\n---\n");
        candidateVault.Write("B.md", "---\ntitle: candidate\n---\n");
        var configurationPath = settings.Write("obsidian-vault.txt", originalVault.Root);
        var factory = new RecordingWatcherFactory();
        using var service = new ObsidianGraphService(
            () => File.ReadAllText(configurationPath),
            () => throw new InvalidOperationException("Configured vault should take priority."),
            factory,
            File.ReadAllText,
            configurationPath);

        _ = service.GetDefaultSource();
        var originalWatcher = Assert.Single(factory.Watchers);
        var configured = service.ConfigureVault(candidateVault.Root);

        Assert.Equal(candidateVault.Root, File.ReadAllText(configurationPath));
        Assert.Equal(Path.GetFileName(candidateVault.Root), configured.Source.Name);
        Assert.Equal("native-picker", configured.Source.Resolution);
        Assert.Equal("candidate", service.GetDefaultSource().Nodes[0].Title);
        Assert.True(originalWatcher.Disposed);
        Assert.Equal(2, factory.Watchers.Count);
        Assert.True(factory.Watchers[1].Started);
        Assert.False(factory.Watchers[1].Disposed);
    }

    [Fact]
    public void ConfigureVaultReplaysCandidateChangesThatArriveDuringTheScan()
    {
        using var originalVault = new TemporaryVault();
        using var candidateVault = new TemporaryVault();
        using var settings = new TemporaryVault();
        originalVault.Write("A.md", "---\ntitle: original\n---\n");
        var candidateNote = candidateVault.Write("B.md", "---\ntitle: alpha\n---\n");
        var candidateWriteTime = File.GetLastWriteTimeUtc(candidateNote);
        var configurationPath = settings.Write("obsidian-vault.txt", originalVault.Root);
        var factory = new RecordingWatcherFactory();
        var candidateReads = 0;
        var candidateWatcherWasStarted = false;
        using var service = new ObsidianGraphService(
            () => File.ReadAllText(configurationPath),
            () => throw new InvalidOperationException("Configured vault should take priority."),
            factory,
            path =>
            {
                var content = File.ReadAllText(path);
                if (path.Equals(candidateNote, StringComparison.OrdinalIgnoreCase) &&
                    Interlocked.Increment(ref candidateReads) == 1)
                {
                    candidateWatcherWasStarted = factory.Watchers[^1].Started;
                    File.WriteAllText(path, "---\ntitle: bravo\n---\n");
                    File.SetLastWriteTimeUtc(path, candidateWriteTime);
                    if (candidateWatcherWasStarted)
                    {
                        factory.Watchers[^1].RaiseChanged(path);
                    }
                }

                return content;
            },
            configurationPath);

        _ = service.GetDefaultSource();
        var configured = service.ConfigureVault(candidateVault.Root);
        var refreshed = service.GetDefaultSource();

        Assert.True(candidateWatcherWasStarted);
        Assert.True(Volatile.Read(ref candidateReads) >= 2);
        Assert.NotEqual(configured.Revision, refreshed.Source.Revision);
        Assert.Equal("bravo", refreshed.Nodes[0].Title);
        Assert.Equal(candidateVault.Root, File.ReadAllText(configurationPath));
    }

    [Fact]
    public void ConfigureVaultPersistenceFailurePreservesThePreviousSelectionAndCleansTheTemporaryFile()
    {
        using var originalVault = new TemporaryVault();
        using var candidateVault = new TemporaryVault();
        using var settings = new TemporaryVault();
        originalVault.Write("A.md", "---\ntitle: original\n---\n");
        candidateVault.Write("B.md", "---\ntitle: candidate\n---\n");
        var invalidConfigurationPath = settings.Root;
        var configurationDirectory = Path.GetDirectoryName(invalidConfigurationPath)!;
        var temporaryPattern = $".{Path.GetFileName(invalidConfigurationPath)}.*.tmp";
        var factory = new RecordingWatcherFactory();
        using var service = new ObsidianGraphService(
            () => originalVault.Root,
            () => throw new InvalidOperationException("Configured vault should take priority."),
            factory,
            File.ReadAllText,
            invalidConfigurationPath);

        var original = service.GetDefaultSource();
        var originalWatcher = Assert.Single(factory.Watchers);
        var exception = Record.Exception(() => service.ConfigureVault(candidateVault.Root));

        Assert.True(exception is IOException or UnauthorizedAccessException);
        Assert.True(Directory.Exists(invalidConfigurationPath));
        Assert.Empty(Directory.GetFiles(configurationDirectory, temporaryPattern));
        Assert.False(originalWatcher.Disposed);
        Assert.Same(original, service.GetDefaultSource());
        Assert.Equal(Path.GetFileName(originalVault.Root), original.Source.Name);
        Assert.Equal(2, factory.Watchers.Count);
        Assert.True(factory.Watchers[1].Started);
        Assert.True(factory.Watchers[1].Disposed);
    }

    [Fact]
    public void WatcherFailureRetriesUseBoundedExponentialBackoff()
    {
        Assert.Equal(750, ObsidianGraphService.GetWatcherRetryDelayMilliseconds(1));
        Assert.Equal(1_500, ObsidianGraphService.GetWatcherRetryDelayMilliseconds(2));
        Assert.Equal(30_000, ObsidianGraphService.GetWatcherRetryDelayMilliseconds(16));
    }

    [Fact]
    public void ParsedLinkCacheHasAGlobalBudget()
    {
        using var vault = new TemporaryVault();
        vault.Write("Target.md", "# target");
        var links = string.Join(' ', Enumerable.Repeat("[[Target]]", 1_024));
        for (var index = 0; index < 129; index++)
        {
            vault.Write($"Notes/{index:D3}.md", links);
        }

        using var service = vault.CreateService();
        var snapshot = service.GetDefaultSource();

        Assert.True(snapshot.Stats.Truncated);
        Assert.Equal(ObsidianGraphService.MaximumTotalParsedLinkCount, snapshot.Stats.ParsedLinkCount);
    }

    [Fact]
    public void ManifestAndChunksStayBoundedAndAllowZeroLimitsAfterOneSideCompletes()
    {
        using var vault = new TemporaryVault();
        for (var index = 0; index < 620; index++)
        {
            var next = (index + 1) % 620;
            vault.Write(
                $"目录/Node-{index:D4}.md",
                $"---\naliases: [alias-{index:D4}]\n---\n[[Node-{next:D4}]]");
        }

        using var service = vault.CreateService();
        var manifest = service.GetDefaultManifest();
        Assert.True(manifest.Available);
        Assert.Equal(620, manifest.NodeCount);
        Assert.Equal(620, manifest.EdgeCount);
        Assert.Equal(ObsidianGraphService.DefaultNodeChunkSize, manifest.NodeChunkSize);
        Assert.Equal(ObsidianGraphService.DefaultEdgeChunkSize, manifest.EdgeChunkSize);
        Assert.Equal("ready", manifest.Status);
        Assert.NotEqual(default, manifest.UpdatedAtUtc);

        var nodes = new List<ObsidianGraphNode>();
        var edges = new List<ObsidianGraphEdge>();
        var nodeOffset = 0;
        var edgeOffset = 0;
        var attempts = 0;
        while (nodeOffset < manifest.NodeCount || edgeOffset < manifest.EdgeCount)
        {
            Assert.True(attempts++ < 20, "Chunk pagination did not make bounded progress.");
            var chunk = service.GetDefaultChunk(
                manifest.Revision,
                nodeOffset,
                nodeOffset < manifest.NodeCount ? manifest.NodeChunkSize : 0,
                edgeOffset,
                edgeOffset < manifest.EdgeCount ? manifest.EdgeChunkSize : 0);
            var json = WebBridgePayloadPolicy.Serialize(
                chunk,
                ObsidianGraphService.MaximumChunkPayloadBytes + 4096);
            Assert.True(System.Text.Encoding.UTF8.GetByteCount(json) < 2 * 1024 * 1024);
            Assert.True(chunk.NextNodeOffset >= nodeOffset);
            Assert.True(chunk.NextEdgeOffset >= edgeOffset);
            nodes.AddRange(chunk.Nodes);
            edges.AddRange(chunk.Edges);
            nodeOffset = chunk.NextNodeOffset;
            edgeOffset = chunk.NextEdgeOffset;
        }

        Assert.Equal(manifest.NodeCount, nodes.Count);
        Assert.Equal(manifest.EdgeCount, edges.Count);
        Assert.True(service.GetDefaultChunk(
            manifest.Revision,
            nodeOffset,
            0,
            edgeOffset,
            0).Complete);
    }

    [Fact]
    public void ChunkRejectsARevisionThatBecameStale()
    {
        using var vault = new TemporaryVault();
        var note = vault.Write("A.md", "# A");
        var factory = new FakeWatcherFactory();
        using var service = vault.CreateService(factory);
        var manifest = service.GetDefaultManifest();

        vault.Write("A.md", "---\ntitle: A changed\n---\n# body");
        factory.Watcher.RaiseChanged(note);

        var exception = Assert.Throws<ObsidianGraphRevisionMismatchException>(() =>
            service.GetDefaultChunk(manifest.Revision, 0, 1, 0, 0));
        Assert.Equal(manifest.Revision, exception.RequestedRevision);
        Assert.NotEqual(exception.RequestedRevision, exception.CurrentRevision);
    }

    [Fact]
    public void ServiceDisposesItsWatcher()
    {
        using var vault = new TemporaryVault();
        vault.Write("A.md", "# A");
        var factory = new FakeWatcherFactory();
        var service = vault.CreateService(factory);
        _ = service.GetDefaultSource();

        service.Dispose();

        Assert.True(factory.Watcher.Disposed);
        Assert.Throws<ObjectDisposedException>(() => service.GetDefaultSource());
    }

    private sealed class TemporaryVault : IDisposable
    {
        public TemporaryVault()
        {
            Root = Path.Combine(
                Path.GetTempPath(),
                $"jarvis-obsidian-graph-{Guid.NewGuid():N}");
            Directory.CreateDirectory(Root);
        }

        public string Root { get; }

        public ObsidianGraphService CreateService(
            IObsidianVaultWatcherFactory? watcherFactory = null,
            Func<string, string>? readAllText = null) => new(
            () => Root,
            () => throw new InvalidOperationException("Configured vault should take priority."),
            watcherFactory ?? new FakeWatcherFactory(),
            readAllText);

        public string Write(string relativePath, string content)
        {
            var fullPath = Path.Combine(
                Root,
                relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            File.WriteAllText(fullPath, content);
            File.SetLastWriteTimeUtc(fullPath, DateTime.UtcNow.AddSeconds(2));
            return fullPath;
        }

        public string Move(string sourceRelativePath, string destinationRelativePath)
        {
            var source = Path.Combine(Root, sourceRelativePath.Replace('/', Path.DirectorySeparatorChar));
            var destination = Path.Combine(Root, destinationRelativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Move(source, destination);
            return destination;
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }

    private sealed class FakeWatcherFactory : IObsidianVaultWatcherFactory
    {
        public FakeWatcher Watcher { get; } = new();

        public IObsidianVaultWatcher Create(string vaultRoot)
        {
            Watcher.VaultRoot = vaultRoot;
            return Watcher;
        }
    }

    private sealed class RecordingWatcherFactory : IObsidianVaultWatcherFactory
    {
        public List<FakeWatcher> Watchers { get; } = [];

        public IObsidianVaultWatcher Create(string vaultRoot)
        {
            var watcher = new FakeWatcher { VaultRoot = vaultRoot };
            Watchers.Add(watcher);
            return watcher;
        }
    }

    private sealed class FakeWatcher : IObsidianVaultWatcher
    {
        public event EventHandler<ObsidianVaultChange>? Changed;

        public event EventHandler? Overflowed;

        public string? VaultRoot { get; set; }

        public bool Started { get; private set; }

        public bool Disposed { get; private set; }

        public void Start() => Started = true;

        public void RaiseChanged(string fullPath) => Changed?.Invoke(
            this,
            new ObsidianVaultChange(ObsidianVaultChangeKind.Changed, fullPath));

        public void RaiseDeleted(string fullPath) => Changed?.Invoke(
            this,
            new ObsidianVaultChange(ObsidianVaultChangeKind.Deleted, fullPath));

        public void RaiseRenamed(string oldFullPath, string fullPath) => Changed?.Invoke(
            this,
            new ObsidianVaultChange(ObsidianVaultChangeKind.Renamed, fullPath, oldFullPath));

        public void RaiseOverflow() => Overflowed?.Invoke(this, EventArgs.Empty);

        public void Dispose() => Disposed = true;
    }
}
