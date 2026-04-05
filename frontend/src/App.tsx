/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  🏆 StrongLogistics — Оптимізація маршрутів CVRP             ║
 * ║  React + TypeScript + Tailwind + Leaflet                     ║
 * ║  Hackathon MVP — Усі тексти українською 🇺🇦                  ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type FormEvent,
} from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import axios, { type AxiosError } from "axios";

// ─── API ────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ─── Types ──────────────────────────────────────────────
interface Warehouse {
  id: number;
  name: string;
  lat: number;
  lng: number;
  stock: number;
  initial_stock: number;
}

interface DeliveryPoint {
  id: number;
  name: string;
  lat: number;
  lng: number;
  demand: number;
  priority: "critical" | "high" | "normal";
  allocated_amount: number;
}

interface RouteItem {
  id: number;
  name: string;
  lat: number;
  lng: number;
  priority: string;
  demand: number;
  allocated_amount: number;
  visit_order: number;
  distance_from_warehouse_km: number;
  assigned_warehouse_id: number;
}

interface AllocateResponse {
  route: RouteItem[];
  total_allocated: number;
  total_distance_km: number;
  solver_status: string;
  solve_time_ms: number;
  unserved: RouteItem[];
}

interface StatusResponse {
  warehouses: Warehouse[];
  delivery_points: DeliveryPoint[];
}

interface NearestItem {
  id: number;
  name: string;
  lat: number;
  lng: number;
  stock: number;
  distance_km: number;
}

// ─── Priority config ────────────────────────────────────
const PRIORITY_COLOR: Record<string, string> = {
  critical: "#ff3b3b",
  high: "#ff9500",
  normal: "#34c759",
};

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Критичний",
  high: "Високий",
  normal: "Нормальний",
};

const PRIORITY_PENALTY_LABEL: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  normal: "🟢",
};

// ─── Warehouse colors ───────────────────────────────────
const WH_COLORS: Record<number, { color: string; label: string }> = {
  1: { color: "#3862ff", label: "blue" },
  2: { color: "#a855f7", label: "purple" },
};

// ─── Leaflet DivIcon helpers ────────────────────────────
function warehouseIcon(whId: number): L.DivIcon {
  const c = WH_COLORS[whId] || { color: "#3862ff" };
  return L.divIcon({
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="
      width:44px;height:44px;display:flex;align-items:center;justify-content:center;
      font-size:22px;border-radius:12px;
      background:${c.color}22;border:2px solid ${c.color};
      box-shadow:0 0 18px ${c.color}80, 0 0 40px ${c.color}40;
      position:relative;
    ">🏭</div>`,
  });
}

