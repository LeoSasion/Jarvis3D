using System.Collections.Concurrent;
using System.Text.Json;
using Jarvis.Host.Agents;

namespace Jarvis.Host.Tests;

public sealed class AgentProviderGatewayTests
{
    [Fact]
    public void PiAdapterPublishesStableProviderMetadata()
    {
        var provider = new PiAgentProvider(CreatePiOptions(configured: true));

        Assert.Equal("pi", provider.Descriptor.Id);
        Assert.Equal("Pi Agent", provider.Descriptor.Label);
        Assert.Equal("chat-only", provider.Descriptor.PermissionMode);
        Assert.True(provider.Descriptor.Supports(AgentProviderCapabilities.Chat));
        Assert.True(provider.Descriptor.Supports(AgentProviderCapabilities.Streaming));
        Assert.True(provider.Descriptor.Supports(AgentProviderCapabilities.MessageHistory));
        Assert.True(provider.Descriptor.Supports(AgentProviderCapabilities.Abort));
        Assert.True(provider.Descriptor.Supports(AgentProviderCapabilities.NewSession));
    }

    [Fact]
    public void RegistryResolvesProvidersDeterministicallyAndRejectsDuplicateIds()
    {
        var alpha = new DeterministicAgentProvider(
            "alpha",
            [AgentProviderCapabilities.Chat, AgentProviderCapabilities.Streaming]);
        var beta = new DeterministicAgentProvider(
            "beta",
            [AgentProviderCapabilities.Chat, AgentProviderCapabilities.Streaming]);
        var registry = new AgentProviderRegistry([beta, alpha]);

        Assert.Collection(
            registry.Providers,
            descriptor => Assert.Equal("alpha", descriptor.Id),
            descriptor => Assert.Equal("beta", descriptor.Id));
        Assert.Same(alpha, registry.GetRequiredProvider("ALPHA"));
        Assert.False(registry.TryGetProvider("missing", out _));
        Assert.Throws<ArgumentException>(() => new AgentProviderRegistry([alpha, alpha]));
    }

