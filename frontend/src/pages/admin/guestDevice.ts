/**
 * A browser's user-agent string in two words a person recognises: "iPhone · Safari",
 * "Android · Chrome", "Windows · Edge". The raw string (Mozilla/5.0 (iPhone; CP…) says
 * nothing useful at a glance (B-177); pages keep it behind a disclosure for the curious.
 */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const s = ua;
  const device =
    /iPhone/.test(s) ? 'iPhone'
      : /iPad/.test(s) ? 'iPad'
        : /Android/.test(s) ? (/Mobile/.test(s) ? 'Android phone' : 'Android tablet')
          : /Windows/.test(s) ? 'Windows'
            : /Macintosh|Mac OS X/.test(s) ? 'Mac'
              : /CrOS/.test(s) ? 'Chromebook'
                : /Linux/.test(s) ? 'Linux'
                  : null;
  // Order matters: Edge and Opera say "Chrome" too, Chrome says "Safari", and every iOS
  // browser is Safari underneath but names itself (CriOS, FxiOS, EdgiOS).
  const browser =
    /Edg(e|A|iOS)?\//.test(s) ? 'Edge'
      : /OPR\/|Opera/.test(s) ? 'Opera'
        : /SamsungBrowser/.test(s) ? 'Samsung Internet'
          : /CriOS|Chrome\//.test(s) ? 'Chrome'
            : /FxiOS|Firefox\//.test(s) ? 'Firefox'
              : /Safari\//.test(s) ? 'Safari'
                : null;
  const parts = [device, browser].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Unknown device';
}
