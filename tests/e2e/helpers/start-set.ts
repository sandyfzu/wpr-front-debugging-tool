/**
 * An extension page's start set in the built bundle under test: each file the
 * page loads before it runs (its module scripts, preloads and their static
 * imports), walked the way the budget gate walks it — so a spec can pin that
 * some code stays off a page's start under whatever chunk name it lands.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { startSet } from '../../../scripts/budget-start-set.mjs';
import { EXTENSION_PATH } from './extension';

/**
 * Read a built page's start set, with each file's code.
 *
 * @param page The page's build-relative HTML file (e.g. `panel.html`).
 * @returns Each start file's code, by build-relative path.
 * @throws {@link Error} When the walk could not complete (it would under-count).
 */
export function pageStartSet(page: string): ReadonlyMap<string, string> {
  const present = new Set(
    readdirSync(EXTENSION_PATH, { recursive: true, encoding: 'utf8' }).map((file) =>
      file.split(path.sep).join('/')
    )
  );
  const read = (file: string): string => readFileSync(path.join(EXTENSION_PATH, file), 'utf8');
  const { files, problems } = startSet(page, present, read);
  if (problems.length > 0) throw new Error(`${page} start set incomplete: ${problems.join('; ')}`);
  return new Map(files.map((file) => [file, read(file)]));
}
