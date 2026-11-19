/**
 * The list pages' search field: a search-typed `Input` (the browser's
 * built-in clear affordance comes with the type) behind a search icon,
 * wired through the page's controlled value loop — this field adds no input
 * logic of its own (the page owns the debouncing).
 */
import type { JSX } from 'solid-js';
import Search from 'lucide-solid/icons/search';
import { cn } from '../../utils/cn';
import { Input } from './input';

/**
 * The field's width: the full row while the panel is compact, a comfortable
 * bounded field (20 rem) from the regular tier — never a fixed width that
 * would read as a banner or float apart from the canvas.
 */
const SEARCH_FIELD_WIDTH = 'w-full @regular:max-w-80';

/** Props of {@link SearchField}. */
export interface SearchFieldProps {
  /** The field's current value (controlled). */
  value: string;
  /** Receives each typed value (the input's `onInput` payload). */
  onValueChange: (value: string) => void;
  /** The field's accessible name. */
  label: string;
  /** The field's placeholder. */
  placeholder: string;
}

/**
 * Render the search field (`data-fdt="search-field"`).
 *
 * @param props See {@link SearchFieldProps}.
 */
export function SearchField(props: SearchFieldProps): JSX.Element {
  return (
    <div data-fdt="search-field" class="relative flex items-center">
      <Search
        size={14}
        class="pointer-events-none absolute start-2 text-fg-muted"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        onInput={(event) => {
          props.onValueChange(event.currentTarget.value);
        }}
        class={cn('ps-7', SEARCH_FIELD_WIDTH)}
      />
    </div>
  );
}
