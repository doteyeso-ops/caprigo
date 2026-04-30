import type { ExecutionTraceEntry } from '../types';

export function estimateTracePressure(
  entries: ExecutionTraceEntry[]
): null | {
  pressure: 'light' | 'watch' | 'heavy';
  costSignal: 'low' | 'watch' | 'high';
  estimatedContextTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
} {
  if (entries.length === 0) return null;

  const estimateTokens = (chars: number) => Math.max(0, Math.round(chars / 4));
  const totals = entries.reduce(
    (acc, entry) => {
      acc.durationMs += entry.durationMs || 0;
      acc.outputChars += entry.outputChars || 0;
      acc.contextChars += (entry.paramsSummary?.length ?? 0) + (entry.rationale?.length ?? 0) + (entry.resultSummary?.length ?? 0);
      return acc;
    },
    { durationMs: 0, outputChars: 0, contextChars: 0 }
  );

  const estimatedContextTokens = estimateTokens(totals.contextChars);
  const estimatedOutputTokens = estimateTokens(totals.outputChars);
  const estimatedTotalTokens = estimatedContextTokens + estimatedOutputTokens;

  const pressure: 'light' | 'watch' | 'heavy' =
    totals.outputChars > 20000 || totals.durationMs > 45000 || entries.length >= 16
      ? 'heavy'
      : totals.outputChars > 8000 || totals.durationMs > 18000 || entries.length >= 8
        ? 'watch'
        : 'light';

  const costSignal: 'low' | 'watch' | 'high' =
    estimatedTotalTokens > 12000 || totals.durationMs > 45000
      ? 'high'
      : estimatedTotalTokens > 5000 || totals.durationMs > 18000
        ? 'watch'
        : 'low';

  return {
    pressure,
    costSignal,
    estimatedContextTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
  };
}
