import Constants from 'expo-constants';

/** Hub listens on this port by default (hub/src/config.ts). */
export const HUB_PORT = Number(process.env.EXPO_PUBLIC_HUB_PORT ?? 4317) || 4317;

/**
 * Best-effort guess for the hub address, so the user does not have to type it.
 *
 * In development the app is loaded from the Mac's Metro server, and Expo knows
 * that host (`expoConfig.hostUri` → "192.168.0.10:8081"). The hub runs on the
 * same Mac, so only the port differs.
 *
 * Returns '' when nothing sensible can be derived (tunnel URLs, localhost,
 * or a production build), so the field stays empty for manual entry.
 */
export function suggestedHubUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_HUB_URL?.trim();
  if (explicit) return explicit;

  const host = metroHost();
  if (!host) return '';
  return `http://${host}:${HUB_PORT}`;
}

function metroHost(): string | null {
  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string } | null;
    expoGoConfig?: { debuggerHost?: string } | null;
    linkingUri?: string;
  };

  const candidates = [
    constants.expoConfig?.hostUri,
    constants.expoGoConfig?.debuggerHost,
    constants.linkingUri,
  ].filter((value): value is string => Boolean(value));

  for (const raw of candidates) {
    const withoutScheme = raw.replace(/^[a-z+]+:\/\//i, '');
    const hostAndPort = withoutScheme.split('/')[0]?.split('?')[0] ?? '';
    const host = hostAndPort.replace(/:\d+$/, '');

    if (!host) continue;
    // Loopback is useless from the phone; tunnel hosts do not reach the hub.
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') continue;
    if (/\.(exp\.direct|ngrok\.io|ngrok-free\.app|trycloudflare\.com)$/i.test(host)) continue;
    // Keep it to plain IPv4 (LAN + Tailscale 100.x).
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) continue;

    return host;
  }

  return null;
}
