import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNormalizeArgs, UsageError } from './args';
import { AssembleError } from './assemble';
import { BudgetError } from './budget';
import { buildSet } from './buildSet';
import { GENERATION_COMMANDS, RefusedError, type CliDeps } from './cliGenerate';
import { DesignError } from './design';
import { InitError } from './init';
import { JobsError } from './jobs';
import { MeshyError, MeshyTaskError } from './meshy/client';
import { apiFromEnvironment, MissingKeyError } from './meshy/env';
import { normalizeModel, type NormalizeReport } from './normalize';
import { NormalizeError } from './spec';

const USAGE = `usage:
  pnpm art normalize --piece w-king --in raw.glb --out out.glb
      [--keep idle,attack,hit,die,victory] [--rename "Old|Name=attack" | "Old="]
      [--anim attack=attack.glb] [--drop-base-clips] [--rotate-y 180] [--max-texture 1024]
  pnpm art build-set <source-dir> <out-dir>      (reads <source-dir>/set.json)

  Meshy generation (needs MESHY_API_KEY in .env, except where noted):
  pnpm art init-set <set-dir>                    start a set: writes design.json (no key needed)
  pnpm art balance                               show the credit balance
  pnpm art actions [--search word]               look up animation action ids (free)
  pnpm art generate <set-dir> --stage concept|model|rig|animate
      [--only w-king,b-king] [--again] [--concurrency 2]
      [--dry-run]                                preview only, no key needed
      [--yes --max-credits N]                    actually spend, up to N credits
  pnpm art pick <set-dir> <piece> <stage> <n>    choose which attempt later stages use
  pnpm art assemble <set-dir>                    write set.json from the results (no key needed)`;

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

/** Errors whose message is the whole story: printed as one line, no stack trace. */
const FRIENDLY = [
  NormalizeError, DesignError, JobsError, InitError, AssembleError, BudgetError, RefusedError, MissingKeyError, MeshyError, MeshyTaskError,
];

/** Returns the process exit code. `deps` lets tests swap the Meshy client for a fake. */
export async function main(argv: string[], deps: CliDeps = { api: () => apiFromEnvironment() }): Promise<number> {
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
    // hasOwn, so a word like "constructor" is an unknown command and not an inherited method
    if (command !== undefined && Object.hasOwn(GENERATION_COMMANDS, command)) return await GENERATION_COMMANDS[command]!(rest, deps);
    console.error(USAGE);
    return 1;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      console.error(USAGE);
      return 1;
    }
    if (FRIENDLY.some((type) => e instanceof type)) {
      console.error((e as Error).message);
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
