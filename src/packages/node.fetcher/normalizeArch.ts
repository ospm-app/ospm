export function getNormalizedArch(
  platform: string,
  arch: string,
  nodeVersion?: string
): string {
  if (typeof nodeVersion === 'string') {
    const nodeMajorVersion = +(nodeVersion.split('.')[0] ?? '1');
    if (platform === 'darwin' && arch === 'arm64' && nodeMajorVersion < 16) {
      return 'x64';
    }
  }

  if (platform === 'win32' && arch === 'ia32') {
    return 'x86';
  }

  if (arch === 'arm') {
    return 'armv7l';
  }

  return arch;
}
