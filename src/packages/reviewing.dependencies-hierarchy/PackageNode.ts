export type PackageNode = {
  alias: string;
  circular?: true | undefined;
  dependencies?: PackageNode[] | undefined;
  dev?: boolean | undefined;
  isPeer: boolean;
  isSkipped: boolean;
  isMissing: boolean;
  name: string;
  optional?: true | undefined;
  path: string;
  resolved?: string | undefined;
  searched?: true | undefined;
  version: string;
};
