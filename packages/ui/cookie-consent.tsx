"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "./dialog";
import { Button } from "./button";
import { CONSENT_EVENT, readConsent, setConsent } from "./consent";

export function CookieConsent({ analytics = false }: { analytics?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [allowed, setAllowed] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const refresh = () => setAllowed(readConsent(document.cookie)?.analytics === true);
    refresh();
    if (!readConsent(document.cookie)) dialog.current?.showModal();
    window.addEventListener(CONSENT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CONSENT_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  function choose(value: boolean) {
    setConsent(value);
    if (!readConsent(document.cookie)) {
      setMessage("Your browser could not remember this choice. Optional analytics stays off.");
      return;
    }
    setMessage("");
    dialog.current?.close();
    trigger.current?.focus();
  }
  return (
    <aside className="tidy-cookie" aria-label="Cookie preferences">
      <Button
        ref={trigger}
        type="button"
        className="tidy-cookie-trigger"
        onClick={() => dialog.current?.showModal()}
      >
        Cookie settings
      </Button>
      <Dialog
        ref={dialog}
        className="tidy-cookie-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <h2 id={`${id}-title`}>Your privacy choices</h2>
        <p id={`${id}-description`}>
          We use essential storage to keep you signed in and remember your preferences.
          {analytics
            ? " With your permission, PostHog helps us understand app usage and diagnose problems. Optional analytics is off until you accept."
            : " This website does not use optional analytics or advertising cookies."}
        </p>
        {analytics && (
          <p>
            Analytics: {allowed ? "on" : "off"}. You can change your choice anytime in Cookie
            settings. Your choice lasts six months on this site.
          </p>
        )}
        <a href="/privacy">Privacy and cookie information</a>
        {message && <p role="alert">{message}</p>}
        <div className="tidy-cookie-actions">
          <Button type="button" autoFocus onClick={() => choose(false)}>
            {analytics ? "Reject optional cookies" : "Use essential cookies only"}
          </Button>
          {analytics && (
            <Button type="button" onClick={() => choose(true)}>
              Accept analytics cookies
            </Button>
          )}
          <Button
            type="button"
            onClick={() => {
              dialog.current?.close();
              trigger.current?.focus();
            }}
          >
            Close
          </Button>
        </div>
      </Dialog>
    </aside>
  );
}
