namespace Jarvis.Host.Agents;

internal sealed class PiAgentProvider : IAgentProvider
{
    private static readonly AgentProviderDescriptor ProviderDescriptor = new(
        id: "pi",
        label: "Pi Agent",
        permissionMode: "chat-only",
        capabilities:
        [
            AgentProviderCapabilities.Chat,
            AgentProviderCapabilities.Streaming,
            AgentProviderCapabilities.MessageHistory,
            AgentProviderCapabilities.Abort,
            AgentProviderCapabilities.NewSession,
        ]);

    private readonly PiAgentOptions _options;

    public PiAgentProvider(PiAgentOptions options)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        if (!string.Equals(
                options.PermissionMode,
                ProviderDescriptor.PermissionMode,
                StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "The Pi adapter only supports the audited chat-only permission mode.",
                nameof(options));
        }
    }

    public AgentProviderDescriptor Descriptor => ProviderDescriptor;

    public bool IsConfigured => _options.IsConfigured;

    public string? ConfigurationIssue => _options.ConfigurationIssue;

    public TimeSpan AbortTimeout => _options.AbortTimeout;

    public TimeSpan TurnTimeout => _options.TurnTimeout;

    public IAgentProviderClient CreateClient() => new PiAgentProviderClient(_options);
}

internal sealed class PiAgentProviderClient : IAgentProviderClient
{
    private readonly PiRpcClient _inner;

    public PiAgentProviderClient(PiAgentOptions options)
    {
        _inner = new PiRpcClient(options);
        _inner.EventReceived += OnEventReceived;
        _inner.Faulted += OnFaulted;
    }

    public event Action<IAgentProviderClient, AgentProviderEvent>? EventReceived;

    public event Action<IAgentProviderClient, AgentProviderFailure>? Faulted;

    public bool IsConnected => _inner.IsConnected;

    public void Start() => _inner.Start();

    public async Task<AgentProviderResponse> SendAsync(
        string command,
        IReadOnlyDictionary<string, object?>? arguments,
        CancellationToken cancellationToken)
    {
        var response = await _inner
            .SendAsync(command, arguments, cancellationToken)
            .ConfigureAwait(false);
        return new AgentProviderResponse(
            response.Command,
            response.Success,
            response.Data,
            response.Error);
    }

    public void Terminate(AgentProviderFailure failure) =>
        _inner.Terminate(new PiRpcFailure(failure.Code, failure.Message, failure.Retryable));

    public void Dispose()
    {
        _inner.EventReceived -= OnEventReceived;
        _inner.Faulted -= OnFaulted;
        _inner.Dispose();
    }

    private void OnEventReceived(PiRpcClient _, PiRpcEvent value) =>
        EventReceived?.Invoke(
            this,
            new AgentProviderEvent(value.Payload, value.PayloadCharacters));

    private void OnFaulted(PiRpcClient _, PiRpcFailure failure) =>
        Faulted?.Invoke(
            this,
            new AgentProviderFailure(failure.Code, failure.Message, failure.Retryable));
}
