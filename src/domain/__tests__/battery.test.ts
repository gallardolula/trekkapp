/** What the battery readings are turned into.
 *
 *  The reading itself needs a device. The arithmetic on top of it does not,
 *  and the arithmetic is where a measurement gets quietly flattered: by
 *  counting a stretch on the charger, by reporting a rate from two readings
 *  a minute apart, or by getting the sign the wrong way round.
 */
import { rateOf, RNF04_BUDGET_PER_HOUR, type Sample } from '../../domain/battery';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 9, 10, minutes)).toISOString();

const sample = (minutes: number, level: number, charging = false): Sample => ({
  level,
  charging,
  at: at(minutes),
});

describe('the rate', () => {
  it('is the charge lost over the time it took', () => {
    // Six points in thirty minutes is twelve an hour.
    const r = rateOf([sample(0, 80), sample(30, 74)]);
    expect(r.perHour).toBeCloseTo(12, 5);
    expect(r.minutes).toBeCloseTo(30, 5);
  });

  it('is positive when charge was lost', () => {
    // The requirement is written as consumption, so losing charge has to
    // come out positive or the comparison against the ceiling inverts.
    expect(rateOf([sample(0, 90), sample(60, 82)]).perHour).toBeGreaterThan(0);
  });

  it('is negative when the phone gained charge off the charger', () => {
    // Which should not happen, and if it does the number should look wrong
    // rather than be hidden.
    expect(rateOf([sample(0, 70), sample(60, 73)]).perHour).toBeLessThan(0);
  });
});

describe('readings that must not count', () => {
  it('ignores the ones taken on the charger', () => {
    const r = rateOf([
      sample(0, 50, true),
      sample(10, 62, true),
      sample(20, 60),
      sample(80, 54),
    ]);
    // From 60 to 54 over an hour, and not from 50 to 54, which would have
    // reported the phone gaining charge while walking.
    expect(r.perHour).toBeCloseTo(6, 5);
    expect(r.droppedCharging).toBe(2);
  });

  it('refuses to report a rate from a measurement that was too short', () => {
    const r = rateOf([sample(0, 80), sample(2, 79)]);
    expect(r.perHour).toBeNull();
    expect(r.withinBudget).toBeNull();
  });

  it('refuses to report a rate from a single reading', () => {
    expect(rateOf([sample(0, 80)]).perHour).toBeNull();
  });

  it('refuses to report a rate from nothing at all', () => {
    expect(rateOf([]).perHour).toBeNull();
  });

  it('refuses when every reading was on the charger', () => {
    const r = rateOf([sample(0, 40, true), sample(90, 95, true)]);
    expect(r.perHour).toBeNull();
    expect(r.droppedCharging).toBe(2);
  });
});

describe('the verdict against RNF04', () => {
  it('passes at the ceiling', () => {
    // Exactly ten per cent an hour meets the requirement, which says no
    // more than ten.
    const r = rateOf([sample(0, 80), sample(60, 70)]);
    expect(r.perHour).toBeCloseTo(RNF04_BUDGET_PER_HOUR, 5);
    expect(r.withinBudget).toBe(true);
  });

  it('fails above it', () => {
    expect(rateOf([sample(0, 80), sample(60, 69)]).withinBudget).toBe(false);
  });

  it('passes comfortably below it', () => {
    expect(rateOf([sample(0, 80), sample(120, 74)]).withinBudget).toBe(true);
  });
});
