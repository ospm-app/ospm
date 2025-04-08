// cspell:ignore sshurl
import urlLib, { URL } from 'node:url';
import { fetchWithAgent } from '../fetch/index.ts';
import type { AgentOptions } from '../network.agent/index.ts';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import git from 'graceful-git';
import HostedGit from 'hosted-git-info';

export type HostedPackageSpec = {
  fetchSpec: string;
  hosted?:
    | {
        type: string;
        user: string;
        project: string;
        committish: string;
        tarball?: (() => string | undefined) | undefined;
      }
    | undefined;
  normalizedPref: string;
  gitCommittish: string | null;
  gitRange?: string | undefined;
  path?: string | undefined;
};

const gitProtocols = new Set([
  'git',
  'git+http',
  'git+https',
  'git+rsync',
  'git+ftp',
  'git+file',
  'git+ssh',
  'ssh',
]);

export async function parsePref(
  pref: string,
  opts: AgentOptions
): Promise<HostedPackageSpec | null> {
  const hosted = HostedGit.fromUrl(pref);

  if (hosted != null) {
    return fromHostedGit(hosted, opts);
  }

  const colonsPos = pref.indexOf(':');

  if (colonsPos === -1) {
    return null;
  }

  const protocol = pref.slice(0, colonsPos);

  if (protocol && gitProtocols.has(protocol.toLocaleLowerCase())) {
    const correctPref = correctUrl(pref);

    const url = new URL(correctPref);

    if (!url.protocol) {
      return null;
    }

    const hash =
      url.hash.length > 1 ? decodeURIComponent(url.hash.slice(1)) : null;

    return {
      fetchSpec: urlToFetchSpec(url),
      normalizedPref: pref,
      ...parseGitParams(hash),
    };
  }

  return null;
}

function urlToFetchSpec(url: URL): string {
  url.hash = '';
  const fetchSpec = urlLib.format(url);
  if (fetchSpec.startsWith('git+')) {
    return fetchSpec.slice(4);
  }
  return fetchSpec;
}

async function fromHostedGit(
  hosted: HostedGit,
  agentOptions: AgentOptions
): Promise<HostedPackageSpec> {
  let fetchSpec: string | null = null;

  // try git/https url before fallback to ssh url
  const gitHttpsUrl = hosted.https({ noCommittish: true, noGitPlus: true });

  if (
    typeof gitHttpsUrl === 'string' &&
    (await isRepoPublic(gitHttpsUrl, agentOptions)) &&
    (await accessRepository(gitHttpsUrl))
  ) {
    fetchSpec = gitHttpsUrl;
  } else {
    const gitSshUrl = hosted.ssh({ noCommittish: true });

    if (typeof gitSshUrl === 'string' && (await accessRepository(gitSshUrl))) {
      fetchSpec = gitSshUrl;
    }
  }

  if (fetchSpec === null || fetchSpec === '') {
    const httpsUrl: string | null = hosted.https({
      noGitPlus: true,
      noCommittish: true,
    });

    if (httpsUrl !== '') {
      if (
        (typeof hosted.auth === 'string' ||
          !(await isRepoPublic(httpsUrl, agentOptions))) &&
        (await accessRepository(httpsUrl))
      ) {
        return {
          fetchSpec: httpsUrl,
          hosted: {
            ...hosted,
            // TODO: _fill is not typed
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            _fill: hosted._fill,
            tarball: undefined,
          },
          normalizedPref: `git+${httpsUrl}`,
          ...parseGitParams(hosted.committish ?? null),
        };
      }

      try {
        // when git ls-remote private repo, it asks for login credentials.
        // use HTTP HEAD request to test whether this is a private repo, to avoid login prompt.
        // this is very similar to yarn classic's behavior.
        // npm instead tries git ls-remote directly which prompts user for login credentials.

        // HTTP HEAD on https://domain/user/repo, strip out ".git"
        const response = await fetchWithAgent(httpsUrl.replace(/\.git$/, ''), {
          method: 'HEAD',
          follow: 0,
          retry: { retries: 0 },
          agentOptions,
        });
        if (response.ok) {
          fetchSpec = httpsUrl;
        }
      } catch {
        // ignore
      }
    }
  }

  if (fetchSpec === null || fetchSpec === '') {
    // use ssh url for likely private repo
    fetchSpec = hosted.sshurl({ noCommittish: true });
  }

  return {
    fetchSpec,
    hosted: {
      ...hosted,
      // TODO: _fill is not typed
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      _fill: hosted._fill,
      tarball: hosted.tarball,
    },
    normalizedPref: hosted.shortcut(),
    ...parseGitParams(hosted.committish ?? null),
  };
}

async function isRepoPublic(
  httpsUrl: string,
  agentOptions: AgentOptions
): Promise<boolean> {
  try {
    const response = await fetchWithAgent(httpsUrl.replace(/\.git$/, ''), {
      method: 'HEAD',
      follow: 0,
      retry: { retries: 0 },
      agentOptions,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function accessRepository(repository: string): Promise<boolean> {
  try {
    await git(['ls-remote', '--exit-code', repository, 'HEAD'], { retries: 0 });
    return true;
  } catch {
    return false;
  }
}

type GitParsedParams = Pick<
  HostedPackageSpec,
  'gitCommittish' | 'gitRange' | 'path'
>;

function parseGitParams(committish: string | null): GitParsedParams {
  const result: GitParsedParams = { gitCommittish: null };

  if (committish === null || committish === '') {
    return result;
  }

  const params = committish.split('&');

  for (const param of params) {
    if (param.length >= 7 && param.slice(0, 7) === 'semver:') {
      result.gitRange = param.slice(7);
    } else if (param.slice(0, 5) === 'path:') {
      result.path = param.slice(5);
    } else {
      result.gitCommittish = param;
    }
  }

  return result;
}

// handle SCP-like URLs
// see https://github.com/yarnpkg/yarn/blob/5682d55/src/util/git.js#L103
function correctUrl(gitUrl: string): string {
  const parsed = urlLib.parse(gitUrl.replace(/^git\+/, '')); // eslint-disable-line n/no-deprecated-api

  if (
    parsed.protocol === 'ssh:' &&
    typeof parsed.hostname === 'string' &&
    parsed.hostname !== '' &&
    typeof parsed.pathname === 'string' &&
    parsed.pathname !== '' &&
    parsed.pathname.startsWith('/:') &&
    parsed.port === null
  ) {
    parsed.pathname = parsed.pathname.replace(/^\/:/, '');
    return urlLib.format(parsed);
  }

  return gitUrl;
}
