/**
 * The forward LazyLoad (images) transform on targeted pages: each `served`
 * below is what the real plugin (WP Rocket 3.24, its harness) served for
 * `html` placed on its own line of a page carrying LazyLoad's texts, those
 * texts removed. Then the refusals, by named step, and the IE handling.
 */
import { describe, expect, it } from 'vitest';
import {
  lazyloadExclusions,
  lazyloadImagesPass,
  simulateLazyloadImages,
  type LazyloadExclusions
} from './lazyload-forward';
import { PICTURE_IMAGE_PATTERN_MAX_BYTES } from './lazyload-picture-image';

/** WP Rocket 3.24's image exclusion literals. */
const LITERALS = {
  excludedAttributes: [
    'data-src=',
    'data-no-lazy=',
    'data-lazy-original=',
    'data-lazy-src=',
    'data-lazysrc=',
    'data-lazyload=',
    'data-bgposition=',
    'data-envira-src=',
    'fullurl=',
    'lazy-slider-img=',
    'data-srcset=',
    'class="ls-l',
    'class="ls-bg',
    'soliloquy-image',
    'loading="eager"',
    'swatch-img',
    'data-height-percentage',
    'data-large_image',
    'avia-bg-style-fixed',
    'data-skip-lazy',
    'skip-lazy',
    'image-compare__'
  ],
  excludedSrc: ['/wpcf7_captcha/', 'timthumb.php?src', 'woocommerce/assets/images/placeholder.png']
};

/** A filler too long for the per-picture pattern (stands for `§` below). */
const LONG = 'x'.repeat(16_600);

