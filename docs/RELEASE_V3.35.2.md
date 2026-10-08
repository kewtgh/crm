# ewaya CRM v3.35.2

Authentication-email delivery configuration is once again required by Web startup and readiness.
Device verification, password reset and email verification stay synchronous in Web; business
communication, notification, reminder and calendar delivery stay asynchronous in Worker.
Deployment preflight rejects invalid, missing or unequal shared webhook configuration before
build or switch. Diagnostics expose variable names and stable codes only, with no provider I/O.

Visible legacy brand text now uses ewaya across website metadata, help/legal/error pages,
email templates and newly enrolled MFA-factor labels. A new social-sharing image replaces the
active legacy image. Existing organization branding and internal identifiers remain compatible.

No database migration or credential rotation is required. Migration head remains 126 with
131 SQL files. Web and Worker require the same existing webhook URL/token; operators must
repair missing or unequal configuration before deployment. Provider credentials remain solely
in the Cloudflare Email Worker. No Production access, push or deployment occurred.

See [verification](AUTH_EMAIL_RUNTIME_V3352_VERIFICATION.md).
