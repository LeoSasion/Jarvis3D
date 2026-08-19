using System.Buffers;
using System.Text;
using System.Text.Json;

namespace Jarvis.Host.Bridge;

internal sealed class WebBridgePayloadTooLargeException : Exception
{
    public WebBridgePayloadTooLargeException(int maximumBytes)
        : base($"Bridge payload exceeded the {maximumBytes}-byte UTF-8 limit.")
    {
        MaximumBytes = maximumBytes;
    }

    public int MaximumBytes { get; }
}

internal static class WebBridgePayloadPolicy
{
    // Message history is bounded to two million UTF-16 characters upstream;
    // eight MiB still contains its worst-case UTF-8 expansion plus JSON framing.
    public const int MaximumResponseBytes = 8 * 1024 * 1024;
    public const int MaximumEventBytes = 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = JsonNamingPolicy.CamelCase
    };

    public static string Serialize(object payload, int maximumBytes)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentOutOfRangeException.ThrowIfLessThan(maximumBytes, 256);

        var buffer = new ArrayBufferWriter<byte>(Math.Min(maximumBytes, 4096));
        var boundedBuffer = new BoundedBufferWriter(buffer, maximumBytes);
        using var writer = new Utf8JsonWriter(boundedBuffer);
        JsonSerializer.Serialize(writer, payload, payload.GetType(), JsonOptions);
        writer.Flush();
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private sealed class BoundedBufferWriter : IBufferWriter<byte>
    {
        private readonly ArrayBufferWriter<byte> _inner;
        private readonly int _maximumBytes;

        public BoundedBufferWriter(ArrayBufferWriter<byte> inner, int maximumBytes)
        {
            _inner = inner;
            _maximumBytes = maximumBytes;
        }

        public void Advance(int count)
        {
            if (count < 0 || count > _maximumBytes - _inner.WrittenCount)
            {
                throw new WebBridgePayloadTooLargeException(_maximumBytes);
            }

            _inner.Advance(count);
        }

        public Memory<byte> GetMemory(int sizeHint = 0)
        {
            var length = Reserve(sizeHint);
            return _inner.GetMemory(length)[..length];
        }

        public Span<byte> GetSpan(int sizeHint = 0)
        {
            var length = Reserve(sizeHint);
            return _inner.GetSpan(length)[..length];
        }

        private int Reserve(int sizeHint)
        {
            if (sizeHint < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(sizeHint));
            }

            var remaining = _maximumBytes - _inner.WrittenCount;
            var requested = Math.Max(sizeHint, 1);
            if (requested > remaining)
            {
                throw new WebBridgePayloadTooLargeException(_maximumBytes);
            }

            return Math.Min(remaining, Math.Max(requested, 4096));
        }
    }
}
