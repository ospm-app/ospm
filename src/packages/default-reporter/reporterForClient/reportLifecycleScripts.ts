import cliTruncate from 'cli-truncate';
import path from 'node:path';
import type { LifecycleLog } from '../../core-loggers/index.ts';
import * as Rx from 'rxjs';
import {
  buffer,
  filter,
  groupBy,
  map,
  mergeAll,
  mergeMap,
} from 'rxjs/operators';
import chalk from 'chalk';
import prettyTime from 'pretty-ms';
import { EOL } from '../constants.ts';
import { formatPrefix, formatPrefixNoTrim } from './utils/formatPrefix.ts';
import { hlValue } from './outputConstants.ts';

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
const TMP_DIR_IN_STORE = `tmp${path.sep}_tmp_`; // git-hosted dependencies are built in these temporary directories

const ANSI_ESCAPES_LENGTH_OF_PREFIX = hlValue(' ').length - 1;

// When streaming processes are spawned, use this color for prefix
const colorWheel = [
  'cyan',
  'magenta',
  'blue',
  'yellow',
  'green',
  'red',
] as const;
const NUM_COLORS = colorWheel.length;

// Ever-increasing index ensures colors are always sequential
let currentColor = 0;

type ColorByPkg = Map<string, (txt: string) => string>;

export function reportLifecycleScripts(
  log$: {
    lifecycle: Rx.Observable<LifecycleLog>;
  },
  opts: {
    appendOnly?: boolean | undefined;
    aggregateOutput?: boolean | undefined;
    hideLifecyclePrefix?: boolean | undefined;
    cwd: string;
    width: number;
  }
): Rx.Observable<Rx.Observable<{ msg: string }>> {
  // When the reporter is not append-only, the length of output is limited
  // in order to reduce flickering
  if (opts.appendOnly === true) {
    let lifecycle$ = log$.lifecycle;
    if (opts.aggregateOutput === true) {
      lifecycle$ = lifecycle$.pipe(aggregateOutput);
    }

    const streamLifecycleOutput = createStreamLifecycleOutput(
      opts.cwd,
      opts.hideLifecyclePrefix === true
    );
    return lifecycle$.pipe(
      map((log: LifecycleLog) => {
        return Rx.of({
          msg: streamLifecycleOutput(log),
        });
      })
    );
  }
  const lifecycleMessages: {
    [depPath: string]: {
      collapsed: boolean;
      output: string[];
      script: string;
      startTime: [number, number];
      status: string;
    };
  } = {};
  const lifecycleStreamByDepPath: {
    [depPath: string]: Rx.Subject<{ msg: string }>;
  } = {};

  const lifecyclePushStream = new Rx.Subject<Rx.Observable<{ msg: string }>>();

  // TODO: handle promise of .forEach?!
  // biome-ignore lint/complexity/noForEach: <explanation>
  log$.lifecycle.forEach((log: LifecycleLog) => {
    const key = `${log.stage}:${log.depPath}`;

    lifecycleMessages[key] = lifecycleMessages[key] ?? {
      collapsed:
        log.wd.includes(NODE_MODULES) || log.wd.includes(TMP_DIR_IN_STORE),
      output: [],
      script: '',
      startTime: process.hrtime(),
      status: formatIndentedStatus(chalk.magentaBright('Running...')),
    };

    const exit = typeof log.exitCode === 'number';

    let msg: string;

    if (lifecycleMessages[key].collapsed) {
      msg = renderCollapsedScriptOutput(log, lifecycleMessages[key], {
        cwd: opts.cwd,
        exit,
        maxWidth: opts.width,
      });
    } else {
      msg = renderScriptOutput(log, lifecycleMessages[key], {
        cwd: opts.cwd,
        exit,
        maxWidth: opts.width,
      });
    }

    if (exit) {
      delete lifecycleMessages[key];
    }

    if (!lifecycleStreamByDepPath[key]) {
      lifecycleStreamByDepPath[key] = new Rx.Subject<{ msg: string }>();
      lifecyclePushStream.next(Rx.from(lifecycleStreamByDepPath[key]));
    }

    lifecycleStreamByDepPath[key].next({ msg });

    if (exit) {
      lifecycleStreamByDepPath[key].complete();
    }
  });

  return Rx.from(lifecyclePushStream);
}

function toNano(time: [number, number]): number {
  return (time[0] + time[1] / 1e9) * 1e3;
}

function renderCollapsedScriptOutput(
  log: LifecycleLog,
  messageCache: {
    collapsed: boolean;
    label?: string;
    output: string[];
    script: string;
    startTime: [number, number];
    status: string;
  },
  opts: {
    cwd: string;
    exit: boolean;
    maxWidth: number;
  }
): string {
  if (typeof messageCache.label === 'undefined') {
    messageCache.label = highlightLastFolder(
      formatPrefixNoTrim(opts.cwd, log.wd)
    );

    if (log.wd.includes(TMP_DIR_IN_STORE) === true) {
      messageCache.label += ` [${log.depPath}]`;
    }

    messageCache.label += `: Running ${log.stage} script`;
  }

  if (!opts.exit) {
    updateMessageCache(log, messageCache, opts);
    return `${messageCache.label}...`;
  }

  const time = prettyTime(toNano(process.hrtime(messageCache.startTime)));

  if (log.exitCode === 0) {
    return `${messageCache.label}, done in ${time}`;
  }

  if (log.optional === true) {
    return `${messageCache.label}, failed in ${time} (skipped as optional)`;
  }

  return `${messageCache.label}, failed in ${time}${EOL}${renderScriptOutput(log, messageCache, opts)}`;
}

