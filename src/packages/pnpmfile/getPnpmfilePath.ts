import path from 'node:path'

export function getOspmfilePath (prefix: string, ospmfile?: string | undefined): string {
  if (!ospmfile) {
    ospmfile = '.ospmfile.cjs'
  } else if (path.isAbsolute(ospmfile)) {
    return ospmfile
  }
  return path.join(prefix, ospmfile)
}
