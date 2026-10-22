/**
 * The rebuilt libxml element tree. Expected shapes are libxml 2.9.13's own
 * parse of the same markup (PHP `DOMDocument`, WP Rocket's flags).
 */
import { describe, expect, it } from 'vitest';
import { scanTokens } from '../html-scan';
import { buildLibxmlTree, type TreeElement } from './tree';

/** The tree as `tag#id(children)` text, the shape the measurements were taken in. */
function shape(html: string): string {
  const render = (elements: readonly TreeElement[]): string =>
    elements
      .map((element) => {
        const id = element.tag.attrs.find((attr) => attr.name === 'id')?.value;
        const inner = render(element.children);
        return `${element.tag.name}${id ? `#${id}` : ''}${inner ? `(${inner})` : ''}`;
      })
      .join(' ');
  return render(buildLibxmlTree(scanTokens(html)).rootChildren);
}

describe('buildLibxmlTree — libxml 2.9.13 shapes (measured)', () => {
  it.each([
    ['<div id="a"><div id="b"></div><div id="c">', 'div#a(div#b div#c)'],
    [
      '<div id="a"><span id="s"><div id="b"></div></div><div id="c"></div>',
      'div#a(span#s(div#b)) div#c'
    ],
    ['<div id="a"></span><div id="b"></div></div>', 'div#a(div#b)'],
    ['<div id="a"><p id="p">x<div id="b">y</div>z</p></div>', 'div#a(p#p div#b)'],
    ['<div id="a"><p id="p">t<section id="b">x</section></p></div>', 'div#a(p#p(section#b))'],
    ['<div id="o"><h2 id="p"><form id="k">x</form></h2></div>', 'div#o(h2#p form#k)'],
    [
      '<div id="a"><a id="x"><div id="b"></a></div><div id="c"></div></div>',
      'div#a(a#x(div#b div#c))'
    ],
    ['<div id="a"><section id="b"></div><div id="c"></div>', 'div#a(section#b) div#c'],
    ['<main id="m"><div id="b"></main><div id="c"></div>', 'main#m(div#b(div#c))'],
    ['<div id="a"><td id="x">t</div><div id="b"></div>', 'div#a(td#x(div#b))'],
    ['<div id="a"><source id="x"><div id="b"></div></div>', 'div#a(source#x(div#b))'],
    ['<div id="a"><img id="x"><div id="b"></div></div>', 'div#a(img#x div#b)'],
    ['<div id="a"><div id="x"/><div id="b"></div></div>', 'div#a(div#x div#b)'],
    ['<div id="a"><head id="h"><div id="b"></div></div>', 'div#a(div#b)']
  ])('%s → %s', (body, expected) => {
    expect(shape(`<html><head></head><body>${body}</body></html>`)).toBe(expected);
  });

  it('marks every ancestor of an SVG `<use>`', () => {
    const tree = buildLibxmlTree(
      scanTokens('<body><div id="a"><svg><use></use></svg></div><div id="b"></div></body>')
    );
    expect(tree.rootChildren.map((element) => element.containsUse)).toEqual([true, false]);
  });

  it('stays linear on end tags that cannot close anything', () => {
    // Unclosed elements under a stack of end tags that are not open (or are
    // blocked by a higher-priority element): each must resolve without
    // scanning the stack.
    const n = 60_000;
    const pages = [
      `<body><div id="a">${'<span>'.repeat(n)}${'</div>'.repeat(n)}</body>`,
      `<body><div id="a">${'<span>'.repeat(n)}${'</p>'.repeat(n)}</body>`,
      `<body><b><td>${'<span>'.repeat(n)}${'</b>'.repeat(n)}</body>`
    ];
    for (const page of pages) {
      const tokens = scanTokens(page);
      const started = performance.now();
      buildLibxmlTree(tokens);
      // Generous: a quadratic scan takes seconds here, the linear one milliseconds.
      expect(performance.now() - started).toBeLessThan(1_000);
    }
  });
});
