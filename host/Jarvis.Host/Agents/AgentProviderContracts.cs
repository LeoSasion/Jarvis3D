using System.Text.Json;

namespace Jarvis.Host.Agents;

internal static class AgentProviderCapabilities
{
    public const string Chat = "chat";
    public const string Streaming = "streaming";
    public const string MessageHistory = "message-history";
    public const string Abort = "abort";
    public const string NewSession = "new-session";
}

internal sealed class AgentProviderDescriptor
{
    public AgentProviderDescriptor(
        string id,
        string label,
        string permissionMode,
        IEnumerable<string> capabilities)
    {
        Id = NormalizeIdentifier(id, nameof(id), 32);
        Label = NormalizeLabel(label, nameof(label), 64);
        PermissionMode = NormalizeIdentifier(permissionMode, nameof(permissionMode), 32);

        var normalizedCapabilities = (capabilities ?? [])
            .Select(value => NormalizeIdentifier(value, nameof(capabilities), 48))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .Take(33)
            .ToArray();
        if (normalizedCapabilities.Length > 32)
        {
            throw new ArgumentException(
                "An agent provider may declare at most 32 capabilities.",
                nameof(capabilities));
        }

        if (normalizedCapabilities.Contains(
                AgentProviderCapabilities.Chat,
                StringComparer.Ordinal) &&
            !normalizedCapabilities.Contains(
                AgentProviderCapabilities.Streaming,
                StringComparer.Ordinal))
        {
            throw new ArgumentException(
                "The current Agent gateway requires every chat provider to declare streaming support.",
                nameof(capabilities));
        }

        Capabilities = Array.AsReadOnly(normalizedCapabilities);
    }

    public string Id { get; }

    public string Label { get; }

    public string PermissionMode { get; }

    public IReadOnlyList<string> Capabilities { get; }

    public bool Supports(string capability) =>
        !string.IsNullOrWhiteSpace(capability) &&
        Capabilities.Contains(capability, StringComparer.Ordinal);

    private static string NormalizeIdentifier(string value, string parameterName, int maximumLength)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? string.Empty;
        if (normalized.Length is 0 || normalized.Length > maximumLength ||
            normalized.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '.'))
        {
            throw new ArgumentException(
                "Agent provider identifiers must contain only lowercase ASCII letters, digits, dots, or hyphens.",
                parameterName);
        }

        return normalized;
    }

    private static string NormalizeLabel(string value, string parameterName, int maximumLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length is 0 || normalized.Length > maximumLength ||
            normalized.Any(char.IsControl))
        {
            throw new ArgumentException("The agent provider label is invalid.", parameterName);
        }

        return normalized;
    }
}

internal interface IAgentProvider
{
    AgentProviderDescriptor Descriptor { get; }

    bool IsConfigured { get; }

    string? ConfigurationIssue { get; }

    TimeSpan AbortTimeout { get; }

    TimeSpan TurnTimeout { get; }

    IAgentProviderClient CreateClient();
}

internal interface IAgentProviderClient : IDisposable
{
    event Action<IAgentProviderClient, AgentProviderEvent>? EventReceived;

    event Action<IAgentProviderClient, AgentProviderFailure>? Faulted;

    bool IsConnected { get; }

    void Start();

    Task<AgentProviderResponse> SendAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        CancellationToken cancellationToken);

    void Terminate(AgentProviderFailure failure);
}

internal sealed record AgentProviderFailure(
    string Code,
    string Message,
    bool Retryable = false);

internal sealed record AgentProviderResponse(
    string Command,
    bool Success,
    JsonElement? Data,
    string? Error);

internal readonly record struct AgentProviderEvent(
    JsonElement Payload,
    int PayloadCharacters);

internal sealed class AgentProviderRegistry
{
    private readonly IReadOnlyDictionary<string, IAgentProvider> _providers;

    public AgentProviderRegistry(IEnumerable<IAgentProvider> providers)
    {
        ArgumentNullException.ThrowIfNull(providers);

        var byId = new Dictionary<string, IAgentProvider>(StringComparer.Ordinal);
        foreach (var provider in providers)
        {
            ArgumentNullException.ThrowIfNull(provider);
            if (!byId.TryAdd(provider.Descriptor.Id, provider))
            {
                throw new ArgumentException(
                    $"Agent provider id '{provider.Descriptor.Id}' is registered more than once.",
                    nameof(providers));
            }
        }

        if (byId.Count == 0)
        {
            throw new ArgumentException(
                "At least one agent provider must be registered.",
                nameof(providers));
        }

        _providers = byId;
        Providers = Array.AsReadOnly(
            byId.Values
                .Select(provider => provider.Descriptor)
                .OrderBy(descriptor => descriptor.Id, StringComparer.Ordinal)
                .ToArray());
    }

    public IReadOnlyList<AgentProviderDescriptor> Providers { get; }

    public bool TryGetProvider(string id, out IAgentProvider? provider) =>
        _providers.TryGetValue(id?.Trim().ToLowerInvariant() ?? string.Empty, out provider);

    public IAgentProvider GetRequiredProvider(string id) =>
        TryGetProvider(id, out var provider)
            ? provider!
            : throw new KeyNotFoundException($"Agent provider '{id}' is not registered.");

    public static AgentProviderRegistry CreateDefault(PiAgentOptions options) =>
        new([new PiAgentProvider(options)]);
}
