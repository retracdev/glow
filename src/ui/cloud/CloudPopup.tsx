import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/*
 * The same popup as the onboarding's flashing lights warning: a small spinner that grows
 * to the full card once there's something to say. It reuses those styles on purpose, so
 * both look and move exactly alike.
 */

export type Tone = 'accent' | 'success' | 'warning' | 'danger';

export interface PopupAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
}

export interface PopupContent {
  /** Changes whenever the content does, so the card re-measures and fades in again. */
  key: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  text: ReactNode;
  status?: string;
  primary: PopupAction;
  secondary?: PopupAction;
}

interface CloudPopupProps {
  /** Shown while busy is false. */
  content: PopupContent | null;
  busy: boolean;
  busyLabel: string;
  onClose: () => void;
}

export function CloudPopup({ content, busy, busyLabel, onClose }: CloudPopupProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const showing = !busy && content !== null;
  const contentKey = showing ? content.key : null;

  // The card is laid out at full size behind the clip, so it can be measured before growing.
  useLayoutEffect(() => {
    if (contentKey === null) {
      setSize(null);
      return;
    }
    const measure = () => {
      const el = cardRef.current;
      if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
    };
    measure();
    popupRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [contentKey]);

  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showing, onClose]);

  const expanded = showing && size !== null;
  const Icon = content?.icon;

  return (
    <div
      className="onb-scrim cp-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && showing) onClose();
      }}
    >
      <div
        ref={popupRef}
        className={`onb-popup cp-popup${expanded ? ' is-expanded' : ''}`}
        style={expanded ? size : undefined}
        role="dialog"
        aria-modal="true"
        aria-busy={!showing}
        aria-label={showing ? undefined : busyLabel}
        aria-labelledby={showing ? 'cp-title' : undefined}
        aria-describedby={showing ? 'cp-text' : undefined}
        tabIndex={-1}
      >
        <span className="onb-spinner" aria-hidden="true" />
        {!showing && (
          <span className="cp-visually-hidden" role="status">
            {busyLabel}
          </span>
        )}
        {content && Icon && (
          <div key={content.key} ref={cardRef} className="onb-warning cp-card" inert={!showing}>
            <button type="button" className="cp-close" aria-label="Close" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
            <Icon className={`onb-warning-icon cp-icon is-${content.tone}`} size={44} strokeWidth={1.8} aria-hidden="true" />
            <h2 id="cp-title">{content.title}</h2>
            <p id="cp-text">{content.text}</p>
            {content.status && (
              <p className="cp-status" role="status">
                <span aria-hidden="true" />
                {content.status}
              </p>
            )}
            <div className="onb-actions">
              <ActionButton action={content.primary} className="onb-continue" />
              {content.secondary && <ActionButton action={content.secondary} className="onb-back cp-secondary" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ action, className }: { action: PopupAction; className: string }) {
  const Icon = action.icon;
  return (
    <button type="button" className={className} onClick={action.onClick}>
      {Icon && <Icon className="cp-button-icon" aria-hidden="true" />}
      {action.label}
    </button>
  );
}
