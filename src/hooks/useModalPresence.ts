import { useEffect, useRef, useState } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useModalPresence(open: boolean, onClose: () => void, duration = 220) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    if (open) {
      if (!mounted) {
        previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setMounted(true);
        return;
      }
      frame = window.requestAnimationFrame(() => {
        setVisible(true);
        window.requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
      });
    } else if (mounted) {
      setVisible(false);
      timer = window.setTimeout(() => setMounted(false), duration);
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [duration, mounted, open]);

  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const computedPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${computedPadding + scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mounted, onClose]);

  return { mounted, visible, dialogRef };
}
