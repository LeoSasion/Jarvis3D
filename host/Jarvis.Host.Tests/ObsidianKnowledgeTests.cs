using System.IO;
using System.Text.Json;
using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class ObsidianKnowledgeTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "jarvis-knowledge-test-" + Guid.NewGuid().ToString("N"));

    public ObsidianKnowledgeTests() => Directory.CreateDirectory(_root);
    private void Write(string path, string content)
    {
        var full = Path.Combine(_root, path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
    }
    private ObsidianGraphService Service() => new(() => _root, () => "");

    [Fact]
    public void SearchSupportsAliasesTagsAndPagingWithoutReturningBodies()
    {
        Write("a.md", "---\ntitle: Alpha\naliases: [needle]\ntags: [red]\n---\nPRIVATE_BODY");
        Write("b.md", "---\naliases: [needle]\ntags: [blue]\n---\nSECOND_PRIVATE_BODY");
        using var service = Service();
        var search = service.SearchKnowledge("needle", limit: 1);
        Assert.Equal(2, search.Total);
        Assert.Single(search.Items);
        Assert.Equal("b.md", Assert.Single(service.SearchKnowledge("needle", "blue").Items).Id);
        Assert.Equal("b.md", Assert.Single(service.SearchKnowledge("needle", offset: 1, limit: 1).Items).Id);
        var json = JsonSerializer.Serialize(search);
        Assert.DoesNotContain("PRIVATE_BODY", json);
        Assert.DoesNotContain(_root, json);
    }

    [Fact]
    public void NeighborhoodTraversesIncomingAndOutgoingRelationsForOneAndTwoHops()
    {
        Write("a.md", "[[b]]");
        Write("b.md", "[[c]]");
        Write("c.md", "[[d]]");
        Write("d.md", "# last");
        using var service = Service();
        var revision = service.SearchKnowledge().Revision;
        var one = service.GetKnowledgeNeighborhood(revision, "b.md", 1);
        Assert.Equal(new[] { "a.md", "b.md", "c.md" }, one.Nodes.Select(node => node.Id).Order());
        Assert.Equal(2, one.Edges.Count);
        var two = service.GetKnowledgeNeighborhood(revision, "b.md", 2);
        Assert.Equal(4, two.Nodes.Count);
        Assert.Equal(3, two.Edges.Count);
        Assert.Throws<ArgumentOutOfRangeException>(() => service.GetKnowledgeNeighborhood(revision, "b.md", 3));
    }

    [Fact]
    public void ReadingIsExplicitBoundedAndRejectsUnknownPathsAndOldRevisions()
    {
        Write("a.md", "heading\n" + new string('x', 7_000) + "\nlast");
        using var service = Service();
        var search = service.SearchKnowledge();
        var excerpt = service.ReadKnowledgeNote(search.Revision, "a.md", 2);
        Assert.Equal(6_000, excerpt.Text.Length);
        Assert.True(excerpt.Truncated);
        Assert.Equal(2, excerpt.StartLine);
        Assert.Equal(2, excerpt.EndLine);
        Assert.Equal(64, excerpt.Digest.Length);
        Assert.Equal("last", service.ReadKnowledgeNote(search.Revision, "a.md", 3).Text);
        Assert.Throws<ArgumentException>(() => service.ReadKnowledgeNote(search.Revision, "../outside.md"));
        Assert.Throws<ArgumentException>(() => service.ReadKnowledgeNote(search.Revision, Path.Combine(_root, "a.md")));
        Assert.Throws<ArgumentException>(() => service.ReadKnowledgeNote(search.Revision, "a.md", 99));
        service.RefreshDefaultManifest();
        Assert.Throws<ObsidianGraphRevisionMismatchException>(() => service.ReadKnowledgeNote(search.Revision, "a.md"));
    }

    [Fact]
    public void OnDemandSearchFindsNotesBeyondTheSceneBudget()
    {
        for (var index = 0; index < ObsidianGraphService.MaximumNodeCount + 2; index++)
            Write($"{index:D5}.md", $"---\naliases: [alias{index}]\n---\n");
        using var service = Service();
        var scene = service.GetDefaultSource();
        Assert.Equal(ObsidianGraphService.MaximumNodeCount, scene.Nodes.Count);
        var search = service.SearchKnowledge("alias4097");
        var note = Assert.Single(search.Items);
        Assert.Equal("04097.md", note.Id);
        Assert.Single(service.GetKnowledgeNeighborhood(search.Revision, note.Id).Nodes);
        Assert.False(search.Truncated);
    }

    [Fact]
    public void OversizedFilesCannotBeReadThroughTheContentEndpoint()
    {
        Write("a.md", "# small");
        using var service = Service();
        var revision = service.SearchKnowledge().Revision;
        Write("a.md", new string('x', ObsidianGraphService.MaximumMarkdownFileBytes + 1));
        Assert.ThrowsAny<Exception>(() => service.ReadKnowledgeNote(revision, "a.md"));
    }

    [Fact]
    public void MetadataHeavySearchPagesAndNeighborhoodsRespectTheWireByteBudget()
    {
        var tags = string.Join(",", Enumerable.Range(0, 64).Select(index => "\"" + index + new string('签', 124) + "\""));
        var aliases = string.Join(",", Enumerable.Range(0, 64).Select(index => "\"" + index + new string('名', 252) + "\""));
        for (var index = 0; index < 20; index++)
            Write($"{index:D2}.md", $"---\ntags: [{tags}]\naliases: [{aliases}]\n---\n[[19]]");
        using var service = Service();
        var page = service.SearchKnowledge(limit: 100);
        Assert.True(page.Truncated);
        Assert.InRange(page.Items.Count, 1, 19);
        Assert.Equal(page.Items.Count, page.NextOffset);
        var visited = page.Items.Select(node => node.Id).ToList();
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.True(JsonSerializer.SerializeToUtf8Bytes(page, options).Length < ObsidianGraphService.MaximumChunkPayloadBytes);
        while (page.NextOffset < page.Total)
        {
            page = service.SearchKnowledge(offset: page.NextOffset, limit: 100);
            visited.AddRange(page.Items.Select(node => node.Id));
        }
        Assert.Equal(20, visited.Distinct().Count());
        var neighborhood = service.GetKnowledgeNeighborhood(page.Revision, "19.md");
        Assert.True(neighborhood.Truncated);
        Assert.Contains(neighborhood.Nodes, node => node.Id == "19.md");
        var ids = neighborhood.Nodes.Select(node => node.Id).ToHashSet();
        Assert.All(neighborhood.Edges, edge => { Assert.Contains(edge.Source, ids); Assert.Contains(edge.Target, ids); });
        Assert.True(JsonSerializer.SerializeToUtf8Bytes(neighborhood, options).Length < ObsidianGraphService.MaximumChunkPayloadBytes);
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);
}
