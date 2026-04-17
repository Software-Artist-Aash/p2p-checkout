import { Buffer } from "buffer";
(window as any).Buffer = Buffer;

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PrivyAppProvider } from "./providers/privy-provider";
import Home from "./pages/home";
import Store from "./pages/store";
import Success from "./pages/success";

function App() {
  return (
    <PrivyAppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Store />} />
          <Route path="/my-nfts" element={<Home />} />
          <Route path="/success" element={<Success />} />
        </Routes>
      </BrowserRouter>
    </PrivyAppProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
