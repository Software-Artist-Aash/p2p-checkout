import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useSendTransaction } from "@privy-io/react-auth";
import {
  createPublicClient,
  http,
  formatUnits,
  encodeFunctionData,
  stringToHex,
  parseUnits,
} from "viem";
import { baseSepolia, base } from "viem/chains";
import { CHAIN_ID, USDC_DECIMALS, CURRENCIES } from "../../lib/config";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;
const publicClient = createPublicClient({ chain, transport: http() });

// V2 ABI
const V2_ABI = [
  { name: "baseTxLimit", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "dailyTxCountLimit", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "userRP", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "rpToUsdc", type: "function", stateMutability: "view", inputs: [{ name: "currency", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "maxTxLimit", type: "function", stateMutability: "view", inputs: [{ name: "currency", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "getUserTxLimit", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "currency", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "getTodayCount", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "setBaseTxLimit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "limit", type: "uint256" }], outputs: [] },
  { name: "setDailyTxCountLimit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "count", type: "uint256" }], outputs: [] },
  { name: "setUserRP", type: "function", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "rp", type: "uint256" }], outputs: [] },
  { name: "setRpToUsdc", type: "function", stateMutability: "nonpayable", inputs: [{ name: "currency", type: "bytes32" }, { name: "usdcPerRp", type: "uint256" }], outputs: [] },
  { name: "setMaxTxLimit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "currency", type: "bytes32" }, { name: "cap", type: "uint256" }], outputs: [] },
] as const;

interface CurrencyRate {
  symbol: string;
  rate: bigint;
  maxTx: bigint;
}

export default function AdminLimits() {
  const { integratorAddr } = useOutletContext<{ integratorAddr: `0x${string}` }>();
  const { sendTransaction } = useSendTransaction();

  const [baseTxLimit, setBaseTxLimitVal] = useState<bigint | null>(null);
  const [dailyCountLimit, setDailyCountLimit] = useState<bigint | null>(null);
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [isV2, setIsV2] = useState(true);

  // Edit states
  const [editBaseTx, setEditBaseTx] = useState("");
  const [editDailyCount, setEditDailyCount] = useState("");
  const [editRate, setEditRate] = useState<Record<string, string>>({});
  const [editCap, setEditCap] = useState<Record<string, string>>({});
  const [rpUserAddr, setRpUserAddr] = useState("");
  const [rpValue, setRpValue] = useState("");
  const [rpLookupAddr, setRpLookupAddr] = useState("");
  const [rpLookupResult, setRpLookupResult] = useState<{ rp: string; todayCount: string } | null>(null);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const [bl, dc] = await Promise.all([
          publicClient.readContract({
            address: integratorAddr,
            abi: V2_ABI,
            functionName: "baseTxLimit",
          }),
          publicClient.readContract({
            address: integratorAddr,
            abi: V2_ABI,
            functionName: "dailyTxCountLimit",
          }),
        ]);
        setBaseTxLimitVal(bl);
        setDailyCountLimit(dc);

        const rateResults = await Promise.all(
          CURRENCIES.map(async (c) => {
            const currBytes = stringToHex(c.symbol, { size: 32 });
            const [rate, maxTx] = await Promise.all([
              publicClient
                .readContract({ address: integratorAddr, abi: V2_ABI, functionName: "rpToUsdc", args: [currBytes] })
                .catch(() => 0n),
              publicClient
                .readContract({ address: integratorAddr, abi: V2_ABI, functionName: "maxTxLimit", args: [currBytes] })
                .catch(() => 0n),
            ]);
            return { symbol: c.symbol, rate, maxTx };
          })
        );
        setRates(rateResults);
      } catch {
        setIsV2(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [integratorAddr]);

  const sendTx = async (functionName: string, args: any[]) => {
    setTxLoading(true);
    setMsg(null);
    try {
      const data = encodeFunctionData({
        abi: V2_ABI,
        functionName: functionName as any,
        args: args as any,
      });
      const { hash } = await sendTransaction({ to: integratorAddr, data });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`${functionName} succeeded`);
    } catch (err: any) {
      setMsg(err?.shortMessage || err?.message || "Failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleLookupRP = async () => {
    if (!rpLookupAddr) return;
    try {
      const [rp, todayCount] = await Promise.all([
        publicClient.readContract({
          address: integratorAddr,
          abi: V2_ABI,
          functionName: "userRP",
          args: [rpLookupAddr as `0x${string}`],
        }),
        publicClient.readContract({
          address: integratorAddr,
          abi: V2_ABI,
          functionName: "getTodayCount",
          args: [rpLookupAddr as `0x${string}`],
        }),
      ]);
      setRpLookupResult({ rp: rp.toString(), todayCount: todayCount.toString() });
    } catch {
      setRpLookupResult(null);
      setMsg("Error reading user data");
    }
  };

  if (loading) return <p style={{ color: "#888" }}>Loading limits config...</p>;

  if (!isV2) {
    return (
      <div>
        <h1 style={s.title}>Limits & RP</h1>
        <div style={s.section}>
          <p style={{ color: "#888" }}>
            This integrator is V1 (flat 50 USDC). Deploy IntegratorV2 to use RP-based per-tx limits and daily count limits.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={s.title}>Limits & RP</h1>

      {/* Global Config */}
      <div style={s.section}>
        <h3 style={s.subtitle}>Per-Transaction Limit (0 RP fallback)</h3>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "8px" }}>
          Current: {baseTxLimit !== null ? formatUnits(baseTxLimit, USDC_DECIMALS) : "—"} USDC per transaction
        </p>
        <p style={{ color: "#666", fontSize: "12px", marginBottom: "8px" }}>
          Users with 0 RP can spend this much per transaction, regardless of currency.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={s.input}
            placeholder="New base tx limit (USDC)"
            value={editBaseTx}
            onChange={(e) => setEditBaseTx(e.target.value)}
          />
          <button
            style={s.btn}
            disabled={txLoading || !editBaseTx}
            onClick={() => sendTx("setBaseTxLimit", [parseUnits(editBaseTx, USDC_DECIMALS)])}
          >
            Set
          </button>
        </div>
      </div>

      <div style={s.section}>
        <h3 style={s.subtitle}>Daily Transaction Count Limit</h3>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "8px" }}>
          Current: {dailyCountLimit?.toString() ?? "—"} transactions per day per user
        </p>
        <p style={{ color: "#666", fontSize: "12px", marginBottom: "8px" }}>
          Global cap on the number of orders any user can place in a single day.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={s.input}
            placeholder="Count (e.g., 10)"
            value={editDailyCount}
            onChange={(e) => setEditDailyCount(e.target.value)}
          />
          <button
            style={s.btn}
            disabled={txLoading || !editDailyCount}
            onClick={() => sendTx("setDailyTxCountLimit", [BigInt(editDailyCount)])}
          >
            Set
          </button>
        </div>
      </div>

      {/* Per-Currency Rates */}
      <div style={s.section}>
        <h3 style={s.subtitle}>Per-TX Limit for RP Users (by currency)</h3>
        <p style={{ color: "#666", fontSize: "12px", marginBottom: "12px" }}>
          Users with RP {'>'} 0: <code>tx_limit = RP × rate</code>, capped at max.
        </p>
        {rates.map((r) => (
          <div key={r.symbol} style={s.rateRow}>
            <span style={{ width: "50px", fontWeight: "600" }}>{r.symbol}</span>
            <div style={{ flex: 1, minWidth: "150px" }}>
              <span style={{ fontSize: "12px", color: "#888" }}>Rate: </span>
              <span>
                {r.rate > 0n ? formatUnits(r.rate, USDC_DECIMALS) : "default (1)"} USDC/RP
              </span>
            </div>
            <input
              style={{ ...s.input, width: "80px", flex: "none" }}
              placeholder="Rate"
              value={editRate[r.symbol] ?? ""}
              onChange={(e) => setEditRate({ ...editRate, [r.symbol]: e.target.value })}
            />
            <button
              style={s.btnSmall}
              disabled={txLoading || !editRate[r.symbol]}
              onClick={() =>
                sendTx("setRpToUsdc", [
                  stringToHex(r.symbol, { size: 32 }),
                  parseUnits(editRate[r.symbol] || "0", USDC_DECIMALS),
                ])
              }
            >
              Set
            </button>
            <span style={{ fontSize: "12px", color: "#888" }}>
              Max: {r.maxTx > 0n ? formatUnits(r.maxTx, USDC_DECIMALS) : "∞"}
            </span>
            <input
              style={{ ...s.input, width: "80px", flex: "none" }}
              placeholder="Max"
              value={editCap[r.symbol] ?? ""}
              onChange={(e) => setEditCap({ ...editCap, [r.symbol]: e.target.value })}
            />
            <button
              style={s.btnSmall}
              disabled={txLoading || editCap[r.symbol] === undefined}
              onClick={() =>
                sendTx("setMaxTxLimit", [
                  stringToHex(r.symbol, { size: 32 }),
                  parseUnits(editCap[r.symbol] || "0", USDC_DECIMALS),
                ])
              }
            >
              Cap
            </button>
          </div>
        ))}
      </div>

      {/* User RP Lookup */}
      <div style={s.section}>
        <h3 style={s.subtitle}>Lookup User</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={s.input}
            placeholder="User address"
            value={rpLookupAddr}
            onChange={(e) => setRpLookupAddr(e.target.value)}
          />
          <button style={s.btn} onClick={handleLookupRP}>
            Lookup
          </button>
        </div>
        {rpLookupResult && (
          <div style={{ marginTop: "8px", fontSize: "14px", color: "#ccc" }}>
            <p>RP: <strong>{rpLookupResult.rp}</strong></p>
            <p>Orders today: <strong>{rpLookupResult.todayCount}</strong> / {dailyCountLimit?.toString()}</p>
          </div>
        )}
      </div>

      {/* Set User RP */}
      <div style={s.section}>
        <h3 style={s.subtitle}>Set User RP</h3>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={s.input}
            placeholder="User address"
            value={rpUserAddr}
            onChange={(e) => setRpUserAddr(e.target.value)}
          />
          <input
            style={{ ...s.input, width: "80px", flex: "none" }}
            placeholder="RP"
            value={rpValue}
            onChange={(e) => setRpValue(e.target.value)}
          />
          <button
            style={s.btn}
            disabled={txLoading}
            onClick={() =>
              sendTx("setUserRP", [rpUserAddr as `0x${string}`, BigInt(rpValue || "0")])
            }
          >
            Set
          </button>
        </div>
      </div>

      {msg && (
        <p
          style={{
            color: msg.includes("Failed") || msg.includes("error") ? "#ef4444" : "#4ade80",
            fontSize: "14px",
            marginTop: "12px",
          }}
        >
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
    minWidth: 0,
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
  btnSmall: {
    padding: "4px 10px",
    background: "#7C3AED",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontSize: "12px",
    cursor: "pointer",
    flexShrink: 0,
  },
  rateRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 0",
    borderBottom: "1px solid #12121f",
    flexWrap: "wrap" as const,
  },
};
