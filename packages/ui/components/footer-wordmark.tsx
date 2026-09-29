'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';

const WORD = 'ShipYard';

/** Rise + settle: soft spring, overshoot you feel more than see. */
const LETTER: Variants = {
  hidden: { y: '0.55em', opacity: 0 },
  shown: (i: number) => ({
    y: '0em',
    opacity: 1,
    transition: { type: 'spring', stiffness: 120, damping: 19, mass: 0.9, delay: 0.12 + i * 0.05 },
  }),
};

const ACCENT: Variants = {
  hidden: { scale: 0, opacity: 0 },
  shown: {
    scale: 1,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 320,
      damping: 15,
      delay: 0.12 + WORD.length * 0.05 + 0.18,
    },
  },
};

/**
 * One letter of the footer wordmark.
 *
 * Overflow is clipped per letter, so each glyph rises out of its own cell as
 * if the row were a split-flap board resolving — never a rigid block slide.
 */
function WordmarkLetter({ ch, index }: { ch: string; index: number }) {
  return (
    <span className="-mb-[0.08em] inline-block overflow-hidden pb-[0.08em] align-bottom">
      <motion.span
        className="wordmark-faded inline-block text-[11vw] xl:text-[145px]"
        variants={LETTER}
        custom={index}
      >
        {ch}
      </motion.span>
    </span>
  );
}

/**
 * Footer wordmark with a one-shot entrance:
 *
 * Each glyph rises 0.55em out of its own clipped cell on a soft spring,
 * staggered 50ms left→right like a flap board resolving, with the brand
 * square popping in last. `once: true` + `margin` trigger it the moment the
 * footer crests into view — no scroll coupling to debug, no autoplay loops.
 *
 * Reduced motion renders the exact static markup (the hook is null at SSR, so
 * this branch can never mismatch hydration — it only flips post-mount).
 */
export function FooterWordmark() {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div aria-hidden="true" className="mt-16 flex items-end justify-center gap-3 pb-6">
        <span className="wordmark-faded text-[11vw] whitespace-nowrap xl:text-[145px]">
          ShipYard
        </span>
        <span className="mb-[0.12em] size-3 shrink-0 rounded-[3px] bg-brand-500 md:size-5" />
      </div>
    );
  }

  return (
    <motion.div
      aria-hidden="true"
      className="mt-16 flex items-end justify-center gap-3 pb-6"
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '-8% 0px' }}
    >
      <span className="flex items-end whitespace-nowrap">
        {WORD.split('').map((ch, i) => (
          <WordmarkLetter key={i} ch={ch} index={i} />
        ))}
      </span>
      <motion.span
        className="mb-[0.12em] size-3 shrink-0 rounded-[3px] bg-brand-500 md:size-5"
        variants={ACCENT}
      />
    </motion.div>
  );
}
