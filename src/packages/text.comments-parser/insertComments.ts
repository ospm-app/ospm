import type { CommentSpecifier } from './CommentSpecifier.ts';

export function insertComments(
  json: string,
  comments: CommentSpecifier[]
): string {
  // We need to reintroduce the comments. So create an index of
  // the lines of the manifest so we can try to match them up.
  // We eliminate whitespace and quotes in the index entries,
  // because ospm may have changed them.
  const jsonLines = json.split('\n');

  const index: Record<string, number> = {};

  // eslint-disable-next-line optimize-regex/optimize-regex
  const canonicalizer = /[\s'"]/g;

  for (let i = 0; i < jsonLines.length; ++i) {
    const key = jsonLines[i]?.replace(canonicalizer, '');

    if (typeof key === 'undefined') {
      continue;
    }

    if (key in index) {
      index[key] = -1; // Mark this line as occurring twice
    } else {
      index[key] = i;
    }
  }

  // A place to put comments that come _before_ the lines they are
  // anchored to:
  const jsonPrefix: Record<string, string> = {};

  for (const comment of comments) {
    // First if we can find the line the comment was on, that is
    // the most reliable locator:
    let key = comment.on.replace(canonicalizer, '');

    const ik = index[key];

    if (key && typeof ik !== 'undefined' && ik >= 0) {
      jsonLines[ik] += ` ${comment.content}`;
      continue;
    }

    // Next, if it's not before anything, it must have been at the very end:
    if (comment.before === undefined) {
      jsonLines[jsonLines.length - 1] += comment.whitespace + comment.content;

      continue;
    }

    // Next, try to put it before something; note the comment extractor
    // used the convention that position 0 is before the first line:
    let location = comment.lineNumber === 0 ? 0 : -1;

    if (location < 0) {
      key = comment.before.replace(canonicalizer, '');

      const ik = index[key];

      if (key && typeof ik !== 'undefined') {
        location = ik;
      }
    }

    if (location >= 0) {
      if (typeof jsonPrefix[location] === 'undefined') {
        const inlineWhitespace = comment.whitespace.startsWith('\n')
          ? comment.whitespace.slice(1)
          : comment.whitespace;

        jsonPrefix[location] = inlineWhitespace + comment.content;
      } else {
        jsonPrefix[location] += ` ${comment.content}`;
      }

      continue;
    }

    // The last definite indicator we can use is that it is after something:
    if (typeof comment.after === 'string') {
      key = comment.after.replace(canonicalizer, '');

      const ik = index[key];

      if (key && typeof ik !== 'undefined' && ik >= 0) {
        jsonLines[ik] += comment.whitespace + comment.content;

        continue;
      }
    }

    // Finally, try to get it in the right general location by using the
    // line number, but warn the user the comment may have been relocated:
    location = comment.lineNumber - 1; // 0 was handled above

    let separator = ' ';

    if (location >= jsonLines.length) {
      location = jsonLines.length - 1;
      separator = '\n';
    }

    jsonLines[location] +=
      `${separator + comment.content} /* [comment possibly relocated by ospm] */`;
  }
  // Insert the accumulated prefixes:
  for (let i = 0; i < jsonLines.length; ++i) {
    const jp = jsonPrefix[i];
    const jl = jsonLines[i];

    if (typeof jp === 'string' && typeof jl === 'string') {
      jsonLines[i] = `${jp}\n${jl}`;
    }
  }

  // And reassemble the manifest:
  return jsonLines.join('\n');
}
