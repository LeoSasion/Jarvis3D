using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace Jarvis.Host;

public partial class MainWindow
{
    // This path runs only in the explicitly requested, isolated renderer smoke
    // session. It exercises the shipped DOM and leaves the Windows taskbar alone.
    private async Task RunRendererGraphBenchmarkAsync()
    {
        if (_rendererSmokeOptions is null || !_rendererSmokeOptions.MeasurePerformance) return;
        if (!await WaitForRendererSmokeBooleanAsync("Boolean(document.querySelector('.core-stage__graph-explore'))", 200))
            throw new InvalidOperationException("The synthetic graph did not become available.");

        var samples = new List<RendererPerformanceSample>();
        samples.Add(await MeasureRendererScenarioAsync("idle"));
        await ExecuteRendererSmokeActionAsync("document.querySelector('.core-stage__graph-explore').click()");
        if (!await WaitForRendererSmokeBooleanAsync("document.querySelector('.core-stage__graph-explore')?.getAttribute('aria-pressed') === 'true'"))
            throw new InvalidOperationException("Explore did not open.");
        await SelectBenchmarkDimensionAsync("3D");
        if (!await WaitForRendererSmokeBooleanAsync("Boolean(document.querySelector('.knowledge-workspace__accessible-nodes [role=option]'))"))
            throw new InvalidOperationException("The graph node navigator did not become available.");
        await ExecuteRendererSmokeActionAsync("document.querySelector('.knowledge-workspace__accessible-nodes [role=option]').click()");
        if (!await WaitForRendererSmokeBooleanAsync("Boolean(document.querySelector('.knowledge-workspace__accessible-nodes [role=option][aria-selected=true]'))"))
            throw new InvalidOperationException("The focus node was not selected.");
        samples.Add(await MeasureRendererScenarioAsync("explore-3d-focused"));
        await SelectBenchmarkDimensionAsync("2D");
        samples.Add(await MeasureRendererScenarioAsync("explore-2d-focused"));

        // A settled graph must still respond to repeated mode changes. Drive the
        // real controls so state ownership and graphics lifetime are exercised.
        for (var cycle = 0; cycle < 3; cycle++)
        {
            await ExecuteRendererSmokeActionAsync("document.querySelector('.core-stage__graph-explore').click()");
            if (!await WaitForRendererSmokeBooleanAsync("document.querySelector('.core-stage__graph-explore')?.getAttribute('aria-pressed') === 'false'"))
                throw new InvalidOperationException("Explore did not close.");
            await ExecuteRendererSmokeActionAsync("document.querySelector('.core-stage__graph-explore').click()");
            if (!await WaitForRendererSmokeBooleanAsync("document.querySelector('.core-stage__graph-explore')?.getAttribute('aria-pressed') === 'true'"))
                throw new InvalidOperationException("Explore did not reopen.");
            await SelectBenchmarkDimensionAsync(cycle % 2 == 0 ? "3D" : "2D");
        }
        await VerifyRendererKnowledgeInteractionAsync();
        await ExecuteRendererSmokeActionAsync("document.querySelector('.core-stage__graph-explore').click()");

        var path = Path.Combine(_rendererSmokeOptions.DataRoot, "receipts", "performance.json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            sampledAtUtc = DateTimeOffset.UtcNow,
            environment = "isolated native WebView2; visible non-activating window; full-motion query override; synthetic 96-note Vault",
            viewport = new { width = Width, height = Height },
            logicalProcessors = Environment.ProcessorCount,
            webView2Version = WebView.CoreWebView2.Environment.BrowserVersionString,
            taskbarTouched = false,
            repeatedExploreTransitionsPassed = true,
            knowledgeSearchAndExcerptPassed = true,
            notes = "Frame intervals are not GPU execution times. Working sets are summed, may include shared pages, and are not unique memory. Occlusion and other desktop workloads affect results.",
            samples,
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
    }

    private async Task VerifyRendererKnowledgeInteractionAsync()
    {
        const string searchInput = "document.querySelector('.knowledge-browser input[type=search]')";
        if (!await WaitForRendererSmokeBooleanAsync($"Boolean({searchInput})"))
            throw new InvalidOperationException("The knowledge search input did not appear.");
        await ExecuteRendererSmokeActionAsync($"(() => {{ const input = {searchInput}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Fixture-42'); input.dispatchEvent(new Event('input', {{ bubbles: true }})); }})()");
        const string resultButton = "Array.from(document.querySelectorAll('.knowledge-browser__results button')).find(button => button.textContent.includes('Note-042.md'))";
        if (!await WaitForRendererSmokeBooleanAsync($"Boolean({resultButton})"))
            throw new InvalidOperationException("Alias search did not find the synthetic note.");
        await ExecuteRendererSmokeActionAsync($"({resultButton}).click()");
        if (!await WaitForRendererSmokeBooleanAsync("Boolean(document.querySelector('.knowledge-browser__note input[type=number]'))"))
            throw new InvalidOperationException("The selected knowledge note did not appear.");
        await ExecuteRendererSmokeActionAsync("document.querySelector('.knowledge-browser__note input[type=number]').closest('label').parentElement.querySelector('button').click()");
        if (!await WaitForRendererSmokeBooleanAsync("document.querySelector('.knowledge-browser__excerpt pre')?.textContent.includes('Synthetic note 42')"))
            throw new InvalidOperationException("The source excerpt did not match the synthetic note.");
        await ExecuteRendererSmokeActionAsync("document.querySelector('.knowledge-browser__excerpt button').click()");
        if (!await WaitForRendererSmokeBooleanAsync("document.querySelector('.knowledge-browser__basket')?.textContent.includes('[S1]')"))
            throw new InvalidOperationException("The reviewed excerpt was not staged.");
        if (await ExecuteRendererSmokeBooleanAsync("Boolean(document.querySelector('.agent-messages article'))"))
            throw new InvalidOperationException("Reading or staging a note unexpectedly created an Agent turn.");
    }

    private async Task SelectBenchmarkDimensionAsync(string dimension)
    {
        var literal = JsonSerializer.Serialize(dimension);
        await ExecuteRendererSmokeActionAsync($"Array.from(document.querySelectorAll('.desktop-graph-tools button')).find(button => button.textContent === {literal})?.click()");
        if (!await WaitForRendererSmokeBooleanAsync($"Array.from(document.querySelectorAll('.desktop-graph-tools button')).some(button => button.textContent === {literal} && button.getAttribute('aria-pressed') === 'true')"))
            throw new InvalidOperationException($"Graph dimension {dimension} did not activate.");
        if (!await WaitForRendererSmokeBooleanAsync($"document.querySelector('.graphics-runtime')?.dataset.graphDimension === '{dimension[0]}' && document.querySelector('.graphics-runtime__surface')?.dataset.rendererState === 'ready'"))
            throw new InvalidOperationException($"Graph renderer {dimension} did not become ready.");
    }

    private async Task<RendererPerformanceSample> MeasureRendererScenarioAsync(string scenario)
    {
        await Task.Delay(2_000);
        var baseline = ReadRendererProcessUsage(out var unavailableReadings);
        var processSetChanged = false;
        var started = Stopwatch.StartNew();
        long peakWorkingSet = 0;
        for (var second = 0; second < 15; second++)
        {
            if (_isClosing) throw new OperationCanceledException("Renderer benchmark was closed.");
            await Task.Delay(1_000);
            var reading = ReadRendererProcessUsage(out var unavailable);
            unavailableReadings += unavailable;
            processSetChanged |= !baseline.Keys.Order().SequenceEqual(reading.Keys.Order());
            peakWorkingSet = Math.Max(peakWorkingSet, reading.Values.Sum(value => value.WorkingSet));
        }
        var after = ReadRendererProcessUsage(out var unavailableAfter);
        unavailableReadings += unavailableAfter;
        processSetChanged |= !baseline.Keys.Order().SequenceEqual(after.Keys.Order());
        var cpuMilliseconds = after.Sum(entry => Math.Max(0,
            entry.Value.CpuMilliseconds - (baseline.TryGetValue(entry.Key, out var before) ? before.CpuMilliseconds : 0)));
        var serialized = await WebView.CoreWebView2.ExecuteScriptAsync("(() => { const surface = document.querySelector('.graphics-runtime__surface'); return surface ? { ...surface.dataset, documentVisible: document.visibilityState === 'visible', systemReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, width: innerWidth, height: innerHeight } : null; })()");
        using var graphics = JsonDocument.Parse(serialized);
        if (graphics.RootElement.ValueKind != JsonValueKind.Object ||
            !graphics.RootElement.TryGetProperty("frameStatistics", out _))
            throw new InvalidOperationException($"No active graphics samples for {scenario}: {serialized}");
        return new RendererPerformanceSample(scenario, started.Elapsed.TotalSeconds,
            cpuMilliseconds / 1_000,
            cpuMilliseconds / started.Elapsed.TotalMilliseconds / Environment.ProcessorCount * 100,
            peakWorkingSet, !processSetChanged && unavailableReadings == 0,
            processSetChanged, unavailableReadings, baseline.Count, after.Count, graphics.RootElement.Clone());
    }

    private Dictionary<int, (double CpuMilliseconds, long WorkingSet)> ReadRendererProcessUsage(out int unavailableReadings)
    {
        unavailableReadings = 0;
        var ids = WebView.CoreWebView2.Environment.GetProcessInfos().Select(info => info.ProcessId)
            .Append(Environment.ProcessId).Distinct();
        var readings = new Dictionary<int, (double, long)>();
        foreach (var id in ids)
        {
            try
            {
                using var process = Process.GetProcessById(id);
                readings[id] = (process.TotalProcessorTime.TotalMilliseconds, process.WorkingSet64);
            }
            catch (ArgumentException) { unavailableReadings++; }
            catch (InvalidOperationException) { unavailableReadings++; }
            catch (System.ComponentModel.Win32Exception) { unavailableReadings++; }
        }
        return readings;
    }

    private sealed record RendererPerformanceSample(string Scenario, double DurationSeconds,
        double ProcessCpuSeconds, double MachineCpuPercent, long PeakSummedWorkingSetBytes,
        bool ProcessMeasurementComplete, bool ProcessSetChanged, int UnavailableProcessReadings,
        int BaselineProcessCount, int FinalProcessCount, JsonElement Graphics);
}
