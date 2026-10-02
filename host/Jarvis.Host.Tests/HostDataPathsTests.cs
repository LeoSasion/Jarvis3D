using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Tests;

public sealed class HostDataPathsTests
{
    [Fact]
    public void GeneratedRunRootIsAccepted()
    {
        var expected = Path.Combine(Path.GetTempPath(), "jarvis-native-validation", Guid.NewGuid().ToString("N"));
        Assert.True(HostDataPaths.TryValidateRoot(expected, out var actual));
        Assert.Equal(expected.TrimEnd(Path.DirectorySeparatorChar), actual);
    }

    [Fact]
    public void ProductionAndAncestorRootsAreRejected()
    {
        Assert.False(HostDataPaths.TryValidateRoot(HostDataPaths.ProductionRoot, out _));
        Assert.False(HostDataPaths.TryValidateRoot(Path.GetTempPath(), out _));
        Assert.False(HostDataPaths.TryValidateRoot(Path.GetPathRoot(Path.GetTempPath())!, out _));
    }

    [Theory]
    [InlineData("relative")]
    [InlineData("")]
    [InlineData("not-a-run-id")]
    [InlineData("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")]
    public void NonRunPathsAreRejected(string value)
    {
        Assert.False(HostDataPaths.TryValidateRoot(value, out _));
        Assert.False(HostDataPaths.TryValidateRoot(Path.Combine(Path.GetTempPath(), "jarvis-native-validation", value), out _));
    }

    [Fact]
    public void NestedRootAndTraversalOutsideParentAreRejected()
    {
        var root = Path.Combine(Path.GetTempPath(), "jarvis-native-validation", Guid.NewGuid().ToString("N"));
        Assert.False(HostDataPaths.TryValidateRoot(Path.Combine(root, "Settings"), out _));
        Assert.False(HostDataPaths.TryValidateRoot(Path.Combine(root, "..", "..", Guid.NewGuid().ToString("N")), out _));
    }

    [Theory]
    [InlineData(@"\\?\C:\jarvis-validation")]
    [InlineData(@"\\.\C:\jarvis-validation")]
    [InlineData(@"\\localhost\C$\jarvis-validation")]
    [InlineData(@"\\?\UNC\localhost\C$\jarvis-validation")]
    [InlineData("//?/C:/jarvis-validation")]
    [InlineData("//./C:/jarvis-validation")]
    [InlineData("//localhost/C$/jarvis-validation")]
    [InlineData(@"C:\jarvis-validation:stream")]
    public void AliasedAndStreamPathsAreRejectedBeforeCanonicalization(string value)
    {
        Assert.False(HostDataPaths.IsLocalAbsolutePath(value));
        Assert.False(HostDataPaths.TryValidateRoot(value, out _));
    }
}
