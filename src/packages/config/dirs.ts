import os from 'os'
import path from 'path'

export function getCacheDir (
  opts: {
    env: NodeJS.ProcessEnv
    platform: string
  }
): string {
  if (opts.env.XDG_CACHE_HOME) {
    return path.join(opts.env.XDG_CACHE_HOME, 'ospm')
  }
  if (opts.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Caches/ospm')
  }
  if (opts.platform !== 'win32') {
    return path.join(os.homedir(), '.cache/ospm')
  }
  if (opts.env.LOCALAPPDATA) {
    return path.join(opts.env.LOCALAPPDATA, 'ospm-cache')
  }
  return path.join(os.homedir(), '.ospm-cache')
}

export function getStateDir (
  opts: {
    env: NodeJS.ProcessEnv
    platform: string
  }
): string {
  if (opts.env.XDG_STATE_HOME) {
    return path.join(opts.env.XDG_STATE_HOME, 'ospm')
  }
  if (opts.platform !== 'win32') {
    return path.join(os.homedir(), '.local/state/ospm')
  }
  if (opts.env.LOCALAPPDATA) {
    return path.join(opts.env.LOCALAPPDATA, 'ospm-state')
  }
  return path.join(os.homedir(), '.ospm-state')
}

export function getDataDir (
  opts: {
    env: NodeJS.ProcessEnv
    platform: string
  }
): string {
  if (opts.env.OSPM_HOME) {
    return opts.env.OSPM_HOME
  }
  if (opts.env.XDG_DATA_HOME) {
    return path.join(opts.env.XDG_DATA_HOME, 'ospm')
  }
  if (opts.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/ospm')
  }
  if (opts.platform !== 'win32') {
    return path.join(os.homedir(), '.local/share/ospm')
  }
  if (opts.env.LOCALAPPDATA) {
    return path.join(opts.env.LOCALAPPDATA, 'ospm')
  }
  return path.join(os.homedir(), '.ospm')
}

export function getConfigDir (
  opts: {
    env: NodeJS.ProcessEnv
    platform: string
  }
): string {
  if (opts.env.XDG_CONFIG_HOME) {
    return path.join(opts.env.XDG_CONFIG_HOME, 'ospm')
  }
  if (opts.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Preferences/ospm')
  }
  if (opts.platform !== 'win32') {
    return path.join(os.homedir(), '.config/ospm')
  }
  if (opts.env.LOCALAPPDATA) {
    return path.join(opts.env.LOCALAPPDATA, 'ospm/config')
  }
  return path.join(os.homedir(), '.config/ospm')
}
