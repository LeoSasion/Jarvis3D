using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host;

public partial class MainWindow
{
    // Available only after the explicitly requested isolated renderer smoke.
    // The page exposes a whitelist of synthetic cases, never a renderer/scene.
    private async Task RunGraphicsRegressionAsync()
    {
        if (_rendererSmokeOptions?.MeasureGraphicsRegression != true) return;
        var directory = Path.Combine(_rendererSmokeOptions.DataRoot, "receipts", "graphics-regression");
        Directory.CreateDirectory(directory);
        var report = new JsonObject
        {
            ["schemaVersion"] = 1,
            ["environment"] = "native-webview2",
            ["browserVersion"] = WebView.CoreWebView2.Environment.BrowserVersionString,
            ["capturedAtUtc"] = DateTimeOffset.UtcNow.ToString("O"),
            ["taskbarTouched"] = false,
            ["note"] = "Fixed-step synthetic animation; P95 is actual active frame interval, not GPU time. PNGs are browser-composited WebView captures cropped to the same CSS stage. Compare scene invariants across runtimes; review PNG encoding/pixel variance separately.",
            ["success"] = false,
        };
        var samples = new JsonArray();
        report["samples"] = samples;
        try
        {
            // A second navigation must not recursively start another shell smoke.
            WebView.CoreWebView2.NavigationCompleted -= OnNavigationCompleted;
            WebView.CoreWebView2.Navigate("https://jarvis.local/graphics-regression.html");
            if (!await WaitForRendererSmokeBooleanAsync("Boolean(window.jarvisGraphicsRegression && document.querySelector('[data-regression-ready=true]'))", 400))
                throw new InvalidOperationException("The fixed graphics regression entry did not load.");
            var manifest = await ReadGraphicsRegressionJsonAsync("window.jarvisGraphicsRegression.manifest");
            var environment = await ReadGraphicsRegressionJsonAsync("window.jarvisGraphicsRegression.environment()");
            report["manifest"] = manifest;
            report["runtime"] = environment;
            if (environment["documentVisible"]?.GetValue<bool>() != true)
                throw new InvalidOperationException("The regression WebView document is hidden.");
            var cases = manifest["cases"]!.AsArray().Select(value => value!.GetValue<string>()).ToArray();
            if (cases.Length is < 1 or > 12) throw new InvalidOperationException("Invalid regression case count.");
            foreach (var caseId in cases)
            {
                if (_isClosing) throw new OperationCanceledException("The graphics regression was closed.");
                if (!System.Text.RegularExpressions.Regex.IsMatch(caseId, "^[a-z0-9-]{1,48}$"))
                    throw new InvalidOperationException("Invalid graphics regression case name.");
                var literal = JsonSerializer.Serialize(caseId);
                if (!await ExecuteRendererSmokeBooleanAsync($"window.jarvisGraphicsRegression.start({literal})"))
                    throw new InvalidOperationException($"Graphics regression rejected {caseId}.");
                if (!await WaitForRendererSmokeBooleanAsync("['complete','failed'].includes(window.jarvisGraphicsRegression.status().phase)", 2400))
                    throw new InvalidOperationException($"Graphics regression timed out in {caseId}.");
                var status = await ReadGraphicsRegressionJsonAsync("window.jarvisGraphicsRegression.status()");
                if (status["phase"]?.GetValue<string>() != "complete")
                    throw new InvalidOperationException($"{caseId}: {status["error"]}");
                var sample = status["result"]!.DeepClone().AsObject();
                var screenshot = caseId + ".png";
                var bytes = await CaptureGraphicsRegressionStageAsync(environment, manifest);
                await File.WriteAllBytesAsync(Path.Combine(directory, screenshot), bytes);
                sample["screenshot"] = screenshot;
                sample["screenshotSha256"] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                samples.Add(sample);
            }
            string Hash(string id) => samples.Select(value => value!.AsObject())
                .Single(value => value["caseId"]!.GetValue<string>() == id)["screenshotSha256"]!.GetValue<string>();
            if (Hash("frozen-a") != Hash("frozen-a-restored"))
                throw new InvalidOperationException("Frozen A was not restored pixel-for-pixel.");
            if (Hash("frozen-a") == Hash("frozen-b"))
                throw new InvalidOperationException("The B edit did not change the composed image.");
            if (Hash("reentry") != Hash("context-restored"))
                throw new InvalidOperationException("Context recovery changed the composed image.");
            report["success"] = true;
        }
        catch (Exception exception)
        {
            report["error"] = exception.Message;
            throw;
        }
        finally
        {
            await File.WriteAllTextAsync(Path.Combine(directory, "report.json"),
                report.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    private async Task<JsonObject> ReadGraphicsRegressionJsonAsync(string expression)
    {
        var serialized = await WebView.CoreWebView2.ExecuteScriptAsync(expression);
        return JsonNode.Parse(serialized)?.AsObject()
            ?? throw new InvalidOperationException("The regression page returned no object.");
    }

    private async Task<byte[]> CaptureGraphicsRegressionStageAsync(JsonObject environment, JsonObject manifest)
    {
        using var preview = new MemoryStream();
        await WebView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, preview);
        preview.Position = 0;
        var bitmap = BitmapDecoder.Create(preview, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad).Frames[0];
        var viewport = environment["viewport"]!.AsObject();
        var stage = environment["stage"]!.AsObject();
        var scaleX = bitmap.PixelWidth / viewport["width"]!.GetValue<double>();
        var scaleY = bitmap.PixelHeight / viewport["height"]!.GetValue<double>();
        var width = manifest["width"]!.GetValue<int>();
        var height = manifest["height"]!.GetValue<int>();
        var rect = new Int32Rect((int)Math.Round(stage["x"]!.GetValue<double>() * scaleX),
            (int)Math.Round(stage["y"]!.GetValue<double>() * scaleY),
            (int)Math.Round(width * scaleX), (int)Math.Round(height * scaleY));
        if (rect.X < 0 || rect.Y < 0 || rect.X + rect.Width > bitmap.PixelWidth || rect.Y + rect.Height > bitmap.PixelHeight)
            throw new InvalidOperationException("The regression stage does not fit in the native WebView viewport.");
        BitmapSource image = new CroppedBitmap(bitmap, rect);
        if (image.PixelWidth != width || image.PixelHeight != height)
            image = new TransformedBitmap(image, new ScaleTransform((double)width / image.PixelWidth, (double)height / image.PixelHeight));
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(image));
        using var output = new MemoryStream();
        encoder.Save(output);
        return output.ToArray();
    }
}
