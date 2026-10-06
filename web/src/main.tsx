import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Route, Routes, useLocation, Link } from 'react-router-dom';
import { CartProvider } from './state/cart';
import { LiveProvider } from './state/live';
import { UiProvider } from './state/ui';
import { CartBar, Footer, Nav, Toast } from './components/Chrome';
import { Panels } from './components/Panels';
import Home from './pages/Home';
import Menu from './pages/Menu';
import OrderStatus from './pages/OrderStatus';
import Licences from './pages/Licences';

// Staff screens load separately so guests never download them.
const Admin = lazy(() => import('./admin/AdminApp'));
import './styles.css';

// The shareable preview is served from a single page, so it routes with the hash.
const Router = import.meta.env.MODE === 'preview' ? HashRouter : BrowserRouter;

function NotFound() {
  const loc = useLocation();
  return (
    <div className="zone-night">
      <Nav tone="night" />
      <section className="wrap notfound">
        <h1 className="display">Wrong record.</h1>
        <p>There’s nothing at {loc.pathname}. The menu and bookings are a tap away.</p>
        <Link to="/" className="btn btn-lemon">Go to the home page</Link>
      </section>
      <Footer />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<div className="admin-boot">Loading…</div>}>
              <Admin />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <LiveProvider>
              <UiProvider>
                <CartProvider>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/menu" element={<Menu />} />
                    <Route path="/order/:token" element={<OrderStatus />} />
                    <Route path="/licences" element={<Licences />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                  <CartBar />
                  <Panels />
                  <Toast />
                </CartProvider>
              </UiProvider>
            </LiveProvider>
          }
        />
      </Routes>
    </Router>
  </StrictMode>,
);
