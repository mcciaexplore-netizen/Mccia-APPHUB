"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./SafetyMascot.module.css";

/**
 * The Safety Week mascot. Clicking "Safety Week" in the sidebar calls playSafetyMascot(); this component (mounted once, in the page
 * frame) shows the mascot for two seconds and removes it. Clicking again while it is showing restarts it: there is only ever one
 * mascot and one timer, and the timer and listener are cleaned up when the frame goes away.
 */
const EVENT = "hub:safety-week";
const SHOW_MS = 2000;
const SRC = "/safety-first-mascot.png";

/** Whether a department is the Safety Week one (the sidebar item that plays the mascot). */
export const isSafetyWeek = (departmentName: string) => /^safety\s*week$/i.test(departmentName.trim());

export const playSafetyMascot = () => window.dispatchEvent(new Event(EVENT));

export function SafetyMascot() {
  // 0 = hidden. Each play gets a new number, which is also the element's key, so the animation starts from the beginning every time.
  const [play, setPlay] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    new Image().src = SRC; // have the picture ready before the first click
    const start = () => {
      clearTimeout(timer.current);
      setPlay((n) => n + 1);
      timer.current = setTimeout(() => setPlay(0), SHOW_MS);
    };
    window.addEventListener(EVENT, start);
    return () => {
      window.removeEventListener(EVENT, start);
      clearTimeout(timer.current);
    };
  }, []);

  if (play === 0) return null;
  return (
    <div key={play} className={styles.stage} data-safety-mascot aria-hidden="true">
      <div className={styles.pop}>
        <div className={styles.figure}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a small decorative picture that must not go through the image optimiser (it is cut in two with CSS) */}
          <img className={styles.base} src={SRC} alt="" draggable={false} />
          {/* eslint-disable-next-line @next/next/no-img-element -- the same picture, showing only the glove that waves */}
          <img className={styles.arm} src={SRC} alt="" draggable={false} />
        </div>
      </div>
    </div>
  );
}
