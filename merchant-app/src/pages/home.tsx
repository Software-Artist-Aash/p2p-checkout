import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { createPublicClient, http } from "viem";
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
  { name: "nextTokenId", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

interface NFT {
  tokenId: number;
  productId: number;
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const orderId = params.get("orderId");
  const productIdParam = params.get("productId");
  const justPurchased = Boolean(orderId);

  const { user, ready, authenticated, login, logout } = usePrivy();
  const address = user?.wallet?.address as `0x${string}` | undefined;

  const [nfts, setNfts] = useState<NFT[]>([]);
  const [collectionName, setCollectionName] = useState("");
  const [collectionSymbol, setCollectionSymbol] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) { setLoading(false); return; }
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

        if (Number(balance) === 0) { setNfts([]); return; }

        const found: NFT[] = [];
        for (let i = Number(nextId) - 1; i >= 1 && found.length < 50; i--) {
          try {
            const owner = await publicClient.readContract({
              address: CLIENT_ADDRESS, abi: ERC721_ABI, functionName: "ownerOf", args: [BigInt(i)],
            });
            if ((owner as string).toLowerCase() === address.toLowerCase()) {
              const productId = await publicClient.readContract({
                address: CLIENT_ADDRESS, abi: ERC721_ABI, functionName: "tokenProduct", args: [BigInt(i)],
              });
              found.push({ tokenId: i, productId: Number(productId) });
            }
          } catch {}
        }
        setNfts(found);
      } finally {
        setLoading(false);
      }
    })();
  }, [address]);

  const dismissBanner = () => {
    params.delete("orderId");
    params.delete("productId");
    setParams(params, { replace: true });
  };

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={s.logo}>S</div>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Demo Store</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link to="/" style={s.navLink}>Shop</Link>
            {ready && authenticated ? (
              <button style={s.walletChip} onClick={logout}>
                <span style={s.walletDot} />
                <span style={s.mono}>
                  {address?.slice(0, 6)}…{address?.slice(-4)}
                </span>
              </button>
            ) : ready ? (
              <button style={s.headerBtn} onClick={login}>Sign in</button>
            ) : null}
          </div>
        </div>
      </header>

      <main style={s.main}>
        {justPurchased && (
          <div style={s.successBanner}>
            <div style={s.checkmark}>✓</div>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Payment successful</h2>
              <p style={{ color: "#4b5563", margin: "4px 0 0", fontSize: 13 }}>
                Order #{orderId}. Your NFT is highlighted below.
              </p>
            </div>
            <button style={s.bannerClose} onClick={dismissBanner} aria-label="Dismiss">×</button>
          </div>
        )}

        <div style={{ marginBottom: 24 }}>
          <h1 style={s.pageTitle}>My NFTs</h1>
          <p style={s.pageSubtitle}>
            Your collection from the Demo Store.
          </p>
        </div>

        {!ready ? (
          <p style={s.muted}>Loading…</p>
        ) : !authenticated ? (
          <div style={s.emptyCard}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Sign in to view your NFTs</h3>
            <p style={{ color: "#6b7280", margin: "8px 0 16px", fontSize: 14 }}>
              Connect your wallet to see what you own.
            </p>
            <button style={s.primaryBtn} onClick={login}>Connect Wallet</button>
          </div>
        ) : loading ? (
          <p style={s.muted}>Loading your collection…</p>
        ) : nfts.length === 0 ? (
          <div style={s.emptyCard}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>No NFTs yet</h3>
            <p style={{ color: "#6b7280", margin: "8px 0 16px", fontSize: 14 }}>
              Head to the shop to buy your first one.
            </p>
            <Link to="/" style={{ ...s.primaryBtn, textDecoration: "none", display: "inline-block" }}>
              Browse Shop
            </Link>
          </div>
        ) : (
          <>
            <p style={{ ...s.muted, marginBottom: 16 }}>
              {collectionName} ({collectionSymbol}) — {nfts.length} owned
            </p>
            <div style={s.grid}>
              {nfts.map((nft) => {
                const product = PRODUCTS.find((p) => p.id === nft.productId);
                const isHighlighted = productIdParam && Number(productIdParam) === nft.productId
                  && nft.tokenId === Math.max(...nfts.filter(n => n.productId === Number(productIdParam)).map(n => n.tokenId));
                return (
                  <div key={nft.tokenId} style={{
                    ...s.nftCard,
                    border: isHighlighted ? "2px solid #7C3AED" : "1px solid #e5e5e5",
                    boxShadow: isHighlighted ? "0 4px 16px rgba(124, 58, 237, 0.15)" : "0 1px 2px rgba(0,0,0,0.04)",
                  }}>
                    {product && <img src={product.image} alt={product.name} style={s.nftImage} />}
                    <div style={s.nftBody}>
                      <p style={{ fontSize: 11, color: "#9a9a9a", margin: 0, letterSpacing: "0.04em" }}>
                        Token #{nft.tokenId}
                      </p>
                      <h3 style={{ margin: "4px 0 6px", fontSize: 15, fontWeight: 600 }}>
                        {product?.name ?? `Product #${nft.productId}`}
                      </h3>
                      {isHighlighted && <span style={s.justPurchased}>Just purchased</span>}
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
  page: { minHeight: "100vh", background: "#fafafa", fontFamily: "Inter, system-ui, sans-serif", color: "#0a0b0d" },
  header: { background: "#fff", borderBottom: "1px solid #eaeaea", padding: "14px 24px" },
  headerInner: { maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { width: 28, height: 28, borderRadius: 8, background: "#0a0b0d", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 },
  navLink: { color: "#0a0b0d", textDecoration: "none", fontSize: 13, fontWeight: 500, padding: "8px 10px" },
  headerBtn: { padding: "8px 14px", background: "#0a0b0d", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  walletChip: { display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px 0 8px", background: "#f5f5f5", border: "1px solid #eaeaea", borderRadius: 999, fontSize: 12, color: "#0a0b0d", cursor: "pointer" },
  walletDot: { width: 8, height: 8, borderRadius: 999, background: "#0f9b53" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  main: { maxWidth: 1100, margin: "0 auto", padding: "32px 24px", width: "100%", boxSizing: "border-box" },
  pageTitle: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 },
  pageSubtitle: { color: "#6b6b6b", fontSize: 15, marginTop: 8 },
  muted: { color: "#6b6b6b", fontSize: 14, margin: 0 },
  successBanner: {
    display: "flex", alignItems: "center", gap: 14,
    background: "#ecfdf5", border: "1px solid #86efac", borderRadius: 12,
    padding: "16px 18px", marginBottom: 24,
  },
  checkmark: {
    width: 36, height: 36, borderRadius: "50%", background: "#22c55e", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0,
  },
  bannerClose: {
    width: 28, height: 28, border: "none", background: "transparent",
    fontSize: 20, color: "#6b7280", cursor: "pointer", lineHeight: 1,
  },
  emptyCard: {
    background: "#fff", border: "1px solid #eaeaea", borderRadius: 12, padding: 32, textAlign: "center" as const,
  },
  primaryBtn: {
    padding: "10px 18px", background: "#7C3AED", color: "#fff", border: "none",
    borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 },
  nftCard: { background: "#fff", borderRadius: 12, overflow: "hidden", transition: "box-shadow 0.2s" },
  nftImage: { width: "100%", aspectRatio: "1", objectFit: "cover" as const, display: "block" },
  nftBody: { padding: 14 },
  justPurchased: {
    display: "inline-block", background: "#7C3AED", color: "#fff",
    padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
  },
};
