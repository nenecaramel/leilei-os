import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./lg-author-editor-layout-fix.css";

export type PaperAuthorValue = "L" | "G" | null;

export interface PaperAuthorSignatureProps {
  value: PaperAuthorValue;
  editable: boolean;
  disabled?: boolean;
  onChange?: (author: "L" | "G") => void;
  error?: string | null;
}

export function PaperAuthorSignature({
  value,
  editable,
  disabled = false,
  onChange,
}: PaperAuthorSignatureProps) {
  const [open, setOpen] = useState(false);
  const [signatureSlot, setSignatureSlot] = useState<HTMLElement | null>(null);
  const [slotResolved, setSlotResolved] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const display = value ?? "—";

  useEffect(() => {
    const paper = anchorRef.current?.closest<HTMLElement>(".paper-detail-paper") ?? null;
    const slot = paper?.querySelector<HTMLElement>(".paper-detail-signature") ?? null;
    setSignatureSlot(slot);
    setSlotResolved(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, [open]);

  const signature = !editable ? (
    <span className="paper-author-signature" aria-label={`作者 ${display}`}>
      {display}
    </span>
  ) : (
    <span className="paper-author-signature" ref={rootRef}>
      <button
        type="button"
        className="paper-author-signature-trigger"
        aria-label={`作者 ${display}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {display}
      </button>
      {open ? (
        <span className="paper-author-signature-menu" role="menu" aria-label="选择作者">
          {(["L", "G"] as const).map((author) => (
            <button
              key={author}
              type="button"
              role="menuitemradio"
              data-author={author}
              aria-checked={value === author}
              onClick={() => {
                onChange?.(author);
                setOpen(false);
              }}
            >
              {author}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );

  return (
    <>
      <span ref={anchorRef} className="paper-author-signature-anchor" aria-hidden="true" />
      {signatureSlot
        ? createPortal(signature, signatureSlot)
        : slotResolved
          ? signature
          : null}
    </>
  );
}