function renderScriptOutput(
  log: LifecycleLog,
  messageCache: {
    collapsed: boolean;
    output: string[];
    script: string;
    startTime: [number, number];
    status: string;
  },
  opts: {
    cwd: string;
    exit: boolean;
    maxWidth: number;
  }
): string {
  updateMessageCache(log, messageCache, opts);
  if (opts.exit && log.exitCode !== 0) {
    return [
      messageCache.script,
      ...messageCache.output,
      messageCache.status,
    ].join(EOL);
  }

  if (messageCache.output.length > 10) {
    return [
      messageCache.script,
      `[${messageCache.output.length - 10} lines collapsed]`,
      ...messageCache.output.slice(messageCache.output.length - 10),
      messageCache.status,
    ].join(EOL);
  }

  return [
    messageCache.script,
    ...messageCache.output,
    messageCache.status,
  ].join(EOL);
}

function updateMessageCache(
  log: LifecycleLog,
  messageCache: {
    collapsed: boolean;
    output: string[];
    script: string;
    startTime: [number, number];
    status: string;
  },
  opts: {
    cwd: string;
    exit: boolean;
    maxWidth: number;
  }
): void {
  if (typeof log.script === 'string' && log.script !== '') {
    const prefix = `${formatPrefix(opts.cwd, log.wd)} ${hlValue(log.stage)}`;
    const maxLineWidth =
      opts.maxWidth - prefix.length - 2 + ANSI_ESCAPES_LENGTH_OF_PREFIX;
    messageCache.script = `${prefix}$ ${cutLine(log.script, maxLineWidth)}`;
  } else if (opts.exit) {
    const time = prettyTime(toNano(process.hrtime(messageCache.startTime)));
    if (log.exitCode === 0) {
      messageCache.status = formatIndentedStatus(
        chalk.magentaBright(`Done in ${time}`)
      );
    } else {
      messageCache.status = formatIndentedStatus(
        chalk.red(`Failed in ${time} at ${log.wd}`)
      );
    }
  } else {
    messageCache.output.push(formatIndentedOutput(opts.maxWidth, log));
  }
}

function formatIndentedStatus(status: string): string {
  return `${chalk.magentaBright('└─')} ${status}`;
}

function highlightLastFolder(p: string): string {
  const lastSlash = p.lastIndexOf('/') + 1;
  return `${chalk.gray(p.slice(0, lastSlash))}${p.slice(lastSlash)}`;
}

function createStreamLifecycleOutput(
  cwd: string,
  hideLifecyclePrefix: boolean
): (logObj: LifecycleLog) => string {
  currentColor = 0;
  const colorByPrefix: ColorByPkg = new Map();
  return streamLifecycleOutput.bind(
    null,
    colorByPrefix,
    cwd,
    hideLifecyclePrefix
  );
}

function streamLifecycleOutput(
  colorByPkg: ColorByPkg,
  cwd: string,
  hideLifecyclePrefix: boolean,
  logObj: LifecycleLog
): string {
  const prefix = formatLifecycleScriptPrefix(
    colorByPkg,
    cwd,
    logObj.wd,
    logObj.stage
  );
  if (typeof logObj.exitCode === 'number') {
    return logObj.exitCode === 0 ? `${prefix}: Done` : `${prefix}: Failed`;
  }

  if (typeof logObj.script === 'string') {
    return `${prefix}$ ${logObj.script}`;
  }
  const line = formatLine(Number.POSITIVE_INFINITY, logObj);
  return hideLifecyclePrefix ? line : `${prefix}: ${line}`;
}

function formatIndentedOutput(maxWidth: number, logObj: LifecycleLog): string {
  return `${chalk.magentaBright('│')} ${formatLine(maxWidth - 2, logObj)}`;
}

function formatLifecycleScriptPrefix(
  colorByPkg: ColorByPkg,
  cwd: string,
  wd: string,
  stage: string
): string {
  if (!colorByPkg.has(wd)) {
    const colorName = colorWheel[currentColor % NUM_COLORS];

    if (typeof colorName === 'string') {
      colorByPkg.set(wd, chalk[colorName]);

      currentColor++;
    }
  }

  const color = colorByPkg.get(wd);

  if (typeof color === 'function') {
    return `${color(formatPrefix(cwd, wd))} ${hlValue(stage)}`;
  }

  return `${formatPrefix(cwd, wd)} ${hlValue(stage)}`;
}

function formatLine(maxWidth: number, logObj: LifecycleLog): string {
  const line = cutLine(logObj.line, maxWidth);

  // TODO: strip only the non-color/style ansi escape codes
  if (logObj.stdio === 'stderr') {
    return chalk.gray(line);
  }

  return line;
}

function cutLine(line: string | undefined, maxLength: number): string {
  if (typeof line === 'undefined' || line === '') return '';
  return cliTruncate(line, maxLength);
}

function aggregateOutput(
  source: Rx.Observable<LifecycleLog>
): Rx.Observable<LifecycleLog> {
  return source.pipe(
    // The '\0' is a null character which delimits these strings. This works since JS doesn't use
    // null-terminated strings.
    groupBy((data) => `${data.depPath}\0${data.stage}`),
    mergeMap((group) => {
      return group.pipe(buffer(group.pipe(filter((msg) => 'exitCode' in msg))));
    }),
    map((ar) => Rx.from(ar)),
    mergeAll()
  );
}
