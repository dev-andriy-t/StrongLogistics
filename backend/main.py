"""
StrongLogistics MVP — FastAPI Backend
JWT Auth + OR-Tools CVRP Solver + In-Memory Store
"""
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Literal
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
from ortools.constraint_solver import routing_enums_pb2, pywrapcp
import math, time, copy

# ── Config ──────────────────────────────────────────────
SECRET_KEY = "stronglogistics-jwt-secret-2026"
ALGORITHM = "HS256"
TOKEN_EXPIRE_MIN = 120
VEHICLE_CAPACITY = 500
PRIORITY_ORDER = {"critical": 0, "high": 1, "normal": 2}
PRIORITY_PENALTY = {"critical": 1_000_000, "high": 100_000, "normal": 10_000}

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
USERS_DB = {"admin": pwd_ctx.hash("stronglogistics2026")}
security = HTTPBearer()

# ── Pydantic Models ─────────────────────────────────────
class LoginReq(BaseModel):
    username: str
    password: str

class Warehouse(BaseModel):
    id: int; name: str; lat: float; lng: float
    stock: int; initial_stock: int

class DeliveryPoint(BaseModel):
    id: int; name: str; lat: float; lng: float
    demand: int; priority: Literal["critical","high","normal"]
    allocated_amount: int = 0

class ForceMajeureReq(BaseModel):
    point_id: int; demand: int; priority: Literal["critical","high","normal"]

class RouteItem(BaseModel):
    id: int; name: str; lat: float; lng: float
    priority: str; demand: int; allocated_amount: int
    visit_order: int; distance_from_warehouse_km: float
    assigned_warehouse_id: int

class AllocateResp(BaseModel):
    route: list[RouteItem]; total_allocated: int
    total_distance_km: float; solver_status: str
    solve_time_ms: float; unserved: list[RouteItem]

class StatusResp(BaseModel):
    warehouses: list[Warehouse]; delivery_points: list[DeliveryPoint]

class NearestItem(BaseModel):
    id: int; name: str; lat: float; lng: float
    stock: int; distance_km: float

# ── In-Memory Data ──────────────────────────────────────
def make_initial():
    wh = [
        Warehouse(id=1, name="Львів", lat=49.84, lng=24.02, stock=1000, initial_stock=1000),
        Warehouse(id=2, name="Дрогобич", lat=49.35, lng=23.50, stock=400, initial_stock=400),
    ]
    pts = [
        DeliveryPoint(id=1, name="Стрий", lat=49.25, lng=23.85, demand=150, priority="high"),
        DeliveryPoint(id=2, name="Борислав", lat=49.29, lng=23.43, demand=80, priority="normal"),
        DeliveryPoint(id=3, name="Жовква", lat=50.06, lng=23.97, demand=120, priority="high"),
        DeliveryPoint(id=4, name="Самбір", lat=49.52, lng=23.20, demand=200, priority="critical"),
    ]
    return wh, pts

warehouses, points = make_initial()

