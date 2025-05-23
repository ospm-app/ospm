import chalk from 'chalk';

export function formatUnknownOptionsError(
  unknownOptions: Map<string, string[]>
): string {
  let output = chalk.bgRed.black('\u2009ERROR\u2009');
  const unknownOptionsArray = Array.from(unknownOptions.keys());
  if (unknownOptionsArray.length > 1) {
    return `${output} ${chalk.red(`Unknown options: ${unknownOptionsArray.map((unknownOption) => `'${unknownOption}'`).join(', ')}`)}`;
  }
  const unknownOption = unknownOptionsArray[0];

  if (typeof unknownOption === 'undefined') {
    return output;
  }

  output += ` ${chalk.red(`Unknown option: '${unknownOption}'`)}`;
  const didYouMeanOptions = unknownOptions.get(unknownOption);

  if (
    typeof didYouMeanOptions?.length === 'undefined' ||
    didYouMeanOptions.length === 0
  ) {
    return output;
  }

  return `${output}
Did you mean '${didYouMeanOptions.join("', or '")}'? Use "--config.unknown=value" to force an unknown option.`;
}
