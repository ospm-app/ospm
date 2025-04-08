import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import HostedGit from 'hosted-git-info';
import validatePackageName from 'validate-npm-package-name';
import semver from 'semver';

// @ts-expect-error Element implicitly has an 'any' type because type 'typeof globalThis' has no index signature.ts(7017)
const isWindows: boolean = process.platform === 'win32' || global.FAKE_WINDOWS;

const hasSlashes = isWindows ? /[/\\]/ : /\//;

const isURL = /^(?:git\+)?[a-z]+:/i;

const isFilename = /\.(?:tgz|tar.gz|tar)$/i;

export function npa(arg: Result | string, where?: string | undefined): Result {
  let name: string | undefined;
  let spec: string | undefined;

  if (typeof arg === 'object') {
    if (
      arg instanceof Result &&
      (typeof where === 'undefined' || where === arg.where)
    ) {
      return arg;
    }

    if (typeof arg.name !== 'undefined' && arg.rawSpec) {
      return resolve(arg.name, arg.rawSpec, where ?? arg.where);
    }

    return npa(arg.raw ?? '', where ?? arg.where);
  }

  const nameEndsAt = arg.startsWith('@')
    ? arg.slice(1).indexOf('@') + 1
    : arg.indexOf('@');

  const namePart = nameEndsAt > 0 ? arg.slice(0, nameEndsAt) : arg;

  if (isURL.test(arg)) {
    spec = arg;
  } else if (
    !namePart.startsWith('@') &&
    (hasSlashes.test(namePart) || isFilename.test(namePart))
  ) {
    spec = arg;
  } else if (nameEndsAt > 0) {
    name = namePart;

    spec = arg.slice(nameEndsAt + 1);
  } else {
    const valid = validatePackageName(arg);

    if (valid.validForOldPackages) {
      name = arg;
    } else {
      spec = arg;
    }
  }

  return resolve(name, spec, where, arg);
}

const isFilespec = isWindows
  ? /^(?:\.|~\/|[/\\]|[A-Za-z]:)/
  : /^(?:\.|~\/|\/|[A-Za-z]:)/;

export function resolve(
  name?: string | undefined,
  spec?: string | undefined,
  where?: string | undefined,
  arg?: string | undefined
): Result {
  const res = new Result({
    name,
    raw: arg,
    rawSpec: spec,
    fromArgument: typeof arg !== 'undefined',
  });

  if (typeof name === 'string') {
    res.setName(name);
  }

  if (
    typeof spec === 'string' &&
    (isFilespec.test(spec) || /^file:/i.test(spec))
  ) {
    return fromFile(res, where);
  }

  if (typeof spec === 'string' && spec.startsWith('npm:')) {
    return Object.assign<
      Result,
      {
        alias?: string | undefined;
        raw?: string | undefined;
        rawSpec: string;
      }
    >(npa(spec.substr(4), where), {
      alias: name,
      raw: res.raw,
      rawSpec: res.rawSpec,
    });
  }

  if (typeof spec === 'string') {
    const hosted = HostedGit.fromUrl(spec, {
      noGitPlus: true,
      noCommittish: true,
    });

    if (typeof hosted !== 'undefined') {
      return fromHostedGit(res, hosted);
    }
  }

  if (typeof spec === 'string' && isURL.test(spec)) {
    return fromURL(res);
  }

  if (
    typeof spec === 'string' &&
    (hasSlashes.test(spec) || isFilename.test(spec))
  ) {
    return fromFile(res, where);
  }

  return fromRegistry(res);
}

function invalidPackageName(name: string, valid: { errors: string[] }): Error {
  const err = new Error(
    `Invalid package name "${name}": ${valid.errors.join('; ')}`
  );

  // @ts-expect-error Property 'code' does not exist on type 'Error'.ts(2339)
  err.code = 'EINVALIDPACKAGENAME';

  return err;
}

function invalidTagName(name: string): Error {
  const err = new Error(
    `Invalid tag name "${name}": Tags may not have any characters that encodeURIComponent encodes.`
  );

  // @ts-expect-error Property 'code' does not exist on type 'Error'.ts(2339)
  err.code = 'EINVALIDTAGNAME';

  return err;
}

