import {
  createThirdwebClient,
  defineChain,
  type Chain as ThirdwebChain,
  type ThirdwebClient,
} from "thirdweb";
import {
  base as baseThirdweb,
  baseSepolia as baseSepoliaThirdweb,
} from "thirdweb/chains";
import { smartWallet, privateKeyToAccount } from "thirdweb/wallets";
import type { Account } from "thirdweb/wallets";
import type { Address, Hex } from "viem";
import type { BotConfig } from "./config.js";

export interface ThirdwebSetup {
  client: ThirdwebClient;
  chain: ThirdwebChain;
}

export function createSetup(config: BotConfig): ThirdwebSetup {
  const client = createThirdwebClient({ clientId: config.thirdwebClientId });
  const base = config.chainId === 8453 ? baseThirdweb : baseSepoliaThirdweb;
  const chain = defineChain({
    id: base.id,
    rpc: config.rpcUrl,
    nativeCurrency: base.nativeCurrency,
    testnet: base.testnet,
    blockExplorers: base.blockExplorers,
  });
  return { client, chain };
}

export async function connectSmartAccount(
  setup: ThirdwebSetup,
  config: BotConfig,
  privateKey: Hex,
): Promise<Account> {
  const personalAccount = privateKeyToAccount({
    client: setup.client,
    privateKey,
  });
  const wallet = smartWallet({
    chain: setup.chain,
    sponsorGas: true,
    factoryAddress: config.aaFactoryAddress,
  });
  return wallet.connect({ client: setup.client, personalAccount });
}

export function smartAccountAddress(account: Account): Address {
  return account.address as Address;
}
