export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  headLine: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  startLine: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  headLineSet: Set<number>;
}

/**
 * Parse a unified diff string (as produced by `git diff`) into structured FileDiff objects.
 *
 * Handles:
 * - `diff --git a/... b/...` file headers
 * - `@@ -L,S +L,S @@` hunk headers
 * - +/- context lines with proper head-side line tracking
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const fileDiffs: FileDiff[] = [];
  const lines = diffText.split('\n');

  let currentPath: string | null = null;
  let currentHunks: DiffHunk[] = [];
  let currentHeadLineSet: Set<number> = new Set();
  let currentHunk: DiffHunk | null = null;
  let headLine = 0;

  const flushFile = (): void => {
    if (currentPath !== null) {
      fileDiffs.push({
        path: currentPath,
        hunks: currentHunks,
        headLineSet: currentHeadLineSet,
      });
    }
  };

  for (const line of lines) {
    // New file header
    if (line.startsWith('diff --git ')) {
      flushFile();

      // Extract the b/ path: "diff --git a/path b/path"
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      currentPath = match !== null ? (match[1] ?? null) : null;
      currentHunks = [];
      currentHeadLineSet = new Set();
      currentHunk = null;
      headLine = 0;
      continue;
    }

    // Skip file metadata lines (index, ---, +++)
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('Binary files') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue;
    }

    // Hunk header: @@ -L,S +L,S @@
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch !== null) {
      currentHunk = {
        header: line,
        startLine: parseInt(hunkMatch[1] ?? '1', 10),
        lines: [],
      };
      headLine = parseInt(hunkMatch[1] ?? '1', 10);
      currentHunks.push(currentHunk);
      continue;
    }

    if (currentHunk === null || currentPath === null) {
      continue;
    }

    if (line.startsWith('+')) {
      const diffLine: DiffLine = {
        type: 'added',
        headLine,
        content: line.slice(1),
      };
      currentHunk.lines.push(diffLine);
      currentHeadLineSet.add(headLine);
      headLine++;
    } else if (line.startsWith('-')) {
      const diffLine: DiffLine = {
        type: 'removed',
        headLine: null,
        content: line.slice(1),
      };
      currentHunk.lines.push(diffLine);
      // Removed lines do not advance head line
    } else if (line.startsWith(' ')) {
      const diffLine: DiffLine = {
        type: 'context',
        headLine,
        content: line.slice(1),
      };
      currentHunk.lines.push(diffLine);
      currentHeadLineSet.add(headLine);
      headLine++;
    } else if (line === '\\ No newline at end of file') {
      // Skip — no line tracking needed
    }
    // Empty lines between hunks are ignored
  }

  flushFile();

  return fileDiffs;
}

/**
 * Returns true if the given head-side line number is present in the diff.
 * Used to gate inline PR comments — only post comments on lines in the diff.
 */
export function isLineInDiff(diff: FileDiff, line: number): boolean {
  return diff.headLineSet.has(line);
}
