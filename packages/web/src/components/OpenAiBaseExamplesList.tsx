import React from 'react';
import { OPENAI_COMPATIBLE_BASE_EXAMPLES } from '../data/openaiCompatibleBaseExamples';

export function OpenAiBaseExamplesList() {
  return (
    <ul className="rb-base-examples">
      {OPENAI_COMPATIBLE_BASE_EXAMPLES.map(ex => (
        <li key={ex.url} className="rb-base-examples__item">
          <span className="rb-base-examples__label">{ex.label}</span>
          <code className="rb-code rb-code--break">{ex.url}</code>
          {ex.note && <span className="rb-muted rb-base-examples__note"> — {ex.note}</span>}
        </li>
      ))}
    </ul>
  );
}
