using System.Text;
using Jarvis.Host.Services;

namespace Jarvis.Host.Bridge;

internal sealed class PendingTerminalOutputBuffer
{
    public const int MaximumPendingSessionCount = 32;
    public const int MaximumCharactersPerSession = 64 * 1024;
    public const int MaximumUtf8BytesPerSession = 64 * 1024;

    internal const string OutputOverflowMarker =
        "\r\n[JARVIS: terminal output truncated while the renderer was busy.]\r\n";
    internal const string SessionOverflowMarker =
        "\r\n[JARVIS: output from additional terminal sessions was dropped while the renderer was busy.]\r\n";

    private readonly object _gate = new();
    private readonly Dictionary<string, PendingTerminalOutput> _pending =
        new(StringComparer.Ordinal);
    private bool _flushScheduled;

    public int PendingSessionCount
    {
        get
        {
            lock (_gate)
            {
                return _pending.Count;
            }
        }
    }

    public bool Enqueue(TerminalOutputChunk chunk)
    {
        ArgumentNullException.ThrowIfNull(chunk);

        lock (_gate)
        {
            if (!_pending.TryGetValue(chunk.SessionId, out var pending))
            {
                if (_pending.Count >= MaximumPendingSessionCount)
                {
                    // Keep the first bounded set stable until it is drained. Replacing entries here
                    // would let a stream of new session ids allocate without limit and would silently
                    // discard already-buffered output. The marker uses the existing event payload shape.
                    _pending.First().Value.MarkAdditionalSessionsDropped();
                    return false;
                }

                pending = new PendingTerminalOutput();
                _pending.Add(chunk.SessionId, pending);
            }

            pending.Append(chunk.Sequence, chunk.Data);
            if (_flushScheduled)
            {
                return false;
            }

            _flushScheduled = true;
            return true;
        }
    }

    public TerminalOutputChunk[] Drain()
    {
        lock (_gate)
        {
            var chunks = _pending.Select(pair => new TerminalOutputChunk(
                pair.Key,
                pair.Value.Sequence,
                pair.Value.Materialize())).ToArray();
            _pending.Clear();
            _flushScheduled = false;
            return chunks;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _pending.Clear();
            _flushScheduled = false;
        }
    }

    private sealed class PendingTerminalOutput
    {
        private static readonly int ReservedMarkerCharacters =
            OutputOverflowMarker.Length + SessionOverflowMarker.Length;
        private static readonly int ReservedMarkerUtf8Bytes =
            Encoding.UTF8.GetByteCount(OutputOverflowMarker) +
            Encoding.UTF8.GetByteCount(SessionOverflowMarker);
        private static readonly int MaximumDataCharacters =
            MaximumCharactersPerSession - ReservedMarkerCharacters;
        private static readonly int MaximumDataUtf8Bytes =
            MaximumUtf8BytesPerSession - ReservedMarkerUtf8Bytes;

        private readonly StringBuilder _data = new();
        private int _dataUtf8Bytes;
        private bool _outputOverflowed;
        private bool _additionalSessionsDropped;

        public long Sequence { get; private set; }

        public void Append(long sequence, string data)
        {
            Sequence = Math.Max(Sequence, sequence);
            if (_outputOverflowed || string.IsNullOrEmpty(data))
            {
                return;
            }

            var remainingCharacters = MaximumDataCharacters - _data.Length;
            var remainingUtf8Bytes = MaximumDataUtf8Bytes - _dataUtf8Bytes;
            var prefix = GetPrefixWithinBudget(data, remainingCharacters, remainingUtf8Bytes);
            if (prefix.CharacterCount > 0)
            {
                _data.Append(data, 0, prefix.CharacterCount);
                _dataUtf8Bytes += prefix.Utf8Bytes;
            }

            if (prefix.CharacterCount < data.Length)
            {
                _outputOverflowed = true;
            }
        }

        public void MarkAdditionalSessionsDropped()
        {
            _additionalSessionsDropped = true;
        }

        public string Materialize()
        {
            var capacity = _data.Length +
                           (_outputOverflowed ? OutputOverflowMarker.Length : 0) +
                           (_additionalSessionsDropped ? SessionOverflowMarker.Length : 0);
            var result = new StringBuilder(capacity);
            result.Append(_data);
            if (_outputOverflowed)
            {
                result.Append(OutputOverflowMarker);
            }
            if (_additionalSessionsDropped)
            {
                result.Append(SessionOverflowMarker);
            }
            return result.ToString();
        }

        private static PrefixBudget GetPrefixWithinBudget(
            string value,
            int maximumCharacters,
            int maximumUtf8Bytes)
        {
            if (maximumCharacters <= 0 || maximumUtf8Bytes <= 0)
            {
                return default;
            }

            var characterCount = 0;
            var utf8Bytes = 0;
            while (characterCount < value.Length && characterCount < maximumCharacters)
            {
                var current = value[characterCount];
                int currentCharacters;
                int currentUtf8Bytes;
                if (char.IsHighSurrogate(current) &&
                    characterCount + 1 < value.Length &&
                    char.IsLowSurrogate(value[characterCount + 1]))
                {
                    currentCharacters = 2;
                    currentUtf8Bytes = 4;
                }
                else
                {
                    currentCharacters = 1;
                    currentUtf8Bytes = current switch
                    {
                        <= '\u007f' => 1,
                        <= '\u07ff' => 2,
                        _ => 3
                    };
                }

                if (characterCount + currentCharacters > maximumCharacters ||
                    utf8Bytes + currentUtf8Bytes > maximumUtf8Bytes)
                {
                    break;
                }

                characterCount += currentCharacters;
                utf8Bytes += currentUtf8Bytes;
            }

            return new PrefixBudget(characterCount, utf8Bytes);
        }

        private readonly record struct PrefixBudget(int CharacterCount, int Utf8Bytes);
    }
}
