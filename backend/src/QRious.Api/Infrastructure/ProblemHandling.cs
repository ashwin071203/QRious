using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using QRious.Application.Common;

namespace QRious.Api.Infrastructure;

/// <summary>Maps exceptions to RFC 9457 ProblemDetails with a stable machine-readable <c>code</c>.</summary>
public sealed class AppExceptionHandler(ILogger<AppExceptionHandler> logger, IProblemDetailsService problems) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        ProblemDetails details;
        switch (exception)
        {
            case AppException app:
                details = new ProblemDetails { Status = app.Status, Title = TitleFor(app.Status), Detail = app.Message };
                details.Extensions["code"] = app.Code;
                if (app.Errors is not null) details.Extensions["errors"] = app.Errors;
                foreach (var (k, v) in app.Extensions) details.Extensions[k] = v;
                break;
            case BadHttpRequestException bad:
                details = new ProblemDetails { Status = bad.StatusCode, Title = TitleFor(bad.StatusCode), Detail = "The request was malformed or too large." };
                details.Extensions["code"] = bad.StatusCode == 413 ? "payload_too_large" : "bad_request";
                break;
            case OperationCanceledException when context.RequestAborted.IsCancellationRequested:
                details = new ProblemDetails { Status = 499, Title = "Client closed request" };
                details.Extensions["code"] = "cancelled";
                break;
            default:
                logger.LogError(exception, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);
                details = new ProblemDetails { Status = 500, Title = "Something went wrong", Detail = "An unexpected error occurred. Please try again." };
                details.Extensions["code"] = "server_error";
                break;
        }

        context.Response.StatusCode = details.Status ?? 500;
        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = details, Exception = exception });
    }

    public static string TitleFor(int status) => status switch
    {
        400 => "Invalid request",
        401 => "Not authorized",
        403 => "Forbidden",
        404 => "Not found",
        409 => "Conflict",
        413 => "Payload too large",
        422 => "Unprocessable request",
        429 => "Too many requests",
        _ => "Error",
    };
}