# ── Helpers ─────────────────────────────────────────────
def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def create_token(sub: str):
    return jwt.encode({"sub": sub, "exp": datetime.utcnow()+timedelta(minutes=TOKEN_EXPIRE_MIN)}, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(creds: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("sub"): raise HTTPException(401, "Invalid token")
        return payload["sub"]
    except JWTError:
        raise HTTPException(401, "Token expired or invalid")

# ── CVRP Solver ─────────────────────────────────────────
def solve_cluster(wh: Warehouse, cluster: list[DeliveryPoint]):
    if not cluster:
        return [], [], 0.0, "NO_POINTS"
    locs = [(wh.lat, wh.lng)] + [(p.lat, p.lng) for p in cluster]
    n = len(locs)
    dm = [[0]*n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                dm[i][j] = int(haversine(locs[i][0], locs[i][1], locs[j][0], locs[j][1]) * 1000)
    total_demand = sum(p.demand for p in cluster)
    nv = max(1, math.ceil(total_demand / VEHICLE_CAPACITY))
    mgr = pywrapcp.RoutingIndexManager(n, nv, 0)
    routing = pywrapcp.RoutingModel(mgr)

    def dist_cb(fi, ti):
        return dm[mgr.IndexToNode(fi)][mgr.IndexToNode(ti)]
    tid = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(tid)

    def demand_cb(fi):
        nd = mgr.IndexToNode(fi)
        return 0 if nd == 0 else cluster[nd-1].demand
    did = routing.RegisterUnaryTransitCallback(demand_cb)
    routing.AddDimensionWithVehicleCapacity(did, 0, [VEHICLE_CAPACITY]*nv, True, "Cap")

    for i, p in enumerate(cluster):
        idx = mgr.NodeToIndex(i+1)
        routing.AddDisjunction([idx], PRIORITY_PENALTY.get(p.priority, 10_000))

    sp = pywrapcp.DefaultRoutingSearchParameters()
    sp.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    sp.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    sp.time_limit.seconds = 8

    sol = routing.SolveWithParameters(sp)
    if not sol:
        return [], list(cluster), 0.0, "NO_SOLUTION"

    served_set = set()
    route_items = []
    total_dist_m = 0
    order_counter = 0
    remaining = wh.stock

    for v in range(nv):
        idx = routing.Start(v)
        while not routing.IsEnd(idx):
            node = mgr.IndexToNode(idx)
            nxt = sol.Value(routing.NextVar(idx))
            total_dist_m += routing.GetArcCostForVehicle(idx, nxt, v)
            if node > 0:
                pt = cluster[node-1]
                served_set.add(node-1)
                order_counter += 1
                alloc = min(pt.demand, remaining)
                remaining -= alloc
                pt.allocated_amount = alloc
                dist_km = haversine(wh.lat, wh.lng, pt.lat, pt.lng)
                route_items.append(RouteItem(
                    id=pt.id, name=pt.name, lat=pt.lat, lng=pt.lng,
                    priority=pt.priority, demand=pt.demand,
                    allocated_amount=alloc, visit_order=order_counter,
                    distance_from_warehouse_km=round(dist_km, 2),
                    assigned_warehouse_id=wh.id,
                ))
            idx = nxt

    wh.stock = remaining
    unserved = []
    for i, p in enumerate(cluster):
        if i not in served_set:
            p.allocated_amount = 0
            dist_km = haversine(wh.lat, wh.lng, p.lat, p.lng)
            unserved.append(RouteItem(
                id=p.id, name=p.name, lat=p.lat, lng=p.lng,
                priority=p.priority, demand=p.demand, allocated_amount=0,
                visit_order=0, distance_from_warehouse_km=round(dist_km,2),
                assigned_warehouse_id=wh.id,
            ))

    status_map = {1: "OPTIMAL", 2: "FEASIBLE", 3: "FAIL", 4: "TIMEOUT"}
    status = status_map.get(routing.status(), "UNKNOWN")
    return route_items, unserved, total_dist_m / 1000.0, status

# ── FastAPI App ─────────────────────────────────────────
app = FastAPI(title="StrongLogistics MVP", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

@app.post("/api/login")
def login(req: LoginReq):
    hashed = USERS_DB.get(req.username)
    if not hashed or not pwd_ctx.verify(req.password, hashed):
        raise HTTPException(401, "Невірний логін або пароль")
    return {"access_token": create_token(req.username), "token_type": "bearer"}

@app.get("/api/status", response_model=StatusResp)
def get_status():
    return StatusResp(warehouses=warehouses, delivery_points=points)

@app.post("/api/allocate", response_model=AllocateResp)
def allocate(_user: str = Depends(verify_token)):
    global warehouses, points
    for w in warehouses: w.stock = w.initial_stock
    for p in points: p.allocated_amount = 0

    clusters: dict[int, list[DeliveryPoint]] = {w.id: [] for w in warehouses}
    for p in sorted(points, key=lambda x: PRIORITY_ORDER.get(x.priority, 2)):
        nearest_wh = min(warehouses, key=lambda w: haversine(w.lat, w.lng, p.lat, p.lng))
        clusters[nearest_wh.id].append(p)

    all_route, all_unserved = [], []
    total_dist = 0.0
    combined_status = "OPTIMAL"
    t0 = time.time()
    for w in warehouses:
        ri, un, dist, st = solve_cluster(w, clusters[w.id])
        all_route.extend(ri)
        all_unserved.extend(un)
        total_dist += dist
        if st != "OPTIMAL": combined_status = st
    elapsed = round((time.time() - t0) * 1000, 1)
    total_alloc = sum(r.allocated_amount for r in all_route)
    return AllocateResp(route=all_route, total_allocated=total_alloc,
                        total_distance_km=round(total_dist, 2),
                        solver_status=combined_status, solve_time_ms=elapsed,
                        unserved=all_unserved)

@app.post("/api/force-majeure", response_model=StatusResp)
def force_majeure(req: ForceMajeureReq, _user: str = Depends(verify_token)):
    for p in points:
        if p.id == req.point_id:
            p.demand = req.demand; p.priority = req.priority
            return StatusResp(warehouses=warehouses, delivery_points=points)
    raise HTTPException(404, "Точку не знайдено")

@app.post("/api/reset", response_model=StatusResp)
def reset(_user: str = Depends(verify_token)):
    global warehouses, points
    warehouses, points = make_initial()
    return StatusResp(warehouses=warehouses, delivery_points=points)

@app.get("/api/nearest", response_model=list[NearestItem])
def nearest(lat: float = Query(...), lng: float = Query(...)):
    items = []
    for w in warehouses:
        d = haversine(lat, lng, w.lat, w.lng)
        items.append(NearestItem(id=w.id, name=w.name, lat=w.lat, lng=w.lng,
                                 stock=w.stock, distance_km=round(d, 2)))
    items.sort(key=lambda x: x.distance_km)
    return items[:3]
