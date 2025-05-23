/**
 * Catalogs parsed from the ospm-workspace.yaml file.
 *
 * https://github.com/ospm/rfcs/pull/1
 */
export type Catalogs = {
  /**
   * The default catalog.
   *
   * The default catalog can be defined in 2 ways.
   *
   *   1. Users can specify a top-level "catalog" field or,
   *   2. An explicitly named "default" catalog under the "catalogs" map.
   *
   * This field contains either definition. Note that it's an error to define
   * the default catalog using both options. The parser will fail when reading
   * the workspace manifest.
   */
  readonly default?: Catalog | undefined;

  /**
   * Named catalogs.
   */
  readonly [catalogName: string]: Catalog | undefined;
};

export type Catalog = {
  readonly [dependencyName: string]: string | undefined;
};
