'use client';

import React from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';

import { cn } from '@/lib/utils';

/**
 * Motion for the marketing site.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Client components, kept in their own file so the pages themselves stay on
 * the server. A server component may render a client component and pass it
 * server-rendered children, so wrapping a section in `<Reveal>` costs the
 * browser this file and nothing else — the content inside is still HTML that
 * arrived with the document.
 *
 * ── Two rules everything here follows ─────────────────────────────────────
 * 1. `once: true`. Content that re-animates every time it scrolls back into
 *    view is content you cannot re-read without it moving.
 * 2. `useReducedMotion` is honoured everywhere by rendering the FINAL state,
 *    not by skipping the element. Someone with the OS setting on gets the page
 *    intact and still, never a page with holes in it.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Rise-and-fade as it scrolls in. The default for a block of content. */
export function Reveal({
  children,
  className,
  delay = 0,
  /** How far it travels. `sm` for items inside an already-animating group. */
  distance = 24,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      // The margin fires the animation slightly BEFORE the element reaches the
      // viewport edge, so it is already settled by the time it is comfortably
      // readable rather than animating under the reader's eye.
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

const groupVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.08 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

/**
 * A grid or list whose children arrive one after another.
 *
 * This element IS the grid — the motion wrapper cannot sit between a grid and
 * its items without breaking the layout, so the container takes the grid
 * classes itself and each child is a `RevealItem`.
 */
export function RevealGroup({
  children,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'ul' | 'ol' | 'dl';
}) {
  const reduce = useReducedMotion();
  const Component = motion[Tag];

  if (reduce) return <Tag className={className}>{children}</Tag>;

  return (
    <Component
      className={className}
      variants={groupVariants}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '-60px' }}
    >
      {children}
    </Component>
  );
}

export function RevealItem({
  children,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'li';
}) {
  const reduce = useReducedMotion();
  const Component = motion[Tag];

  if (reduce) return <Tag className={className}>{children}</Tag>;

  return (
    <Component className={className} variants={itemVariants}>
      {children}
    </Component>
  );
}

/**
 * The hand-drawn underline that sits beneath the emphasised word in a title.
 *
 * Two strokes rather than one, offset slightly and drawn at different speeds:
 * a single clean curve reads as a graphic, while a line that doubles back over
 * itself reads as something a person drew with a marker. The second stroke is
 * deliberately shorter and fainter, the way the return pass of a real
 * underline is.
 *
 * `preserveAspectRatio="none"` lets one path stretch to any word length, which
 * is why the curve is shallow — a deep curve distorts visibly when stretched.
 */
export function HandUnderline({ className }: { className?: string }) {
  const reduce = useReducedMotion();

  const draw = (duration: number, delay: number) =>
    reduce
      ? { initial: { pathLength: 1, opacity: 1 }, animate: { pathLength: 1, opacity: 1 } }
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { pathLength: { duration, ease: 'easeInOut' as const, delay }, opacity: { duration: 0.1, delay } },
        };

  return (
    <svg
      viewBox="0 0 300 16"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
      className={cn('pointer-events-none absolute -bottom-1.5 left-0 h-3 w-full sm:-bottom-2 sm:h-4', className)}
    >
      <motion.path
        d="M3 10.5C48 5.5 96 3.8 148 6.2C200 8.6 252 7.4 297 4.5"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
        {...draw(0.9, 0.35)}
      />
      <motion.path
        d="M26 14C74 10.6 128 9.9 182 11.4C214 12.3 246 12 274 10.4"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.55}
        {...draw(0.7, 0.7)}
      />
    </svg>
  );
}

/**
 * A number that counts up the first time it is scrolled to.
 *
 * Used only where the figure is a genuine measured quantity — a count that
 * animates draws the eye to it, which is wasted on a decorative number and
 * misleading on an invented one.
 */
export function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const reduce = useReducedMotion();
  const [value, setValue] = React.useState(reduce ? to : 0);
  const ref = React.useRef<HTMLSpanElement | null>(null);

  React.useEffect(() => {
    if (reduce) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();

        const start = performance.now();
        const DURATION = 900;
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / DURATION);
          // Ease-out cubic: fast at first, settling on the final figure.
          setValue(Math.round(to * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [to, reduce]);

  return (
    <span ref={ref} className="tabular">
      {value}
      {suffix}
    </span>
  );
}
