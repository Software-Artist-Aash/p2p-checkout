import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia, base } from "viem/chains";
import { CHAIN_ID, CLIENT_ADDRESS, PRODUCTS } from "../lib/config";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;
const publicClient = createPublicClient({ chain, transport: http() });

const ERC721_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { name: "tokenProduct", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "tokenBuyer", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { name: "nextTokenId", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface NFT {
  tokenId: number;
  productId: number;
}

export default function Success() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId");
  const productIdParam = params.get("productId");

  const { user, ready, authenticated, login } = usePrivy();
  const address = user?.wallet?.address as `0x${string}` | undefined;

  const [nfts, setNfts] = useState<NFT[]>([]);
  const [collectionName, setCollectionName] = useState("");
  const [collectionSymbol, setCollectionSymbol] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    (async () => {
      try {
        const [name, symbol, balance, nextId] = await Promise.all([
          publicClient.readContract({ address: CLIENT_ADDRESS, abi: ERC721_ABI, functionName: "name" }),
          publicClient.readContract({ address: CLIENT_ADDRESS, abi: ERC721_ABI, functionName: "symbol" }),
          publicClient.readContract({ address: CLIENT_ADDRESS, abi: ERC721_ABI, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ address: CLIENT_ADDRESS, abi: ERC721_ABI, functionName: "nextTokenId" }),
        ]);

        setCollectionName(name as string);
        setCollectionSymbol(symbol as string);

        if (Number(balance) === 0) {
          setNfts([]);
          return;
        }

        // Walk all token IDs from highest to lowest, collect ones owned by user
        // (most recent purchases first)
        const found: NFT[] = [];
        for (let i = Number(nextId) - 1; i >= 1 && found.length < 20; i--) {
          try {
            const owner = await publicClient.readContract({
              address: CLIENT_ADDRESS,
              abi: ERC721_ABI,
              functionName: "ownerOf",
              args: [BigInt(i)],
            });
            if ((owner as string).toLowerCase() === address.toLowerCase()) {
              const productId = await publicClient.readContract({
                address: CLIENT_ADDRESS,
                abi: ERC721_ABI,
                functionName: "tokenProduct",
                args: [BigInt(i)],
              });
              found.push({ tokenId: i, productId: Number(productId) });
            }
          } catch {
            // Token might be burned or not exist
          }
        }
        setNfts(found);
      } finally {
        setLoading(false);
      }
    })();
  }, [address]);

  if (!ready) return <div style={s.page}><p>Loading...</p></div>;

  if (!authenticated) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h2>Sign In</h2>
          <p style={{ color: "#666", marginBottom: "16px" }}>
            Connect your wallet to view your purchase.
          </p>
          <button style={s.btn} onClick={login}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <Link to="/" style={{ color: "#7C3AED", textDecoration: "none", fontWeight: "600" }}>
          ← Back to store
        </Link>
      </header>

      <main style={s.main}>
        <div style={s.successBanner}>
          <div style={s.checkmark}>✓</div>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px" }}>Payment Successful</h1>
            {orderId && (
              <p style={{ color: "#666", margin: "4px 0 0", fontSize: "14px" }}>
                Order #{orderId}
              </p>
            )}
          </div>
        </div>

        <h2 style={s.subtitle}>Your NFTs</h2>
        {loading ? (
          <p style={{ color: "#666" }}>Loading your collection...</p>
        ) : nfts.length === 0 ? (
          <p style={{ color: "#666" }}>No NFTs found in your wallet yet. The blockchain may take a moment to reflect.</p>
        ) : (
          <>
            <p style={{ color: "#666", fontSize: "14px", marginBottom: "16px" }}>
              {collectionName} ({collectionSymbol}) — {nfts.length} owned
            </p>
            <div style={s.grid}>
              {nfts.map((nft) => {
                const product = PRODUCTS.find((p) => p.id === nft.productId);
                const isJustPurchased = productIdParam && Number(productIdParam) === nft.productId;
                return (
                  <div key={nft.tokenId} style={{
                    ...s.nftCard,
                    border: isJustPurchased ? "2px solid #7C3AED" : "1px solid #e5e5e5",
                  }}>
                    {product && <img src={product.image} alt={product.name} style={s.nftImage} />}
                    <div style={s.nftBody}>
                      <p style={{ fontSize: "11px", color: "#888", margin: 0 }}>
                        Token #{nft.tokenId}
                      </p>
                      <h3 style={{ margin: "4px 0", fontSize: "15px" }}>
                        {product?.name ?? `Product #${nft.productId}`}
                      </h3>
                      {isJustPurchased && (
                        <span style={s.justPurchased}>Just purchased</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#fafafa", fontFamily: "system-ui, sans-serif", color: "#111" },
  header: { padding: "20px 32px", background: "#fff", borderBottom: "1px solid #e5e5e5" },
  main: { maxWidth: "900px", margin: "0 auto", padding: "32px" },
  card: { background: "#fff", borderRadius: "12px", padding: "32px", maxWidth: "400px", margin: "80px auto", textAlign: "center" as const },
  btn: {
    padding: "10px 20px", background: "#7C3AED", color: "#fff", border: "none",
    borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: "pointer",
  },
  successBanner: {
    display: "flex", alignItems: "center", gap: "16px",
    background: "#ecfdf5", border: "1px solid #86efac", borderRadius: "12px",
    padding: "20px", marginBottom: "32px",
  },
  checkmark: {
    width: 48, height: 48, borderRadius: "50%", background: "#22c55e", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "24px", fontWeight: "700", flexShrink: 0,
  },
  subtitle: { fontSize: "20px", fontWeight: "700", margin: "0 0 8px" },
  grid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px",
  },
  nftCard: { background: "#fff", borderRadius: "12px", overflow: "hidden" },
  nftImage: { width: "100%", aspectRatio: "1", objectFit: "cover" as const },
  nftBody: { padding: "12px" },
  justPurchased: {
    display: "inline-block", background: "#7C3AED", color: "#fff",
    padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: "500",
  },
};
