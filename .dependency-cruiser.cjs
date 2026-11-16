/** Architecture rules, checked before every push. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { pathNot: '\\.d\\.ts$' } },
    },
    {
      name: 'ui-must-not-touch-database',
      comment: 'Pages and components reach data through services, never the database client.',
      severity: 'error',
      from: { path: '^(app|components|lib)/' },
      to: { path: '^server/(db/(client|generated)|modules/[^/]+/repo)' },
    },
    {
      name: 'repos-only-from-their-own-module',
      comment: 'A module’s repository is private to that module; other modules call its service.',
      severity: 'error',
      from: { path: '^server/modules/([^/]+)/' },
      to: { path: '^server/modules/[^/]+/repo', pathNot: '^server/modules/$1/repo' },
    },
    {
      name: 'repos-only-inside-modules',
      comment: 'Outside the modules, code calls services; repositories stay internal.',
      severity: 'error',
      from: { path: '^server/', pathNot: ['^server/modules/', '\\.test\\.ts$'] },
      to: { path: '^server/modules/[^/]+/repo' },
    },
    {
      name: 'database-client-only-in-repos',
      severity: 'error',
      from: {
        path: '^server/',
        pathNot: [
          '^server/db/',
          '^server/modules/[^/]+/repo\\.ts$',
          '^server/auth/index\\.ts$',
          '\\.test\\.ts$',
        ],
      },
      to: { path: '^server/db/(client|generated)' },
    },
    {
      name: 'ui-kit-stays-pure',
      comment: 'Design-system components do not know about the server.',
      severity: 'error',
      from: { path: '^components/ui/' },
      to: { path: '^server/' },
    },
    {
      name: 'tanstack-db-behind-data-hooks',
      comment:
        'TanStack DB is pre-1.0. UI code uses the hooks in lib/data, so the engine behind them ' +
        'can be swapped for TanStack Query without touching components.',
      severity: 'error',
      from: { pathNot: ['^lib/data/', '^components/providers/index\\.tsx$'] },
      to: { path: 'node_modules/@tanstack/(react-db|db|query-db-collection)/' },
    },
    {
      name: 'devtools-only-in-dev-panel',
      comment: 'Devtools are dev dependencies, loaded only by the development-only panel.',
      severity: 'error',
      from: { pathNot: '^components/providers/devtools\\.tsx$' },
      to: { path: 'node_modules/@tanstack/[^/]*devtools[^/]*/' },
    },
    {
      name: 'no-test-code-in-app',
      severity: 'error',
      from: { pathNot: '(^tests/|\\.test\\.tsx?$|\\.spec\\.tsx?$|^vitest|^playwright)' },
      to: { path: '(^tests/|\\.test\\.tsx?$|\\.spec\\.tsx?$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // node_modules stays in the graph as leaves (see doNotFollow) so rules can name packages.
    exclude: { path: '(^\\.next/|^server/db/generated/|^docs/|^design/)' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
