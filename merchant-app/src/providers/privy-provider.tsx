import { PrivyProvider as Privy } from "@privy-io/react-auth";
import { baseSepolia, base } from "viem/chains";
import { PRIVY_APP_ID, CHAIN_ID } from "../lib/config";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;

/**
 * Privy provider — uses SAME app ID as the checkout app so the user's
 * embedded wallet session is shared. They log in once on the merchant site,
 * and stay logged in when redirected to checkout.
 */
export function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  return (
    <Privy
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: "light", accentColor: "#7C3AED" },
        defaultChain: chain,
        supportedChains: [chain],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </Privy>
  );
}
