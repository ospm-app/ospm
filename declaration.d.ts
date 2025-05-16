declare module 'npm-packlist' {
  function npmPacklist (opts: { path: string, packageJsonCache?: Map<string, string | { files: string[]; }> }): Promise<string[]>
  export = npmPacklist
}
