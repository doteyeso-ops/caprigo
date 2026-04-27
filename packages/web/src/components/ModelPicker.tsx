import React, { useMemo } from 'react';

export interface ModelPickerProps {
  /** Current override, or null to use engine default. */
  value: string | null;
  onChange: (next: string | null) => void;
  engineModel: string;
  llmProvider: string | undefined;
  ollamaModels: string[];
  onRefreshModels: () => void;
  disabled?: boolean;
  /** Shorter label + control for workspace cards */
  compact?: boolean;
  id?: string;
}

/**
 * Per-agent model: Ollama / OpenAI-compatible = dropdown of reported ids + default; other providers = text field.
 */
export function ModelPicker({
  value,
  onChange,
  engineModel,
  llmProvider,
  ollamaModels,
  onRefreshModels,
  disabled,
  compact,
  id = 'rb-model-picker',
}: ModelPickerProps) {
  const selectValue = value?.trim() || '';
  const extraOptions = useMemo(() => {
    if (!selectValue) return [];
    if (ollamaModels.includes(selectValue)) return [];
    return [selectValue];
  }, [selectValue, ollamaModels]);

  if (llmProvider === 'ollama' || llmProvider === 'openai_compatible') {
    const refreshTitle =
      llmProvider === 'ollama' ? 'Refresh list from Ollama' : 'Refresh model list from the OpenAI-compatible API';
    return (
      <div className={compact ? 'rb-model-pick rb-model-pick--compact' : 'rb-model-pick'}>
        <label className={compact ? 'rb-model-pick__lbl' : 'rb-builder__field'} htmlFor={id}>
              {compact ? <span className="rb-model-pick__lbl-t">Model</span> : <span>Session model</span>}
          {!compact && (
            <span className="rb-muted rb-model-pick__hint">
              Default uses the engine model from Settings ({engineModel}).
            </span>
          )}
          <div className="rb-model-pick__row">
            <select
              id={id}
              className="rb-input rb-model-pick__select"
              disabled={disabled}
              value={selectValue}
              onChange={e => {
                const v = e.target.value;
                onChange(v ? v : null);
              }}
              aria-label="Model for this agent"
            >
              <option value="">Default ({engineModel})</option>
              {extraOptions.map(m => (
                <option key={m} value={m}>
                  {m} (custom)
                </option>
              ))}
              {ollamaModels.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rb-btn rb-btn--ghost rb-model-pick__refresh"
              disabled={disabled}
              title={refreshTitle}
              onClick={() => onRefreshModels()}
            >
              ↻
            </button>
          </div>
        </label>
      </div>
    );
  }

  return (
    <label className={compact ? 'rb-model-pick rb-model-pick--compact' : 'rb-builder__field'} htmlFor={id}>
              {compact ? <span className="rb-model-pick__lbl-t">Model</span> : <span>Session model</span>}
      {!compact && (
        <span className="rb-muted rb-model-pick__hint">
          Override engine default ({engineModel}). Leave empty to inherit.
        </span>
      )}
      <input
        id={id}
        className="rb-input rb-mono"
        disabled={disabled}
        placeholder={engineModel}
        value={selectValue}
        onChange={e => {
          const t = e.target.value.trim();
          onChange(t ? t : null);
        }}
        aria-label="Model id for this agent"
      />
    </label>
  );
}
