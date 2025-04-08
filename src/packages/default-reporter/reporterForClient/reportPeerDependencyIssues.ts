import type { PeerDependencyIssuesLog } from '../../core-loggers/index.ts';
import { renderPeerIssues } from '../../render-peer-issues/index.ts';
import type { PeerDependencyRules } from '../../types/index.ts';
import * as Rx from 'rxjs';
import { map, take } from 'rxjs/operators';
import { formatWarn } from './utils/formatWarn.ts';

export function reportPeerDependencyIssues(
  log$: {
    peerDependencyIssues: Rx.Observable<PeerDependencyIssuesLog>;
  },
  peerDependencyRules?: PeerDependencyRules | undefined
): Rx.Observable<Rx.Observable<{ msg: string }>> {
  return log$.peerDependencyIssues.pipe(
    take(1),
    map((log) => {
      const renderedPeerIssues = renderPeerIssues(log.issuesByProjects, {
        rules: peerDependencyRules,
      });

      if (!renderedPeerIssues) {
        return Rx.NEVER;
      }

      return Rx.of({
        msg: `${formatWarn('Issues with peer dependencies found')}\n${renderedPeerIssues}`,
      });
    })
  );
}
