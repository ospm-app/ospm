import crypto from 'node:crypto';

export const hash =
  // crypto.hash is supported in Node 21.7.0+, 20.12.0+
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  crypto.hash ??
  ((
    algorithm: string,
    data: crypto.BinaryLike,
    outputEncoding: crypto.BinaryToTextEncoding
  ) => crypto.createHash(algorithm).update(data).digest(outputEncoding));
