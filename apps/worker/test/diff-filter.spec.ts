import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';

// ---------------------------------------------------------------------------
// Mock simple-git at module level so the import in DiffFilterService is
// intercepted before any test code runs.
// ---------------------------------------------------------------------------

const { mockDiff, mockSimpleGit } = vi.hoisted(() => {
  const mockDiff = vi.fn();
  const mockSimpleGit = vi.fn().mockReturnValue({ diff: mockDiff });
  return { mockDiff, mockSimpleGit };
});

vi.mock('simple-git', () => ({
  simpleGit: mockSimpleGit,
}));

// Import after mocking.
const { DiffFilterService } = await import(
  '../src/diff/diff-filter.service.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a --stat summary line from insertion / deletion counts. */
function statSummaryLine(insertions: number, deletions: number): string {
  const parts: string[] = ['1 file changed'];
  if (insertions > 0) parts.push(`${insertions} insertion(+)`);
  if (deletions > 0) parts.push(`${deletions} deletion(-)`);
  return ` ${parts.join(', ')}`;
}

/** Build a --name-only output string from an array of file paths. */
function nameOnlyOutput(files: string[]): string {
  return files.join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiffFilterService.filter', () => {
  let service: InstanceType<typeof DiffFilterService>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DiffFilterService,
        {
          provide: 'PINO_LOGGER',
          useValue: {
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DiffFilterService);
  });

  it('returns empty filteredFiles, summaryOnlyMode false, and totalChangedLines 0 for empty diff output', async () => {
    // Both calls return empty strings — no files, no stat lines.
    mockDiff.mockResolvedValue('');

    const result = await service.filter(
      '/tmp/repo',
      'abc0001',
      'abc0002',
    );

    expect(result.filteredFiles).toEqual([]);
    expect(result.summaryOnlyMode).toBe(false);
    expect(result.totalChangedLines).toBe(0);
  });

  it('excludes files that match default ignore globs from filteredFiles', async () => {
    // First call: --name-only
    mockDiff.mockResolvedValueOnce(
      nameOnlyOutput([
        'src/app.ts',
        'src/app.spec.ts',       // matches **/*.spec.ts
        'pnpm-lock.yaml',        // matches pnpm-lock.yaml
        'migrations/001.sql',    // matches migrations/**
      ]),
    );
    // Second call: --stat
    mockDiff.mockResolvedValueOnce(statSummaryLine(10, 5));

    const result = await service.filter('/tmp/repo', 'base', 'head');

    expect(result.filteredFiles).toEqual(['src/app.ts']);
    expect(result.filteredFiles).not.toContain('src/app.spec.ts');
    expect(result.filteredFiles).not.toContain('pnpm-lock.yaml');
    expect(result.filteredFiles).not.toContain('migrations/001.sql');
  });

  it('sets summaryOnlyMode false when total changed lines are below the 50 000 ceiling', async () => {
    mockDiff.mockResolvedValueOnce(nameOnlyOutput(['src/index.ts']));
    // 25 000 insertions + 24 999 deletions = 49 999 — one below the limit.
    mockDiff.mockResolvedValueOnce(
      ' 1 file changed, 25000 insertion(+), 24999 deletion(-)',
    );

    const result = await service.filter('/tmp/repo', 'base', 'head');

    expect(result.summaryOnlyMode).toBe(false);
    expect(result.totalChangedLines).toBe(49999);
  });

  it('sets summaryOnlyMode true when total changed lines exceed 50 000', async () => {
    mockDiff.mockResolvedValueOnce(nameOnlyOutput(['src/generated.ts']));
    // 50 001 total — one above the limit.
    mockDiff.mockResolvedValueOnce(
      ' 1 file changed, 50001 insertion(+)',
    );

    const result = await service.filter('/tmp/repo', 'base', 'head');

    expect(result.summaryOnlyMode).toBe(true);
    expect(result.totalChangedLines).toBe(50001);
  });

  it('returns only non-ignored files when diff contains a mix', async () => {
    mockDiff.mockResolvedValueOnce(
      nameOnlyOutput([
        'src/service.ts',
        'src/service.test.ts',     // matches **/*.test.ts
        'packages/generated/api.ts', // matches **/generated/**
        'docs/readme.md',
        'yarn.lock',               // matches yarn.lock
      ]),
    );
    mockDiff.mockResolvedValueOnce(statSummaryLine(100, 20));

    const result = await service.filter('/tmp/repo', 'base', 'head');

    expect(result.filteredFiles).toHaveLength(2);
    expect(result.filteredFiles).toContain('src/service.ts');
    expect(result.filteredFiles).toContain('docs/readme.md');
  });

  it('includes relative (not absolute) paths in filteredFiles', async () => {
    mockDiff.mockResolvedValueOnce(nameOnlyOutput(['src/utils.ts']));
    mockDiff.mockResolvedValueOnce(statSummaryLine(5, 2));

    const result = await service.filter('/tmp/repo', 'base', 'head');

    expect(result.filteredFiles).toHaveLength(1);
    // The path returned by git diff --name-only is relative; DiffFilterService
    // must not prepend the repoDir or any absolute prefix.
    expect(result.filteredFiles[0]).toBe('src/utils.ts');
    expect(result.filteredFiles[0]).not.toMatch(/^\//);
  });

  it('excludes custom ignore globs provided by the caller in addition to defaults', async () => {
    mockDiff.mockResolvedValueOnce(
      nameOnlyOutput([
        'src/main.ts',
        'infra/terraform/main.tf', // matches custom glob infra/**
      ]),
    );
    mockDiff.mockResolvedValueOnce(statSummaryLine(30, 0));

    const result = await service.filter('/tmp/repo', 'base', 'head', [
      'infra/**',
    ]);

    expect(result.filteredFiles).toEqual(['src/main.ts']);
  });

  it('returns totalChangedLines 0 and does not throw when git diff --stat fails', async () => {
    mockDiff.mockResolvedValueOnce(nameOnlyOutput(['src/app.ts']));
    // Second call (--stat) rejects — service should catch and return 0.
    mockDiff.mockRejectedValueOnce(new Error('git error'));

    const result = await service.filter('/tmp/repo', 'base', 'head');

    expect(result.totalChangedLines).toBe(0);
    expect(result.summaryOnlyMode).toBe(false);
    expect(result.filteredFiles).toEqual(['src/app.ts']);
  });
});
