import {
  packageManager,
  detectIfCurrentPkgIsExecutable,
} from '../packages/cli-meta/index.ts';
import renderHelp from 'render-help';

export function createHelp(
  helpByCommandName: Record<string, () => string>
): (opts: unknown, params: string[]) => string {
  return (_opts: unknown, params: string[]): string => {
    let helpText: string | undefined;

    if (params.length === 0) {
      helpText = getHelpText();
    } else if (typeof helpByCommandName[params[0] ?? ''] === 'function') {
      helpText = helpByCommandName[params[0] ?? '']?.();
    } else {
      helpText = `No results for "${params[0] ?? ''}"`;
    }
    return `Version ${packageManager.version}\
${detectIfCurrentPkgIsExecutable() === true ? ` (compiled to binary; bundled Node.js ${process.version})` : ''}\
\n${helpText}\n`;
  };
}

function getHelpText(): string {
  return renderHelp({
    descriptionLists: [
      {
        title: 'Manage your dependencies',

        list: [
          {
            description: 'Install all dependencies for a project',
            name: 'install',
            shortAlias: 'i',
          },
          {
            description:
              'Installs a package and any packages that it depends on. By default, any new package is installed as a prod dependency',
            name: 'add',
          },
          {
            description:
              'Updates packages to their latest version based on the specified range',
            name: 'update',
            shortAlias: 'up',
          },
          {
            description:
              "Removes packages from node_modules and from the project's package.json",
            name: 'remove',
            shortAlias: 'rm',
          },
          {
            description: 'Connect the local project to another one',
            name: 'link',
            shortAlias: 'ln',
          },
          {
            description:
              'Unlinks a package. Like yarn unlink but ospm re-installs the dependency after removing the external link',
            name: 'unlink',
          },
          {
            description:
              'Generates a ospm-lock.yaml from an npm package-lock.json (or npm-shrinkwrap.json) file',
            name: 'import',
          },
          {
            description:
              'Runs a ospm install followed immediately by a ospm test',
            name: 'install-test',
            shortAlias: 'it',
          },
          {
            description: 'Rebuild a package',
            name: 'rebuild',
            shortAlias: 'rb',
          },
          {
            description: 'Removes extraneous packages',
            name: 'prune',
          },
        ],
      },
      {
        title: 'Review your dependencies',

        list: [
          {
            description:
              'Checks for known security issues with the installed packages',
            name: 'audit',
          },
          {
            description:
              'Print all the versions of packages that are installed, as well as their dependencies, in a tree-structure',
            name: 'list',
            shortAlias: 'ls',
          },
          {
            description: 'Check for outdated packages',
            name: 'outdated',
          },
          {
            description: 'Check licenses in consumed packages',
            name: 'licenses',
          },
        ],
      },
      {
        title: 'Run your scripts',

        list: [
          {
            description: 'Executes a shell command in scope of a project',
            name: 'exec',
          },
          {
            description: 'Runs a defined package script',
            name: 'run',
          },
          {
            description: 'Runs a package\'s "test" script, if one was provided',
            name: 'test',
            shortAlias: 't',
          },
          {
            description:
              'Runs an arbitrary command specified in the package\'s "start" property of its "scripts" object',
            name: 'start',
          },
        ],
      },
      {
        title: 'Other',

        list: [
          {
            description: 'Create a tarball from a package',
            name: 'pack',
          },
          {
            description: 'Publishes a package to the registry',
            name: 'publish',
          },
          {
            description: 'Prints the effective modules directory',
            name: 'root',
          },
          {
            description:
              'Prints the index file of a specific package from the store',
            name: 'cat-index',
          },
          {
            description:
              'Prints the contents of a file based on the hash value stored in the index file',
            name: 'cat-file',
          },
          {
            description:
              'Experimental! Lists the packages that include the file with the specified hash.',
            name: 'find-hash',
          },
        ],
      },
      {
        title: 'Manage your store',

        list: [
          {
            description:
              'Adds new packages to the ospm store directly. Does not modify any projects or files outside the store',
            name: 'store add',
          },
          {
            description: 'Prints the path to the active store directory',
            name: 'store path',
          },
          {
            description:
              'Removes unreferenced (extraneous, orphan) packages from the store',
            name: 'store prune',
          },
          {
            description: 'Checks for modified packages in the store',
            name: 'store status',
          },
        ],
      },
      {
        title: 'Options',

        list: [
          {
            description: 'Run the command for each project in the workspace.',
            name: '--recursive',
            shortAlias: '-r',
          },
        ],
      },
    ],
    usages: ['ospm [command] [flags]', 'ospm [ -h | --help | -v | --version ]'],
  });
}