/** Plugin-served pages. */
const SERVED: readonly {
  readonly name: string;
  readonly rows?: readonly string[];
  readonly html: string;
  readonly served: string;
}[] = [
  {
    name: 'plain image: placeholder sized, data-lazy-src escaped, noscript copy',
    html: '<img src="/a.jpg?x=1&y=2" width="300" height="1e2" alt="a">',
    served:
      '<img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%20300%20100\'%3E%3C/svg%3E" width="300" height="1e2" alt="a" data-lazy-src="/a.jpg?x=1&#038;y=2"><noscript><img src="/a.jpg?x=1&y=2" width="300" height="1e2" alt="a"></noscript>'
  },
  {
    name: 'native loading dropped, srcset and sizes moved to their carriers',
    html: '<img loading="lazy" src="/a.jpg" srcset="/a.jpg 1x, /b.jpg 2x" SIZES=\'100vw\'>',
    served:
      '<img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-srcset="/a.jpg 1x, /b.jpg 2x" data-lazy-SIZES=\'100vw\' data-lazy-src="/a.jpg"><noscript><img loading="lazy" src="/a.jpg" srcset="/a.jpg 1x, /b.jpg 2x" SIZES=\'100vw\'></noscript>'
  },
  {
    name: 'excluded image loses loading=lazy in its tag and wherever its attributes repeat',
    html: '<img src="/k.jpg" loading="lazy" data-no-lazy="1"><source src="/k.jpg" loading="lazy" data-no-lazy="1">',
    served: '<img src="/k.jpg"  data-no-lazy="1"><source src="/k.jpg"  data-no-lazy="1">'
  },
  {
    name: 'duplicate images replaced once each, copies in scripts too',
    html: '<img src="/d.jpg"><script>var a=\'<img src="/d.jpg">\';</script><img src="/d.jpg">',
    served:
      '<img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/d.jpg"><noscript><img src="/d.jpg"></noscript><script>var a=\'<img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/d.jpg"><noscript><img src="/d.jpg"></noscript>\';</script><img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/d.jpg"><noscript><img src="/d.jpg"></noscript>'
  },
  {
    name: "an image nested in another's alt replays call by call",
    html: '<img alt="<img src=\'/i.jpg\'" src="/o.jpg"><img src=\'/i.jpg\'>',
    served:
      '<img alt="<img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E"" src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/i.jpg"><noscript><img alt="<img src=\'/i.jpg\'" src="/o.jpg"></noscript><img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/i.jpg"><noscript><img src=\'/i.jpg\'></noscript>'
  },
  {
    name: 'data: and javascript: sources escape to empty',
    html: '<img src="data:image/gif;base64,R0"><img src="javascript:x">',
    served:
      '<img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src=""><noscript><img src="data:image/gif;base64,R0"></noscript><img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src=""><noscript><img src="javascript:x"></noscript>'
  },
  {
    name: 'picture: sources renamed, first image lazy outside noscript copies',
    html: '<picture><source srcset="/a.webp" type="image/webp"><img src="/p.jpg" alt="$1"></picture><noscript><img src="/p.jpg" alt="$1"></noscript>',
    served:
      '<picture><source data-lazy-srcset="/a.webp" type="image/webp"><img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" alt="" data-lazy-src="/p.jpg"><noscript><img src="/p.jpg" alt=""></noscript></picture><noscript><img src="/p.jpg" alt="$1"></noscript>'
  },
  {
    name: 'excluded picture: data-no-lazy on every <img',
    html: '<picture class="skip-lazy"><img src="/x.jpg"><img src="/y.jpg"></picture>',
    served:
      '<picture class="skip-lazy"><img data-no-lazy="" src="/x.jpg"><img data-no-lazy="" src="/y.jpg"></picture>'
  },
  {
    name: 'picture image inside a one-line noscript stretch is skipped, next line replaced',
    html: '<picture><img src="/m.jpg"></picture>\n<noscript>a <img src="/m.jpg"> b</noscript> <IMG src="/m.jpg">',
    served:
      '<picture><img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/m.jpg"><noscript><img src="/m.jpg"></noscript></picture>\n<noscript>a <img src="/m.jpg"> b</noscript> <img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/m.jpg"><noscript><img src="/m.jpg"></noscript>'
  },
  {
    name: 'background: data-bg, class merged, declaration removed',
    html: "<div class=' a  b ' style=\"color:red;background-image: url('/bg.jpg?a=1&amp;b=2');\">t</div>",
    served:
      '<div data-bg="/bg.jpg?a=1&#038;b=2" class=\'a b rocket-lazyload\' style="color:red;">t</div>'
  },
  {
    name: 'background without class: class inserted after every tag name, <link reads as li',
    html: '<li data-x="<link a>" style="background-image:url(/l.png)">t</li>',
    served:
      '<li data-bg="/l.png" class="rocket-lazyload" data-x="<li data-bg="/l.png"nk a>" style="">t</li>'
  },
  {
    name: "background style inside another attribute's quotes is not the real one",
    html: '<div title="x style=background-image:url(/no.png)" style="background-image:url(/yes.png)">t</div>',
    served:
      '<div data-bg="/yes.png" class="rocket-lazyload" title="x style=background-image:url(/no.png)" style="">t</div>'
  },
  {
    name: 'background excluded by attribute or src rows',
    rows: ['keep-me'],
    html: '<div class="keep-me" style="background-image:url(/a.png)">t</div><div style="background-image:url(/keep-me.png)">t</div><div style="background-image:url(data:image/png;base64,A)">t</div>',
    served:
      '<div class="keep-me" style="background-image:url(/a.png)">t</div><div style="background-image:url(/keep-me.png)">t</div><div style="background-image:url(data:image/png;base64,A)">t</div>'
  },
  {
    name: 'user rows exclude images by attributes and by src',
    rows: ['hero', '/skip/'],
    html: '<img class="hero" src="/h.jpg"><img src="/skip/s.jpg"><img src="/ok.jpg">',
    served:
      '<img class="hero" src="/h.jpg"><img src="/skip/s.jpg"><img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/ok.jpg"><noscript><img src="/ok.jpg"></noscript>'
  },
  {
    name: 'class quirks: empty, "0", unquoted, quote-only',
    html: '<div class="" style="background-image:url(/1.png)">a</div><div class=0 style="background-image:url(/2.png)">b</div><span class=solo style="background-image:url(/3.png)">c</span><a class=\'"x"\' style="background-image:url(/4.png)">d</a>',
    served:
      '<div data-bg="/1.png" class="rocket-lazyload" style="">a</div><div data-bg="/2.png" class="rocket-lazyload" style="">b</div><span data-bg="/3.png" class="solo rocket-lazyload" style="">c</span><a data-bg="/4.png" class=\'"x" rocket-lazyload\' style="">d</a>'
  },
  {
    name: 'atts repeated in its own tail are replaced twice',
    html: '<img / src="/r.jpg" />',
    served:
      '<img / src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/r.jpg" /><noscript><img / src="/r.jpg" /></noscript>'
  },
  {
    name: 'a > right after the whitespace belongs to the attributes',
    html: '<img > src="/g.jpg">',
    served:
      '<img > src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" data-lazy-src="/g.jpg"><noscript><img > src="/g.jpg"></noscript>'
  },
  {
    name: 'stray quote opens a stretch: the later style is inside it',
    html: "<div title=it's style=\"background-image:url(/q.png)\" data-x='y'>t</div>",
    served: "<div title=it's style=\"background-image:url(/q.png)\" data-x='y'>t</div>"
  },
  {
    name: 'uppercase tag name keeps its case in data-bg insertion',
    html: '<DIV style="BACKGROUND-IMAGE : URL( \'/u.png\' ) ;">t</DIV>',
    served: '<DIV data-bg="/u.png" class="rocket-lazyload" style="">t</DIV>'
  },
  {
    name: 'src without quotes is not lazy loaded',
    html: '<img src=/n.jpg loading="lazy">',
    served: '<img src=/n.jpg >'
  },
  {
    name: 'picture image too long for the per-picture pattern stays for the image pass',
    html: '<picture><img src="/long.jpg" alt="§"></picture>',
    served:
      '<picture><img src="data:image/svg+xml,%3Csvg%20xmlns=\'http://www.w3.org/2000/svg\'%20viewBox=\'0%200%200%200\'%3E%3C/svg%3E" alt="§" data-lazy-src="/long.jpg"><noscript><img src="/long.jpg" alt="§"></noscript></picture>'
  }
];

