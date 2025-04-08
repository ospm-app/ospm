// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import nerfDart from 'nerf-dart';

function getMaxParts(uris: string[]): number {
  return uris.reduce((max: number, uri: string): number => {
    const parts = uri.split('/').length;

    return parts > max ? parts : max;
  }, 0);
}

export function pickSettingByUrl<T>(
  generic: { [key: string]: T } | undefined,
  uri: string
): T | undefined {
  if (!generic) {
    return undefined;
  }

  if (typeof generic[uri] !== 'undefined') {
    return generic[uri];
  }

  const nerf = nerfDart(uri);

  const withoutPort = removePort(new URL(uri));

  if (typeof generic[nerf] !== 'undefined') {
    return generic[nerf];
  }

  if (typeof generic[withoutPort] !== 'undefined') {
    return generic[withoutPort];
  }

  const maxParts = getMaxParts(Object.keys(generic));

  const parts = nerf.split('/');

  for (let i = Math.min(parts.length, maxParts) - 1; i >= 3; i--) {
    const key = `${parts.slice(0, i).join('/')}/`;

    if (typeof generic[key] !== 'undefined') {
      return generic[key];
    }
  }

  if (withoutPort !== uri) {
    return pickSettingByUrl(generic, withoutPort);
  }

  return undefined;
}

function removePort(config: URL): string {
  if (config.port === '') {
    return config.href;
  }

  config.port = '';

  const res = config.toString();

  return res.endsWith('/') ? res : `${res}/`;
}
