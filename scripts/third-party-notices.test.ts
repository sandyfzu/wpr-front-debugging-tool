import { describe, expect, it } from 'vitest';
import {
  checkCssPackages,
  createNoticeCollector,
  licenseBannersOf,
  mitLicenseText,
  packageRootOf,
  readPackageNotice,
  renderNotices,
  withLicenseTexts,
  type NoticeReader,
  type PackageNotice
} from './third-party-notices';

/** An in-memory file system: path → text; a folder lists the files under it. */
function memoryReader(files: Record<string, string>): NoticeReader {
  return {
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    listDir: (dir) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1))
        .filter((rest) => !rest.includes('/'))
  };
}

const PNPM = '/repo/node_modules/.pnpm';

describe('packageRootOf', () => {
  it('resolves a pnpm-nested module to its package root', () => {
    expect(packageRootOf(`${PNPM}/solid-js@1.9.20/node_modules/solid-js/dist/solid.js`)).toBe(
      `${PNPM}/solid-js@1.9.20/node_modules/solid-js`
    );
  });

  it('keeps both segments of a scoped name', () => {
    expect(
      packageRootOf(`${PNPM}/@shikijs+core@4.6.0/node_modules/@shikijs/core/dist/index.mjs`)
    ).toBe(`${PNPM}/@shikijs+core@4.6.0/node_modules/@shikijs/core`);
  });

  it('strips a query suffix and normalizes Windows separators', () => {
    expect(packageRootOf('C:\\repo\\node_modules\\clsx\\dist\\clsx.mjs?commonjs-es-import')).toBe(
      'C:/repo/node_modules/clsx'
    );
  });

  it('uses the innermost node_modules (a dependency nested in a package)', () => {
    expect(packageRootOf('/repo/node_modules/a/node_modules/b/index.js')).toBe(
      '/repo/node_modules/a/node_modules/b'
    );
  });

  it('returns null for project files, virtual ids and truncated paths', () => {
    expect(packageRootOf('/repo/lib/panel/view.ts')).toBeNull();
    expect(packageRootOf('\0vite/preload-helper')).toBeNull();
    expect(packageRootOf('/repo/node_modules/clsx')).toBeNull();
    expect(packageRootOf('/repo/node_modules/@scope/pkg')).toBeNull();
    expect(packageRootOf('/repo/node_modules//x.js')).toBeNull();
  });
});