/**
 * The pass's rows for stored rows.
 *
 * @param rows The stored rows.
 */
const exclusions = (rows: readonly string[] = []): LazyloadExclusions =>
  lazyloadExclusions(LITERALS, rows);

describe('lazyloadImagesPass — as the plugin serves', () => {
  it.each(SERVED.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    const out = lazyloadImagesPass(row.html.replaceAll('§', LONG), exclusions(row.rows));
    expect(out).toMatchObject({ html: row.served.replaceAll('§', LONG) });
  });

  it('counts images, pictures and backgrounds', () => {
    const out = lazyloadImagesPass(
      '<img src="/a.jpg"><img src="/a.jpg"><img src="/b.jpg"><picture><img src="/p.jpg"></picture><div style="background-image:url(/c.png)"></div><div style="background-image:url(/c.png)"></div>',
      exclusions()
    );
    expect(out).toMatchObject({ images: 2, pictures: 1, backgrounds: 2 });
  });
});

describe('lazyloadExclusions', () => {
  it('adds the stored rows to both literal lists', () => {
    expect(lazyloadExclusions({ excludedAttributes: ['a'], excludedSrc: ['s'] }, ['r'])).toEqual({
      attributes: ['a', 'r'],
      src: ['s', 'r']
    });
  });
});

