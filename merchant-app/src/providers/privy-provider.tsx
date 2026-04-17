import { PrivyProvider as Privy } from "@privy-io/react-auth";
import { baseSepolia, base } from "viem/chains";
import { PRIVY_APP_ID, CHAIN_ID } from "../lib/config";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;

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
          showWalletUIs: false,
        },
      }}
    >
      {children}
    </Privy>
  );
}
