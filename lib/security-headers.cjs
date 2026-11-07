function contentSecurityPolicy(nodeEnv) {
  const production = nodeEnv === "production";
  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (!production) scriptSources.push("'unsafe-eval'");

  const connectSources = ["'self'"];
  if (!production) connectSources.push("ws:", "wss:");

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSources.join(" ")}`,
  ];

  if (production) {
    directives.push("frame-ancestors 'none'", "upgrade-insecure-requests");
  }
  return directives.join("; ");
}

function getSecurityHeaders(nodeEnv = process.env.NODE_ENV) {
  const production = nodeEnv === "production";
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(nodeEnv) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];

  if (production) {
    headers.push(
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    );
  }
  return headers;
}

module.exports = { contentSecurityPolicy, getSecurityHeaders };
