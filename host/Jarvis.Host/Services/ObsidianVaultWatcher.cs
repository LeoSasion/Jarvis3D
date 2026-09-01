using System.IO;

namespace Jarvis.Host.Services;

internal enum ObsidianVaultChangeKind
{
    Created,
    Changed,
    Deleted,
    Renamed
}

internal sealed record ObsidianVaultChange(
    ObsidianVaultChangeKind Kind,
    string FullPath,
    string? OldFullPath = null);

internal interface IObsidianVaultWatcher : IDisposable
{
    event EventHandler<ObsidianVaultChange>? Changed;

    event EventHandler? Overflowed;

    void Start();
}

internal interface IObsidianVaultWatcherFactory
{
    IObsidianVaultWatcher Create(string vaultRoot);
}

internal sealed class FileSystemObsidianVaultWatcherFactory : IObsidianVaultWatcherFactory
{
    public static FileSystemObsidianVaultWatcherFactory Instance { get; } = new();

    public IObsidianVaultWatcher Create(string vaultRoot) => new FileSystemObsidianVaultWatcher(vaultRoot);
}

internal sealed class FileSystemObsidianVaultWatcher : IObsidianVaultWatcher
{
    private readonly FileSystemWatcher _watcher;
    private bool _disposed;

    public FileSystemObsidianVaultWatcher(string vaultRoot)
    {
        _watcher = new FileSystemWatcher(vaultRoot)
        {
            IncludeSubdirectories = true,
            Filter = "*",
            NotifyFilter = NotifyFilters.FileName |
                           NotifyFilters.DirectoryName |
                           NotifyFilters.LastWrite |
                           NotifyFilters.Size,
            InternalBufferSize = 32 * 1024
        };

        _watcher.Created += OnCreated;
        _watcher.Changed += OnChanged;
        _watcher.Deleted += OnDeleted;
        _watcher.Renamed += OnRenamed;
        _watcher.Error += OnError;
    }

    public event EventHandler<ObsidianVaultChange>? Changed;

    public event EventHandler? Overflowed;

    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _watcher.EnableRaisingEvents = true;
    }

    private void OnCreated(object sender, FileSystemEventArgs args) =>
        RaiseChange(ObsidianVaultChangeKind.Created, args.FullPath);

    private void OnChanged(object sender, FileSystemEventArgs args) =>
        RaiseChange(ObsidianVaultChangeKind.Changed, args.FullPath);

    private void OnDeleted(object sender, FileSystemEventArgs args) =>
        RaiseChange(ObsidianVaultChangeKind.Deleted, args.FullPath);

    private void OnRenamed(object sender, RenamedEventArgs args) =>
        Changed?.Invoke(
            this,
            new ObsidianVaultChange(
                ObsidianVaultChangeKind.Renamed,
                args.FullPath,
                args.OldFullPath));

    private void OnError(object sender, ErrorEventArgs args) => Overflowed?.Invoke(this, EventArgs.Empty);

    private void RaiseChange(ObsidianVaultChangeKind kind, string fullPath) =>
        Changed?.Invoke(this, new ObsidianVaultChange(kind, fullPath));

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _watcher.EnableRaisingEvents = false;
        _watcher.Created -= OnCreated;
        _watcher.Changed -= OnChanged;
        _watcher.Deleted -= OnDeleted;
        _watcher.Renamed -= OnRenamed;
        _watcher.Error -= OnError;
        _watcher.Dispose();
    }
}