function deliveryIcon(priority: string, allocated: boolean): L.DivIcon {
  const color = PRIORITY_COLOR[priority] || "#34c759";
  const opacity = allocated ? 1 : 0.35;
  const pulseRings =
    priority === "critical"
      ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};animation:sl-pulse 1.5s cubic-bezier(.4,0,.6,1) infinite;pointer-events:none;"></div>
         <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};animation:sl-pulse 1.5s cubic-bezier(.4,0,.6,1) infinite;animation-delay:.5s;pointer-events:none;"></div>`
      : "";
  return L.divIcon({
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:${color}20;border:2px solid ${color};
      display:flex;align-items:center;justify-content:center;
      font-size:14px;font-weight:700;color:${color};
      opacity:${opacity};position:relative;
      box-shadow:0 0 12px ${color}60;
    ">
      ${PRIORITY_PENALTY_LABEL[priority] || "📦"}
      ${pulseRings}
    </div>`,
  });
}

// ─── Animated Polyline Component ────────────────────────
function AnimatedRoute({
  positions,
  color,
}: {
  positions: [number, number][];
  color: string;
}) {
  const map = useMap();
  const lineRef = useRef<L.Polyline | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (positions.length < 2) return;

    // Faint underline
    const under = L.polyline(positions, {
      color,
      weight: 3,
      opacity: 0.15,
      dashArray: undefined,
    }).addTo(map);

    // Animated dashed line
    const line = L.polyline(positions, {
      color,
      weight: 2.5,
      opacity: 0.85,
      dashArray: "8 12",
      dashOffset: "0",
    }).addTo(map);
    lineRef.current = line;

    let offset = 0;
    const animate = () => {
      offset = (offset - 1) % 28;
      const el = line.getElement();
      if (el) el.style.strokeDashoffset = String(offset);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      map.removeLayer(under);
      map.removeLayer(line);
    };
  }, [positions, color, map]);

  return null;
}

// ═════════════════════════════════════════════════════════
//  LOGIN SCREEN COMPONENT
// ═════════════════════════════════════════════════════════
function LoginScreen({
  onLogin,
}: {
  onLogin: (token: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/login`, { username, password });
      onLogin(res.data.access_token);
    } catch (err) {
      const axErr = err as AxiosError<{ detail?: string }>;
      setError(axErr.response?.data?.detail || "Помилка авторизації");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
         style={{ background: "#03050f" }}>
      <div className="sl-glass rounded-2xl p-8 w-full max-w-sm"
           style={{ animation: "sl-fade-in 0.4s ease-out" }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
               style={{
                 background: "linear-gradient(135deg, #3862ff, #6366f1)",
                 boxShadow: "0 0 30px rgba(56,98,255,0.4)",
               }}>
            <span className="text-3xl">🚛</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            STRONG<span className="sl-gradient-text">LOGISTICS</span>
          </h1>
          <p className="text-sm mt-1" style={{ color: "#6b7a99" }}>
            Система оптимізації
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5"
                   style={{ color: "#6b7a99" }}>
              Логін
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="w-full"
              style={{
                background: "rgba(8,12,26,0.9)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "10px 14px",
                color: "#c8d6f0",
                fontSize: "14px",
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5"
                   style={{ color: "#6b7a99" }}>
              Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full"
              style={{
                background: "rgba(8,12,26,0.9)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px",
                padding: "10px 14px",
                color: "#c8d6f0",
                fontSize: "14px",
              }}
            />
          </div>

          {error && (
            <div className="text-sm text-center py-2 rounded-lg"
                 style={{ background: "rgba(255,59,59,0.1)", color: "#ff3b3b" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white cursor-pointer transition-all duration-300"
            style={{
              background: "linear-gradient(135deg, #3862ff, #6366f1)",
              boxShadow: "0 4px 20px rgba(56,98,255,0.4)",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                      style={{ animation: "sl-spin 0.8s linear infinite" }} />
                Входимо...
              </span>
            ) : (
              "Увійти"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════
//  MAIN APP COMPONENT
// ═════════════════════════════════════════════════════════
function App() {
  // Auth
  const tokenRef = useRef<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [points, setPoints] = useState<DeliveryPoint[]>([]);
  const [routeItems, setRouteItems] = useState<RouteItem[]>([]);
  const [unserved, setUnserved] = useState<RouteItem[]>([]);

  // Solver stats
  const [solveTime, setSolveTime] = useState<number | null>(null);
  const [solverStatus, setSolverStatus] = useState<string | null>(null);
  const [totalDistKm, setTotalDistKm] = useState<number | null>(null);
  const [totalAllocated, setTotalAllocated] = useState<number | null>(null);

  // UI state
  const [optimizing, setOptimizing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedPoint, setExpandedPoint] = useState<number | null>(null);
  const [nearestResults, setNearestResults] = useState<Record<string, NearestItem[]>>({});

  // Force-majeure form
  const [fmPointId, setFmPointId] = useState<number>(1);
  const [fmDemand, setFmDemand] = useState<number>(200);
  const [fmSubmitting, setFmSubmitting] = useState(false);

  // Offline cache
  const cacheRef = useRef<{ warehouses: Warehouse[]; points: DeliveryPoint[] } | null>(null);

  // Auth headers
  const authHeaders = useCallback(() => ({
    headers: { Authorization: `Bearer ${tokenRef.current}` },
  }), []);

  // ── Fetch status ──────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get<StatusResponse>(`${API}/api/status`);
      setWarehouses(res.data.warehouses);
      setPoints(res.data.delivery_points);
      cacheRef.current = {
        warehouses: res.data.warehouses,
        points: res.data.delivery_points,
      };
      setIsOnline(true);
    } catch {
      setIsOnline(false);
      if (cacheRef.current) {
        setWarehouses(cacheRef.current.warehouses);
        setPoints(cacheRef.current.points);
      }
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) fetchStatus();
  }, [isLoggedIn, fetchStatus]);

  // ── Login handler ─────────────────────────────────────
  const handleLogin = useCallback((token: string) => {
    tokenRef.current = token;
    setIsLoggedIn(true);
  }, []);

  // ── Optimize (allocate) ───────────────────────────────
  const handleOptimize = useCallback(async () => {
    setOptimizing(true);
    try {
      const res = await axios.post<AllocateResponse>(
        `${API}/api/allocate`,
        {},
        authHeaders()
      );
      setRouteItems(res.data.route);
      setUnserved(res.data.unserved);
      setSolveTime(res.data.solve_time_ms);
      setSolverStatus(res.data.solver_status);
      setTotalDistKm(res.data.total_distance_km);
      setTotalAllocated(res.data.total_allocated);
      // Refresh status to get updated stocks
      await fetchStatus();
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    } finally {
      setOptimizing(false);
    }
  }, [authHeaders, fetchStatus]);

  // ── Force-majeure ─────────────────────────────────────
  const handleForceMajeure = useCallback(async () => {
    setFmSubmitting(true);
    try {
      const res = await axios.post<StatusResponse>(
        `${API}/api/force-majeure`,
        { point_id: fmPointId, demand: fmDemand, priority: "critical" as const },
        authHeaders()
      );
      setWarehouses(res.data.warehouses);
      setPoints(res.data.delivery_points);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    } finally {
      setFmSubmitting(false);
    }
  }, [fmPointId, fmDemand, authHeaders]);

  // ── Reset ─────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    try {
      const res = await axios.post<StatusResponse>(
        `${API}/api/reset`,
        {},
        authHeaders()
      );
      setWarehouses(res.data.warehouses);
      setPoints(res.data.delivery_points);
      setRouteItems([]);
      setUnserved([]);
      setSolveTime(null);
      setSolverStatus(null);
      setTotalDistKm(null);
      setTotalAllocated(null);
      setIsOnline(true);
    } catch {
      setIsOnline(false);
    }
  }, [authHeaders]);

  // ── Nearest warehouse lookup ──────────────────────────
  const handleNearest = useCallback(async (lat: number, lng: number, pointId: number) => {
    try {
      const res = await axios.get<NearestItem[]>(
        `${API}/api/nearest?lat=${lat}&lng=${lng}`
      );
      setNearestResults((prev) => ({ ...prev, [pointId]: res.data }));
    } catch {
      /* ignore */
    }
  }, []);

  // ── Inline edit point ─────────────────────────────────
  const handleInlineUpdate = useCallback(
    async (pointId: number, demand: number, priority: string) => {
      try {
        const res = await axios.post<StatusResponse>(
          `${API}/api/force-majeure`,
          { point_id: pointId, demand, priority },
          authHeaders()
        );
        setWarehouses(res.data.warehouses);
        setPoints(res.data.delivery_points);
      } catch {
        /* ignore */
      }
    },
    [authHeaders]
  );

  // ── Computed KPIs ─────────────────────────────────────
  const kpis = useMemo(() => {
    const totalPoints = points.length;
    const criticalCount = points.filter((p) => p.priority === "critical").length;
    const totalStock = warehouses.reduce((s, w) => s + w.stock, 0);
    const totalDemand = points.reduce((s, p) => s + p.demand, 0);
    return { totalPoints, criticalCount, totalStock, totalDemand };
  }, [points, warehouses]);

  // ── Route lines for the map ───────────────────────────
  const routeLines = useMemo(() => {
    return routeItems
      .filter((r) => r.allocated_amount > 0)
      .map((r) => {
        const wh = warehouses.find((w) => w.id === r.assigned_warehouse_id);
        if (!wh) return null;
        return {
          key: `${r.assigned_warehouse_id}-${r.id}`,
          positions: [
            [wh.lat, wh.lng] as [number, number],
            [r.lat, r.lng] as [number, number],
          ],
          color: PRIORITY_COLOR[r.priority] || "#34c759",
        };
      })
      .filter(Boolean) as { key: string; positions: [number, number][]; color: string }[];
  }, [routeItems, warehouses]);

  // ── Allocated lookup ──────────────────────────────────
  const allocatedSet = useMemo(() => {
    const s = new Set<number>();
    routeItems.forEach((r) => {
      if (r.allocated_amount > 0) s.add(r.id);
    });
    return s;
  }, [routeItems]);

  const routeItemByPointId = useMemo(() => {
    const m = new Map<number, RouteItem>();
    routeItems.forEach((r) => m.set(r.id, r));
    return m;
  }, [routeItems]);

  // ── If not logged in, show login ──────────────────────
  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // ═════════════════════════════════════════════════════
  //  MAIN UI
  // ═════════════════════════════════════════════════════
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col"
         style={{ background: "#03050f" }}>

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[9999] text-center py-2 text-sm font-semibold"
             style={{ background: "rgba(255,200,0,0.9)", color: "#1a1a1a" }}>
          ⚠️ Офлайн режим — показуються останні дані
        </div>
      )}

      {/* ── Top Bar ── */}
      <header className="flex-none flex items-center justify-between px-4 md:px-6 py-3 sl-glass"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", zIndex: 50 }}>
        {/* Left: status + stats */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full"
                 style={{
                   background: isOnline ? "#34c759" : "#ff3b3b",
                   boxShadow: isOnline
                     ? "0 0 8px rgba(52,199,89,0.6)"
                     : "0 0 8px rgba(255,59,59,0.6)",
                 }} />
            <span className="text-xs font-semibold"
                  style={{ color: isOnline ? "#34c759" : "#ff3b3b" }}>
              {isOnline ? "API онлайн" : "Офлайн"}
            </span>
          </div>
          {solveTime !== null && (
            <div className="hidden md:flex items-center gap-3 text-xs"
                 style={{ color: "#6b7a99" }}>
              <span>⏱ {solveTime.toFixed(0)}мс</span>
              <span>📊 {solverStatus}</span>
              {totalDistKm !== null && <span>🛣 {totalDistKm.toFixed(1)} км</span>}
              {totalAllocated !== null && <span>📦 {totalAllocated} од.</span>}
            </div>
          )}
        </div>

        {/* Right: optimize button */}
        <button
          onClick={handleOptimize}
          disabled={optimizing}
          className="px-5 py-2.5 md:px-6 md:py-3 rounded-xl font-bold text-sm text-white cursor-pointer transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
          style={{
            background: "linear-gradient(135deg, #3862ff, #6366f1)",
            boxShadow: "0 4px 20px rgba(56,98,255,0.35)",
            opacity: optimizing ? 0.6 : 1,
          }}
        >
          {optimizing ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                    style={{ animation: "sl-spin 0.8s linear infinite" }} />
              Оптимізуємо...
            </span>
          ) : (
            "🚀 Оптимізувати маршрути"
          )}
        </button>
      </header>

      {/* ── Content: sidebar + map ── */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ── Sidebar (desktop) / Drawer (mobile) ── */}
        <aside
          className={`
            fixed md:static bottom-0 left-0 right-0 md:bottom-auto md:left-auto md:right-auto
            md:w-[340px] md:min-w-[340px] md:h-full
            z-[100] md:z-auto
            transition-transform duration-300 ease-in-out
            ${sidebarOpen ? "translate-y-0" : "translate-y-[calc(100%-0px)] md:translate-y-0"}
          `}
          style={{
            maxHeight: "85vh",
            background: "rgba(3,5,15,0.96)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Mobile drag handle */}
          <div className="md:hidden flex justify-center py-2 cursor-pointer"
               onClick={() => setSidebarOpen(!sidebarOpen)}>
            <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
          </div>

          <div className="overflow-y-auto p-4 space-y-4" style={{ maxHeight: "calc(85vh - 16px)" }}>
            {/* ── Logo ── */}
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                   style={{
                     background: "linear-gradient(135deg, #3862ff, #6366f1)",
                     boxShadow: "0 0 16px rgba(56,98,255,0.4)",
                   }}>
                <span className="text-lg">🚛</span>
              </div>
              <div>
                <h1 className="text-base font-extrabold tracking-tight leading-tight">
                  STRONG<span className="sl-gradient-text">LOGISTICS</span>
                </h1>
                <p className="text-[10px]" style={{ color: "#6b7a99" }}>Система оптимізації</p>
              </div>
            </div>

            {/* ── KPI Grid ── */}
            <div className="grid grid-cols-2 gap-2">
              {/* Orders */}
              <div className="sl-glass rounded-xl p-3">
                <p className="text-[10px] font-semibold mb-1" style={{ color: "#6b7a99" }}>
                  Замовлень
                </p>
                <p className="text-xl font-extrabold" style={{ color: "#3862ff" }}>
                  {kpis.totalPoints}
                </p>
              </div>
              {/* Critical */}
              <div className="sl-glass rounded-xl p-3">
                <p className="text-[10px] font-semibold mb-1" style={{ color: "#6b7a99" }}>
                  Критичних
                </p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xl font-extrabold" style={{ color: "#ff3b3b" }}>
                    {kpis.criticalCount}
                  </p>
                  {kpis.criticalCount > 0 && (
                    <div className="w-2.5 h-2.5 rounded-full"
                         style={{
                           background: "#ff3b3b",
                           animation: "sl-pulse 1.5s ease-in-out infinite",
                         }} />
                  )}
                </div>
              </div>
              {/* Stock */}
              <div className="sl-glass rounded-xl p-3">
                <p className="text-[10px] font-semibold mb-1" style={{ color: "#6b7a99" }}>
                  Спільний склад
                </p>
                <p className="text-xl font-extrabold" style={{ color: "#34c759" }}>
                  {kpis.totalStock}
                </p>
              </div>
              {/* Demand */}
              <div className="sl-glass rounded-xl p-3">
                <p className="text-[10px] font-semibold mb-1" style={{ color: "#6b7a99" }}>
                  Попит
                </p>
                <p className="text-xl font-extrabold" style={{ color: "#ff9500" }}>
                  {kpis.totalDemand}
                </p>
              </div>
            </div>

            {/* ── Warehouses ── */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2"
                  style={{ color: "#6b7a99" }}>
                🏭 Склади
              </h3>
              {warehouses.map((w) => {
                const c = WH_COLORS[w.id] || { color: "#3862ff" };
                const used = w.initial_stock - w.stock;
                const pct = Math.round((used / w.initial_stock) * 100);
                return (
                  <div key={w.id} className="sl-glass rounded-xl p-3 mb-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-bold" style={{ color: c.color }}>
                        {w.name}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: "#6b7a99" }}>
                        {w.stock}/{w.initial_stock}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden"
                         style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div className="h-full rounded-full transition-all duration-700"
                           style={{
                             width: `${pct}%`,
                             background: c.color,
                           }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Delivery Points ── */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider mb-2"
                  style={{ color: "#6b7a99" }}>
                📦 Точки доставки
              </h3>
              {points.map((p) => {
                const ri = routeItemByPointId.get(p.id);
                const isExpanded = expandedPoint === p.id;
                return (
                  <div key={p.id} className="sl-glass rounded-xl p-3 mb-2 cursor-pointer transition-all duration-200 hover:border-white/10"
                       onClick={() => setExpandedPoint(isExpanded ? null : p.id)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                              style={{
                                background: PRIORITY_COLOR[p.priority] + "20",
                                color: PRIORITY_COLOR[p.priority],
                              }}>
                          {PRIORITY_LABEL[p.priority]}
                        </span>
                        <span className="text-sm font-semibold">{p.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs" style={{ color: "#6b7a99" }}>
                          потреба: <strong className="text-white">{p.demand}</strong>
                        </span>
                      </div>
                    </div>
                    {ri && ri.allocated_amount > 0 && (
                      <div className="mt-1.5 flex items-center gap-2 text-xs"
                           style={{ color: "#6b7a99" }}>
                        <span>Виділено: <strong style={{ color: "#34c759" }}>{ri.allocated_amount}</strong></span>
                        <span>•</span>
                        <span>{ri.distance_from_warehouse_km} км</span>
                      </div>
                    )}

                    {/* Inline controls */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 space-y-2"
                           style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                           onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2">
                          <select
                            defaultValue={p.priority}
                            onChange={(e) => handleInlineUpdate(p.id, p.demand, e.target.value)}
                            className="flex-1 text-xs py-1.5 px-2 rounded-lg"
                            style={{
                              background: "rgba(8,12,26,0.9)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "#c8d6f0",
                            }}
                          >
                            <option value="normal">🟢 Нормальний</option>
                            <option value="high">🟠 Високий</option>
                            <option value="critical">🔴 Критичний</option>
                          </select>
                          <input
                            type="number"
                            defaultValue={p.demand}
                            min={10}
                            max={2000}
                            onBlur={(e) =>
                              handleInlineUpdate(p.id, Number(e.target.value), p.priority)
                            }
                            className="w-20 text-xs py-1.5 px-2 rounded-lg"
                            style={{
                              background: "rgba(8,12,26,0.9)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "#c8d6f0",
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Force Majeure Panel ── */}
            <div className="sl-glass rounded-xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider mb-3"
                  style={{ color: "#6b7a99" }}>
                ⚡ Форс-мажор
              </h3>
              <div className="space-y-2.5">
                <select
                  value={fmPointId}
                  onChange={(e) => setFmPointId(Number(e.target.value))}
                  className="w-full text-sm py-2 px-3 rounded-lg"
                  style={{
                    background: "rgba(8,12,26,0.9)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#c8d6f0",
                  }}
                >
                  {points.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                <div>
                  <label className="text-[10px] font-semibold mb-1 block"
                         style={{ color: "#6b7a99" }}>
                    Попит: {fmDemand}
                  </label>
                  <input
                    type="range"
                    min={50}
                    max={500}
                    value={fmDemand}
                    onChange={(e) => setFmDemand(Number(e.target.value))}
                    className="w-full accent-amber-500"
                    style={{ height: "4px" }}
                  />
                </div>

                <button
                  onClick={handleForceMajeure}
                  disabled={fmSubmitting}
                  className="w-full py-2.5 rounded-lg font-bold text-sm text-white cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-[0.97]"
                  style={{
                    background: "linear-gradient(135deg, #ff9500, #ff3b3b)",
                    boxShadow: "0 4px 16px rgba(255,149,0,0.25)",
                    opacity: fmSubmitting ? 0.6 : 1,
                  }}
                >
                  {fmSubmitting ? "Оновлюємо..." : "⚡ Активувати форс-мажор"}
                </button>
              </div>
            </div>

            {/* ── Reset button ── */}
            <button
              onClick={handleReset}
              className="w-full py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all duration-200 hover:bg-white/5"
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#6b7a99",
              }}
            >
              🔄 Скинути дані
            </button>
          </div>
        </aside>

        {/* ── Mobile toggle button ── */}
        <button
          className="md:hidden fixed bottom-4 right-4 z-[200] w-12 h-12 rounded-full flex items-center justify-center text-xl cursor-pointer"
          style={{
            background: "linear-gradient(135deg, #3862ff, #6366f1)",
            boxShadow: "0 4px 20px rgba(56,98,255,0.5)",
          }}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? "✕" : "☰"}
        </button>

        {/* ── Map ── */}
        <div className="flex-1 relative">
          <MapContainer
            center={[49.84, 24.02]}
            zoom={9}
            className="w-full h-full"
            style={{ background: "#03050f" }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              maxZoom={19}
            />

            {/* Warehouse markers */}
            {warehouses.map((w) => (
              <Marker key={`wh-${w.id}`} position={[w.lat, w.lng]} icon={warehouseIcon(w.id)}>
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 14, color: WH_COLORS[w.id]?.color || "#3862ff" }}>
                      🏭 {w.name}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7a99" }}>
                      Залишок: <strong style={{ color: "#c8d6f0" }}>{w.stock}</strong> / {w.initial_stock}
                    </p>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Delivery point markers */}
            {points.map((p) => {
              const allocated = allocatedSet.has(p.id);
              const ri = routeItemByPointId.get(p.id);
              return (
                <Marker
                  key={`pt-${p.id}`}
                  position={[p.lat, p.lng]}
                  icon={deliveryIcon(p.priority, routeItems.length === 0 || allocated)}
                >
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <p style={{ margin: "0 0 2px", fontWeight: 800, fontSize: 14, color: "#c8d6f0" }}>
                        {p.name}
                      </p>
                      <span style={{
                        display: "inline-block",
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: PRIORITY_COLOR[p.priority] + "22",
                        color: PRIORITY_COLOR[p.priority],
                        marginBottom: 6,
                      }}>
                        {PRIORITY_LABEL[p.priority]}
                      </span>
                      <p style={{ margin: "4px 0 2px", fontSize: 12, color: "#6b7a99" }}>
                        Попит: <strong style={{ color: "#c8d6f0" }}>{p.demand}</strong>
                      </p>
                      {ri && (
                        <p style={{ margin: "2px 0", fontSize: 12, color: "#6b7a99" }}>
                          Виділено: <strong style={{ color: "#34c759" }}>{ri.allocated_amount}</strong>
                          {" • "}{ri.distance_from_warehouse_km} км
                        </p>
                      )}
                      <button
                        onClick={() => handleNearest(p.lat, p.lng, p.id)}
                        style={{
                          marginTop: 6,
                          padding: "4px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          background: "rgba(56,98,255,0.15)",
                          color: "#3862ff",
                          border: "1px solid rgba(56,98,255,0.3)",
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        📍 Знайти найближчий склад
                      </button>
                      {nearestResults[p.id] && (
                        <div style={{ marginTop: 6 }}>
                          {nearestResults[p.id].map((n) => (
                            <p key={n.id} style={{ margin: "2px 0", fontSize: 11, color: "#6b7a99" }}>
                              <strong style={{ color: WH_COLORS[n.id]?.color || "#c8d6f0" }}>
                                {n.name}
                              </strong>
                              {" — "}{n.distance_km} км (залишок: {n.stock})
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* Animated route lines */}
            {routeLines.map((r) => (
              <AnimatedRoute
                key={r.key}
                positions={r.positions}
                color={r.color}
              />
            ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

export default App;
