import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Route, Routes, useLocation, Link } from 'react-router-dom';
import { CartProvider } from './state/cart';
import { LiveProvider } from './state/live';
import { UiProvider } from './state/ui';
import { MusicProvider } from './state/music';
import { GamesProvider } from './state/games';
import { BottomBar, Footer, Nav, Toast } from './components/Chrome';
import { Panels } from './components/Panels';
import { OrderAlerts } from './components/OrderAlerts';
import Home from './pages/Home';
import Menu from './pages/Menu';
import OrderStatus from './pages/OrderStatus';
import Licences from './pages/Licences';
import Bill from './pages/Bill';
import Card from './pages/Card';

// Games load only when someone opens them.
const Games = lazy(() => import('./pages/Games'));

// Staff screens load separately so guests never download them.
const Admin = lazy(() => import('./admin/AdminApp'));
import './styles.css';
import { Turntable } from './components/Gear';

// The shareable preview is served from a single page, so it routes with the hash.
const Router = import.meta.env.MODE === 'preview' ? HashRouter : BrowserRouter;

function NotFound() {
  const loc = useLocation();
  return (
    <div className="page">
      <Nav />
      <main className="wrap narrow notfound">
        <Turntable className="notfound-gear" />
        <h1 className="display">Wrong record.</h1>
        <p>There’s nothing at {loc.pathname}. The menu and bookings are a tap away.</p>
        <Link to="/" className="btn btn-ink">
          Go to the home page
        </Link>
      </main>
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
              <MusicProvider>
                <UiProvider>
                  <CartProvider>
                  <GamesProvider>
                    <Routes>
                      <Route path="/" element={<Home />} />
                      <Route path="/menu" element={<Menu />} />
                      <Route path="/order/:token" element={<OrderStatus />} />
                      <Route path="/licences" element={<Licences />} />
                      <Route path="/bill/:token" element={<Bill />} />
                      <Route path="/card" element={<Card />} />
                    <Route
                      path="/games/:game?"
                      element={
                        <Suspense fallback={<div className="page" />}>
                          <Games />
                        </Suspense>
                      }
                    />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                    <BottomBar />
                    <Panels />
                    <Toast />
                    <OrderAlerts />
                  </GamesProvider>
                  </CartProvider>
                </UiProvider>
              </MusicProvider>
            </LiveProvider>
          }
        />
      </Routes>
    </Router>
  </StrictMode>,
);
