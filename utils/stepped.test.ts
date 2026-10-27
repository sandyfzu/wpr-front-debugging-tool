import { describe, expect, it } from 'vitest';
import { runStepped, stepFor, steppedValue, type Stepped } from './stepped';

/** Sums `count` numbers a step each. */
function summing(count: number): Stepped<number> & { readonly steps: () => number } {
  let done = 0;
  let sum = 0;
  return {
    step() {
      if (done < count) sum += ++done;
      return done >= count;
    },
    result() {
      if (done < count) throw new Error('not done');
      return sum;
    },
    steps: () => done
  };
}

describe('runStepped', () => {
  it('runs every step, then reads the result', () => {
    expect(runStepped(summing(4))).toBe(10);
    expect(runStepped(summing(0))).toBe(0);
  });
});

describe('stepFor', () => {
  it('runs steps until the time box is spent', () => {
    let now = 0;
    const clock = () => (now += 1);
    const work = summing(100);
    // One read to start, one per step: 4 ms leaves room for 4 steps.
    expect(stepFor(() => work.step(), clock, 4)).toBe(false);
    expect(work.steps()).toBe(4);
  });

  it('always runs one step, however slow', () => {
    const clock = (() => {
      let now = 0;
      return () => (now += 1000);
    })();
    const work = summing(3);
    expect(stepFor(() => work.step(), clock, 1)).toBe(false);
    expect(work.steps()).toBe(1);
  });

  it('stops once the work is done, inside the box', () => {
    const work = summing(2);
    expect(
      stepFor(
        () => work.step(),
        () => 0,
        100
      )
    ).toBe(true);
    expect(work.result()).toBe(3);
  });
});

describe('steppedValue', () => {
  it('is done at once with its value', () => {
    const work = steppedValue('x');
    expect(work.step()).toBe(true);
    expect(work.result()).toBe('x');
  });
});
