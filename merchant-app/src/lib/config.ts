export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? "8453");
export const CHECKOUT_URL = import.meta.env.VITE_CHECKOUT_URL ?? "http://localhost:3000";
export const INTEGRATOR_ADDRESS = (import.meta.env.VITE_INTEGRATOR_ADDRESS ?? "") as `0x${string}`;
export const CLIENT_ADDRESS = (import.meta.env.VITE_CLIENT_ADDRESS ?? "") as `0x${string}`;

export const PRODUCTS = [
  {
    id: 1,
    name: "Common NFT",
    description: "A common tier NFT from our collection.",
    priceUsdc: 5,
    image: "https://api.dicebear.com/9.x/shapes/svg?seed=common&backgroundColor=7c3aed",
  },
  {
    id: 2,
    name: "Rare NFT",
    description: "A rare NFT with unique attributes.",
    priceUsdc: 10,
    image: "https://api.dicebear.com/9.x/shapes/svg?seed=rare&backgroundColor=22c55e",
  },
  {
    id: 3,
    name: "Legendary NFT",
    description: "The top-tier legendary NFT.",
    priceUsdc: 25,
    image: "https://api.dicebear.com/9.x/shapes/svg?seed=legendary&backgroundColor=fbbf24",
  },
];
