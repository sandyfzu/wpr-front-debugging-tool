/**
 * The shared results announcement: the truthful text rule (all / part / none
 * / empty page) and the quiet-refresh lifecycle — a data refresh mutes the
 * region for its own update, a committed chip/query change announces again,
 * and a commit landing inside a refresh batch announces in either write
 * order.
 */
import { batch, createRoot, createMemo, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { CountNoun } from '../../../lib/panel/list-behavior';
import { createResultsAnnouncement } from './results-announcement';

const IMAGES: CountNoun = { one: 'image', other: 'images' };

/** One row per position; the identity the refresh verdict is read from. */
function rows(count: number): readonly unknown[] {
  return Array.from({ length: count }, () => Symbol('row'));
}

describe('createResultsAnnouncement', () => {
  it('always states the current count truthfully', () => {
    createRoot((dispose) => {
      const rows5 = rows(5);
      const [visible, setVisible] = createSignal(rows(1));
      const [total, setTotal] = createSignal(rows5);
      const [chip, setChip] = createSignal('all');
      const { text, live } = createResultsAnnouncement({
        rows: total,
        visible,
        noun: IMAGES,
        actions: [chip]
      });
      expect(text()).toBe('Showing 1 of 5 images');
      setVisible(rows5);
      expect(text()).toBe('Showing all 5 images');
      setVisible(rows(0));
      expect(text()).toBe('No images match');
      setTotal(rows(0));
      setVisible(rows(0));
      expect(text()).toBe(''); // an empty page is announced by its empty state
      setTotal(rows5);
      setVisible(rows5);
      expect(text()).toBe('Showing all 5 images');
      // The empty-page round trip was two rows changes — still muted; only a
      // committed user action announces again.
      expect(live()).toBe('off');
      setChip('lazyloaded');
      expect(live()).toBe('polite');
      dispose();
    });
  });

  it('mutes the region while a refresh moves the rows, announces the next user change again', () => {
    const five = rows(5);
    createRoot((dispose) => {
      const [visible, setVisible] = createSignal(five);
      const [total, setTotal] = createSignal(five);
      const [chip, setChip] = createSignal('all');
      const { text, live } = createResultsAnnouncement({
        rows: total,
        visible,
        noun: IMAGES,
        actions: [chip]
      });
      // An unchanged refresh (same list identity) changes nothing at all.
      setTotal(five);
      expect(text()).toBe('Showing all 5 images');
      expect(live()).toBe('polite');
      // A real refresh: counts updated, region muted for that update.
      setTotal(rows(3));
      setVisible(rows(3));
      expect(text()).toBe('Showing all 3 images');
      expect(live()).toBe('off');
      // The user's next committed change announces and unmutes.
      setVisible(rows(2));
      setChip('lazyloaded');
      expect(text()).toBe('Showing 2 of 3 images');
      expect(live()).toBe('polite');
      dispose();
    });
  });

  it('a commit landing inside the same refresh batch announces, in either write order', () => {
    createRoot((dispose) => {
      const [visible, setVisible] = createSignal(rows(5));
      const [total, setTotal] = createSignal(rows(5));
      const [chip, setChip] = createSignal('all');
      const { text, live } = createResultsAnnouncement({
        rows: total,
        visible,
        noun: IMAGES,
        actions: [chip]
      });
      // Refresh sources written before the action: a batch flushes memos in
      // write order, so the announcement must not depend on it anyway.
      batch(() => {
        setTotal(rows(2));
        setVisible(rows(2));
        setChip('lazyloaded');
      });
      expect(text()).toBe('Showing all 2 images');
      expect(live()).toBe('polite');
      // A refresh-only batch mutes its own update again.
      batch(() => {
        setTotal(rows(1));
        setVisible(rows(1));
      });
      expect(live()).toBe('off');
      // The reverse write order — the user action first, the refresh second —
      // announces exactly the same (one combined effect decides, not the
      // sibling pair's order).
      batch(() => {
        setChip('all');
        setTotal(rows(3));
        setVisible(rows(3));
      });
      expect(text()).toBe('Showing all 3 images');
      expect(live()).toBe('polite');
      dispose();
    });
  });

  it('a pure recompute with an unchanged actions trigger does not unmute', () => {
    createRoot((dispose) => {
      const [visible, setVisible] = createSignal(rows(5));
      const [total, setTotal] = createSignal(rows(5));
      const [chip, setChip] = createSignal<string | undefined>('all');
      // The actions the pages pass are memos, not bare signals: same value →
      // no change → the refresh's mute must survive.
      const actions = createMemo(() => chip());
      const { live } = createResultsAnnouncement({
        rows: total,
        visible,
        noun: IMAGES,
        actions: [actions]
      });
      setTotal(rows(3));
      setVisible(rows(3));
      expect(live()).toBe('off');
      setChip('all'); // same value: the memo keeps its input identity
      expect(live()).toBe('off');
      setChip(undefined);
      expect(live()).toBe('polite');
      dispose();
    });
  });
});
