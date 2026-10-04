import { useEffect, useRef, useState, useCallback, createElement, type ReactElement } from 'react';
import { setNavigationBlocker } from '../../router';
import { DiscardChangesDialog } from './UnsavedChangesDialog';

export function useUnsavedChangesWarning(isDirty: boolean): {
  DiscardDialog: () => ReactElement | null;
  markClean: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const pendingProceedRef = useRef<(() => void) | null>(null);
  const isDirtyRef = useRef(isDirty);

  useEffect(() => {
    isDirtyRef.current = isDirty;
    if (!isDirty) {
      setNavigationBlocker(null);
      return;
    }

    const blocker = (_targetHash: string, proceed: () => void): boolean => {
      if (!isDirtyRef.current) return false;
      pendingProceedRef.current = proceed;
      setIsOpen(true);
      return true;
    };

    setNavigationBlocker(blocker);

    return () => {
      setNavigationBlocker(null);
    };
  }, [isDirty]);

  // Tab close or page reload protection
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  const handleStay = useCallback(() => {
    setIsOpen(false);
    pendingProceedRef.current = null;
  }, []);

  const handleLeave = useCallback(() => {
    setIsOpen(false);
    setNavigationBlocker(null);
    const proceed = pendingProceedRef.current;
    pendingProceedRef.current = null;
    if (proceed) {
      proceed();
    }
  }, []);

  const markClean = useCallback(() => {
    isDirtyRef.current = false;
    setNavigationBlocker(null);
  }, []);

  const DiscardDialog = useCallback(
    () =>
      createElement(DiscardChangesDialog, {
        isOpen,
        onStay: handleStay,
        onLeave: handleLeave,
      }),
    [isOpen, handleStay, handleLeave]
  );

  return {
    DiscardDialog,
    markClean,
  };
}
