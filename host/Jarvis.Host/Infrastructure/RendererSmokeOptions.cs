using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;

namespace Jarvis.Host.Infrastructure;

internal sealed record RendererSmokeOptions(
    string DataRoot,
    string ReceiptPath,
    string Nonce,
    string CultureName = "en-US",
    bool MeasurePerformance = false,
    bool MeasureGraphicsRegression = false)
{
    internal const string DefaultCultureName = "en-US";
    private const string SmokeArgument = "--renderer-smoke";
    private const string DataRootArgument = "--renderer-smoke-data-root=";
    private const string ReceiptArgument = "--renderer-smoke-receipt=";
    private const string NonceArgument = "--renderer-smoke-nonce=";
    private const string CultureArgument = "--renderer-smoke-culture=";
    private const string PerformanceArgument = "--renderer-smoke-performance";
    private const string GraphicsArgument = "--renderer-smoke-graphics";

    private static readonly Regex NoncePattern = new(
        "^[0-9a-fA-F]{32}$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    public static bool IsRequested(IReadOnlyList<string> arguments) =>
        arguments.Any(argument =>
            argument.Equals(SmokeArgument, StringComparison.OrdinalIgnoreCase) ||
            argument.StartsWith("--renderer-smoke-", StringComparison.OrdinalIgnoreCase));

    public static bool TryParse(
        IReadOnlyList<string> arguments,
        out RendererSmokeOptions? options,
        out string? error)
    {
        options = null;
        error = null;

        if (!IsRequested(arguments))
        {
            return false;
        }

        if (arguments.Count is < 4 or > 7 ||
            arguments.Count(argument =>
                argument.Equals(SmokeArgument, StringComparison.OrdinalIgnoreCase)) != 1)
        {
            error = "Renderer smoke requires one marker, three value arguments, and optional culture/measurement flags.";
            return false;
        }

        if (!TryGetSingleValue(arguments, DataRootArgument, out var dataRootValue) ||
            !TryGetSingleValue(arguments, ReceiptArgument, out var receiptValue) ||
            !TryGetSingleValue(arguments, NonceArgument, out var nonceValue))
        {
            error = "Renderer smoke arguments are missing, duplicated, or unsupported.";
            return false;
        }

        var cultureMatches = arguments
            .Where(argument =>
                argument.StartsWith(CultureArgument, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var performanceCount = arguments.Count(argument => argument.Equals(PerformanceArgument, StringComparison.OrdinalIgnoreCase));
        var graphicsCount = arguments.Count(argument => argument.Equals(GraphicsArgument, StringComparison.OrdinalIgnoreCase));
        if (cultureMatches.Length > 1 || performanceCount > 1 || graphicsCount > 1 ||
            arguments.Count != 4 + cultureMatches.Length + performanceCount + graphicsCount)
        {
            error = "Renderer smoke culture is duplicated or an unsupported argument was supplied.";
            return false;
        }

        var cultureName = DefaultCultureName;
        if (cultureMatches.Length == 1)
        {
            var cultureValue = cultureMatches[0][CultureArgument.Length..].Trim();
            if (string.IsNullOrWhiteSpace(cultureValue))
            {
                error = "Renderer smoke culture is invalid.";
                return false;
            }
            try
            {
                cultureName = CultureInfo.GetCultureInfo(cultureValue).Name;
            }
            catch (CultureNotFoundException)
            {
                error = "Renderer smoke culture is invalid.";
                return false;
            }
        }

        if (!HostDataPaths.IsLocalAbsolutePath(dataRootValue) ||
            !HostDataPaths.IsLocalAbsolutePath(receiptValue))
        {
            error = "Renderer smoke paths must be ordinary absolute local drive paths.";
            return false;
        }

        string dataRoot;
        string receiptPath;
        string productionRoot;
        try
        {
            dataRoot = Path.GetFullPath(dataRootValue);
            receiptPath = Path.GetFullPath(receiptValue);
            productionRoot = Path.GetFullPath(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "JARVIS")).TrimEnd(Path.DirectorySeparatorChar);
        }
        catch (Exception exception) when (
            exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            error = "Renderer smoke paths are invalid.";
            return false;
        }

        if (IsVolumeRoot(dataRoot))
        {
            error = "Renderer smoke data root cannot be a volume root.";
            return false;
        }

        dataRoot = dataRoot.TrimEnd(Path.DirectorySeparatorChar);
        if (string.IsNullOrWhiteSpace(dataRoot) || PathsOverlap(dataRoot, productionRoot))
        {
            error = "Renderer smoke data must be isolated from the production JARVIS data root.";
            return false;
        }

        if (!IsStrictChild(receiptPath, dataRoot))
        {
            error = "Renderer smoke receipt must remain beneath the isolated data root.";
            return false;
        }

        if (!HostDataPaths.IsReparseFreeTree(dataRoot))
        {
            error = "Renderer smoke data must not contain or traverse reparse points.";
            return false;
        }

        if (!NoncePattern.IsMatch(nonceValue))
        {
            error = "Renderer smoke nonce must contain exactly 32 hexadecimal characters.";
            return false;
        }

        options = new RendererSmokeOptions(
            dataRoot,
            receiptPath,
            nonceValue.ToLowerInvariant(),
            cultureName,
            performanceCount == 1,
            graphicsCount == 1);
        return true;
    }

    private static bool TryGetSingleValue(
        IReadOnlyList<string> arguments,
        string prefix,
        out string value)
    {
        var matches = arguments
            .Where(argument => argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (matches.Length != 1 || matches[0].Length == prefix.Length)
        {
            value = string.Empty;
            return false;
        }

        value = matches[0][prefix.Length..].Trim();
        return value.Length > 0;
    }

    private static bool PathsOverlap(string left, string right) =>
        PathsEqual(left, right) || IsStrictChild(left, right) || IsStrictChild(right, left);

    private static bool IsStrictChild(string candidate, string parent)
    {
        var parentPrefix = parent.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return candidate.StartsWith(parentPrefix, StringComparison.OrdinalIgnoreCase);
    }

    private static bool PathsEqual(string left, string right) =>
        left.Equals(right, StringComparison.OrdinalIgnoreCase);

    private static bool IsVolumeRoot(string path) =>
        path.Equals(Path.GetPathRoot(path), StringComparison.OrdinalIgnoreCase);
}
