/** Small equirectangular sky as a Radiance .hdr file, written with new-style RLE literal runs (what three's RGBELoader expects). */
export function buildEnvHdr(width = 64, height = 32): Uint8Array {
  const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1); // 0 = zenith, 1 = nadir
    const scan: number[][] = [[], [], [], []];
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const sun = Math.exp(-(((u - 0.3) * 8) ** 2 + ((v - 0.3) * 6) ** 2)) * 6;
      const sky = v < 0.5 ? 0.25 + 0.6 * (v * 2) : 0.06;
      const r = sky * 0.9 + sun;
      const g = sky * 0.85 + sun * 0.9;
      const b = sky * 1.1 + sun * 0.8;
      const m = Math.max(r, g, b);
      if (m < 1e-32) {
        scan[0]!.push(0); scan[1]!.push(0); scan[2]!.push(0); scan[3]!.push(0);
        continue;
      }
      const e = Math.ceil(Math.log2(m));
      const scale = 256 / 2 ** e;
      scan[0]!.push(Math.min(255, Math.floor(r * scale)));
      scan[1]!.push(Math.min(255, Math.floor(g * scale)));
      scan[2]!.push(Math.min(255, Math.floor(b * scale)));
      scan[3]!.push(e + 128);
    }
    const row: number[] = [2, 2, (width >> 8) & 0xff, width & 0xff];
    for (const channel of scan) {
      for (let i = 0; i < channel.length; i += 128) {
        const run = channel.slice(i, i + 128);
        row.push(run.length, ...run);
      }
    }
    rows.push(row);
  }
  const body = rows.flat();
  const out = new Uint8Array(header.length + body.length);
  out.set(header);
  out.set(body, header.length);
  return out;
}
