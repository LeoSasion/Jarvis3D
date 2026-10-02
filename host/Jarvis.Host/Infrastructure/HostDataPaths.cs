using System.IO;

namespace Jarvis.Host.Infrastructure;

// Validation runs use the same services as the installed app, with a separate
// data root selected before any service or recovery watchdog is initialized.
internal static class HostDataPaths
{
    internal const string ValidationArgument = "--native-validation-data-root=";
    internal const string StartupTimeoutArgument = "--native-validation-startup-timeout";
    internal static string ProductionRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JARVIS");
    internal static string Root { get; private set; } = ProductionRoot;
    internal static bool IsValidation { get; private set; }
    internal static bool ForceStartupTimeout { get; private set; }

    // Smoke and lifecycle parsers validate the isolated root before calling
    // this; these modes never start a taskbar recovery watchdog.
    internal static void UseRendererSmokeRoot(string root) => Root = Path.GetFullPath(root);

    internal static bool TryConfigure(IReadOnlyList<string> arguments)
    {
        if (arguments.Any(argument =>
            argument.StartsWith("--native-validation-", StringComparison.OrdinalIgnoreCase) &&
            !argument.StartsWith(ValidationArgument, StringComparison.OrdinalIgnoreCase) &&
            !argument.Equals(StartupTimeoutArgument, StringComparison.OrdinalIgnoreCase))) return false;
        var roots = arguments.Where(argument =>
            argument.StartsWith(ValidationArgument, StringComparison.OrdinalIgnoreCase)).ToArray();
        var faults = arguments.Count(argument => argument.Equals(
            StartupTimeoutArgument, StringComparison.OrdinalIgnoreCase));
        if (roots.Length == 0)
        {
            return faults == 0;
        }
        if (roots.Length != 1 || faults > 1 ||
            !TryValidateRoot(roots[0][ValidationArgument.Length..], out var root))
        {
            return false;
        }

        Root = root!;
        IsValidation = true;
        ForceStartupTimeout = faults == 1;
        return true;
    }

    internal static bool TryValidateRoot(string value, out string? root)
    {
        root = null;
        try
        {
            if (!Path.IsPathFullyQualified(value)) return false;
            var candidate = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar);
            var parent = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "jarvis-native-validation"));
            var production = Path.GetFullPath(ProductionRoot).TrimEnd(Path.DirectorySeparatorChar);
            if (candidate.Equals(production, StringComparison.OrdinalIgnoreCase) ||
                candidate.StartsWith(production + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                production.StartsWith(candidate + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return false;
            var leaf = Path.GetFileName(candidate);
            if (!string.Equals(Path.GetDirectoryName(candidate), parent, StringComparison.OrdinalIgnoreCase) ||
                leaf.Length != 32 || leaf.Any(character => !Uri.IsHexDigit(character))) return false;

            if (!IsReparseFreeTree(candidate)) return false;
            root = candidate;
            return true;
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    internal static bool IsReparseFreeTree(string candidate)
    {
        try
        {
            for (var directory = new DirectoryInfo(candidate); directory is not null; directory = directory.Parent)
            {
                try
                {
                    if ((File.GetAttributes(directory.FullName) & FileAttributes.ReparsePoint) != 0) return false;
                }
                catch (FileNotFoundException) { }
                catch (DirectoryNotFoundException) { }
            }
            if (Directory.Exists(candidate))
            {
                var pending = new Stack<string>();
                pending.Push(candidate);
                var inspected = 0;
                while (pending.Count > 0)
                {
                    foreach (var entry in Directory.EnumerateFileSystemEntries(pending.Pop()))
                    {
                        if (++inspected > 20000) return false;
                        FileAttributes attributes;
                        try { attributes = File.GetAttributes(entry); }
                        catch (FileNotFoundException) { continue; }
                        catch (DirectoryNotFoundException) { continue; }
                        if ((attributes & FileAttributes.ReparsePoint) != 0) return false;
                        if ((attributes & FileAttributes.Directory) != 0) pending.Push(entry);
                    }
                }
            }
            return true;
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}
