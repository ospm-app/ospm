import { OspmError } from '../error/index.ts';

type ActionFailure = {
  status: 'failure';
  duration?: number | undefined;
  prefix?: string;
  message?: string;
  error?: Error;
};

type ActionPassed = {
  status: 'passed';
  duration?: number | undefined;
  prefix?: never;
  message?: never;
  error?: never;
};

type ActionQueued = {
  status: 'queued';
  duration?: number | undefined;
  prefix?: never;
  message?: never;
  error?: never;
};

type ActionRunning = {
  status: 'running' | 'passed';
  duration?: number | undefined;
  prefix?: never;
  message?: never;
};

type ActionSkipped = {
  status: 'skipped';
  duration?: number | undefined;
  prefix?: never;
  message?: never;
};

export type RecursiveSummary = Record<
  string,
  ActionPassed | ActionQueued | ActionRunning | ActionSkipped | ActionFailure
>;

class RecursiveFailError extends OspmError {
  readonly failures: ActionFailure[];
  readonly passes: number;

  constructor(
    command: string,
    recursiveSummary: RecursiveSummary,
    failures: ActionFailure[]
  ) {
    super(
      'RECURSIVE_FAIL',
      `"${command}" failed in ${failures.length} packages`
    );

    this.failures = failures;
    this.passes = Object.values(recursiveSummary).filter(
      ({ status }) => status === 'passed'
    ).length;
  }
}

export function throwOnCommandFail(
  command: string,
  recursiveSummary: RecursiveSummary
): void {
  const failures = Object.values(recursiveSummary).filter(
    (
      summary: RecursiveSummary[keyof RecursiveSummary]
    ): summary is ActionFailure => {
      return summary.status === 'failure';
    }
  );

  if (failures.length > 0) {
    throw new RecursiveFailError(command, recursiveSummary, failures);
  }
}
