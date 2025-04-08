const WORKSPACE_PREF_REGEX =
  // eslint-disable-next-line optimize-regex/optimize-regex, es-x/no-regexp-named-capture-groups
  /^workspace:(?:(?<alias>[^._/][^@]*)@)?(?<version>.*)$/;

export class WorkspaceSpec {
  alias?: string | undefined;
  version: string;

  constructor(version: string, alias?: string | undefined) {
    this.version = version;
    this.alias = alias;
  }

  static parse(pref: string): WorkspaceSpec | null {
    const parts = WORKSPACE_PREF_REGEX.exec(pref);

    if (typeof parts?.groups?.version === 'undefined') {
      return null;
    }

    return new WorkspaceSpec(parts.groups.version, parts.groups.alias);
  }

  toString(): `workspace:${string}` {
    const { alias, version } = this;

    return typeof alias === 'string'
      ? `workspace:${alias}@${version}`
      : `workspace:${version}`;
  }
}
