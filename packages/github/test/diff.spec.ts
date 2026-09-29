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

  it('builds headLineSet containing added and context lines', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    // Line 1: context "import { Injectable } from '@nestjs/common';"
    expect(fileDiff.headLineSet.has(1)).toBe(true);
    // Line 2: added "import { UserRepository } ..."
    expect(fileDiff.headLineSet.has(2)).toBe(true);
    // Line 3: context (blank line)
    expect(fileDiff.headLineSet.has(3)).toBe(true);
    // Line 4: context "@Injectable()"
    expect(fileDiff.headLineSet.has(4)).toBe(true);
    // Line 5: context "export class UserService {"
    expect(fileDiff.headLineSet.has(5)).toBe(true);
    // Line 6: added "  constructor..."
    expect(fileDiff.headLineSet.has(6)).toBe(true);
  });

  it('does NOT include removed-only lines in headLineSet', () => {
    const result = parseUnifiedDiff(REMOVED_ONLY_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    // Line 1: context "const x = 1;"
    expect(fileDiff.headLineSet.has(1)).toBe(true);
    // "-const y = 2;" is removed — not in head
    // Line 2 on head should be "const z = 3;" (context after removal)
    expect(fileDiff.headLineSet.has(2)).toBe(true);
  });

  it('handles multi-hunk diff correctly — headLineSet contains lines from both hunks', () => {
    const result = parseUnifiedDiff(MULTI_HUNK_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    expect(fileDiff.hunks).toHaveLength(2);

    // First hunk starts at line 1 — added "import { B } from './b';" is on line 2
    expect(fileDiff.headLineSet.has(2)).toBe(true);

    // Second hunk starts at line 11 — added "method2()" is on line 14
    expect(fileDiff.headLineSet.has(14)).toBe(true);
  });

  it('correctly identifies line types', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const hunk = result[0]?.hunks[0];
    expect(hunk).toBeDefined();
    if (hunk === undefined) return;

    // First line is context
    expect(hunk.lines[0]?.type).toBe('context');
    // Second line is added
    expect(hunk.lines[1]?.type).toBe('added');
  });

  it('sets headLine to null for removed lines', () => {
    const result = parseUnifiedDiff(REMOVED_ONLY_DIFF);
    const hunk = result[0]?.hunks[0];
    if (hunk === undefined) return;

    const removedLine = hunk.lines.find((l) => l.type === 'removed');
    expect(removedLine?.headLine).toBeNull();
  });

  it('handles second file in two-file diff correctly', () => {
    const result = parseUnifiedDiff(TWO_FILE_DIFF);
    const secondFile = result[1];
    expect(secondFile).toBeDefined();
    if (secondFile === undefined) return;

    // The second hunk starts at line 5, adds a line at the end
    // Context lines 5,6,7 are in headLineSet
    expect(secondFile.headLineSet.has(5)).toBe(true);
    expect(secondFile.headLineSet.has(6)).toBe(true);
    expect(secondFile.headLineSet.has(7)).toBe(true);
    // Added line 8
    expect(secondFile.headLineSet.has(8)).toBe(true);
  });
});

describe('isLineInDiff', () => {
  it('returns true for a line number that is in the diff', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    expect(isLineInDiff(fileDiff, 1)).toBe(true);
    expect(isLineInDiff(fileDiff, 2)).toBe(true);
  });

  it('returns false for a line number not in the diff', () => {
    const result = parseUnifiedDiff(SIMPLE_DIFF);
    const fileDiff = result[0];
    expect(fileDiff).toBeDefined();
    if (fileDiff === undefined) return;

    expect(isLineInDiff(fileDiff, 999)).toBe(false);
    expect(isLineInDiff(fileDiff, 0)).toBe(false);
  });
});
