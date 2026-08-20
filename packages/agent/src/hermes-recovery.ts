/**
 * Hermes-style recovery nudges (from NousResearch/hermes-agent conversation_loop).
 * Keep the model in the tool loop instead of treating narration / empty as "done".
 */

/** Model narrates intent ("I'll open…", "Let me search…") instead of calling tools. */
export function looksLikeIntentNarration(content: string): boolean {
  const t = String(content || '').trim();
  if (!t || t.length > 2500) return false;
  // Already looks like a tool payload
  if (/<tool_call>|\"caprigo\"\s*:\s*\"action\"|\"name\"\s*:\s*\"[a-z0-9_]+\"/i.test(t)) {
    return false;
  }
  return (
    /\b(i('ll| will)|let me|i am going to|i'm going to|next i('ll| will)|now i('ll| will))\b/i.test(
      t
    ) ||
    /\b(i('ll| will) (now )?(open|launch|search|click|type|write|run|check|take|use))\b/i.test(t) ||
    /\b(opening|searching|clicking|typing|writing|running|checking)\b.{0,40}\b(now|for you|next)\b/i.test(
      t
    ) ||
    /\b(first[, ]+i('ll| will)|step 1[: ]|here('s| is) (my |the )?plan)\b/i.test(t)
  );
}

/** Hermes dropped-tool-call / narration-only re-prompt. */
export function buildNarrationStopNudge(objective?: string): string {
  const goal = objective?.trim()
    ? ` Objective: ${objective.trim().slice(0, 160)}.`
    : '';
  return [
    '[Caprigo / Hermes-style recovery]',
    'Your previous turn narrated intent or planned steps but issued NO tool call.',
    'Do not narrate a plan or restate intent — issue the actual tool call (or Action Card JSON) now.' +
      goal,
    'Prefer the next item on the todo list / HOME remaining steps.',
  ].join(' ');
}

/** Empty assistant content after tool results — Hermes post-tool empty nudge. */
export function buildEmptyAfterToolsNudge(): string {
  return [
    '[Caprigo / Hermes-style recovery]',
    'You just executed tool calls but returned an empty response.',
    'Process the tool results above and continue the task with the next tool call or a final answer.',
  ].join(' ');
}

/** finish_reason signaled tools but payload had none. */
export function buildDroppedToolCallNudge(): string {
  return [
    '[Caprigo / Hermes-style recovery]',
    'Your previous turn indicated a tool call but none was included.',
    'Do not narrate — issue the actual tool call now to continue the task.',
  ].join(' ');
}
