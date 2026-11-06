import solid from 'eslint-plugin-solid';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import wxtAutoImports from './.wxt/eslint-auto-imports.mjs';

// Dependencies whose roles are covered by committed, lighter alternatives
// (CSS motion, the ~30-line hash router, the local toast store, shiki). Importing
// them is a mistake — they bloat bundles or pull in React-only peers.
const bannedDependencies = [
  {
    group: ['framer-motion', 'framer-motion/*'],
    message:
      'Animation is CSS transitions/keyframes (prefers-reduced-motion is handled in the token stylesheet).'
  },
  {
    group: ['wouter', 'wouter/*'],
    message: 'Routing is the local hash router from the panel shell; no router library.'
  },
  {
    group: ['react-hot-toast'],
    message: 'Toasts are the local toast store + components/ui/toast.'
  },
  {
    group: ['react-syntax-highlighter'],
    message: 'Code highlighting is shiki (fine-grained bundle, dynamically imported, panel-only).'
  }
];

// WP Rocket's beacon package: one adapter owns its internals, and only the
// lazily injected runner bundle may carry its bytes (relieved for that file
// in the last block below).
const beaconPackageMessage =
  'wp-rocket-scripts is imported only by entrypoints/beacon-runner/beacon-adapter.ts (the one adapter; its bundle loads on a test run only).';
const beaconPackageRestriction = {
  group: ['wp-rocket-scripts', 'wp-rocket-scripts/*'],
  message: beaconPackageMessage
};

// `no-restricted-imports` never sees `import()`: the same ban for dynamic
// imports (a string or template source), everywhere — the adapter imports
// statically, so no file is relieved. No other block sets this rule, so it
// cannot be overridden away.
const beaconDynamicImportRestriction = [
  {
    selector: 'ImportExpression[source.value=/^wp-rocket-scripts(\\/|$)/]',
    message: beaconPackageMessage
  },
  {
    selector:
      "ImportExpression[source.type='TemplateLiteral'][source.quasis.0.value.cooked=/^wp-rocket-scripts(\\/|$)/]",
    message: beaconPackageMessage
  }
];

// The extension namespace: the build resolves every `browser` import through
// the project's clobber-proof resolver (wxt.config.ts aliases
// `@wxt-dev/browser` to utils/extension-api), which also pins the genuine
// `chrome` global. Code keeps the auto-imported `browser` (the test runner
// maps it to the fake browser); importing the resolver or the package, or
// reading either global off the window, would bypass one or the other.
const extensionApiMessage =
  'Use the auto-imported `browser` (wxt/browser): the build resolves it through utils/extension-api, which a page cannot clobber.';
const extensionApiModuleRegex = '(^|/)utils/extension-api(/|$)';

// Its own rule name (`@typescript-eslint/no-restricted-imports`), so the
// per-layer `no-restricted-imports` blocks below cannot drop it. Covers
// `import`, `export … from` and `export * from`; type-only imports are erased.
const extensionApiImportRule = [
  'error',
  {
    paths: [{ name: '@wxt-dev/browser', message: extensionApiMessage, allowTypeImports: true }],
    patterns: [{ regex: extensionApiModuleRegex, message: extensionApiMessage }]
  }
];

const extensionApiDynamicImportRestriction = [
  {
    selector: `ImportExpression[source.value=/^@wxt-dev\\/browser$|${extensionApiModuleRegex.replaceAll('/', '\\/')}/]`,
    message: extensionApiMessage
  },
  {
    selector: `ImportExpression[source.type='TemplateLiteral'][source.quasis.0.value.cooked=/^@wxt-dev\\/browser|${extensionApiModuleRegex.replaceAll('/', '\\/')}/]`,
    message: extensionApiMessage
  }
];

