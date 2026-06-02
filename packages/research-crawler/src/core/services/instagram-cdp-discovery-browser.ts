import { connectCdpSession, type CdpSession } from "../chrome/cdp-session.js";
import { resolveInstagramTarget } from "../chrome/chrome-connector.js";
import { captureInstagramNetworkResponses } from "../network/network-listener.js";
import {
  collectDiscoveryItemsFromCapturedResponses,
  getDiscoveryItemKey,
  hasProfileDetails,
  isDeadlineReached,
  isSameInstagramPageUrl,
  mergeDiscoveryItems,
  normalizePostDate,
  normalizePostUrl,
  normalizeUsername
} from "./instagram-discovery-state.js";
import type {
  InstagramCompetitorCandidate,
  InstagramCompetitorDiscoveryBrowser,
  InstagramCompetitorDiscoveryServiceOptions,
  InstagramDiscoveryRawItem,
  NormalizedInstagramCompetitorDiscoveryInput
} from "./instagram-discovery-types.js";

export function createCdpDiscoveryBrowserFactory(options: InstagramCompetitorDiscoveryServiceOptions): (
  input: NormalizedInstagramCompetitorDiscoveryInput
) => Promise<InstagramCompetitorDiscoveryBrowser> {
  return async (input) => {
    const target = await resolveInstagramTarget({
      chromeOrigin: input.chromeOrigin,
      fetchImpl: options.fetchImpl,
      allowAnyPage: true,
      preferredUrl: input.sourceUrl,
      preferredUrlWaitMs: 6000
    });
    if (!target.webSocketDebuggerUrl) throw new Error("Open Instagram in the browser started from Browser Intelligence.");
    const session = await (options.connectSession ?? connectCdpSession)(target.webSocketDebuggerUrl);
    return new CdpInstagramCompetitorDiscoveryBrowser(session, Math.min(input.timeoutMs ?? 10000, 10000));
  };
}

class CdpInstagramCompetitorDiscoveryBrowser implements InstagramCompetitorDiscoveryBrowser {
  private networkItems: InstagramDiscoveryRawItem[] = [];

  constructor(
    private readonly session: CdpSession,
    private readonly networkCaptureTimeoutMs: number
  ) {}

  async openSourcePage(url: string): Promise<void> {
    await this.session.send("Page.enable");
    await this.session.send("Runtime.enable");
    const currentUrl = await this.getCurrentPageUrl();
    const captured = await captureInstagramNetworkResponses(this.session, {
      timeoutMs: this.networkCaptureTimeoutMs,
      maxResponses: 80,
      ...(isSameInstagramPageUrl(currentUrl, url) ? {} : { navigateUrl: url })
    });
    this.networkItems = collectDiscoveryItemsFromCapturedResponses(captured.map((response) => ({
      responseUrl: response.responseUrl,
      bodyText: response.bodyText
    })));
    await this.waitForRuntimeCondition(`
      document.readyState === 'complete' &&
      Boolean(document.querySelector('a[href*="/p/"] img, a[href*="/reel/"] img, a[href*="/tv/"] img'))
    `, 12000);
  }

