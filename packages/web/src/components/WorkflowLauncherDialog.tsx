import React from 'react';
import { WORKFLOW_LIBRARY, type WorkflowTemplateId } from './workflows';

interface Props {
  open: boolean;
  onClose: () => void;
  onLaunch: (templateId: WorkflowTemplateId) => void;
}

export function WorkflowLauncherDialog({ open, onClose, onLaunch }: Props) {
  if (!open) return null;

  return (
    <div className="rb-dialog-root" role="presentation" onClick={onClose}>
      <div
        className="rb-dialog rb-dialog--wide rb-dialog--workflow"
        role="dialog"
        aria-labelledby="workflow-launcher-title"
        onClick={e => e.stopPropagation()}
      >
        <header className="rb-dialog__head">
          <div>
            <h2 id="workflow-launcher-title" className="rb-dialog__title">
              Workflow Library
            </h2>
            <p className="rb-dialog__lede">
              Launch a built-in crew for a concrete outcome. These are packaged Caprigo workflows, separate from Vibes-Coded marketplace tools and MCP integrations.
            </p>
          </div>
          <button type="button" className="rb-icon-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="rb-workflow-grid rb-workflow-grid--dialog">
          {WORKFLOW_LIBRARY.map(flow => (
            <article key={flow.id} className="rb-workflow-card rb-workflow-card--dialog">
              <div className="rb-workflow-card__top">
                <strong className="rb-workflow-card__title">{flow.title}</strong>
                <span className="rb-workflow-card__roles">{flow.roles}</span>
              </div>
              <p className="rb-workflow-card__blurb">{flow.blurb}</p>
              <p className="rb-workflow-card__best">
                <span className="rb-muted">Best for</span> {flow.bestFor}
              </p>
              <div className="rb-workflow-card__actions">
                <button
                  type="button"
                  className="rb-btn rb-btn--accent"
                  onClick={() => {
                    onLaunch(flow.id);
                    onClose();
                  }}
                >
                  Launch {flow.title}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
