import { type LogBase, logger } from '../logger/index.ts';
import type { ProjectManifest } from '../types/index.ts';

export const packageManifestLogger =
  logger<PackageManifestMessage>('package-manifest');

type PackageManifestMessageBase = {
  prefix: string;
  initial?: ProjectManifest | undefined;
  updated?: ProjectManifest | undefined;
};

export interface PackageManifestMessageInitial
  extends PackageManifestMessageBase {
  initial?: ProjectManifest | undefined;
  updated?: never | undefined;
}

export interface PackageManifestMessageUpdated
  extends PackageManifestMessageBase {
  initial?: never | undefined;
  updated?: ProjectManifest | undefined;
}

export type PackageManifestMessage =
  | PackageManifestMessageInitial
  | PackageManifestMessageUpdated;

export type PackageManifestLog = {
  name: 'ospm:package-manifest';
  initial?: ProjectManifest | undefined;
  updated?: ProjectManifest | undefined;
} & LogBase &
  PackageManifestMessage;
