import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, isLineInDiff } from '../src/diff.js';

const SIMPLE_DIFF = `diff --git a/src/domain/user.service.ts b/src/domain/user.service.ts
index 1234abc..5678def 100644
--- a/src/domain/user.service.ts
+++ b/src/domain/user.service.ts
@@ -1,5 +1,7 @@
 import { Injectable } from '@nestjs/common';
+import { UserRepository } from '../infrastructure/user.repository';

 @Injectable()
 export class UserService {
+  constructor(private readonly repo: UserRepository) {}
 }
`;

const TWO_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index aaa..bbb 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 const z = 3;
 export { x };
diff --git a/src/b.ts b/src/b.ts
index ccc..ddd 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,3 +5,4 @@
 export function foo() {
   return 1;
 }
+export function bar() { return 2; }
`;

const MULTI_HUNK_DIFF = `diff --git a/src/service.ts b/src/service.ts
index abc..def 100644
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,4 +1,5 @@
 import { A } from './a';
+import { B } from './b';
 import { C } from './c';

 export class Service {
@@ -10,3 +11,4 @@
   method() {
     return this.a;
   }
+  method2() { return this.b; }
 }
`;

const REMOVED_ONLY_DIFF = `diff --git a/src/old.ts b/src/old.ts
index abc..def 100644
--- a/src/old.ts
+++ b/src/old.ts
@@ -1,3 +1,2 @@
 const x = 1;
-const y = 2;
 const z = 3;
`;

// MED-07: new-file diff (--- /dev/null)
const NEW_FILE_DIFF = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+const x = 1;
+const y = 2;
+export { x, y };
`;

