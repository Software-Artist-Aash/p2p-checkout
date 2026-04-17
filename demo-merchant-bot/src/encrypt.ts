import fs from "node:fs";
import path from "node:path";
import EthCrypto from "eth-crypto";

const IDENTITY_FILE = path.resolve(process.cwd(), "relay-identity.json");

export interface RelayIdentity {
  address: string;
  publicKey: string;
  privateKey: string;
}

export function loadOrCreateRelayIdentity(): RelayIdentity {
  if (fs.existsSync(IDENTITY_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf8"));
      if (parsed.publicKey && parsed.privateKey && parsed.address) return parsed as RelayIdentity;
    } catch {}
  }
  const identity = EthCrypto.createIdentity();
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
  return identity;
}

export async function encryptForUser(userPubKey: string, plaintext: string): Promise<string> {
  const encrypted = await EthCrypto.encryptWithPublicKey(userPubKey, plaintext);
  return JSON.stringify(encrypted);
}
