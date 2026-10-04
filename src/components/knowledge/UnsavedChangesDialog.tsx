import { useEffect, useRef } from 'react';

export function DiscardChangesDialog({
  isOpen,
  onStay,
  onLeave,
}: {
  isOpen: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isOpen) {
      if (!el.open) {
        el.showModal();
      }
    } else {
      if (el.open) {
        el.close();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      className="guide-restore-dialog discard-changes-dialog"
      ref={ref}
      aria-labelledby="discard-dialog-title"
      onCancel={e => {
        e.preventDefault();
        onStay();
      }}
    >
      <h2 id="discard-dialog-title">Discard changes?</h2>
      <p>You have unsaved changes. If you leave this page, your changes will be lost.</p>
      <div className="knowledge-actions">
        <button autoFocus type="button" className="btn-secondary" onClick={onStay}>
          Stay
        </button>
        <button type="button" className="btn-primary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </dialog>
  );
}
