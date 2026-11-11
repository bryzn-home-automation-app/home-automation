/** Escape SSID/password special chars per the WIFI: QR payload spec (\, ;, ,, "). */
export function escapeWifiField(value: string): string {
  return value.replace(/([\\;,"])/g, '\\$1');
}

/**
 * Native WIFI: QR payload. Scanned with the phone's own Camera app (not an in-app scanner), it
 * brings up the OS "Join network" prompt with the password filled in. T:WPA covers
 * WPA/WPA2/WPA3; change it if the network ever moves to WEP or is left open. Empty without a name.
 */
export function wifiPayload(ssid: string, password: string): string {
  if (!ssid) return '';
  return `WIFI:T:WPA;S:${escapeWifiField(ssid)};P:${escapeWifiField(password)};;`;
}

/**
 * The QR colours: always dark modules on the white label plate, in both themes (B-156); an
 * inverted code (light on dark) is outside the QR spec and some phone scanners won't read it.
 * The light modules are clear so the plate's own white (a touch softer in the dark theme) shows
 * through instead of a brighter square on it.
 */
export const QR_COLOURS = { dark: '#111111ff', light: '#00000000' } as const;

/**
 * Copy text and say whether it really happened (B-155). The clipboard API exists only on a secure
 * page, so on the plain-http LAN address `navigator.clipboard` is undefined; a refusal (no
 * permission, page not focused) rejects. Both come back false, never a false "Copied".
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