  async scanVisibleItems(): Promise<InstagramDiscoveryRawItem[]> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const seen = new Set();
          const readUsername = (root) => {
            const text = [
              root?.getAttribute?.('aria-label') || '',
              root?.getAttribute?.('title') || '',
              root?.textContent || '',
              ...Array.from(root?.querySelectorAll?.('img[alt]') || []).map((img) => img.getAttribute('alt') || '')
            ].join(' ');
            return (
              text.match(/@([A-Za-z0-9._]+)/)?.[1] ||
              text.match(/(?:photo|video|post|reel)\\s+by\\s+([A-Za-z0-9._]+)/i)?.[1] ||
              ''
            );
          };
          return Array.from(document.querySelectorAll('a[href]'))
            .map((anchor) => {
              const href = anchor.getAttribute('href') || '';
              if (!/\\/(p|reel|tv)\\//.test(href)) return null;
              const postUrl = new URL(href, location.origin).toString();
              if (seen.has(postUrl)) return null;
              seen.add(postUrl);
              const username = readUsername(anchor);
              const postDate = anchor.closest('article')?.querySelector('time[datetime]')?.getAttribute('datetime') || '';
              return { postUrl, username, sourcePostUrl: postUrl, postDate };
            })
            .filter(Boolean);
        })()
      `
    });
    const domItems = Array.isArray(result.result?.value) ? result.result.value as InstagramDiscoveryRawItem[] : [];
    return mergeDiscoveryItems([...this.networkItems, ...domItems]);
  }

  async collectModalProfiles(options: { targetItems: number; deadlineMs: number | null }): Promise<InstagramDiscoveryRawItem[]> {
    const items: InstagramDiscoveryRawItem[] = [];
    const seenItems = new Set<string>();
    const seenProfileUsernames = new Set<string>();
    const seenPosts = new Set<string>();
    const opened = await this.clickFirstPost();
    if (!opened) return items;
    await this.waitForRuntimeCondition("Boolean(document.querySelector('div[role=\"dialog\"], article'))", 8000);

    while (seenProfileUsernames.size < options.targetItems && !isDeadlineReached(options.deadlineMs)) {
      const item = await this.readCurrentModalProfile();
      const postUrl = normalizePostUrl(item?.postUrl ?? item?.sourcePostUrl);
      if (item && postUrl) {
        if (!seenPosts.has(postUrl)) {
          seenPosts.add(postUrl);
        }
        const normalizedItem = { ...item, postUrl, sourcePostUrl: postUrl };
        const itemKey = getDiscoveryItemKey(normalizedItem);
        if (itemKey && !seenItems.has(itemKey)) {
          seenItems.add(itemKey);
          items.push(normalizedItem);
          const username = normalizeUsername(normalizedItem.username);
          if (username && hasProfileDetails(normalizedItem)) seenProfileUsernames.add(username);
        }
      }

      if (seenProfileUsernames.size >= options.targetItems) break;
      if (!await this.goToNextPost(postUrl)) break;
      await delay(1400);
    }

    return mergeDiscoveryItems(items);
  }

  async scroll(): Promise<boolean> {
    const before = await this.getScrollY();
    const beforeHeight = await this.getScrollHeight();
    await this.session.send("Runtime.evaluate", {
      expression: "window.scrollTo({ top: window.scrollY + Math.max(window.innerHeight * 1.5, 900), behavior: 'instant' })"
    });
    await delay(2200);
    return await this.getScrollY() > before || await this.getScrollHeight() > beforeHeight;
  }

  async resolvePostProfile(postUrl: string): Promise<InstagramCompetitorCandidate | null> {
    await this.session.send("Page.navigate", { url: postUrl });
    await this.waitForRuntimeCondition("Boolean(document.querySelector('article a[href^=\"/\"], meta[property=\"og:title\"], meta[property=\"og:description\"]'))", 10000);
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const blocked = new Set([
            'about', 'accounts', 'archive', 'challenge', 'developer', 'direct', 'explore',
            'legal', 'p', 'privacy', 'reel', 'reels', 'stories', 'terms', 'tv'
          ]);
          const cleanUsername = (value) => {
            const username = String(value || '').replace(/^@/, '').trim().toLowerCase();
            return /^[a-z0-9._]{1,30}$/.test(username) && !blocked.has(username) ? username : '';
          };
          const usernameFromHref = (href) => {
            const path = new URL(href || '', location.origin).pathname;
            const match = path.match(/^\\/([A-Za-z0-9._]{1,30})\\/?$/);
            return cleanUsername(match?.[1]);
          };
          const textFor = (node) => [
            node?.textContent || '',
            node?.getAttribute?.('aria-label') || '',
            node?.getAttribute?.('title') || '',
            ...Array.from(node?.querySelectorAll?.('img[alt]') || []).map((img) => img.getAttribute('alt') || '')
          ].join(' ');
          const candidates = [];
          const addAnchor = (anchor, baseScore) => {
            const username = usernameFromHref(anchor.getAttribute('href') || '');
            if (!username) return;
            const box = anchor.getBoundingClientRect();
            const text = textFor(anchor);
            const avatar = anchor.closest('article, header, main')?.querySelector('img')?.getAttribute('src') || '';
            candidates.push({
              username,
              avatar,
              score: baseScore + (box.width > 0 && box.height > 0 ? 5 : 0) + (text.toLowerCase().includes(username) ? 10 : 0)
            });
          };
          Array.from(document.querySelectorAll('article header a[href^="/"]')).forEach((anchor) => addAnchor(anchor, 100));
          Array.from(document.querySelectorAll('article a[href^="/"]')).forEach((anchor) => addAnchor(anchor, 60));
          Array.from(document.querySelectorAll('main a[href^="/"]')).forEach((anchor) => addAnchor(anchor, 20));

          const metaText = Array.from(document.querySelectorAll('meta[property="og:title"], meta[property="og:description"], meta[name="description"]'))
            .map((node) => node.getAttribute('content') || '')
            .join(' ');
          const metaUsername = cleanUsername(
            metaText.match(/@([A-Za-z0-9._]{1,30})/)?.[1] ||
            metaText.match(/(?:from|by)\\s+([A-Za-z0-9._]{1,30})/i)?.[1]
          );
          if (metaUsername) candidates.push({ username: metaUsername, avatar: '', score: 50 });

          candidates.sort((left, right) => right.score - left.score);
          const selected = candidates[0];
          if (!selected?.username) return null;
          return {
            username: selected.username,
            avatar: selected.avatar || '',
            profileUrl: new URL('/' + selected.username + '/', location.origin).toString()
          };
        })()
      `
    });
    const value = result.result?.value;
    if (!isRecord(value) || typeof value.username !== "string") return null;
    const apiProfile = await this.resolveProfileFromWebApi(value.username);
    const profile = apiProfile && hasProfileDetails(apiProfile)
      ? apiProfile
      : await this.scanProfilePage(value.profileUrl);
    const postAvatar = typeof value.avatar === "string" ? value.avatar : "";
    return {
      username: value.username,
      ...(profile.bio ? { bio: profile.bio } : {}),
      ...(typeof profile.followers === "number" ? { followers: profile.followers } : {}),
      ...(typeof profile.following === "number" ? { following: profile.following } : {}),
      ...(profile.avatar || postAvatar ? { avatar: profile.avatar || postAvatar } : {}),
      profileUrl: typeof value.profileUrl === "string" ? value.profileUrl : `https://www.instagram.com/${value.username}/`,
      sourcePostUrl: normalizePostUrl(postUrl) || postUrl,
      status: "profile_found"
    };
  }

  close(): void {
    this.session.close();
  }

  private async clickFirstPost(): Promise<boolean> {
    const point = await this.waitForFirstPostPoint();
    if (!point) return false;
    await this.clickPoint(point.x, point.y);
    await delay(1200);
    return true;
  }

  private async readCurrentModalProfile(): Promise<InstagramDiscoveryRawItem | null> {
    const author = await this.getModalAuthorPoint();
    if (!author) return null;
    const apiProfile = await this.resolveProfileFromWebApi(author.username);
    if (apiProfile && hasProfileDetails(apiProfile)) {
      console.info("[instagram-discovery] profile api", JSON.stringify({
        username: apiProfile.username,
        postUrl: normalizePostUrl(author.postUrl) || author.postUrl,
        hasFollowers: typeof apiProfile.followers === "number",
        hasFollowing: typeof apiProfile.following === "number",
        hasAvatar: Boolean(apiProfile.avatar),
        hasBio: Boolean(apiProfile.bio)
      }));
      return {
        ...apiProfile,
        sourcePostUrl: normalizePostUrl(author.postUrl) || author.postUrl,
        postUrl: normalizePostUrl(author.postUrl) || author.postUrl,
        ...(author.postDate ? { postDate: author.postDate } : {})
      };
    }

    console.info("[instagram-discovery] profile api miss", JSON.stringify({
      username: author.username,
      postUrl: normalizePostUrl(author.postUrl) || author.postUrl
    }));
    await this.moveMouse(Math.max(1, author.x - 160), Math.max(1, author.y - 80));
    await delay(250);
    await this.startHoverCardDomWatch(author.username);
    await this.moveMouse(author.x, author.y);
    const domChanged = await this.waitForHoverCardDomChange();
    if (!domChanged) await delay(600);
    return this.readHoverProfile(author.username, author.postUrl, domChanged, author.postDate);
  }

  private async goToNextPost(previousPostUrl: string): Promise<boolean> {
    await this.session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39
    });
    await this.session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39
    });

    const previous = normalizePostUrl(previousPostUrl);
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      const current = normalizePostUrl(await this.getCurrentPageUrl());
      if (current && current !== previous) return true;
      await delay(250);
    }
    return false;
  }

  private async getScrollY(): Promise<number> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: "window.scrollY"
    });
    return typeof result.result?.value === "number" ? result.result.value : 0;
  }

  private async getScrollHeight(): Promise<number> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: "document.documentElement.scrollHeight || document.body.scrollHeight || 0"
    });
    return typeof result.result?.value === "number" ? result.result.value : 0;
  }

  private async getCurrentPageUrl(): Promise<string> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: "location.href"
    });
    return typeof result.result?.value === "string" ? result.result.value : "";
  }

  private async getFirstPostPoint(): Promise<{ x: number; y: number } | null> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const anchors = Array.from(document.querySelectorAll('a[href*="/p/"] img, a[href*="/reel/"] img, a[href*="/tv/"] img'))
            .map((img) => img.closest('a'))
            .filter(Boolean);
          const visible = anchors
            .map((anchor) => ({ anchor, rect: anchor.getBoundingClientRect() }))
            .find((item) => item.rect.width > 20 && item.rect.height > 20 && item.rect.bottom > 0 && item.rect.right > 0);
          if (!visible) return null;
          return {
            x: Math.round(visible.rect.left + visible.rect.width / 2),
            y: Math.round(visible.rect.top + visible.rect.height / 2)
          };
        })()
      `
    });
    const value = result.result?.value;
    return isPoint(value) ? value : null;
  }

  private async waitForFirstPostPoint(): Promise<{ x: number; y: number } | null> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const point = await this.getFirstPostPoint();
      if (point) return point;
      await this.session.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 400,
        y: 500,
        deltaX: 0,
        deltaY: 500
      });
      await delay(700);
    }
    return null;
  }

  private async getModalAuthorPoint(): Promise<{ x: number; y: number; username: string; postUrl: string; postDate?: string } | null> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const blocked = new Set(['about','accounts','archive','challenge','direct','explore','p','reel','reels','stories','tv']);
          const cleanUsername = (value) => {
            const username = String(value || '').replace(/^@/, '').trim().toLowerCase();
            return /^[a-z0-9._]{1,30}$/.test(username) && !blocked.has(username) ? username : '';
          };
          const usernameFromHref = (href) => {
            const path = new URL(href || '', location.origin).pathname;
            const match = path.match(/^\\/([A-Za-z0-9._]{1,30})\\/?$/);
            return cleanUsername(match?.[1]);
          };
          const dialog = document.querySelector('div[role="dialog"]') || document.querySelector('article') || document;
          const links = Array.from(dialog.querySelectorAll('a[href^="/"]'));
          const candidates = links.map((anchor) => {
            const username = usernameFromHref(anchor.getAttribute('href') || '');
            const rect = anchor.getBoundingClientRect();
            const text = (anchor.textContent || '').trim().toLowerCase();
            if (!username || rect.width <= 0 || rect.height <= 0) return null;
            const inArticleHeader = Boolean(anchor.closest('article header'));
            return {
              username,
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              score: (inArticleHeader ? 100 : 20) + (text.includes(username) ? 20 : 0) - Math.max(0, rect.top)
            };
          }).filter(Boolean).sort((left, right) => right.score - left.score);
          const selected = candidates[0];
          if (!selected) return null;
          const postDate = dialog.querySelector('time[datetime]')?.getAttribute('datetime') || '';
          return { ...selected, postUrl: location.href, postDate };
        })()
      `
    });
    const value = result.result?.value;
    if (!isModalAuthorPoint(value)) {
      return null;
    }
    return {
      x: value.x,
      y: value.y,
      username: value.username,
      postUrl: typeof value.postUrl === "string" ? value.postUrl : "",
      ...(normalizePostDate(value.postDate) ? { postDate: normalizePostDate(value.postDate) } : {})
    };
  }

  private async startHoverCardDomWatch(username: string): Promise<void> {
    await this.session.send("Runtime.evaluate", {
      expression: `
        (() => {
          const username = ${JSON.stringify(username)};
          const clean = (value) => String(value || '').trim();
          const findSignature = () => {
            const cards = Array.from(document.querySelectorAll('div[role="tooltip"], div[role="dialog"], div[style*="transform"], body > div, body > div div'));
            return cards
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const text = clean(node.textContent);
                const lower = text.toLowerCase();
                if (!lower.includes(username)) return '';
                if (rect.width < 160 || rect.width > 560 || rect.height < 90 || rect.height > 420) return '';
                if (node.querySelector?.('article')) return '';
                if (lower.includes('add a comment') || lower.includes('view all comments')) return '';
                return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height), text.length].join(':');
              })
              .filter(Boolean)
              .join('|');
          };
          const initial = findSignature();
          window.__researchCrawlerInstagramHoverWatch = new Promise((resolve) => {
            const timeout = window.setTimeout(() => {
              observer.disconnect();
              resolve(false);
            }, 2500);
            const observer = new MutationObserver(() => {
              const next = findSignature();
              if (next && next !== initial) {
                window.clearTimeout(timeout);
                observer.disconnect();
                resolve(true);
              }
            });
            observer.observe(document.body, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true
            });
          });
        })()
      `
    });
  }

  private async waitForHoverCardDomChange(): Promise<boolean> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: "window.__researchCrawlerInstagramHoverWatch || false"
    });
    return result.result?.value === true;
  }

  private async readHoverProfile(username: string, postUrl: string, domChanged: boolean, postDate?: string): Promise<InstagramDiscoveryRawItem | null> {
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const username = ${JSON.stringify(username)};
          const parseCount = (value) => {
            const raw = String(value || '').replace(/,/g, '').trim().toLowerCase();
            const match = raw.match(/([0-9]+(?:\\.[0-9]+)?)\\s*([kmb])?/);
            if (!match) return undefined;
            const base = Number(match[1]);
            const multiplier = match[2] === 'b' ? 1000000000 : match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1;
            return Number.isFinite(base) ? Math.round(base * multiplier) : undefined;
          };
          const clean = (value) => String(value || '').trim();
          const cards = Array.from(document.querySelectorAll('div[role="tooltip"], div[role="dialog"], div[style*="transform"], body > div, body > div div'));
          const card = cards
            .map((node) => ({
              node,
              text: clean(node.textContent),
              rect: node.getBoundingClientRect(),
              hasArticle: Boolean(node.querySelector?.('article')),
              hasNext: Boolean(node.querySelector?.('[aria-label*="Next"], [aria-label*="next"]'))
            }))
            .filter((item) => {
              const lower = item.text.toLowerCase();
              return lower.includes(username) &&
                item.rect.width >= 160 &&
                item.rect.width <= 560 &&
                item.rect.height >= 90 &&
                item.rect.height <= 420 &&
                !item.hasArticle &&
                !item.hasNext &&
                !lower.includes('add a comment') &&
                !lower.includes('view all comments');
            })
            .sort((left, right) => {
              const leftHasCounts = /followers|following|pengikut|mengikuti/i.test(left.text) ? 0 : 1;
              const rightHasCounts = /followers|following|pengikut|mengikuti/i.test(right.text) ? 0 : 1;
              if (leftHasCounts !== rightHasCounts) return leftHasCounts - rightHasCounts;
              return (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height);
            })[0]?.node;
          if (!card) {
            return {
              username,
              profileUrl: new URL('/' + username + '/', location.origin).toString()
            };
          }
          const root = card;
          const text = clean(root.textContent);
          const followers = parseCount(text.match(/([0-9.,]+\\s*[kmb]?)\\s*(followers|pengikut)/i)?.[1]);
          const following = parseCount(text.match(/([0-9.,]+\\s*[kmb]?)\\s*(following|mengikuti)/i)?.[1]);
          const avatar = root.querySelector('img')?.getAttribute('src') || '';
          const lines = text.split('\\n').map((line) => clean(line)).filter(Boolean);
          const bio = lines.find((line) => {
            const lower = line.toLowerCase();
            return lower !== username &&
              !lower.includes('followers') &&
              !lower.includes('pengikut') &&
              !lower.includes('following') &&
              !lower.includes('mengikuti') &&
              !lower.includes('posts') &&
              !lower.includes('postingan') &&
              !lower.includes('follow') &&
              !/^\\d/.test(lower);
          }) || '';
          return {
            username,
            bio,
            followers,
            following,
            avatar,
            profileUrl: new URL('/' + username + '/', location.origin).toString(),
            debug: {
              hoverDomChanged: ${JSON.stringify(domChanged)},
              hoverCardFound: true,
              textLength: text.length,
              hasFollowers: followers !== undefined,
              hasFollowing: following !== undefined,
              hasAvatar: Boolean(avatar),
              hasBio: Boolean(bio)
            }
          };
        })()
      `
    });
    const value = result.result?.value;
    if (!isRecord(value) || typeof value.username !== "string") return null;
    const debug = isRecord(value.debug) ? value.debug : {};
    console.info("[instagram-discovery] hover profile", JSON.stringify({
      username: value.username,
      postUrl: normalizePostUrl(postUrl) || postUrl,
      hoverDomChanged: debug.hoverDomChanged === true,
      hoverCardFound: debug.hoverCardFound === true,
      hasFollowers: debug.hasFollowers === true,
      hasFollowing: debug.hasFollowing === true,
      hasAvatar: debug.hasAvatar === true,
      hasBio: debug.hasBio === true
    }));
    return {
      username: value.username,
      ...(typeof value.bio === "string" && value.bio ? { bio: value.bio } : {}),
      ...(typeof value.followers === "number" ? { followers: value.followers } : {}),
      ...(typeof value.following === "number" ? { following: value.following } : {}),
      ...(typeof value.avatar === "string" && value.avatar ? { avatar: value.avatar } : {}),
      profileUrl: typeof value.profileUrl === "string" ? value.profileUrl : `https://www.instagram.com/${value.username}/`,
      sourcePostUrl: normalizePostUrl(postUrl) || postUrl,
      postUrl: normalizePostUrl(postUrl) || postUrl,
      ...(postDate ? { postDate } : {})
    };
  }

  private async clickPoint(x: number, y: number): Promise<void> {
    await this.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  private async moveMouse(x: number, y: number): Promise<void> {
    await this.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  private async resolveProfileFromWebApi(username: string): Promise<InstagramDiscoveryRawItem | null> {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) return null;
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (async () => {
          const username = ${JSON.stringify(normalizedUsername)};
          const parseCount = (value) => {
            if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
            const raw = String(value || '').replace(/,/g, '').trim().toLowerCase();
            const match = raw.match(/([0-9]+(?:\\.[0-9]+)?)\\s*([kmb])?/);
            if (!match) return undefined;
            const base = Number(match[1]);
            const multiplier = match[2] === 'b' ? 1000000000 : match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1;
            return Number.isFinite(base) ? Math.round(base * multiplier) : undefined;
          };
          const pickUser = (payload) => payload?.data?.user || payload?.user || null;
          const endpoint = new URL('/api/v1/users/web_profile_info/', location.origin);
          endpoint.searchParams.set('username', username);
          try {
            const response = await fetch(endpoint.toString(), {
              credentials: 'include',
              headers: {
                'accept': 'application/json',
                'x-asbd-id': '129477',
                'x-ig-app-id': '936619743392459',
                'x-requested-with': 'XMLHttpRequest'
              }
            });
            const text = await response.text();
            let payload = null;
            try {
              payload = text ? JSON.parse(text) : null;
            } catch {
              payload = null;
            }
            const user = pickUser(payload);
            if (!response.ok || !user) {
              return { ok: false, status: response.status, textLength: text.length };
            }
            return {
              ok: true,
              username: String(user.username || username).replace(/^@/, '').trim().toLowerCase(),
              bio: String(user.biography || user.bio || '').trim(),
              followers: parseCount(user.edge_followed_by?.count ?? user.follower_count ?? user.followers),
              following: parseCount(user.edge_follow?.count ?? user.following_count ?? user.following),
              avatar: String(user.profile_pic_url_hd || user.profile_pic_url || ''),
              profileUrl: new URL('/' + username + '/', location.origin).toString()
            };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        })()
      `
    });
    const value = result.result?.value;
    if (!isRecord(value) || value.ok !== true || typeof value.username !== "string") {
      const debug = isRecord(value) ? value : {};
      console.info("[instagram-discovery] profile api failed", JSON.stringify({
        username: normalizedUsername,
        status: typeof debug.status === "number" ? debug.status : null,
        textLength: typeof debug.textLength === "number" ? debug.textLength : null,
        error: typeof debug.error === "string" ? debug.error : null
      }));
      return null;
    }
    const profile = {
      username: value.username,
      ...(typeof value.bio === "string" && value.bio ? { bio: value.bio } : {}),
      ...(typeof value.followers === "number" ? { followers: value.followers } : {}),
      ...(typeof value.following === "number" ? { following: value.following } : {}),
      ...(typeof value.avatar === "string" && value.avatar ? { avatar: value.avatar } : {}),
      profileUrl: typeof value.profileUrl === "string" ? value.profileUrl : `https://www.instagram.com/${value.username}/`
    };
    console.info("[instagram-discovery] profile api result", JSON.stringify({
      username: profile.username,
      hasFollowers: typeof profile.followers === "number",
      hasFollowing: typeof profile.following === "number",
      hasAvatar: Boolean(profile.avatar),
      hasBio: Boolean(profile.bio)
    }));
    return profile;
  }

  private async scanProfilePage(profileUrl: unknown): Promise<{ bio: string; followers?: number; following?: number; avatar: string }> {
    if (typeof profileUrl !== "string" || !profileUrl) return { bio: "", avatar: "" };
    await this.session.send("Page.navigate", { url: profileUrl });
    await this.waitForRuntimeCondition("Boolean(document.querySelector('header, main, meta[property=\"og:description\"], meta[name=\"description\"]'))", 10000);
    const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      returnByValue: true,
      expression: `
        (() => {
          const username = location.pathname.split('/').filter(Boolean)[0] || '';
          const parseCount = (value) => {
            const raw = String(value || '').replace(/,/g, '').trim().toLowerCase();
            const match = raw.match(/([0-9]+(?:\\.[0-9]+)?)\\s*([kmb])?/);
            if (!match) return undefined;
            const base = Number(match[1]);
            const multiplier = match[2] === 'b' ? 1000000000 : match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1;
            return Number.isFinite(base) ? Math.round(base * multiplier) : undefined;
          };
          const textOf = (node) => [
            node?.textContent || '',
            node?.getAttribute?.('aria-label') || '',
            node?.getAttribute?.('title') || ''
          ].join(' ');
          const description = Array.from(document.querySelectorAll('meta[property="og:description"], meta[name="description"]'))
            .map((node) => node.getAttribute('content') || '')
            .find(Boolean) || '';
          const followersLink = document.querySelector('a[href$="/followers/"], a[href*="/followers/"]');
          const followingLink = document.querySelector('a[href$="/following/"], a[href*="/following/"]');
          const followers = parseCount(description.match(/([0-9.,]+\\s*[kmb]?)\\s+followers/i)?.[1]) ?? parseCount(textOf(followersLink));
          const following = parseCount(description.match(/([0-9.,]+\\s*[kmb]?)\\s+following/i)?.[1]) ?? parseCount(textOf(followingLink));
          const header = document.querySelector('header') || document.querySelector('main');
          const headerLines = (header?.innerText || '')
            .split('\\n')
            .map((line) => line.trim())
            .filter(Boolean);
          const bioLine = headerLines.find((line) => {
            const normalized = line.toLowerCase();
            return normalized !== username.toLowerCase() &&
              !/^\\d/.test(normalized) &&
              !normalized.includes('posts') &&
              !normalized.includes('followers') &&
              !normalized.includes('following') &&
              !normalized.includes('follow') &&
              !normalized.includes('message');
          }) || '';
          const metaBio = description
            .replace(/^[^-]+-\\s*/, '')
            .replace(/See Instagram photos and videos from .*$/i, '')
            .trim();
          const bio = bioLine || metaBio;
          const avatar = document.querySelector('header img, main img')?.getAttribute('src') || '';
          return { bio, followers, following, avatar };
        })()
      `
    });
    const value = result.result?.value;
    if (!isRecord(value)) return { bio: "", avatar: "" };
    return {
      bio: typeof value.bio === "string" ? value.bio : "",
      ...(typeof value.followers === "number" ? { followers: value.followers } : {}),
      ...(typeof value.following === "number" ? { following: value.following } : {}),
      avatar: typeof value.avatar === "string" ? value.avatar : ""
    };
  }

  private async waitForRuntimeCondition(conditionExpression: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.session.send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          try {
            return Boolean(${conditionExpression});
          } catch {
            return false;
          }
        })()`
      });
      if (result.result?.value === true) return;
      await delay(500);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isModalAuthorPoint(value: unknown): value is { x: number; y: number; username: string; postUrl?: string; postDate?: string } {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number" && typeof value.username === "string";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
