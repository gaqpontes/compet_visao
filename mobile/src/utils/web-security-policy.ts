import productionPolicy from '../../security/web-policy.json';

/** Development runs on loopback; allow Metro scripts/HMR without allowing SDK telemetry off-device. */
export function getWebContentSecurityPolicy(development: boolean): string {
  if (!development) return productionPolicy.contentSecurityPolicy;
  return productionPolicy.contentSecurityPolicy.split(';').map((entry) => {
    const directive = entry.trim();
    if (directive.startsWith('script-src ')) {
      // Hash sources disable unsafe-inline, so development uses a separate script directive.
      return "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'";
    }
    if (directive.startsWith('connect-src ')) {
      return "connect-src 'self' ws://localhost:* ws://127.0.0.1:*";
    }
    return directive;
  }).join('; ');
}
