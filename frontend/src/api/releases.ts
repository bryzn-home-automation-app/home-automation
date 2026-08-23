import api from './client';

export type ReleaseStage = 'beta' | 'stable';
export type ChangeType = 'new' | 'improved' | 'fixed';

export interface ReleaseChange {
  /** 'new' | 'improved' | 'fixed'. */
  type: ChangeType;
  /** Plain-language, non-technical description. */
  text: string;
}

export interface Release {
  version: string;
  stage: ReleaseStage;
  /** ISO yyyy-mm-dd. */
  releasedAt: string;
  title: string;
  summary: string;
  changes: ReleaseChange[];
}

/** Full version history, newest first. Empty array before anything is seeded. */
export async function fetchReleases(): Promise<Release[]> {
  const res = await api.get<Release[]>('/releases');
  return Array.isArray(res.data) ? res.data : [];
}
