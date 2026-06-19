/*
 * Wallet discovery for AdSplit — listens for EIP-6963 announcements and
 * keeps a running registry of every injected provider the page can reach.
 * The chosen wallet's rdns is parked in localStorage so a battle creator
 * comes back to the same signer next visit.
 */

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isRabby?: boolean;
  isMetaMask?: boolean;
}

interface ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

// Wallets we reach for first when the user hasn't pinned one yet.
const FALLBACK_ORDER = ["io.rabby", "io.metamask"];

// localStorage slot for the pinned wallet — namespace built from a stem so it
// doesn't collide with sibling dApps on the same origin.
const STORAGE_STEM = "adsplit";
const PINNED_RDNS_SLOT = `${STORAGE_STEM}::v1::signer`;

// Live registry of providers that have announced themselves.
const registry: ProviderDetail[] = [];

function upsert(entry?: ProviderDetail) {
  if (!entry?.info?.rdns || !entry.provider) return;
  const at = registry.findIndex((d) => d.info.rdns === entry.info.rdns);
  if (at >= 0) registry[at] = entry;
  else registry.push(entry);
}

// Kick off discovery as soon as this module loads in the browser.
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    upsert((e as CustomEvent<ProviderDetail>).detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function refreshWallets() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function setChosenRdns(rdns: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_RDNS_SLOT, rdns);
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export function getChosenRdns(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PINNED_RDNS_SLOT) || "";
  } catch {
    return "";
  }
}

export function listWallets() {
  refreshWallets();
  return registry.map((d) => ({ name: d.info.name, rdns: d.info.rdns, icon: d.info.icon }));
}

// Re-broadcast the request and wait until at least one provider answers
// (or until the timeout lapses, whichever comes first).
export function ensureDiscovered(timeoutMs = 250): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (registry.length) {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const onAnnounce = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve();
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(onAnnounce, timeoutMs);
  });
}

export function pickDetail(rdns?: string): { provider: Eip1193Provider; rdns: string } | undefined {
  refreshWallets();
  const target = rdns ?? getChosenRdns();
  if (target) {
    const pinned = registry.find((d) => d.info.rdns === target);
    if (pinned) return { provider: pinned.provider, rdns: pinned.info.rdns };
  }
  for (const candidate of FALLBACK_ORDER) {
    const hit = registry.find((d) => d.info.rdns === candidate);
    if (hit) return { provider: hit.provider, rdns: hit.info.rdns };
  }
  const first = registry[0];
  return first ? { provider: first.provider, rdns: first.info.rdns } : undefined;
}

export function pickProvider(rdns?: string): Eip1193Provider | undefined {
  const detail = pickDetail(rdns);
  if (detail) return detail.provider;
  return typeof window !== "undefined" ? (window.ethereum as Eip1193Provider | undefined) : undefined;
}
