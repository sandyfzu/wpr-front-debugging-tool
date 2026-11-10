/**
 * Who produced a row state, and how a chip shows it — the one declaring site
 * of the source → look mapping the state chips, the "+N" chip and the legend
 * all read. Each source differs by icon and by fill/dash/outline, never by
 * color alone: WP Rocket (rocket, soft info fill), an FDT simulation (flask,
 * dashed info outline), an FDT exclusion (ban, soft warn fill), the page's
 * own markup (plain outline, the row's type-chip look, no icon).
 */
import type { LucideIcon } from 'lucide-solid';
import Ban from 'lucide-solid/icons/ban';
import FlaskConical from 'lucide-solid/icons/flask-conical';
import Rocket from 'lucide-solid/icons/rocket';
import type { BadgeVariant } from '../../../../components/ui/badge';
import type { StatusKind } from '../../../../components/ui/status-badge';

/** Every source, in legend order. */
export const STATE_SOURCES = ['wp-rocket', 'simulated', 'excluded', 'page'] as const;

/** Who produced a state: WP Rocket, an FDT simulation, an FDT exclusion, or the page itself. */
export type StateSource = (typeof STATE_SOURCES)[number];

/** How one source reads. */
export interface StateSourceLook {
  /** The legend's words. */
  readonly legend: string;
  /** The short words the "+N" title puts after a hidden chip ("Minified (WP Rocket)"). */
  readonly phrase: string;
  /** The vocabulary colors the chip borrows. */
  readonly kind: StatusKind;
  /** The chip treatment. */
  readonly variant: BadgeVariant;
  /** The leading icon, or `null` (the page's own state: the plain outline says it). */
  readonly icon: LucideIcon | null;
}

/** Per source: its words and its look. */
export const STATE_SOURCE_LOOKS: Readonly<Record<StateSource, StateSourceLook>> = {
  'wp-rocket': {
    legend: 'WP Rocket',
    phrase: 'WP Rocket',
    kind: 'info',
    variant: 'soft',
    icon: Rocket
  },
  simulated: {
    legend: 'Simulated by FDT',
    phrase: 'FDT simulation',
    kind: 'info',
    variant: 'dashed',
    icon: FlaskConical
  },
  excluded: {
    legend: 'Excluded by FDT',
    phrase: 'FDT exclusion',
    kind: 'warn',
    variant: 'soft',
    icon: Ban
  },
  page: { legend: 'Page', phrase: 'page', kind: 'neutral', variant: 'outline', icon: null }
};
