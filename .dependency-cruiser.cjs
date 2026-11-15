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
      name: 'no-test-code-in-app',
      severity: 'error',
      from: { pathNot: '(^tests/|\\.test\\.tsx?$|\\.spec\\.tsx?$|^vitest|^playwright)' },
      to: { path: '(^tests/|\\.test\\.tsx?$|\\.spec\\.tsx?$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^\\.next/|^node_modules/|^server/db/generated/|^docs/|^design/)' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
