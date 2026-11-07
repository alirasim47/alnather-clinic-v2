function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "localhost" || host === "[::1]") return true;
  const octets = host.split(".");
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function isExplicitLocalHttpOrigin(value) {
  try {
    const origin = new URL(value);
    return origin.protocol === "http:" && !origin.username && !origin.password && isLoopbackHost(origin.hostname);
  } catch {
    return false;
  }
}

export function shouldUseSecureSessionCookie({ nodeEnv, cookieSecure, appOrigin } = {}) {
  if (cookieSecure === "true") return true;
  if (cookieSecure !== "false") return nodeEnv === "production";
  if (nodeEnv !== "production") return false;
  return !isExplicitLocalHttpOrigin(appOrigin);
}
