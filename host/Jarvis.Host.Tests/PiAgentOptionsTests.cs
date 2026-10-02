using Jarvis.Host.Agents;

namespace Jarvis.Host.Tests;

public sealed class PiAgentOptionsTests
{
    [Fact]
    public void ExternalRuntimeUsesItsPackageDirectoryForBuiltinAssets()
    {
        const string allowName = "JARVIS_ALLOW_EXTERNAL_PI_RUNTIME";
        const string executableName = "JARVIS_PI_EXECUTABLE";
        const string shaName = "JARVIS_PI_EXECUTABLE_SHA256";
        var previousAllow = Environment.GetEnvironmentVariable(allowName);
        var previousExecutable = Environment.GetEnvironmentVariable(executableName);
        var previousSha = Environment.GetEnvironmentVariable(shaName);
        var root = Path.Combine(Path.GetTempPath(), "jarvis-pi-options-test-" + Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(root);
            var executable = Path.Combine(root, "pi.exe");
            File.WriteAllBytes(executable, [0]);
            Environment.SetEnvironmentVariable(allowName, "1");
            Environment.SetEnvironmentVariable(executableName, executable);
            Environment.SetEnvironmentVariable(shaName, new string('a', 64));

            var options = PiAgentOptions.FromEnvironment();

            Assert.True(options.IsConfigured);
            Assert.Equal(root, options.PackageDirectory);
            Assert.NotEqual(options.AgentDirectory, options.PackageDirectory);
        }
        finally
        {
            Environment.SetEnvironmentVariable(allowName, previousAllow);
            Environment.SetEnvironmentVariable(executableName, previousExecutable);
            Environment.SetEnvironmentVariable(shaName, previousSha);
            var executable = Path.Combine(root, "pi.exe");
            if (File.Exists(executable)) File.Delete(executable);
            if (Directory.Exists(root)) Directory.Delete(root);
        }
    }
}
