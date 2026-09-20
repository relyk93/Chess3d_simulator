import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNormalizeArgs, UsageError } from './args';
import { buildSet } from './buildSet';
import { normalizeModel, type NormalizeReport } from './normalize';
import { NormalizeError } from './spec';

const USAGE = `usage:
  pnpm art normalize --piece w-king --in raw.glb --out out.glb
      [--keep idle,attack,hit,die,victory] [--rename "Old|Name=attack" | "Old="]
      [--anim attack=attack.glb] [--rotate-y 180] [--max-texture 1024]
  pnpm art build-set <source-dir> <out-dir>      (reads <source-dir>/set.json)`;

const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

export function formatReport(r: NormalizeReport): string {
  const clips = r.clips.length > 0 ? r.clips.join(', ') : 'none (rigid fallback)';
  const lines = [`${r.piece}: ${r.heightUnits.toFixed(3)} units tall, ${(r.bytes / 1024).toFixed(0)} KB, clips: ${clips}`];
  for (const w of r.warnings) lines.push(`  warning: ${w}`);
  return lines.join('\n');
}

export async function runNormalize(argv: string[]): Promise<NormalizeReport> {
  const cmd = parseNormalizeArgs(argv);
  const extraClips = cmd.anims.map((a) => ({ name: a.name, bytes: bytesOf(a.path) }));
  const { glb, report } = await normalizeModel(bytesOf(cmd.input), { ...cmd.options, extraClips });
  mkdirSync(dirname(cmd.output), { recursive: true });
  writeFileSync(cmd.output, glb);
  return report;
}

/** Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'normalize') {
      console.log(formatReport(await runNormalize(rest)));
      return 0;
    }
    if (command === 'build-set') {
      const [srcDir, outDir] = rest;
      if (!srcDir || !outDir) throw new UsageError('build-set expects <source-dir> <out-dir>');
      for (const report of await buildSet(srcDir, outDir)) console.log(formatReport(report));
      return 0;
    }
    console.error(USAGE);
    return 1;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      console.error(USAGE);
      return 1;
    }
    if (e instanceof NormalizeError) {
      console.error(e.message);
      return 1;
    }
    const io = e as NodeJS.ErrnoException;
    if (io.code === 'ENOENT' && io.path) {
      console.error(`cannot open ${io.path}: no such file or directory`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
