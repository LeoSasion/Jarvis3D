using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Bridge;

internal static class WebBridgeRequestPolicy
{
    public const int MaximumPayloadBytes = 256 * 1024;
    public const int MaximumJsonDepth = 24;
    public const int MaximumConcurrentRequests = 32;

    private static readonly JsonDocumentOptions DocumentOptions = new()
    {
        AllowTrailingCommas = false,
        CommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = MaximumJsonDepth
    };

    public static JsonDocument Parse(string payload)
    {
        if (payload.Length > MaximumPayloadBytes ||
            Encoding.UTF8.GetByteCount(payload) > MaximumPayloadBytes)
        {
            throw new BridgeFaultException(
                "REQUEST_TOO_LARGE",
                $"Bridge requests must not exceed {MaximumPayloadBytes} UTF-8 bytes.");
        }

        return JsonDocument.Parse(payload, DocumentOptions);
    }
}

internal sealed class WebBridgeRequestGate
{
    private readonly int _maximumConcurrentRequests;
    private int _activeRequests;

    public WebBridgeRequestGate(
        int maximumConcurrentRequests = WebBridgeRequestPolicy.MaximumConcurrentRequests)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maximumConcurrentRequests, 1);
        _maximumConcurrentRequests = maximumConcurrentRequests;
    }

    public int ActiveRequests => Volatile.Read(ref _activeRequests);

    public bool TryEnter([NotNullWhen(true)] out IDisposable? lease)
    {
        var active = Interlocked.Increment(ref _activeRequests);
        if (active <= _maximumConcurrentRequests)
        {
            lease = new RequestLease(this);
            return true;
        }

        _ = Interlocked.Decrement(ref _activeRequests);
        lease = null;
        return false;
    }

    private void Exit() => _ = Interlocked.Decrement(ref _activeRequests);

    private sealed class RequestLease : IDisposable
    {
        private WebBridgeRequestGate? _owner;

        public RequestLease(WebBridgeRequestGate owner)
        {
            _owner = owner;
        }

        public void Dispose()
        {
            Interlocked.Exchange(ref _owner, null)?.Exit();
        }
    }
}
