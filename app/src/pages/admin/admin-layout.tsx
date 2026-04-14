import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useCheckoutWallet } from "../../hooks/use-checkout-wallet";
import { createPublicClient, http } from "viem";
import { baseSepolia, base } from "viem/chains";
import { CHAIN_ID } from "../../lib/config";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;
const publicClient = createPublicClient({ chain, transport: http() });

// ABI for owner() on integrator
const OWNER_ABI = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const NAV_ITEMS = [
  { path: "/admin", label: "Dashboard" },
  { path: "/admin/orders", label: "Orders" },
  { path: "/admin/clients", label: "Clients" },
  { path: "/admin/limits", label: "RP & Limits" },
];

export default function AdminLayout() {
  const { ready, authenticated, login, address } = useCheckoutWallet();
  const location = useLocation();
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const integratorAddr = new URLSearchParams(window.location.search).get("integrator") as `0x${string}` | null;

  useEffect(() => {
    if (!address || !integratorAddr) return;
    publicClient
      .readContract({
        address: integratorAddr,
        abi: OWNER_ABI,
        functionName: "owner",
      })
      .then((owner) => {
        setIsOwner(owner.toLowerCase() === address.toLowerCase());
      })
      .catch(() => setIsOwner(false));
  }, [address, integratorAddr]);

  if (!integratorAddr) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>Admin Panel</h2>
          <p style={{ color: "#888" }}>
            Add <code>?integrator=0x...</code> to the URL.
          </p>
        </div>
      </div>
    );
  }

  if (!ready) return <div style={styles.container}><p>Loading...</p></div>;

  if (!authenticated) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>Admin Panel</h2>
          <p style={{ color: "#888", marginBottom: "16px" }}>
            Connect with the integrator owner wallet.
          </p>
          <button style={styles.button} onClick={login}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  if (isOwner === null) {
    return <div style={styles.container}><p>Verifying owner...</p></div>;
  }

  if (!isOwner) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2>Access Denied</h2>
          <p style={{ color: "#ef4444" }}>
            {address?.slice(0, 6)}...{address?.slice(-4)} is not the owner of this integrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.shell}>
        {/* Nav */}
        <nav style={styles.nav}>
          <h2 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "16px" }}>
            Admin
          </h2>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={`${item.path}?integrator=${integratorAddr}`}
              style={{
                ...styles.navLink,
                background:
                  location.pathname === item.path ? "#2a2a4a" : "transparent",
                color: location.pathname === item.path ? "#fff" : "#888",
              }}
            >
              {item.label}
            </Link>
          ))}
          <div style={{ marginTop: "auto", fontSize: "11px", color: "#555" }}>
            {integratorAddr.slice(0, 8)}...{integratorAddr.slice(-6)}
          </div>
        </nav>

        {/* Content */}
        <main style={styles.main}>
          <Outlet context={{ integratorAddr, publicClient }} />
        </main>
      </div>
    </div>
  );
}

// Admin pages use useOutletContext<{ integratorAddr: string }> directly from react-router-dom

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#0a0a0a",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#fff",
    display: "flex",
    justifyContent: "center",
    padding: "16px",
  },
  card: {
    background: "#1a1a2e",
    borderRadius: "16px",
    padding: "32px",
    maxWidth: "420px",
    width: "100%",
    alignSelf: "center",
  },
  button: {
    width: "100%",
    padding: "14px",
    background: "#7C3AED",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    fontSize: "16px",
    fontWeight: "600",
    cursor: "pointer",
  },
  shell: {
    display: "flex",
    maxWidth: "1000px",
    width: "100%",
    gap: "24px",
    paddingTop: "32px",
  },
  nav: {
    width: "180px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flexShrink: 0,
  },
  navLink: {
    display: "block",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "14px",
    textDecoration: "none",
    fontWeight: "500",
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
};