describe('lazyloadImagesPass — refused where WP Rocket could diverge', () => {
  it.each<[string, string]>([
    ['lazyload-hidden-blocks', `<script>${'a'.repeat(600_000)}`],
    ['lazyload-pictures', `<picture>${'>a'.repeat(2_000)}`],
    ['lazyload-pictures', `<picture${'x'.repeat(130_000)}>y</picture>`],
    ['lazyload-images', `<img ${'a'.repeat(200_000)}>`],
    // Unclosed openings at the page end (the plugin's call fails on each but the 400 000 one).
    ['lazyload-images', `<img src="/a.jpg"><img ${'a'.repeat(600_000)}`],
    ['lazyload-images', `<img src="/a.jpg"><img ${'a'.repeat(400_000)}`],
    ['lazyload-images', `<img src="/a.jpg">${`<img ${'a'.repeat(300)}`.repeat(4_000)}`],
    ['lazyload-images', `<img src="/a.jpg">\n<img src="x" ${'a'.repeat(700_000)}`],
    ['lazyload-pictures', `<picture><img src="/p.jpg"></picture><picture${'a'.repeat(600_000)}`],
    [
      'lazyload-pictures',
      `<picture><img src="/p.jpg"></picture>${`<picture${'a'.repeat(300)}`.repeat(4_000)}`
    ],
    [
      'lazyload-picture-image',
      `<picture><img src="/a.jpg"></picture><noscript>${'<img src="/a.jpg">'.repeat(1_000)}`
    ],
    [
      'lazyload-picture-pattern-size',
      `<picture><img src="/a.jpg" alt="${'y'.repeat(PICTURE_IMAGE_PATTERN_MAX_BYTES - 30)}"></picture>`
    ],
    ['lazyload-dimension', '<img src="/a.jpg" width="1e30">'],
    ['lazyload-url', '<img src="/a[1].jpg">'],
    ['lazyload-entities', '<div style="background-image:url(/a&lpar;.png)"></div>'],
    [
      'lazyload-tag-length',
      `<div style="background-image:url(/a.png)" data-x="${'z'.repeat(130_000)}"></div>`
    ],
    [
      'lazyload-replacements',
      Array.from(
        { length: 300 },
        (_, index) => `<img src="/${String(index)}.jpg" loading="lazy" data-no-lazy="1">`
      ).join('') + 'p'.repeat(1_000_000)
    ]
  ])('%s', (step, html) => {
    expect(lazyloadImagesPass(html, exclusions())).toEqual({ beyond: step });
  });

  it('reproduces a picture pattern PCRE refuses to compile: the image pass takes the image', () => {
    const image = `<img src="/a.jpg" alt="${'y'.repeat(PICTURE_IMAGE_PATTERN_MAX_BYTES + 200)}">`;
    const out = lazyloadImagesPass(`<picture>${image}</picture>`, exclusions());
    expect(out).toMatchObject({ pictures: 0, images: 1 });
  });
});

describe('simulateLazyloadImages', () => {
  it('works inside the IE conditional extraction: conditionals stay as served', () => {
    const html = '<!--[if IE]><img src="/ie.jpg"><![endif]--><img src="/a.jpg">';
    const out = simulateLazyloadImages({ html, literals: LITERALS, rows: [] });
    expect(out.report).toEqual({ state: 'simulated', images: 1, pictures: 0, backgrounds: 0 });
    expect(
      out.html.startsWith(
        '<!--[if IE]><img src="/ie.jpg"><![endif]--><img src="data:image/svg+xml,'
      )
    ).toBe(true);
  });

  it('names the step it refuses, and leaves the page as is', () => {
    const html = `<!--[if IE]>${'a'.repeat(600_000)}`;
    expect(simulateLazyloadImages({ html, literals: LITERALS, rows: [] })).toEqual({
      html,
      report: {
        state: 'not-applicable',
        unreproduced: 'ie-conditionals',
        images: 0,
        pictures: 0,
        backgrounds: 0
      }
    });
    const lazy = '<img src="/a.jpg" width="1e30">';
    expect(
      simulateLazyloadImages({ html: lazy, literals: LITERALS, rows: [] }).report
    ).toMatchObject({
      state: 'not-applicable',
      unreproduced: 'lazyload-dimension'
    });
  });

  it('refuses a script conditional PCRE could stop on', () => {
    const html = `<!--[if IE]><script a>${'x'.repeat(70_000)}</script><![endif]-->`;
    const out = simulateLazyloadImages({ html, literals: LITERALS, rows: [] });
    expect(out.report.state).toBe('not-applicable');
    expect(out.report.unreproduced).toBe('ie-conditional-script');
  });
});
