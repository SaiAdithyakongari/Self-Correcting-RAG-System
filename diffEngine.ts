import { DiffLine, DiffResult, DiffStats } from '../types/fileEditor';

/**
 * Computes line-by-line diff using Longest Common Subsequence (LCS).
 * Produces structured data for side-by-side or unified diff rendering.
 */
export function computeLineDiff(originalText: string, modifiedText: string): DiffResult {
  const origLines = (originalText || '').split(/\r?\n/);
  const modLines = (modifiedText || '').split(/\r?\n/);

  const n = origLines.length;
  const m = modLines.length;

  // Edge case: empty strings
  if (n === 1 && origLines[0] === '' && m === 1 && modLines[0] === '') {
    return {
      lines: [],
      stats: {
        origLineCount: 0,
        modLineCount: 0,
        addedLines: 0,
        deletedLines: 0,
        modifiedLines: 0,
        unchangedLines: 0,
        similarityRatio: 1,
      },
    };
  }

  // Dynamic programming LCS table
  // To keep memory small for large files, use array of Int32Array or standard table
  // Up to 3000 lines is fast and fits in minimal memory
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (origLines[i] === modLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to find diff
  const rawOps: Array<{
    type: 'equal' | 'delete' | 'insert';
    origText?: string;
    modText?: string;
    origLine?: number;
    modLine?: number;
  }> = [];

  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      rawOps.push({
        type: 'equal',
        origText: origLines[i - 1],
        modText: modLines[j - 1],
        origLine: i,
        modLine: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawOps.push({
        type: 'insert',
        modText: modLines[j - 1],
        modLine: j,
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawOps.push({
        type: 'delete',
        origText: origLines[i - 1],
        origLine: i,
      });
      i--;
    }
  }

  rawOps.reverse();

  // Consolidate consecutive delete followed by insert into 'modify' where appropriate for clean side-by-side
  const lines: DiffLine[] = [];
  let addedCount = 0;
  let deletedCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;

  let idx = 0;
  while (idx < rawOps.length) {
    const curr = rawOps[idx];

    if (curr.type === 'equal') {
      lines.push({
        type: 'equal',
        origLineNumber: curr.origLine,
        modLineNumber: curr.modLine,
        origText: curr.origText,
        modText: curr.modText,
      });
      unchangedCount++;
      idx++;
    } else if (
      curr.type === 'delete' &&
      idx + 1 < rawOps.length &&
      rawOps[idx + 1].type === 'insert'
    ) {
      // Pair delete + insert as modify
      const next = rawOps[idx + 1];
      lines.push({
        type: 'modify',
        origLineNumber: curr.origLine,
        modLineNumber: next.modLine,
        origText: curr.origText,
        modText: next.modText,
      });
      modifiedCount++;
      idx += 2;
    } else if (curr.type === 'delete') {
      lines.push({
        type: 'delete',
        origLineNumber: curr.origLine,
        origText: curr.origText,
      });
      deletedCount++;
      idx++;
    } else {
      // insert
      lines.push({
        type: 'insert',
        modLineNumber: curr.modLine,
        modText: curr.modText,
      });
      addedCount++;
      idx++;
    }
  }

  const totalLinesCompared = Math.max(n, m);
  const similarityRatio =
    totalLinesCompared > 0
      ? Number((unchangedCount / totalLinesCompared).toFixed(3))
      : 1;

  const stats: DiffStats = {
    origLineCount: n,
    modLineCount: m,
    addedLines: addedCount,
    deletedLines: deletedCount,
    modifiedLines: modifiedCount,
    unchangedLines: unchangedCount,
    similarityRatio,
  };

  return { lines, stats };
}
