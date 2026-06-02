import type { CdpSession } from "../chrome/cdp-session.js";
import type { ProgressReporter } from "../progress/progress-reporter.js";

export type InstagramCompetitorDiscoverySource = "explore" | "hashtag" | "keyword";

export type InstagramCompetitorDiscoveryInput = {
  source?: unknown;
  hashtag?: unknown;
  keyword?: unknown;
  targetCompetitors?: unknown;
  chromeOrigin?: unknown;
  timeoutMs?: unknown;
  reporter?: ProgressReporter;
  phaseLabel?: string;
  onCandidate?: (candidate: InstagramCompetitorCandidate) => void;
};

export type InstagramCompetitorCandidate = {
  username: string;
  bio?: string;
  following?: number;
  followers?: number;
  avatar?: string;
  profileUrl: string;
  sourcePostUrl?: string;
  postDate?: string;
  status: "profile_found";
};

export type InstagramPostOnlyRecord = {
  postUrl: string;
  postDate?: string;
  status: "profile_not_found";
};

export type InstagramDiscoveryPostRecord = {
  postUrl: string;
  postDate?: string;
};

export type InstagramDiscoveryRawItem = Partial<InstagramCompetitorCandidate> & {
  postUrl?: string;
  postDate?: string;
};

export type InstagramCompetitorDiscoverySuccess = {
  ok: true;
  status: "success" | "partial";
  candidates: InstagramCompetitorCandidate[];
  posts: InstagramDiscoveryPostRecord[];
  postOnly: InstagramPostOnlyRecord[];
  rawItems: InstagramDiscoveryRawItem[];
  meta: {
    source: InstagramCompetitorDiscoverySource;
    hashtag?: string;
    keyword?: string;
    targetCompetitors: number;
    rawItemCount: number;
    postCount: number;
    candidateCount: number;
    postOnlyCount: number;
    startedAt: string;
    finishedAt: string;
    stopReason: "target_reached" | "timeout" | "no_more_items";
    sourceUrl: string;
  };
};

export type InstagramCompetitorDiscoveryFailure = {
  ok: false;
  error: {
    code: "INSTAGRAM_DISCOVERY_INVALID_INPUT" | "INSTAGRAM_DISCOVERY_FAILED" | "INSTAGRAM_TAB_NOT_FOUND";
    message: string;
  };
};

export type InstagramCompetitorDiscoveryResult =
  | InstagramCompetitorDiscoverySuccess
  | InstagramCompetitorDiscoveryFailure;

export type InstagramCompetitorDiscoveryBrowser = {
  openSourcePage(url: string): Promise<void>;
  collectModalProfiles?(options: { targetItems: number; deadlineMs: number | null }): Promise<InstagramDiscoveryRawItem[]>;
  scanVisibleItems(): Promise<InstagramDiscoveryRawItem[]>;
  scroll(): Promise<boolean>;
  resolvePostProfile(postUrl: string): Promise<InstagramCompetitorCandidate | null>;
  close(): Promise<void> | void;
};

export type InstagramCompetitorDiscoveryService = {
  discover(input: InstagramCompetitorDiscoveryInput): Promise<InstagramCompetitorDiscoveryResult>;
};

export type InstagramCompetitorDiscoveryServiceOptions = {
  fetchImpl?: typeof fetch;
  connectSession?: (webSocketDebuggerUrl: string) => Promise<CdpSession>;
  createBrowser?: (input: NormalizedInstagramCompetitorDiscoveryInput) => Promise<InstagramCompetitorDiscoveryBrowser>;
};

export type NormalizedInstagramCompetitorDiscoveryInput = {
  source: InstagramCompetitorDiscoverySource;
  hashtag?: string;
  keyword?: string;
  targetCompetitors: number;
  chromeOrigin: string;
  timeoutMs: number | null;
  sourceUrl: string;
};
