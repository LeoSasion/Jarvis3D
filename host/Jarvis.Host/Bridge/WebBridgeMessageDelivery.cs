using System.Runtime.InteropServices;

namespace Jarvis.Host.Bridge;

internal enum WebBridgeDeliveryFailure
{
    None,
    PayloadTooLarge,
    Serialization,
    TransportUnavailable,
    Delivery
}

internal readonly record struct WebBridgeDeliveryResult(
    bool Delivered,
    WebBridgeDeliveryFailure Failure,
    string? ExceptionType = null)
{
    public static WebBridgeDeliveryResult Success { get; } =
        new(true, WebBridgeDeliveryFailure.None);
}

internal static class WebBridgeMessageDelivery
{
    public static WebBridgeDeliveryResult TryPost(
        object payload,
        int maximumBytes,
        Action<string> postMessage)
    {
        string json;
        try
        {
            json = WebBridgePayloadPolicy.Serialize(payload, maximumBytes);
        }
        catch (WebBridgePayloadTooLargeException exception)
        {
            return Failed(WebBridgeDeliveryFailure.PayloadTooLarge, exception);
        }
        catch (Exception exception) when (!IsFatal(exception))
        {
            return Failed(WebBridgeDeliveryFailure.Serialization, exception);
        }

        try
        {
            postMessage(json);
            return WebBridgeDeliveryResult.Success;
        }
        catch (Exception exception) when (
            exception is InvalidOperationException or COMException)
        {
            // WebView2 uses InvalidOperationException while a document is being
            // replaced and COMException after its controller/process disconnects.
            return Failed(WebBridgeDeliveryFailure.TransportUnavailable, exception);
        }
        catch (Exception exception) when (!IsFatal(exception))
        {
            return Failed(WebBridgeDeliveryFailure.Delivery, exception);
        }
    }

    internal static bool IsFatal(Exception exception) =>
        exception is OutOfMemoryException or StackOverflowException or AccessViolationException;

    private static WebBridgeDeliveryResult Failed(
        WebBridgeDeliveryFailure failure,
        Exception exception) =>
        new(false, failure, exception.GetType().Name);
}
