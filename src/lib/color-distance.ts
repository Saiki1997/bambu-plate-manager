/** CIEDE2000 colour difference. Inputs are sRGB hex `#RRGGBB`. */

export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return `#${raw.slice(0, 6).toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

function pivot(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexToLab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = pivot((n >> 16) & 255);
  const g = pivot((n >> 8) & 255);
  const b = pivot(n & 255);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function deg(value: number): number {
  return (value * 180) / Math.PI;
}

/** CIEDE2000. Smaller means closer. Identical colours return 0. */
export function deltaE00(hexA: string, hexB: string): number {
  const [L1, a1, b1] = hexToLab(hexA);
  const [L2, a2, b2] = hexToLab(hexB);
  const avgLp = (L1 + L2) / 2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const avgC = (c1 + c2) / 2;
  const c7 = avgC ** 7;
  const g = 0.5 * (1 - Math.sqrt(c7 / (c7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const avgCp = (c1p + c2p) / 2;
  const h1p = Math.atan2(b1, a1p);
  const h2p = Math.atan2(b2, a2p);
  let dhp = h2p - h1p;
  if (c1p * c2p === 0) dhp = 0;
  else if (dhp > Math.PI) dhp -= 2 * Math.PI;
  else if (dhp < -Math.PI) dhp += 2 * Math.PI;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(dhp / 2);
  let avgHp = (h1p + h2p) / 2;
  if (c1p * c2p !== 0 && Math.abs(h1p - h2p) > Math.PI) {
    avgHp += h1p + h2p < 2 * Math.PI ? Math.PI : -Math.PI;
  }
  const t =
    1 -
    0.17 * Math.cos(avgHp - rad(30)) +
    0.24 * Math.cos(2 * avgHp) +
    0.32 * Math.cos(3 * avgHp + rad(6)) -
    0.2 * Math.cos(4 * avgHp - rad(63));
  const dLp = L2 - L1;
  const dCp = c2p - c1p;
  const sl = 1 + (0.015 * (avgLp - 50) ** 2) / Math.sqrt(20 + (avgLp - 50) ** 2);
  const sc = 1 + 0.045 * avgCp;
  const sh = 1 + 0.015 * avgCp * t;
  const avgHpDeg = deg(avgHp);
  const dTheta = 30 * Math.exp(-(((avgHpDeg - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(avgCp ** 7 / (avgCp ** 7 + 25 ** 7));
  const rt = -Math.sin(rad(2 * dTheta)) * rc;
  const kl = 1;
  const kc = 1;
  const kh = 1;
  return Math.sqrt((dLp / (kl * sl)) ** 2 + (dCp / (kc * sc)) ** 2 + (dHp / (kh * sh)) ** 2 + rt * (dCp / (kc * sc)) * (dHp / (kh * sh)));
}

export function confidenceFromDelta(delta: number): "high" | "medium" | "low" {
  if (delta <= 3) return "high";
  if (delta <= 10) return "medium";
  return "low";
}
