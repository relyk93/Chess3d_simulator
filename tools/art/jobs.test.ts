// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Jobs, JobsError, type Attempt } from './jobs';

const attempt = (taskId: string, patch: Partial<Attempt> = {}): Attempt => ({
  taskId, status: 'SUCCEEDED', file: `f-${taskId}`, credits: 3, error: null, ...patch,
});
const tmp = () => join(mkdtempSync(join(tmpdir(), 'jobs-')), 'nested', 'jobs.json');

describe('Jobs persistence', () => {
  test('a missing file loads as empty and is created, with its folder, on the first change', () => {
    const path = tmp();
    const jobs = Jobs.load(path);
    expect(jobs.attempts('w-king', 'concept')).toEqual([]);
    expect(existsSync(path)).toBe(false);
    jobs.add('w-king', 'concept', attempt('t1'));
    expect(existsSync(path)).toBe(true);
  });

  test('changes survive a reload', () => {
    const path = tmp();
    const jobs = Jobs.load(path);
    jobs.add('w-king', 'concept', attempt('t1'));
    jobs.add('w-king', 'concept', attempt('t2', { status: 'FAILED', file: null, credits: null, error: 'boom' }));
    jobs.add('b-queen', 'rig', attempt('t3'));
    const again = Jobs.load(path);
    expect(again.attempts('w-king', 'concept').map((a) => a.taskId)).toEqual(['t1', 't2']);
    expect(again.attempts('w-king', 'concept')[1]).toMatchObject({ status: 'FAILED', error: 'boom' });
    expect(again.attempts('b-queen', 'rig')).toHaveLength(1);
  });

  test('add returns the attempt number, counting from 1', () => {
    const jobs = Jobs.load(tmp());
    expect(jobs.add('w-king', 'model', attempt('a'))).toBe(1);
    expect(jobs.add('w-king', 'model', attempt('b'))).toBe(2);
    expect(jobs.add('w-king', 'concept', attempt('c'))).toBe(1);
  });

  test('saving is atomic: no temp file is left behind and the file is valid JSON', () => {
    const path = tmp();
    Jobs.load(path).add('w-king', 'concept', attempt('t1'));
    expect(readdirSync(join(path, '..'))).toEqual(['jobs.json']);
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(1);
  });

  test('a corrupt file is an error that names the file, not a silent reset', () => {
    const path = tmp();
    Jobs.load(path).add('w-king', 'concept', attempt('t1'));
    writeFileSync(path, '{ not json');
    expect(() => Jobs.load(path)).toThrow(JobsError);
    expect(() => Jobs.load(path)).toThrow(new RegExp(`${path.replace(/[/\\.]/g, '\\$&')}.*not a valid jobs file`));
  });

  test('a file from a different version is rejected', () => {
    const path = tmp();
    Jobs.load(path).add('w-king', 'concept', attempt('t1'));
    writeFileSync(path, JSON.stringify({ version: 99, pieces: {} }));
    expect(() => Jobs.load(path)).toThrow(/not a valid jobs file/);
  });
});

describe('Jobs updates', () => {
  test('update patches one attempt by task id and persists it', () => {
    const path = tmp();
    const jobs = Jobs.load(path);
    jobs.add('w-king', 'model', attempt('t1', { status: 'IN_PROGRESS', file: null, credits: null }));
    jobs.update('w-king', 'model', 't1', { status: 'SUCCEEDED', file: 'models/w-king-1.glb', credits: 20 });
    expect(Jobs.load(path).attempts('w-king', 'model')[0]).toMatchObject({ status: 'SUCCEEDED', file: 'models/w-king-1.glb', credits: 20 });
  });

  test('updating an unknown task id is an error', () => {
    expect(() => Jobs.load(tmp()).update('w-king', 'model', 'nope', {})).toThrow(/no attempt "nope" for w-king model/);
  });
});

describe('Jobs selection', () => {
  test('nothing succeeded means nothing selected', () => {
    const jobs = Jobs.load(tmp());
    expect(jobs.selected('w-king', 'concept')).toBeNull();
    jobs.add('w-king', 'concept', attempt('t1', { status: 'FAILED', file: null, credits: null }));
    expect(jobs.selected('w-king', 'concept')).toBeNull();
  });

  test('by default the latest succeeded attempt is used, skipping later failures', () => {
    const jobs = Jobs.load(tmp());
    jobs.add('w-king', 'concept', attempt('t1'));
    jobs.add('w-king', 'concept', attempt('t2'));
    jobs.add('w-king', 'concept', attempt('t3', { status: 'FAILED', file: null, credits: null }));
    expect(jobs.selected('w-king', 'concept')?.taskId).toBe('t2');
  });

  test('select picks an attempt by its number and the pick persists', () => {
    const path = tmp();
    const jobs = Jobs.load(path);
    jobs.add('w-king', 'concept', attempt('t1'));
    jobs.add('w-king', 'concept', attempt('t2'));
    jobs.select('w-king', 'concept', 1);
    expect(jobs.selected('w-king', 'concept')?.taskId).toBe('t1');
    expect(Jobs.load(path).selected('w-king', 'concept')?.taskId).toBe('t1');
  });

  test('select rejects a number out of range, and an attempt that did not succeed', () => {
    const jobs = Jobs.load(tmp());
    jobs.add('w-king', 'concept', attempt('t1'));
    jobs.add('w-king', 'concept', attempt('t2', { status: 'FAILED', file: null, credits: null }));
    expect(() => jobs.select('w-king', 'concept', 3)).toThrow(/w-king concept has 2 attempts; choose 1 to 2/);
    expect(() => jobs.select('w-king', 'concept', 2)).toThrow(/attempt 2 of w-king concept did not succeed \(FAILED\)/);
    expect(() => jobs.select('b-king', 'concept', 1)).toThrow(/b-king concept has no attempts/);
  });
});

describe('Jobs lastCredits', () => {
  test('is the most recent recorded cost of a stage across all pieces, or null if none', () => {
    const jobs = Jobs.load(tmp());
    expect(jobs.lastCredits('model')).toBeNull();
    jobs.add('w-king', 'model', attempt('a', { credits: 20 }));
    jobs.add('b-king', 'model', attempt('b', { credits: 22 }));
    jobs.add('w-queen', 'model', attempt('c', { status: 'FAILED', file: null, credits: null }));
    expect(jobs.lastCredits('model')).toBe(22);
    expect(jobs.lastCredits('rig')).toBeNull();
  });
});

describe('Jobs credits', () => {
  test('totalCredits adds every recorded cost across pieces and stages and ignores unknowns', () => {
    const jobs = Jobs.load(tmp());
    jobs.add('w-king', 'concept', attempt('a', { credits: 3 }));
    jobs.add('w-king', 'model', attempt('b', { credits: 20 }));
    jobs.add('b-king', 'rig', attempt('c', { credits: 5 }));
    jobs.add('b-king', 'attack', attempt('d', { credits: null }));
    expect(jobs.totalCredits()).toBe(28);
  });
});
