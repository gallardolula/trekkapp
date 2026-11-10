/** What a run of battery readings says about RNF04.
 *
 *  Taking the readings needs a device. Deciding what they mean does not,
 *  and this half is where a measurement gets quietly flattered: by counting
 *  a stretch spent on the charger, by reporting a rate from two readings a
 *  minute apart, or by getting the sign the wrong way round and announcing
 *  that walking charges the phone.
 *
 *  So the arithmetic lives here, with the rest of the rules, where it is
 *  verifiable without a phone in hand. The reading itself is in
 *  src/data/battery.ts.
 */

/** The ceiling RNF04 commits to, in percent per hour. */
export const RNF04_BUDGET_PER_HOUR = 10;

/** Below this a rate is noise rather than a measurement. */
export const MINIMUM_MINUTES = 5;

export interface Sample {
  /** 0 to 100. Whole numbers on Android, finer on iOS. */
  level: number;
  charging: boolean;
  at: string;
}

export interface Rate {
  /** Null until there are two usable readings far enough apart. */
  perHour: number | null;
  minutes: number;
  droppedCharging: number;
  withinBudget: boolean | null;
}

/**
 * The rate, from the readings that are allowed to count.
 *
 * Measured from the first to the last reading taken off the charger, and
 * not from a line fitted through all of them. The question the requirement
 * asks is what an hour of walking costs, which is a difference over a span,
 * and a regression would invent a smoothness the data does not have.
 *
 * Positive means charge was lost, which is the direction the requirement is
 * written in. A negative result is reported rather than hidden: a phone
 * that gained charge off the charger means the measurement is wrong, and
 * that should look wrong.
 */
export function rateOf(samples: Sample[]): Rate {
  const usable = samples.filter((s) => !s.charging);
  const droppedCharging = samples.length - usable.length;

  const first = usable[0];
  const last = usable[usable.length - 1];
  if (!first || !last || first === last) {
    return { perHour: null, minutes: 0, droppedCharging, withinBudget: null };
  }

  const minutes = (new Date(last.at).getTime() - new Date(first.at).getTime()) / 60000;
  if (minutes < MINIMUM_MINUTES) {
    return { perHour: null, minutes, droppedCharging, withinBudget: null };
  }

  const perHour = ((first.level - last.level) / minutes) * 60;
  return { perHour, minutes, droppedCharging, withinBudget: perHour <= RNF04_BUDGET_PER_HOUR };
}