// MED-07: deleted-file diff (+++ /dev/null)
const DELETED_FILE_DIFF = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
--- a/src/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-const x = 1;
-const y = 2;
-export { x, y };
`;

// MED-07: binary file diff (no hunks)
const BINARY_FILE_DIFF = `diff --git a/image.png b/image.png
index abc..def 100644
Binary files a/image.png and b/image.png differ
`;

// MED-07: file path containing a space
const SPACE_IN_PATH_DIFF = `diff --git a/src/my file.ts b/src/my file.ts
index abc..def 100644
--- a/src/my file.ts
+++ b/src/my file.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`;

// MED-07: directory name that contains " b/" — old diff --git regex would misparse this
const B_DIR_IN_PATH_DIFF = `diff --git a/packages/b/src/foo.ts b/packages/b/src/foo.ts
index abc..def 100644
--- a/packages/b/src/foo.ts
+++ b/packages/b/src/foo.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;
`;

describe('parseUnifiedDiff', () => {
  it('returns empty array for empty string', () => {
    const result = parseUnifiedDiff('');
    expect(result).toEqual([]);
  });

  it('parses a single file diff with correct path', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('src/domain/user.service.ts');
  });

  it('parses two files into separate FileDiff entries', () => {
    const result = parseUnifiedDiff(TWO_FILE_DIFF);
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe('src/a.ts');
    expect(result[1]?.path).toBe('src/b.ts');
  });

  it('correctly identifies hunk start line from @@ header', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const hunk = result[0]?.hunks[0];
    expect(hunk?.startLine).toBe(1);
  });

  it('builds headLineSet containing only added lines (not context)', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    // Line 2: added "import { UserRepository } ..." — IN headLineSet
    expect(fileDiff.headLineSet.has(2)).toBe(true);
    // Line 5: added "  constructor..." — IN headLineSet
    // (blank line in fixture is empty string, not a space-prefixed context line, so headLine
    //  does not advance through it; the constructor lands at head line 5, not 6)
    expect(fileDiff.headLineSet.has(5)).toBe(true);

    // Context lines are NOT in headLineSet
    expect(fileDiff.headLineSet.has(1)).toBe(false); // context
    expect(fileDiff.headLineSet.has(3)).toBe(false); // context @Injectable
    expect(fileDiff.headLineSet.has(4)).toBe(false); // context export class
  });

  it('does NOT include removed or context lines in headLineSet', () => {
    const result = parseUnifiedDiff(REMOVED_ONLY_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    // REMOVED_ONLY_DIFF has no added lines → headLineSet is empty
    expect(fileDiff.headLineSet.size).toBe(0);
    expect(fileDiff.headLineSet.has(1)).toBe(false); // context
    expect(fileDiff.headLineSet.has(2)).toBe(false); // context after removal
  });

  it('handles multi-hunk diff correctly — headLineSet contains added lines from both hunks', () => {
    const result = parseUnifiedDiff(MULTI_HUNK_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    expect(fileDiff.hunks).toHaveLength(2);

    // First hunk: added "import { B } from './b';" is on line 2
    expect(fileDiff.headLineSet.has(2)).toBe(true);

    // Second hunk starts at line 11 — added "method2()" is on line 14
    expect(fileDiff.headLineSet.has(14)).toBe(true);

    // Context lines from both hunks are NOT in headLineSet
    expect(fileDiff.headLineSet.has(1)).toBe(false);
    expect(fileDiff.headLineSet.has(11)).toBe(false);
  });

  it('correctly identifies line types', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const hunk = result[0]?.hunks[0];
    expect(hunk).toBeDefined();
    if (hunk === undefined) return;

    expect(hunk.lines[0]?.type).toBe('context');
    expect(hunk.lines[1]?.type).toBe('added');
  });

  it('sets headLine to null for removed lines', () => {
    const result = parseUnifiedDiff(REMOVED_ONLY_DIFF);
    const hunk = result[0]?.hunks[0];
    if (hunk === undefined) return;

    const removedLine = hunk.lines.find((l) => l.type === 'removed');
    expect(removedLine?.headLine).toBeNull();
  });

  it('handles second file in two-file diff — only added lines in headLineSet', () => {
    const result = parseUnifiedDiff(TWO_FILE_DIFF);
    const secondFile = result[1];
    expect(secondFile).toBeDefined();
    if (secondFile === undefined) return;

    // Context lines 5, 6, 7 are NOT in headLineSet
    expect(secondFile.headLineSet.has(5)).toBe(false);
    expect(secondFile.headLineSet.has(6)).toBe(false);
    expect(secondFile.headLineSet.has(7)).toBe(false);
    // Added line 8 IS in headLineSet
    expect(secondFile.headLineSet.has(8)).toBe(true);
  });

  // MED-07: new-file diffs
  it('parses a new-file diff (--- /dev/null) with correct path and added lines', () => {
    const result = parseUnifiedDiff(NEW_FILE_DIFF);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('src/new.ts');
    // Lines 1-3 are all added
    expect(result[0]?.headLineSet.has(1)).toBe(true);
    expect(result[0]?.headLineSet.has(2)).toBe(true);
    expect(result[0]?.headLineSet.has(3)).toBe(true);
  });

  // MED-07: deleted-file diffs
  it('parses a deleted-file diff (+++ /dev/null) with correct path and no added lines', () => {
    const result = parseUnifiedDiff(DELETED_FILE_DIFF);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('src/gone.ts');
    // All lines are removed — no added lines
    expect(result[0]?.headLineSet.size).toBe(0);
  });

  // MED-07: binary file diffs
  it('returns no FileDiff entries for a binary file diff', () => {
    const result = parseUnifiedDiff(BINARY_FILE_DIFF);
    expect(result).toHaveLength(0);
  });

  // MED-07: file path with a space
  it('parses a diff with a space in the file path correctly', () => {
    const result = parseUnifiedDiff(SPACE_IN_PATH_DIFF);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('src/my file.ts');
    expect(result[0]?.headLineSet.has(2)).toBe(true); // added line
  });

  // MED-07: directory name containing " b/" (would break diff --git regex)
  it('correctly parses path with " b/" in directory name using +++ line', () => {
    const result = parseUnifiedDiff(B_DIR_IN_PATH_DIFF);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe('packages/b/src/foo.ts');
    expect(result[0]?.headLineSet.has(2)).toBe(true); // added line
  });
});

describe('isLineInDiff', () => {
  it('returns true for an added line number that is in the diff', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    // Line 2 is added (import UserRepository)
    expect(isLineInDiff(fileDiff, 2)).toBe(true);
    // Line 5 is added (constructor — blank line in fixture is not a space-prefixed context line)
    expect(isLineInDiff(fileDiff, 5)).toBe(true);
  });

  it('returns false for a context line', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    // Line 1 is context — NOT in headLineSet after MED-01 fix
    expect(isLineInDiff(fileDiff, 1)).toBe(false);
  });

  it('returns false for a line number not in the diff', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    expect(isLineInDiff(fileDiff, 999)).toBe(false);
    expect(isLineInDiff(fileDiff, 0)).toBe(false);
  });

  // LOW-06: removal-only diff has no added lines — isLineInDiff should always be false
  it('returns false for all lines in a removal-only diff', () => {
    const result = parseUnifiedDiff(REMOVED_ONLY_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    expect(isLineInDiff(fileDiff, 1)).toBe(false);
    expect(isLineInDiff(fileDiff, 2)).toBe(false);
    expect(isLineInDiff(fileDiff, 3)).toBe(false);
  });
});
