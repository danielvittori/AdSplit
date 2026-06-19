"use client";

import { ethers } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureDiscovered, pickDetail, pickProvider, setChosenRdns, type Eip1193Provider } from "./wallet";
import { ARC_CHAIN_HEX, ARC_RPC, switchToArc } from "./arcNetwork";

// Flag we set in localStorage when the user deliberately walks away — keeps an
// eager auto-reconnect from dragging them back in on the next page load.
const SESSION_NS = "adsplit";
const OPTED_OUT_FLAG = `${SESSION_NS}/walletOptOut`;

const isArc = (chainId: string) => chainId.toLowerCase() === ARC_CHAIN_HEX.toLowerCase();

export function useWallet() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const optedOutRef = useRef(false);
  const subRef = useRef<{ provider: Eip1193Provider; cleanup: () => void } | null>(null);

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const rpc = new ethers.JsonRpcProvider(ARC_RPC);
      const wei = await rpc.getBalance(addr);
      setBalance(parseFloat(ethers.formatEther(wei)).toFixed(3));
    } catch {
      setBalance("вЂ”");
    }
  }, []);

  const subscribe = useCallback(
    (inj: Eip1193Provider) => {
      if (!inj?.on) return;
      if (subRef.current?.provider === inj) return;
      subRef.current?.cleanup();

      const handleAccounts = (payload: unknown) => {
        if (optedOutRef.current) return;
        const next = payload as string[];
        if (next.length) {
          setAccount(next[0]);
          refreshBalance(next[0]);
        } else {
          setAccount("");
          setBalance("");
          setChainOk(false);
        }
      };
      const handleChain = (payload: unknown) => setChainOk(isArc(payload as string));

      inj.on("accountsChanged", handleAccounts);
      inj.on("chainChanged", handleChain);
      subRef.current = {
        provider: inj,
        cleanup: () => {
          inj.removeListener?.("accountsChanged", handleAccounts);
          inj.removeListener?.("chainChanged", handleChain);
        },
      };
    },
    [refreshBalance]
  );

  // Explicit user-initiated connect: clear the opt-out, prompt for accounts,
  // then nudge the wallet onto ARC Testnet.
  const connect = useCallback(async () => {
    optedOutRef.current = false;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(OPTED_OUT_FLAG);
      } catch {
        /* ignore */
      }
    }
    await ensureDiscovered();
    const detail = pickDetail();
    const inj = detail?.provider;
    if (!inj) return;
    setChosenRdns(detail.rdns);
    setConnecting(true);
    try {
      const accs = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.length) return;
      setAccount(accs[0]);
      subscribe(inj);
      try {
        await switchToArc(inj);
      } catch {
        /* user declined the network switch */
      }
      try {
        const id = (await inj.request({ method: "eth_chainId" })) as string;
        setChainOk(isArc(id));
      } catch {
        setChainOk(false);
      }
      refreshBalance(accs[0]);
    } catch {
      /* user rejected */
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance, subscribe]);

  // Local-only sign-out: we can't revoke the dApp permission, so we just drop
  // our state and remember the choice for next time.
  const disconnect = useCallback(() => {
    optedOutRef.current = true;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(OPTED_OUT_FLAG, "1");
      } catch {
        /* ignore */
      }
    }
    setAccount("");
    setBalance("");
    setChainOk(false);
  }, []);

  // On mount: honor a prior opt-out, otherwise silently rehydrate from any
  // already-authorized account and wire up live event listeners.
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(OPTED_OUT_FLAG) === "1") {
      optedOutRef.current = true;
    }
    (async () => {
      await ensureDiscovered();
      const inj = pickProvider();
      if (!inj) return;
      if (!optedOutRef.current) {
        try {
          const accs = (await inj.request({ method: "eth_accounts" })) as string[];
          if (accs.length) {
            setAccount(accs[0]);
            refreshBalance(accs[0]);
            inj
              .request({ method: "eth_chainId" })
              .then((id) => setChainOk(isArc(id as string)))
              .catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
      subscribe(inj);
    })();
    return () => {
      subRef.current?.cleanup();
      subRef.current = null;
    };
  }, [refreshBalance, subscribe]);

  return { account, balance, chainOk, connecting, connect, disconnect, refreshBalance };
}