export class Result {
  type?: string | undefined;
  registry?: boolean | undefined;
  where?: string | undefined;
  raw?: string | undefined;
  name?: string | undefined;
  escapedName?: string | undefined;
  scope?: string | undefined;
  rawSpec: string;
  saveSpec?: string | undefined;
  fetchSpec?: string | undefined;
  gitRange?: string | undefined;
  gitCommittish?: string | undefined;
  hosted?: HostedGit | undefined;

  constructor(opts: {
    type?: string | undefined;
    registry?: boolean | undefined;
    where?: string | undefined;
    raw?: string | undefined;
    name?: string | undefined;
    rawSpec?: string | undefined;
    saveSpec?: string | undefined;
    fetchSpec?: string | undefined;
    gitRange?: string | undefined;
    gitCommittish?: string | undefined;
    hosted?: HostedGit | undefined;
    fromArgument?: boolean | undefined;
  }) {
    this.type = opts.type;
    this.registry = opts.registry;
    this.where = opts.where;

    if (typeof opts.raw === 'undefined') {
      this.raw =
        typeof opts.name === 'string'
          ? `${opts.name}@${opts.rawSpec}`
          : opts.rawSpec;
    } else {
      this.raw = opts.raw;
    }

    this.name = undefined;
    this.escapedName = undefined;
    this.scope = undefined;

    this.rawSpec = typeof opts.rawSpec === 'undefined' ? '' : opts.rawSpec;
    this.saveSpec = opts.saveSpec;
    this.fetchSpec = opts.fetchSpec;

    if (typeof opts.name !== 'undefined') {
      this.setName(opts.name);
    }

    this.gitRange = opts.gitRange;
    this.gitCommittish = opts.gitCommittish;
    this.hosted = opts.hosted;
  }

  setName(name: string): Result {
    const valid = validatePackageName(name);

    if (!valid.validForOldPackages) {
      throw invalidPackageName(name, valid);
    }

    this.name = name;

    this.scope = name.startsWith('@')
      ? name.slice(0, name.indexOf('/'))
      : undefined;

    // scoped packages in couch must have slash url-encoded, e.g. @foo%2Fbar
    this.escapedName = name.replace('/', '%2f');

    return this;
  }

  toString(): string | undefined {
    const full = [];

    if (this.name != null && this.name !== '') {
      full.push(this.name);
    }

    const spec = this.saveSpec ?? this.fetchSpec ?? this.rawSpec;

    if (typeof spec !== 'undefined' && spec !== '') {
      full.push(spec);
    }

    return full.length ? full.join('@') : this.raw;
  }

  toJSON(): Result {
    const result = Object.assign({}, this);

    // biome-ignore lint/performance/noDelete: <explanation>
    delete result.hosted;

    return result;
  }
}

function setGitCommittish(res: Result, committish: string | undefined): Result {
  if (
    committish != null &&
    committish.length >= 7 &&
    committish.slice(0, 7) === 'semver:'
  ) {
    res.gitRange = decodeURIComponent(committish.slice(7));
    res.gitCommittish = undefined;
  } else {
    res.gitCommittish = committish === '' ? undefined : committish;
  }

  return res;
}

const isAbsolutePath = /^\/|^[A-Za-z]:/;

function resolvePath(where: string, spec: string): string {
  if (isAbsolutePath.test(spec)) {
    return spec;
  }

  return path.resolve(where, spec);
}

function isAbsolute(dir: string): boolean {
  if (dir.startsWith('/')) {
    return true;
  }

  if (/^[A-Za-z]:/.test(dir)) {
    return true;
  }

  return false;
}