// Reading `browser`/`chrome` off the global, plain (`globalThis.chrome`,
// `window['browser']`, `self?.chrome`) or through up to two wrappers: a cast
// (`(globalThis as X).chrome`, `(<X>window).chrome`, `globalThis!.browser`)
// or a comma sequence yielding its last operand (`(0, globalThis).chrome`).
// Plain destructuring (`const { chrome } = globalThis`) is
// no-restricted-properties'; a cast one is the last selector.
const extensionApiGlobals = ['globalThis', 'window', 'self'];
const extensionApiNames = ['browser', 'chrome'];
const globalObject = `/^(${extensionApiGlobals.join('|')})$/`;
const namedProperty = `:matches([computed=false][property.name=/^(${extensionApiNames.join('|')})$/], [computed=true][property.value=/^(${extensionApiNames.join('|')})$/])`;
const tsWrapper = '/^TS((As|Satisfies|NonNull)Expression|TypeAssertion)$/';
const castNode = `[type=${tsWrapper}]`;
const sequenceNode = 'SequenceExpression';

/**
 * Selector for a named `browser`/`chrome` read whose object is a global
 * behind `wrappers` (outermost first). Child combinators walk the operand
 * chain; under a sequence only the last operand (`:last-child`) is the value.
 * A wrapper child of the read can only be its object: a named property is an
 * Identifier or a string literal.
 * @param {string[]} wrappers - `castNode`/`sequenceNode`, outermost first.
 * @returns {string} The esquery selector, matching the global Identifier.
 */
const wrappedGlobalRead = (wrappers) => {
  let selector = `MemberExpression${namedProperty}`;
  let parent = '';
  for (const node of [...wrappers, `Identifier[name=${globalObject}]`]) {
    selector += ` > ${node}${parent === sequenceNode ? ':last-child' : ''}`;
    parent = node;
  }
  return selector;
};
const wrapperKinds = [castNode, sequenceNode];
const extensionApiGlobalReadRestriction = [
  `MemberExpression${namedProperty}[object.type='Identifier'][object.name=${globalObject}]`,
  ...wrapperKinds.map((outer) => wrappedGlobalRead([outer])),
  ...wrapperKinds.flatMap((outer) =>
    wrapperKinds.map((inner) => wrappedGlobalRead([outer, inner]))
  ),
  `VariableDeclarator[init.type=${tsWrapper}][init.expression.name=${globalObject}] > ObjectPattern > Property[key.name=/^(${extensionApiNames.join('|')})$/]`
].map((selector) => ({ selector, message: extensionApiMessage }));
const extensionApiGlobalRestriction = extensionApiGlobals.flatMap((object) =>
  extensionApiNames.map((property) => ({ object, property, message: extensionApiMessage }))
);

// Design-system internals: Kobalte is only allowed inside components/ui/ —
// every other surface consumes its headless primitives through the typed
// wrappers there (see AGENTS.md dependency direction + the P5B plan row).
const kobalteRestriction = {
  group: ['@kobalte/core', '@kobalte/core/*'],
  message:
    'Kobalte is the design-system layer of components/ui/ — import it only there, through components/ui wrappers.'
};

