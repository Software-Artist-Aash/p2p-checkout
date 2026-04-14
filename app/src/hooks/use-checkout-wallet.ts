import { usePrivy, useWallets, getEmbeddedConnectedWallet } from "@privy-io/react-auth";
import { useMemo } from "react";

/**
 * Hook to get the user's Privy wallet for the checkout flow.
 * Uses getEmbeddedConnectedWallet() to find the Privy-managed wallet.
 */
export function useCheckoutWallet() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const wallet = useMemo(() => {
    // Use Privy's helper to find the embedded wallet
    return getEmbeddedConnectedWallet(wallets) ?? wallets[0] ?? null;
  }, [wallets]);

  return {
    ready,
    authenticated,
    login,
    logout,
    wallet,
    address: wallet?.address as `0x${string}` | undefined,
    user,
  };
}
