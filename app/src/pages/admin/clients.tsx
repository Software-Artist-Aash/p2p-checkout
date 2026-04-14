import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useSendTransaction } from "@privy-io/react-auth";
import {
  createPublicClient,
  http,
  formatUnits,
  encodeFunctionData,
} from "viem";
import { baseSepolia, base } from "viem/chains";
import { CHAIN_ID, USDC_DECIMALS } from "../../lib/config";
import { CLIENT_ABI } from "../../lib/contracts";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;
const publicClient = createPublicClient({ chain, transport: http() });

const INTEGRATOR_ADMIN_ABI = [
  {
    name: "registerClient",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "client", type: "address" }],
    outputs: [],
  },
  {
    name: "removeClient",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "client", type: "address" }],
    outputs: [],
  },
  {
    name: "clients",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "client", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [{ name: "isRegistered", type: "bool" }],
      },
    ],
  },
] as const;

const ERC721_NAME_ABI = [
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;

const SET_PRICE_ABI = [
  {
    name: "setProductPrice",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "productId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

interface ClientInfo {
  address: string;
  isRegistered: boolean;
  name: string;
  symbol: string;
}

interface ProductInfo {
  id: number;
  price: bigint;
}

export default function AdminClients() {
  const { integratorAddr } = useOutletContext<{ integratorAddr: `0x${string}` }>();
  const { sendTransaction } = useSendTransaction();

  const [clientAddresses, setClientAddresses] = useState<string[]>([]);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [newClientAddr, setNewClientAddr] = useState("");
  const [newProductId, setNewProductId] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Load known clients from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`@P2P_ADMIN:CLIENTS:${integratorAddr}`);
    if (stored) setClientAddresses(JSON.parse(stored));
  }, [integratorAddr]);

  // Fetch client info
  useEffect(() => {
    if (clientAddresses.length === 0) {
      setClients([]);
      return;
    }
    Promise.all(
      clientAddresses.map(async (addr) => {
        const [reg, name, symbol] = await Promise.all([
          publicClient.readContract({
            address: integratorAddr,
            abi: INTEGRATOR_ADMIN_ABI,
            functionName: "clients",
            args: [addr as `0x${string}`],
          }).catch(() => ({ isRegistered: false })),
          publicClient.readContract({
            address: addr as `0x${string}`,
            abi: ERC721_NAME_ABI,
            functionName: "name",
          }).catch(() => "Unknown"),
          publicClient.readContract({
            address: addr as `0x${string}`,
            abi: ERC721_NAME_ABI,
            functionName: "symbol",
          }).catch(() => "?"),
        ]);
        return {
          address: addr,
          isRegistered: (reg as any).isRegistered,
          name: name as string,
          symbol: symbol as string,
        };
      })
    ).then(setClients);
  }, [clientAddresses, integratorAddr]);

  // Fetch products for selected client
  useEffect(() => {
    if (!selectedClient) { setProducts([]); return; }
    const prods: ProductInfo[] = [];
    const fetchProd = async (id: number) => {
      try {
        const price = await publicClient.readContract({
          address: selectedClient as `0x${string}`,
          abi: CLIENT_ABI,
          functionName: "getProductPrice",
          args: [BigInt(id)],
        });
        if (price > 0n) prods.push({ id, price });
      } catch {}
    };
    // Check product IDs 1-20
    Promise.all(Array.from({ length: 20 }, (_, i) => fetchProd(i + 1))).then(() =>
      setProducts([...prods].sort((a, b) => a.id - b.id))
    );
  }, [selectedClient]);

  const saveClients = (addrs: string[]) => {
    setClientAddresses(addrs);
    localStorage.setItem(`@P2P_ADMIN:CLIENTS:${integratorAddr}`, JSON.stringify(addrs));
  };

  const handleAddClient = async () => {
    if (!newClientAddr) return;
    setLoading(true);
    setMsg(null);
    try {
      const data = encodeFunctionData({
        abi: INTEGRATOR_ADMIN_ABI,
        functionName: "registerClient",
        args: [newClientAddr as `0x${string}`],
      });
      const { hash } = await sendTransaction({ to: integratorAddr, data });
      await publicClient.waitForTransactionReceipt({ hash });
      if (!clientAddresses.includes(newClientAddr.toLowerCase())) {
        saveClients([...clientAddresses, newClientAddr.toLowerCase()]);
      }
      setNewClientAddr("");
      setMsg("Client registered!");
    } catch (err: any) {
      setMsg(err?.shortMessage || err?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSetPrice = async () => {
    if (!selectedClient || !newProductId || !newProductPrice) return;
    setLoading(true);
    setMsg(null);
    try {
      const price = BigInt(Math.round(parseFloat(newProductPrice) * 1e6));
      const data = encodeFunctionData({
        abi: SET_PRICE_ABI,
        functionName: "setProductPrice",
        args: [BigInt(newProductId), price],
      });
      const { hash } = await sendTransaction({
        to: selectedClient as `0x${string}`,
        data,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`Product #${newProductId} price set to ${newProductPrice} USDC`);
      setNewProductId("");
      setNewProductPrice("");
    } catch (err: any) {
      setMsg(err?.shortMessage || err?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 style={s.title}>Clients & Products</h1>

      {/* Add Client */}
      <div style={s.section}>
        <h3 style={s.subtitle}>Register Client</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={s.input}
            placeholder="Client contract address"
            value={newClientAddr}
            onChange={(e) => setNewClientAddr(e.target.value)}
          />
          <button style={s.btn} onClick={handleAddClient} disabled={loading}>
            {loading ? "..." : "Register"}
          </button>
        </div>
      </div>

      {/* Track existing client (no tx, just add to local list) */}
      <div style={s.section}>
        <h3 style={s.subtitle}>Track Existing Client</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={s.input}
            placeholder="Client address to track"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v.length === 42 && !clientAddresses.includes(v.toLowerCase())) {
                saveClients([...clientAddresses, v.toLowerCase()]);
              }
            }}
          />
        </div>
      </div>

      {/* Client List */}
      {clients.length > 0 && (
        <div style={s.section}>
          <h3 style={s.subtitle}>Registered Clients</h3>
          {clients.map((c) => (
            <div
              key={c.address}
              style={{
                ...s.clientRow,
                border:
                  selectedClient === c.address
                    ? "1px solid #7C3AED"
                    : "1px solid #2a2a4a",
              }}
              onClick={() => setSelectedClient(c.address)}
            >
              <div>
                <span style={{ fontWeight: "600" }}>{c.name}</span>
                <span style={{ color: "#888", marginLeft: "8px" }}>({c.symbol})</span>
              </div>
              <div style={{ fontSize: "12px", color: "#888", fontFamily: "monospace" }}>
                {c.address.slice(0, 10)}...{c.address.slice(-6)}
              </div>
              <span
                style={{
                  fontSize: "11px",
                  color: c.isRegistered ? "#4ade80" : "#f87171",
                }}
              >
                {c.isRegistered ? "Registered" : "Not registered"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Products for selected client */}
      {selectedClient && (
        <div style={s.section}>
          <h3 style={s.subtitle}>
            Products — {clients.find((c) => c.address === selectedClient)?.name}
          </h3>
          {products.length === 0 ? (
            <p style={{ color: "#555", fontSize: "14px" }}>No products found (checked IDs 1-20)</p>
          ) : (
            products.map((p) => (
              <div key={p.id} style={s.productRow}>
                <span>#{p.id}</span>
                <span>{formatUnits(p.price, USDC_DECIMALS)} USDC</span>
              </div>
            ))
          )}

          <div style={{ marginTop: "12px" }}>
            <h4 style={{ fontSize: "13px", color: "#888", marginBottom: "8px" }}>
              Set Product Price
            </h4>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                style={{ ...s.input, width: "80px" }}
                placeholder="ID"
                value={newProductId}
                onChange={(e) => setNewProductId(e.target.value)}
              />
              <input
                style={s.input}
                placeholder="Price (USDC)"
                value={newProductPrice}
                onChange={(e) => setNewProductPrice(e.target.value)}
              />
              <button style={s.btn} onClick={handleSetPrice} disabled={loading}>
                Set
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <p style={{ color: msg.includes("Failed") ? "#ef4444" : "#4ade80", fontSize: "14px", marginTop: "12px" }}>
          {msg}
        </p>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  title: { fontSize: "22px", fontWeight: "700", marginBottom: "24px" },
  subtitle: { fontSize: "14px", fontWeight: "600", marginBottom: "8px" },
  section: {
    background: "#1a1a2e",
    borderRadius: "12px",
    border: "1px solid #2a2a4a",
    padding: "16px",
    marginBottom: "16px",
  },
  input: {
    flex: 1,
    padding: "8px 12px",
    background: "#12121f",
    border: "1px solid #2a2a4a",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "13px",
  },
  btn: {
    padding: "8px 16px",
    background: "#7C3AED",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    cursor: "pointer",
    flexShrink: 0,
  },
  clientRow: {
    padding: "10px 14px",
    borderRadius: "8px",
    marginBottom: "6px",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  productRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    fontSize: "14px",
    borderBottom: "1px solid #12121f",
  },
};
