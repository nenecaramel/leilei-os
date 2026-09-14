import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type PaperAuthorValue = "L" | "G" | "C" | null;
export type PaperAuthor = Exclude<PaperAuthorValue, null>;

const PAPER_AUTHORS: readonly PaperAuthor[] = ["L", "G", "C"];

export interface PaperAuthorSignatureProps {
  value: PaperAuthorValue;
  editable: boolean;
  disabled?: boolean;
  onChange?: (author: PaperAuthor) => void;
  error?: string | null;
  placement?: "paper" | "inline";
}

export function PaperAuthorSignature({
  value,
  editable,
  disabled = false,
  onChange,
  placement = "paper",
}: PaperAuthorSignatureProps) {
  const [open, setOpen] = useState(false);
  const [signatureSlot, setSignatureSlot] = useState<HTMLElement | null | undefined>(undefined);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const display = value ?? "—";

  useEffect(() => {
    if (placement === "inline") {
      setSignatureSlot(null);
      return;
    }
    setSignatureSlot(
      document.querySelector<HTMLElement>(".paper-detail-layer .paper-detail-signature-portal"),
    );
  }, [placement]);

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
          {PAPER_AUTHORS.map((author) => (
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

  if (placement === "inline") return signature;
  if (signatureSlot === undefined) return null;
  return signatureSlot ? createPortal(signature, signatureSlot) : signature;
}