    [Fact]
    public void CoordinatorStateExposesProviderIdentityCapabilitiesAndHealth()
    {
        var provider = new DeterministicAgentProvider(
            "deterministic",
            [AgentProviderCapabilities.Streaming, AgentProviderCapabilities.Chat]);
        using var coordinator = new AgentCoordinator(provider);

        var state = coordinator.GetStateSnapshot();

        Assert.Equal("deterministic", state.Provider);
        Assert.Equal("deterministic", state.ProviderId);
        Assert.Equal("Deterministic Provider", state.ProviderLabel);
        Assert.Equal("chat-only", state.PermissionMode);
        Assert.Equal(
            [AgentProviderCapabilities.Chat, AgentProviderCapabilities.Streaming],
            state.Capabilities);
        Assert.Equal("ready", state.Health.Status);
        Assert.True(state.Health.Healthy);
        Assert.Null(state.Health.Detail);

        using var document = JsonDocument.Parse(JsonSerializer.Serialize(
            state,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        Assert.Equal("deterministic", document.RootElement.GetProperty("provider").GetString());
        Assert.Equal("deterministic", document.RootElement.GetProperty("providerId").GetString());
        Assert.Equal(
            "Deterministic Provider",
            document.RootElement.GetProperty("providerLabel").GetString());
        Assert.Equal(
            2,
            document.RootElement.GetProperty("capabilities").GetArrayLength());
        Assert.Equal(
            "ready",
            document.RootElement.GetProperty("health").GetProperty("status").GetString());
    }

    [Fact]
    public async Task UndeclaredCapabilitiesFailClosedWithoutStartingProvider()
    {
        var provider = new DeterministicAgentProvider("limited", []);
        using var coordinator = new AgentCoordinator(provider);

        var prompt = await coordinator.PromptAsync(
            "not permitted",
            "client-message",
            CancellationToken.None);
        var abort = await coordinator.AbortAsync(CancellationToken.None);
        var newSession = await coordinator.NewSessionAsync(CancellationToken.None);
        var messages = await coordinator.GetMessagesAsync(CancellationToken.None);

        Assert.False(prompt.Accepted);
        Assert.Equal("CAPABILITY_UNAVAILABLE", prompt.Error?.Code);
        Assert.False(abort.Success);
        Assert.Equal("CAPABILITY_UNAVAILABLE", abort.Error?.Code);
        Assert.False(newSession.Success);
        Assert.Equal("CAPABILITY_UNAVAILABLE", newSession.Error?.Code);
        Assert.Empty(messages);
        Assert.Equal(0, provider.CreateClientCount);
        Assert.Equal("degraded", coordinator.GetStateSnapshot().Health.Status);
        Assert.Equal(
            "CAPABILITY_UNAVAILABLE",
            coordinator.GetStateSnapshot().Health.Detail);
    }

    [Fact]
    public async Task DeterministicProviderRunsThroughTheNeutralClientContract()
    {
        var provider = new DeterministicAgentProvider(
            "deterministic",
            [AgentProviderCapabilities.Chat, AgentProviderCapabilities.Streaming]);
        using var coordinator = new AgentCoordinator(provider);

        var result = await coordinator.PromptAsync(
            "hello",
            "deterministic-message",
            CancellationToken.None);

        Assert.True(result.Accepted);
        Assert.Null(result.Error);
        Assert.Equal(1, provider.CreateClientCount);
        Assert.Equal(["prompt"], provider.Client.Commands);
        Assert.Equal("ready", coordinator.GetStateSnapshot().Status);
        Assert.Equal("connected", coordinator.GetStateSnapshot().Health.Status);
    }

    [Fact]
    public void ChatProviderMustDeclareStreamingCapability()
    {
        var error = Assert.Throws<ArgumentException>(() => new AgentProviderDescriptor(
            "non-streaming",
            "Non-streaming Provider",
            "chat-only",
            [AgentProviderCapabilities.Chat]));

        Assert.Contains("requires every chat provider", error.Message);
    }

    [Fact]
    public async Task InvalidProviderEventFailsClosedWhenTerminateAndDisposeThrow()
    {
        var provider = new DeterministicAgentProvider(
            "invalid-event",
            [AgentProviderCapabilities.Chat, AgentProviderCapabilities.Streaming],
            eventPayloadJson: "{\"type\":\"tool_call\"}",
            raiseFaultOnTerminate: false,
            terminationException: new InvalidOperationException("terminate failed"),
            disposeException: new IOException("dispose failed"));
        using var coordinator = new AgentCoordinator(provider);

        var result = await coordinator.PromptAsync(
            "hello",
            "invalid-event-message",
            CancellationToken.None);

        Assert.False(result.Accepted);
        Assert.Equal("PROTOCOL_ERROR", result.Error?.Code);
        Assert.False(provider.Client.CallbackThrew);
        Assert.False(provider.Client.IsConnected);
        Assert.Contains(
            provider.Client.Terminations,
            failure => failure.Code == "PROTOCOL_ERROR");
        Assert.False(coordinator.GetStateSnapshot().Running);
        Assert.Null(coordinator.GetStateSnapshot().ActiveRunId);
        Assert.Equal(1, provider.Client.DisposeAttempts);
    }

    [Fact]
    public async Task TurnTimeoutFailsClosedWhenProviderDoesNotRaiseFaulted()
    {
        var provider = new DeterministicAgentProvider(
            "no-abort",
            [AgentProviderCapabilities.Chat, AgentProviderCapabilities.Streaming],
            emitSettlement: false,
            turnTimeout: TimeSpan.FromMilliseconds(15),
            raiseFaultOnTerminate: false);
        using var coordinator = new AgentCoordinator(provider);

        var result = await coordinator.PromptAsync(
            "wait forever",
            "timeout-message",
            CancellationToken.None);
        Assert.True(result.Accepted);

        for (var attempt = 0;
             attempt < 100 &&
             (provider.Client.Terminations.Count == 0 ||
              coordinator.GetStateSnapshot().ActiveRunId is not null);
             attempt++)
        {
            await Task.Delay(10);
        }

        Assert.DoesNotContain("abort", provider.Client.Commands);
        Assert.Contains(
            provider.Client.Terminations,
            failure => failure.Code == "TURN_TIMEOUT");
        Assert.False(provider.Client.IsConnected);
        Assert.False(coordinator.GetStateSnapshot().Running);
        Assert.Null(coordinator.GetStateSnapshot().ActiveRunId);
    }

    [Fact]
    public async Task CommandFailureReleasesRunAndPromptReservationWithoutFaultCallback()
    {
        var provider = new DeterministicAgentProvider(
            "command-failure",
            [
                AgentProviderCapabilities.Chat,
                AgentProviderCapabilities.Streaming,
                AgentProviderCapabilities.NewSession
            ],
            raiseFaultOnTerminate: false,
            promptException: new IOException("provider pipe failed"));
        using var coordinator = new AgentCoordinator(provider);

        var result = await coordinator.PromptAsync(
            "fail",
            "command-failure-message",
            CancellationToken.None);
        var reset = await coordinator.NewSessionAsync(CancellationToken.None);

        Assert.False(result.Accepted);
        Assert.Equal("PROVIDER_UNAVAILABLE", result.Error?.Code);
        Assert.False(coordinator.GetStateSnapshot().Running);
        Assert.Null(coordinator.GetStateSnapshot().ActiveRunId);
        Assert.True(reset.Success);
    }

    [Fact]
    public async Task PromptCancellationReleasesRunAndPromptReservationWithoutFaultCallback()
    {
        var provider = new DeterministicAgentProvider(
            "cancelled-prompt",
            [
                AgentProviderCapabilities.Chat,
                AgentProviderCapabilities.Streaming,
                AgentProviderCapabilities.NewSession
            ],
            raiseFaultOnTerminate: false,
            blockPromptUntilCancelled: true);
        using var coordinator = new AgentCoordinator(provider);
        using var cancellation = new CancellationTokenSource();

        var prompt = coordinator.PromptAsync(
            "cancel",
            "cancelled-prompt-message",
            cancellation.Token);
        await provider.Client.PromptStarted.WaitAsync(TimeSpan.FromSeconds(5));
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => prompt);
        var reset = await coordinator.NewSessionAsync(CancellationToken.None);

        Assert.Contains(
            provider.Client.Terminations,
            failure => failure.Code == "CANCELLED");
        Assert.False(coordinator.GetStateSnapshot().Running);
        Assert.Null(coordinator.GetStateSnapshot().ActiveRunId);
        Assert.True(reset.Success);
    }

    private static PiAgentOptions CreatePiOptions(bool configured)
    {
        var root = Path.Combine(Path.GetTempPath(), "jarvis-agent-provider-test");
        return new PiAgentOptions(
            ExecutablePath: configured ? Path.Combine(root, "fake-pi.exe") : null,
            ExecutableIdentity: configured
                ? new PiExecutableIdentity(new string('0', 64), SizeBytes: 1)
                : null,
            AgentDirectory: root,
            PackageDirectory: Path.Combine(root, "packages"),
            WorkingDirectory: Path.Combine(root, "runtime"),
            PermissionMode: "chat-only",
            MaximumJsonLineBytes: 1024,
            CommandTimeout: TimeSpan.FromSeconds(5),
            AbortTimeout: TimeSpan.FromSeconds(1),
            TurnTimeout: TimeSpan.FromMinutes(1),
            ConfigurationIssue: configured ? null : "Deterministic configuration failure.");
    }

    private sealed class DeterministicAgentProvider : IAgentProvider
    {
        private int _createClientCount;

        public DeterministicAgentProvider(
            string id,
            IEnumerable<string> capabilities,
            bool emitSettlement = true,
            string? eventPayloadJson = null,
            TimeSpan? turnTimeout = null,
            bool raiseFaultOnTerminate = true,
            Exception? terminationException = null,
            Exception? disposeException = null,
            Exception? promptException = null,
            bool blockPromptUntilCancelled = false)
        {
            Descriptor = new AgentProviderDescriptor(
                id,
                id == "deterministic" ? "Deterministic Provider" : $"{id} Provider",
                "chat-only",
                capabilities);
            Client = new DeterministicAgentProviderClient(
                emitSettlement,
                eventPayloadJson,
                raiseFaultOnTerminate,
                terminationException,
                disposeException,
                promptException,
                blockPromptUntilCancelled);
            TurnTimeout = turnTimeout ?? TimeSpan.FromMinutes(1);
        }

        public AgentProviderDescriptor Descriptor { get; }

        public bool IsConfigured => true;

        public string? ConfigurationIssue => null;

        public TimeSpan AbortTimeout => TimeSpan.FromMilliseconds(100);

        public TimeSpan TurnTimeout { get; }

        public DeterministicAgentProviderClient Client { get; }

        public int CreateClientCount => Volatile.Read(ref _createClientCount);

        public IAgentProviderClient CreateClient()
        {
            Interlocked.Increment(ref _createClientCount);
            return Client;
        }
    }

    private sealed class DeterministicAgentProviderClient : IAgentProviderClient
    {
        private readonly bool _emitSettlement;
        private readonly string? _eventPayloadJson;
        private readonly bool _raiseFaultOnTerminate;
        private readonly Exception? _terminationException;
        private readonly Exception? _disposeException;
        private readonly Exception? _promptException;
        private readonly bool _blockPromptUntilCancelled;
        private readonly TaskCompletionSource _promptStarted = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private int _disposeAttempts;

        public DeterministicAgentProviderClient(
            bool emitSettlement,
            string? eventPayloadJson,
            bool raiseFaultOnTerminate,
            Exception? terminationException,
            Exception? disposeException,
            Exception? promptException,
            bool blockPromptUntilCancelled)
        {
            _emitSettlement = emitSettlement;
            _eventPayloadJson = eventPayloadJson;
            _raiseFaultOnTerminate = raiseFaultOnTerminate;
            _terminationException = terminationException;
            _disposeException = disposeException;
            _promptException = promptException;
            _blockPromptUntilCancelled = blockPromptUntilCancelled;
        }

        public event Action<IAgentProviderClient, AgentProviderEvent>? EventReceived;

        public event Action<IAgentProviderClient, AgentProviderFailure>? Faulted;

        public bool IsConnected { get; private set; }

        public List<string> Commands { get; } = [];

        public ConcurrentQueue<AgentProviderFailure> Terminations { get; } = new();

        public bool CallbackThrew { get; private set; }

        public int DisposeAttempts => Volatile.Read(ref _disposeAttempts);

        public Task PromptStarted => _promptStarted.Task;

        public void Start() => IsConnected = true;

        public async Task<AgentProviderResponse> SendAsync(
            string command,
            IReadOnlyDictionary<string, object?>? arguments,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Commands.Add(command);
            if (command == "prompt")
            {
                _promptStarted.TrySetResult();
                if (_blockPromptUntilCancelled)
                {
                    await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                }
                if (_promptException is not null)
                {
                    throw _promptException;
                }
                if (_eventPayloadJson is not null || _emitSettlement)
                {
                    using var document = JsonDocument.Parse(
                        _eventPayloadJson ?? "{\"type\":\"agent_settled\"}");
                    try
                    {
                        EventReceived?.Invoke(
                            this,
                            new AgentProviderEvent(
                                document.RootElement.Clone(),
                                _eventPayloadJson?.Length ?? 24));
                    }
                    catch
                    {
                        CallbackThrew = true;
                        throw;
                    }
                }
            }

            return new AgentProviderResponse(command, Success: true, Data: null, Error: null);
        }

        public void Terminate(AgentProviderFailure failure)
        {
            Terminations.Enqueue(failure);
            IsConnected = false;
            if (_terminationException is not null)
            {
                throw _terminationException;
            }
            if (_raiseFaultOnTerminate)
            {
                Faulted?.Invoke(this, failure);
            }
        }

        public void Dispose()
        {
            Interlocked.Increment(ref _disposeAttempts);
            IsConnected = false;
            if (_disposeException is not null)
            {
                throw _disposeException;
            }
        }
    }
}