export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      '.claude/worktrees/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // WP Rocket's own LazyLoad runtime, shipped byte for byte (pinned by `parity:wp-rocket`).
      'public/wp-rocket-simulation/**/*.js'
    ]
  },

  // WXT/Solid auto-imported globals, regenerated by `wxt prepare` (postinstall).
  wxtAutoImports,

  // Plain JS (config files, build scripts).
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.eslintRecommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },

  // Application code — strict, type-aware, with SolidJS-specific rules.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, solid.configs['flat/typescript']],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser }
    },
    rules: {
      // tsconfig enables verbatimModuleSyntax — keep type-only imports explicit.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-imports': [
        'error',
        { patterns: [...bannedDependencies, beaconPackageRestriction, kobalteRestriction] }
      ],
      '@typescript-eslint/no-restricted-imports': extensionApiImportRule,
      'no-restricted-syntax': [
        'error',
        ...beaconDynamicImportRestriction,
        ...extensionApiDynamicImportRestriction
      ]
    }
  },

  // Shipped code never reads the namespace global (the e2e tier does, in
  // pages it drives, to stamp both namespaces). MAIN-world scripts are
  // exempt: they have no extension API, and `window.chrome` there is the
  // page's own object (the strict block's import bans still apply).
  {
    files: ['{entrypoints,components,lib,utils}/**/*.{ts,tsx}'],
    ignores: [
      'entrypoints/{main-world,ua-identity}.content.ts',
      'entrypoints/{main-world,ua-identity}/**'
    ],
    rules: {
      'no-restricted-properties': ['error', ...extensionApiGlobalRestriction],
      // The strict block's selectors restated: last matching config wins.
      'no-restricted-syntax': [
        'error',
        ...beaconDynamicImportRestriction,
        ...extensionApiDynamicImportRestriction,
        ...extensionApiGlobalReadRestriction
      ]
    }
  },

  // …except inside the design system itself, which owns the primitives.
  // Placed right after the strict block so the per-layer blocks below (this
  // file's order = last matching config wins) still tighten their scopes.
  // The entrypoint ban survives: only Kobalte is relieved, the layer order
  // (components → lib → utils, never entrypoints) is not negotiable here.
  {
    files: ['components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...bannedDependencies,
            beaconPackageRestriction,
            { group: ['**/entrypoints/**'], message: 'components/ui must not import entrypoints/.' }
          ]
        }
      ]
    }
  },

  // Layered dependency direction (see AGENTS.md):
  // entrypoints/ → components/ → lib/ → utils/, never upward.
  // Entryoints must not import each other — shared code belongs in components/ or lib/.
  {
    files: ['entrypoints/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...bannedDependencies,
            beaconPackageRestriction,
            {
              group: ['**/entrypoints/**'],
              message:
                'Cross-entrypoint imports are not allowed — promote shared code to components/ or lib/.'
            },
            kobalteRestriction
          ]
        }
      ]
    }
  },
  {
    files: ['components/**/*.{ts,tsx}'],
    ignores: [
      // The design-system layer owns Kobalte by itself (the block above).
      'components/ui/**'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...bannedDependencies,
            beaconPackageRestriction,
            { group: ['**/entrypoints/**'], message: 'components/ must not import entrypoints/.' },
            kobalteRestriction
          ]
        }
      ]
    }
  },
  {
    files: ['lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...bannedDependencies,
            beaconPackageRestriction,
            {
              group: ['**/entrypoints/**', '**/components/**'],
              message: 'Dependency direction: lib/ must not import entrypoints/ or components/.'
            },
            kobalteRestriction
          ]
        }
      ]
    }
  },
  {
    files: ['utils/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...bannedDependencies,
            beaconPackageRestriction,
            {
              group: ['**/entrypoints/**', '**/components/**', '**/lib/**'],
              message:
                'Dependency direction: utils/ must not import entrypoints/, components/ or lib/.'
            },
            kobalteRestriction
          ]
        }
      ]
    }
  },

  // The test-only reference engine (lib/detection/reference) is deliberately
  // legacy-shaped (loose untyped payloads are part of the replicated
  // semantics). It must never import the port's logic — importing the engine
  // under test would make the parity harness circular and meaningless — so the
  // only upward imports allowed are the shared footprint vocabulary
  // (lib/wp-rocket/constants, its values literal-pinned by their own tests)
  // and the shared contract types (lib/wp-rocket/types, type-only, erased at
  // runtime). Loose typing stays; this one guard stays on. (Placed after the
  // strict block on purpose: last matching config wins.)
  {
    files: ['lib/detection/reference/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            beaconPackageRestriction,
            {
              // Any relative import reaching upward (`../` the port's
              // detection modules, `../../` the rest of lib/) except the two
              // shared modules above.
              regex: '^(?!(?:\\.\\./)+wp-rocket/(constants|types)$)(?:\\.{1,2}/)+',
              message:
                'The reference engine is an independent behavioral baseline: the only shared modules it may import are lib/wp-rocket/constants and lib/wp-rocket/types (types-only) — never the port logic it is compared against.'
            }
          ]
        }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off'
    }
  },

  // The beacon adapter is the one importer of wp-rocket-scripts (see
  // beaconPackageRestriction) — its test too, to run the real package, and
  // the beacon test's end-to-end test, to prove the package's prototype is
  // never patched (tests ship in no bundle); every other entrypoint rule
  // stays on.
  {
    files: [
      'entrypoints/beacon-runner/beacon-adapter.ts',
      'entrypoints/beacon-runner/beacon-adapter.test.ts',
      'entrypoints/isolated.content/beacon-test/integration.test.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...bannedDependencies,
            {
              group: ['**/entrypoints/**'],
              message:
                'Cross-entrypoint imports are not allowed — promote shared code to components/ or lib/.'
            },
            kobalteRestriction
          ]
        }
      ]
    }
  }
);
