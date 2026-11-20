/** The code block's test seams the JavaScript page's views forward untouched (production omits them). */
import type { CodeBlockProps } from '../../../../components/ui/code-block';

/** The seams: highlighter load, intersection gate and overflow watch. */
export type CodeBlockSeams = Pick<
  CodeBlockProps,
  'loadHighlighter' | 'createObserver' | 'watchOverflow'
>;
