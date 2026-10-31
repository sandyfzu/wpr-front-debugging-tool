/**
 * A note's text runs: plain words, and row texts or addresses as code.
 */
import { For, type JSX } from 'solid-js';
import type { NoteText } from '../copy';

/**
 * A note's runs: code segments render as `<code>` (whatever characters they hold).
 *
 * @param props The note.
 */
export function NoteRuns(props: { readonly note: NoteText }): JSX.Element {
  return (
    <For each={props.note}>
      {(segment) =>
        typeof segment === 'string' ? segment : <code class="xo-code">{segment.code}</code>
      }
    </For>
  );
}
