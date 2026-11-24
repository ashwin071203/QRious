namespace QRious.Application.Common;

/// <summary>
/// An expected, client-facing failure. Mapped to RFC 9457 ProblemDetails with a stable <see cref="Code"/>.
/// </summary>
public class AppException(int status, string code, string message, IDictionary<string, string[]>? errors = null)
    : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public IDictionary<string, string[]>? Errors { get; } = errors;
    /// <summary>Optional extra machine-readable data (e.g. username suggestions).</summary>
    public IDictionary<string, object?> Extensions { get; } = new Dictionary<string, object?>();

    public static AppException NotFound(string code, string message) => new(404, code, message);
    public static AppException Conflict(string code, string message) => new(409, code, message);
    public static AppException Forbidden(string code, string message) => new(403, code, message);
    public static AppException Unauthorized(string code, string message) => new(401, code, message);
    public static AppException BadRequest(string code, string message) => new(400, code, message);

    public static AppException Validation(IDictionary<string, string[]> errors) =>
        new(400, "validation_failed", "One or more fields are invalid.", errors);

    public static AppException Validation(string field, string message) =>
        Validation(new Dictionary<string, string[]> { [field] = [message] });
}

public static class ErrorCodes
{
    public const string ProfileRequired = "profile_required";
    public const string ExistingIdentity = "existing_identity";
    public const string UsernameTaken = "username_taken";
    public const string UsernameChangeTooSoon = "username_change_too_soon";
    public const string EventNotJoinable = "event_not_joinable";
    public const string EventFull = "event_full";
    public const string ParticipantRemoved = "participant_removed";
    public const string NotParticipant = "not_participant";
    public const string QrInvalid = "qr_invalid";
    public const string RecoveryFailed = "recovery_failed";
    public const string ConsentRequired = "consent_required";
    public const string IdempotencyMismatch = "idempotency_key_reused";
    public const string NotFound = "not_found";
}