function fromFile(res: Result, where?: string | undefined) {
  let newWhere = where;

  if (typeof newWhere === 'undefined') {
    newWhere = process.cwd();
  }

  res.type = isFilename.test(res.rawSpec) ? 'file' : 'directory';

  res.where = newWhere;

  const spec = res.rawSpec
    .replace(/\\/g, '/')
    .replace(/^file:\/*([A-Za-z]:)/, '$1') // drive name paths on windows
    .replace(/^file:(?:\/*([./~]))?/, '$1');

  if (/^~\//.test(spec)) {
    // this is needed for windows and for file:~/foo/bar

    res.fetchSpec = resolvePath(os.homedir(), spec.slice(2));

    res.saveSpec = `file:${spec}`;
  } else {
    res.fetchSpec = resolvePath(newWhere, spec);

    res.saveSpec = isAbsolute(spec)
      ? `file:${spec}`
      : `file:${path.relative(newWhere, res.fetchSpec)}`;
  }

  return res;
}

function fromHostedGit(res: Result, hosted: HostedGit) {
  res.type = 'git';

  res.hosted = hosted;

  res.saveSpec = hosted.toString({ noGitPlus: false, noCommittish: false });

  res.fetchSpec =
    hosted.getDefaultRepresentation() === 'shortcut'
      ? undefined
      : hosted.toString();

  return setGitCommittish(res, hosted.committish);
}

function unsupportedURLType(protocol: string | null, spec: string) {
  const err = new Error(`Unsupported URL Type "${protocol ?? ''}": ${spec}`);

  // @ts-expect-error Property 'code' does not exist on type 'Error'.ts(2339)
  err.code = 'EUNSUPPORTEDPROTOCOL';

  return err;
}

function matchGitScp(
  spec: string
):
  | false
  | { fetchSpec: string | undefined; gitCommittish: string | undefined }
  | null {
  // git ssh specifiers are overloaded to also use scp-style git
  // specifiers, so we have to parse those out and treat them special.
  // They are NOT true URIs, so we can't hand them to `url.parse`.
  //
  // This regex looks for things that look like:
  // git+ssh://git@my.custom.git.com:username/project.git#deadbeef
  //
  // ...and various combinations. The username in the beginning is *required*.
  const matched = spec.match(
    /^git\+ssh:\/\/([^#:]+:[^#]+(?:\.git)?)(?:#(.*))?$/i
  );

  return (
    matched &&
    !matched[1]?.match(/:\d+\/?.*$/i) && {
      fetchSpec: matched[1],
      gitCommittish: matched[2] ?? undefined,
    }
  );
}

function fromURL(res: Result): Result {
  const urlparse = new URL(res.rawSpec);

  res.saveSpec = res.rawSpec;
  // check the protocol, and then see if it's git or not

  switch (urlparse.protocol) {
    case 'git:':
    case 'git+http:':
    case 'git+https:':
    case 'git+rsync:':
    case 'git+ftp:':
    case 'git+file:':
    case 'git+ssh:': {
      res.type = 'git';

      const match =
        urlparse.protocol === 'git+ssh:' && matchGitScp(res.rawSpec);

      if (typeof match === 'object' && match !== null) {
        res.fetchSpec = match.fetchSpec;
        res.gitCommittish = match.gitCommittish;
      } else {
        setGitCommittish(
          res,
          typeof urlparse.hash === 'undefined' ? '' : urlparse.hash.slice(1)
        );

        urlparse.protocol = urlparse.protocol.replace(/^git\+/, '');

        // @ts-expect-error The operand of a 'delete' operator must be optional.ts(2790)
        // biome-ignore lint/performance/noDelete: <explanation>
        delete urlparse.hash;

        res.fetchSpec = urlparse.toString();
      }

      break;
    }

    case 'http:':
    case 'https:': {
      res.type = 'remote';
      res.fetchSpec = res.saveSpec;
      break;
    }

    default: {
      throw unsupportedURLType(urlparse.protocol, res.rawSpec);
    }
  }

  return res;
}

function fromRegistry(res: Result): Result {
  res.registry = true;

  const spec = res.rawSpec === '' ? 'latest' : res.rawSpec;

  // no save spec for registry components as we save based on the fetched
  // version, not on the argument so this can't compute that.
  res.saveSpec = undefined;

  res.fetchSpec = spec;

  const version = semver.valid(spec, true);

  const range = semver.validRange(spec, true);

  if (version !== null) {
    res.type = 'version';
  } else if (range !== null) {
    res.type = 'range';
  } else {
    if (encodeURIComponent(spec) !== spec) {
      throw invalidTagName(spec);
    }

    res.type = 'tag';
  }

  return res;
}
