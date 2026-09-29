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
  /**
   * Set of head-side (right-side) line numbers that were **added** in this diff.
   * Context lines are intentionally excluded so that `isLineInDiff` only returns
   * true for lines actually touched by the PR.
   */
  headLineSet: Set<number>;
}

/**
 * Parse a unified diff string (as produced by `git diff`) into structured FileDiff objects.
 *
 * Handles:
 * - `diff --git a/... b/...` file headers
 * - `--- a/path` / `+++ b/path` metadata (uses +++ as canonical path source)
 * - `@@ -L,S +L,S @@` hunk headers
 * - +/- context lines with proper head-side line tracking
 * - New files (`--- /dev/null`), deleted files (`+++ /dev/null`), binary files
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const fileDiffs: FileDiff[] = [];
  const lines = diffText.split('\n');

  let currentPath: string | null = null;
  let pendingPath: string | null = null; // path from `--- a/` (fallback for deleted files)
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
    // New file header — flush previous file and reset state.
    // Path will be determined by the +++ line that follows.
    if (line.startsWith('diff --git ')) {
      flushFile();
      currentPath = null;
      pendingPath = null;
      currentHunks = [];
      currentHeadLineSet = new Set();
      currentHunk = null;
      headLine = 0;
      continue;
    }

    // Skip non-path metadata lines
    if (
      line.startsWith('index ') ||
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

    // MED-02: Use `--- a/` as a tentative path (fallback for deleted files where +++ is /dev/null).
    if (line.startsWith('--- ')) {
      if (line.startsWith('--- a/')) {
        pendingPath = line.slice(6); // strip "--- a/"
      }
      continue;
    }

    // MED-02: Use `+++ b/` as the canonical path — avoids the ambiguity of parsing
    // `diff --git a/... b/...` when a directory name contains " b/".
    if (line.startsWith('+++ ')) {
      if (line.startsWith('+++ b/')) {
        currentPath = line.slice(6); // strip "+++ b/"
      } else {
        // "+++ /dev/null" means deleted file — fall back to the --- a/ path.
        currentPath = pendingPath;
      }
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
      // MED-01: only added lines belong in headLineSet (not context lines).
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
      // Context lines advance headLine but are NOT added to headLineSet.
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
 * Returns true if the given head-side line number was **added** in the diff.
 * Only added lines (not context) are eligible for inline PR comments.
 */
export function isLineInDiff(diff: FileDiff, line: number): boolean {
  return diff.headLineSet.has(line);
}
