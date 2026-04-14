import { Buffer } from "buffer";
(window as any).Buffer = Buffer;

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PrivyAppProvider } from "./providers/privy-provider";
import CheckoutPage from "./pages/checkout";
import CheckoutOrderPage from "./pages/checkout-order";
import AdminLayout from "./pages/admin/admin-layout";
import AdminDashboard from "./pages/admin/dashboard";
import AdminOrders from "./pages/admin/orders";
import AdminClients from "./pages/admin/clients";
import AdminLimits from "./pages/admin/limits";

function App() {
  return (
    <PrivyAppProvider>
      <BrowserRouter>
        <Routes>
          {/* Checkout */}
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/checkout/order/:orderId" element={<CheckoutOrderPage />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="clients" element={<AdminClients />} />
            <Route path="limits" element={<AdminLimits />} />
          </Route>
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