describe('readPackageNotice', () => {
  it('reads name, version, licence id and the licence file text (trimmed)', () => {
    const reader = memoryReader({
      '/p/package.json': JSON.stringify({ name: 'clsx', version: '2.1.1', license: ' MIT ' }),
      '/p/license': '\nMIT License\n\nCopyright (c) Luke\n\n',
      '/p/index.js': ''
    });
    expect(readPackageNotice('/p', reader)).toEqual({
      name: 'clsx',
      version: '2.1.1',
      license: 'MIT',
      text: 'MIT License\n\nCopyright (c) Luke'
    });
  });

  it('accepts LICENCE / COPYING / LICENSE.md spellings, first in sort order', () => {
    const base = { '/p/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }) };
    expect(readPackageNotice('/p', memoryReader({ ...base, '/p/LICENCE': 'L' })).text).toBe('L');
    expect(readPackageNotice('/p', memoryReader({ ...base, '/p/COPYING': 'C' })).text).toBe('C');
    expect(
      readPackageNotice(
        '/p',
        memoryReader({ ...base, '/p/LICENSE.md': 'md', '/p/LICENSE': 'plain' })
      ).text
    ).toBe('plain');
  });

  it('never mistakes a similarly named file for a licence', () => {
    const reader = memoryReader({
      '/p/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
      '/p/licenses-list.js': 'code',
      '/p/unlicensed.txt': 'x'
    });
    expect(readPackageNotice('/p', reader)).toEqual({
      name: 'a',
      version: '1.0.0',
      license: 'UNKNOWN',
      text: null
    });
  });

  it('throws naming the root when the package cannot be attributed', () => {
    for (const manifest of [
      {},
      { name: 'a' },
      { name: '', version: '1' },
      { name: 'a', version: 1 }
    ]) {
      const reader = memoryReader({ '/p/package.json': JSON.stringify(manifest) });
      expect(() => readPackageNotice('/p', reader)).toThrow(
        '/p/package.json has no name or version'
      );
    }
  });
});

describe('renderNotices', () => {
  const a: PackageNotice = { name: 'b-pkg', version: '1.0.0', license: 'MIT', text: 'B text' };
  const b: PackageNotice = { name: 'a-pkg', version: '2.0.0', license: 'ISC', text: 'A text' };

  it('renders a header and one section per entry, sorted, newline-terminated', () => {
    expect(renderNotices([a, b])).toBe(
      'Third-party software notices\n\n' +
        'This extension includes the following third-party software, each under its own licence.\n\n' +
        'a-pkg 2.0.0 (ISC)\n-----------------\n\nA text\n\n' +
        'b-pkg 1.0.0 (MIT)\n-----------------\n\nB text\n'
    );
  });

  it('is independent of input order and names where a vendored entry ships', () => {
    const vendored = { ...a, files: 'x/y.js' };
    expect(renderNotices([vendored, b])).toBe(renderNotices([b, vendored]));
    expect(renderNotices([vendored])).toContain('b-pkg 1.0.0 (MIT)\nPackaged as: x/y.js\n---');
  });

  it('orders versions of one name and states a missing text', () => {
    const text = renderNotices([
      { ...a, version: '2.0.0', text: null },
      { ...a, version: '1.0.0' }
    ]);
    expect(text.indexOf('b-pkg 1.0.0')).toBeLessThan(text.indexOf('b-pkg 2.0.0'));
    expect(text).toContain('Licensed under MIT; the package ships no licence file.');
  });
});

describe('withLicenseTexts', () => {
  const withText: PackageNotice = { name: 'a', version: '1', license: 'MIT', text: 'A' };
  const without: PackageNotice = { name: 'b', version: '1', license: 'MIT', text: null };

  it('fills a missing text from the table and leaves present texts alone', () => {
    expect(withLicenseTexts([withText, without], { a: 'ignored', b: 'B' })).toEqual([
      withText,
      { ...without, text: 'B' }
    ]);
  });

  it('throws naming every package still without a text', () => {
    const other = { ...without, name: 'c' };
    expect(() => withLicenseTexts([without, other, withText], {})).toThrow(
      'no licence text for b, c'
    );
  });
});

describe('mitLicenseText', () => {
  it('puts the copyright line between the title and the permission notice', () => {
    const text = mitLicenseText('Copyright (c) 2020 Jane');
    expect(
      text.startsWith('MIT License\n\nCopyright (c) 2020 Jane\n\nPermission is hereby granted')
    ).toBe(true);
    expect(text.endsWith('DEALINGS IN THE\nSOFTWARE.')).toBe(true);
  });
});

describe('licenseBannersOf', () => {
  it('reads name and version of each licence banner, skipping other preserved comments', () => {
    const css =
      '/*! tailwindcss v4.3.5 | MIT License | https://tailwindcss.com */a{}' +
      '/*! keep this */b{}/* License plain comment */' +
      '/*! @scope/pkg v1.0.0-rc.1 | Apache-2.0 licence */';
    expect(licenseBannersOf('x.css', css)).toEqual([
      { name: 'tailwindcss', version: '4.3.5', file: 'x.css' },
      { name: '@scope/pkg', version: '1.0.0-rc.1', file: 'x.css' }
    ]);
  });

  it('returns nothing for CSS without banners', () => {
    expect(licenseBannersOf('x.css', 'a{color:red}')).toEqual([]);
  });

  it('throws naming the file and banner when a licence banner has no name/version head', () => {
    expect(() => licenseBannersOf('y.css', '/*! MIT License, (c) someone */')).toThrow(
      'unreadable licence banner in y.css: /*! MIT License, (c) someone */'
    );
  });
});

describe('checkCssPackages', () => {
  const tw: PackageNotice = { name: 'tailwindcss', version: '4.3.5', license: 'MIT', text: 'T' };
  const banner = { name: 'tailwindcss', version: '4.3.5', file: 'a.css' };

  it('passes when every banner is declared and every declared package has a banner', () => {
    expect(() => {
      checkCssPackages([banner, { ...banner, file: 'b.css' }], [tw]);
    }).not.toThrow();
    expect(() => {
      checkCssPackages([], []);
    }).not.toThrow();
  });

  it('fails naming a banner with no declared package (a missing CSS package)', () => {
    expect(() => {
      checkCssPackages([banner, { name: 'normalize.css', version: '8.0.1', file: 'c.css' }], [tw]);
    }).toThrow('CSS licence banner without a declared package: normalize.css@8.0.1 (c.css)');
  });

  it('fails on a version mismatch, both ways', () => {
    expect(() => {
      checkCssPackages([{ ...banner, version: '4.4.0' }], [tw]);
    }).toThrow(
      'without a declared package: tailwindcss@4.4.0 (a.css); declared CSS package not in the built CSS: tailwindcss@4.3.5'
    );
  });

  it('fails naming a declared package whose banner never appeared', () => {
    expect(() => {
      checkCssPackages([], [tw]);
    }).toThrow('declared CSS package not in the built CSS: tailwindcss@4.3.5');
  });
});

describe('createNoticeCollector', () => {
  const root = `${PNPM}/clsx@2.1.1/node_modules/clsx`;
  const peer = `${PNPM}/clsx@2.1.1_peer/node_modules/clsx`;
  const reader = memoryReader({
    [`${root}/package.json`]: JSON.stringify({ name: 'clsx', version: '2.1.1', license: 'MIT' }),
    [`${root}/license`]: 'clsx licence',
    [`${peer}/package.json`]: JSON.stringify({ name: 'clsx', version: '2.1.1', license: 'MIT' }),
    [`${peer}/license`]: 'clsx licence'
  });

  it('records npm modules only and renders each package version once', () => {
    const collector = createNoticeCollector(reader);
    expect(collector.empty).toBe(true);
    collector.addModules(['/repo/lib/a.ts', '\0virtual', `${root}/dist/clsx.mjs`]);
    collector.addModules([`${root}/dist/lite.mjs`, `${peer}/dist/clsx.mjs`]);
    expect(collector.empty).toBe(false);
    const text = collector.render([], {});
    expect(text.match(/clsx 2\.1\.1 \(MIT\)/g)).toHaveLength(1);
    expect(text).toContain('clsx licence');
  });

  it('adds the vendored entries and applies the missing-text table', () => {
    const collector = createNoticeCollector(reader);
    collector.addModules([`${root}/dist/clsx.mjs`]);
    const vendored: PackageNotice = { name: 'v', version: '1', license: 'MIT', text: null };
    expect(() => collector.render([vendored], {})).toThrow('no licence text for v');
    expect(collector.render([vendored], { v: 'V text' })).toContain('V text');
  });

  it('adds the declared CSS packages once their banners were recorded', () => {
    const tw = '/repo/node_modules/tailwindcss';
    const cssReader = memoryReader({
      [`${tw}/package.json`]: JSON.stringify({
        name: 'tailwindcss',
        version: '4.3.5',
        license: 'MIT'
      }),
      [`${tw}/LICENSE`]: 'tailwind licence'
    });
    const collector = createNoticeCollector(cssReader);
    expect(() => collector.render([], {}, [tw])).toThrow('declared CSS package not in the built');
    collector.addCss('a.css', '/*! tailwindcss v4.3.5 | MIT License */');
    expect(collector.render([], {}, [tw])).toContain('tailwindcss 4.3.5 (MIT)');
    // A banner with no declared package fails the render.
    expect(() => collector.render([], {})).toThrow('without a declared package: tailwindcss@4.3.5');
  });

  it('reset forgets the previous build', () => {
    const collector = createNoticeCollector(reader);
    collector.addModules([`${root}/dist/clsx.mjs`]);
    collector.addCss('a.css', '/*! x v1.0.0 | MIT License */');
    collector.reset();
    expect(collector.empty).toBe(true);
    expect(collector.render([], {})).not.toContain('clsx');
  });

  it('its plugin records chunk module ids and the banners of CSS assets only', () => {
    const collector = createNoticeCollector(reader);
    const plugin = collector.plugin();
    const generate = plugin.generateBundle as (o: unknown, bundle: unknown) => void;
    const banner = '/*! x v1.0.0 | MIT License */';
    generate.call(
      {},
      {},
      {
        'b.css': {
          type: 'asset',
          fileName: 'b.css',
          moduleIds: [`${root}/x`],
          source: new TextEncoder().encode(banner)
        }
      }
    );
    generate.call(
      {},
      {},
      { 'c.svg': { type: 'asset', fileName: 'c.svg', source: '/*! y v1.0.0 | MIT License */' } }
    );
    expect(collector.empty).toBe(true);
    expect(() => collector.render([], {})).toThrow('without a declared package: x@1.0.0 (b.css)');
    generate.call({}, {}, { 'a.js': { type: 'chunk', moduleIds: [`${root}/dist/clsx.mjs`] } });
    expect(collector.empty).toBe(false);
    expect(plugin.name).toBe('wpr-fdt:third-party-notices');
  });
});
