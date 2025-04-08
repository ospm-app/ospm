export type PrepareExecutionEnvOptions = {
  extraBinPaths?: string[] | undefined;
  executionEnv: ExecutionEnv | undefined;
};

export type PrepareExecutionEnvResult = {
  extraBinPaths: string[];
};

export type PrepareExecutionEnv = (
  options: PrepareExecutionEnvOptions
) => Promise<PrepareExecutionEnvResult>;

export type ExecutionEnv = {
  nodeVersion?: string | undefined;
};
