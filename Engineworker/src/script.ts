import axios, { AxiosInstance } from "axios";

const BASE_URL = "http://localhost:3000";
const MARKET = "SOL_USDT";

const USER_TOKENS: Record<string, string> = {
  "b3077873-8bdf-4c26-8f39-51021af7290c": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJiMzA3Nzg3My04YmRmLTRjMjYtOGYzOS01MTAyMWFmNzI5MGMiLCJpYXQiOjE3ODAyNDEzOTR9.RHsZIOuRWo-rc607ek75uf9vN22_UTbwzBuSVgmVSSU",
  "18013de8-014b-4e40-b1b0-e66ec84ab396": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxODAxM2RlOC0wMTRiLTRlNDAtYjFiMC1lNjZlYzg0YWIzOTYiLCJpYXQiOjE3ODAyNDE0NDd9.zQfSXAuen8YUi43gU4D-6EiPs0JiO53CD66aiX_WD8E",
  "29a412af-7ae4-42f8-8874-051369007072": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIyOWE0MTJhZi03YWU0LTQyZjgtODg3NC0wNTEzNjkwMDcwNzIiLCJpYXQiOjE3ODAyNDE1MjN9.GZ7GZdhEJUCYJoF8gGsZn7zrce3sTT9MxOYuegCUHsw",
  "4ae26b99-f20d-4b2d-9bfc-a78b7306d632": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI0YWUyNmI5OS1mMjBkLTRiMmQtOWJmYy1hNzhiNzMwNmQ2MzIiLCJpYXQiOjE3ODAyNDE1NjR9.7Q9ONJsmRyTaTBmSVW2HXSbXpMg6r1IHg7q7qeO7CCY",
};

const TARGET_BIDS = 14;
const TARGET_ASKS = 14;
const BASE_PRICE = 100;
const MID_DRIFT = 1.5;
const LEVELS = 7;
const LOOP_MS = 1500;

const SPREAD_BPS = 10;
const MAX_BOOK_DEVIATION = 0.018;
const RANDOM_CANCEL_PROBABILITY = 0.10;

const QTY_MIN = 0.05;
const QTY_MAX = 0.35;

const userIds = Object.keys(USER_TOKENS);
let userRoundRobin = 0;

type Side = "BUY" | "SELL";
type Kind = "LIMIT";

type OpenOrder = {
  orderId: string;
  market: string;
  side: "buy" | "sell" | "BUY" | "SELL";
  price: string | number | null;
  quantity?: string | number;
  remainingQuantity?: string | number;
};

const log = (...args: any[]) => console.log(...args);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function nextUser(): string {
  const id = userIds[userRoundRobin % userIds.length];
  userRoundRobin++;
  return id;
}

function normalizeSide(side: string): Side {
  return side.toUpperCase() === "BUY" ? "BUY" : "SELL";
}

function makeClient(token: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 150000,
  });
}

function levelPrice(mid: number, side: Side, level: number): string {
  const offset = (SPREAD_BPS / 10000) * mid * (1 + level * 0.75);
  const raw = side === "BUY" ? mid - offset : mid + offset;
  if (!isFinite(raw)) throw new Error(`non-finite price: mid=${mid} level=${level}`);
  return raw.toFixed(2);
}

function levelQty(): string {
  const qty = rand(QTY_MIN, QTY_MAX);
  if (!isFinite(qty)) throw new Error(`non-finite qty`);
  return qty.toFixed(3);
}

async function getOpenOrdersForUser(userId: string): Promise<OpenOrder[]> {
  const client = makeClient(USER_TOKENS[userId]);
  const res = await client.get("/api/v1/orders/open", { params: { market: MARKET } });
  return (res.data ?? []) as OpenOrder[];
}

async function getAllOpenOrders(): Promise<Array<OpenOrder & { _ownerUserId: string }>> {
  const results = await Promise.all(
    userIds.map(async (userId) => {
      try {
        const orders = await getOpenOrdersForUser(userId);
        return orders.map((o) => ({ ...o, _ownerUserId: userId }));
      } catch (err: any) {
        log(
          `[FETCH-FAIL] user=${userId} HTTP ${err?.response?.status} ${JSON.stringify(
            err?.response?.data ?? err?.message
          )}`
        );
        return [];
      }
    })
  );
  return results.flat();
}

async function cancelOrder(userId: string, orderId: string): Promise<boolean> {
  const client = makeClient(USER_TOKENS[userId]);
  try {
    await client.delete(`/api/v1/orders/${orderId}`, { data: { market: MARKET } });
    return true;
  } catch (err: any) {
    log(
      `[CANCEL-FAIL] order=${orderId} HTTP ${err?.response?.status} ${JSON.stringify(
        err?.response?.data ?? err?.message
      )}`
    );
    return false;
  }
}

async function placeOrder(
  userId: string,
  side: Side,
  price: string,
  quantity: string,
  kind: Kind = "LIMIT"
): Promise<boolean> {
  const client = makeClient(USER_TOKENS[userId]);
  try {
    await client.post("/api/v1/orders", { market: MARKET, side, kind, price, quantity });
    return true;
  } catch (err: any) {
    log(
      `[ORDER-FAIL] ${side} price=${price} qty=${quantity} user=${userId} HTTP ${err?.response?.status} ${JSON.stringify(
        err?.response?.data ?? err?.message
      )}`
    );
    return false;
  }
}

async function nukeAllOrders(): Promise<void> {
  log("[NUKE] Fetching all open orders across all users...");
  const all = await getAllOpenOrders();

  if (all.length === 0) {
    log("[NUKE] Book is already clean.");
    return;
  }

  log(`[NUKE] Found ${all.length} open orders — cancelling all...`);

  let remaining = all;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const results = await Promise.all(
      remaining.map((o) => cancelOrder(o._ownerUserId, o.orderId).then((ok) => ({ o, ok })))
    );
    const failed = results.filter((r) => !r.ok).map((r) => r.o);
    const succeeded = remaining.length - failed.length;
    log(`[NUKE] Attempt ${attempt}: cancelled ${succeeded}, failed ${failed.length}`);

    if (failed.length === 0) break;
    remaining = failed;
    if (attempt < 3) await sleep(1000);
  }

  const leftover = await getAllOpenOrders();
  if (leftover.length > 0) {
    log(
      `[NUKE] WARNING: ${leftover.length} orders could not be cancelled (engine bug). They will be treated as phantom orders.`
    );
    log(`[NUKE] Phantom order IDs: ${leftover.map((o) => o.orderId).join(", ")}`);
  } else {
    log("[NUKE] Book cleared successfully.");
  }
}

async function pruneOrders(
  openOrders: Array<OpenOrder & { _ownerUserId: string }>,
  mid: number
): Promise<void> {
  const toCancel = openOrders.filter((order) => {
    const side = normalizeSide(order.side);
    const p = order.price == null ? null : Number(order.price);

    const crossed =
      (side === "BUY" && p !== null && p >= mid) ||
      (side === "SELL" && p !== null && p <= mid);

    const tooFar =
      (side === "BUY" && p !== null && p < mid * (1 - MAX_BOOK_DEVIATION)) ||
      (side === "SELL" && p !== null && p > mid * (1 + MAX_BOOK_DEVIATION));

    const randomChurn = Math.random() < RANDOM_CANCEL_PROBABILITY;

    return crossed || tooFar || randomChurn;
  });

  if (toCancel.length > 0) {
    log(`[PRUNE] cancelling ${toCancel.length} orders`);
    await Promise.allSettled(toCancel.map((o) => cancelOrder(o._ownerUserId, o.orderId)));
  }
}

async function populateMarketOnce() {
  const mid = BASE_PRICE + rand(-MID_DRIFT, MID_DRIFT);
  if (!isFinite(mid)) {
    log(`[SKIP] non-finite mid=${mid}`);
    return;
  }

  const before = await getAllOpenOrders();
  await pruneOrders(before, mid);

  const after = await getAllOpenOrders();
  const bids = after.filter((o) => normalizeSide(o.side) === "BUY");
  const asks = after.filter((o) => normalizeSide(o.side) === "SELL");

  let bidsToAdd = Math.max(0, TARGET_BIDS - bids.length);
  let asksToAdd = Math.max(0, TARGET_ASKS - asks.length);

  log(
    `[TICK] mid=${mid.toFixed(2)} | existing bids=${bids.length} asks=${asks.length} | placing +${bidsToAdd} bids +${asksToAdd} asks`
  );

  const placements: Promise<boolean>[] = [];
  let bidLevel = 0;
  let askLevel = 0;

  while (bidsToAdd > 0 || asksToAdd > 0) {
    if (bidsToAdd > 0) {
      let price: string, qty: string;
      try {
        price = levelPrice(mid, "BUY", bidLevel % LEVELS);
        qty = levelQty();
      } catch (e: any) {
        log(`[SKIP-BID] ${e.message}`);
        bidsToAdd--;
        bidLevel++;
        continue;
      }
      placements.push(placeOrder(nextUser(), "BUY", price, qty));
      bidsToAdd--;
      bidLevel++;
    }

    if (asksToAdd > 0) {
      let price: string, qty: string;
      try {
        price = levelPrice(mid, "SELL", askLevel % LEVELS);
        qty = levelQty();
      } catch (e: any) {
        log(`[SKIP-ASK] ${e.message}`);
        asksToAdd--;
        askLevel++;
        continue;
      }
      placements.push(placeOrder(nextUser(), "SELL", price, qty));
      asksToAdd--;
      askLevel++;
    }
  }

  const results = await Promise.allSettled(placements);
  const ok = results.filter((r) => r.status === "fulfilled" && (r as any).value === true).length;
  const fail = results.length - ok;
  if (fail > 0) log(`[PLACEMENT] ${ok} ok, ${fail} failed`);

  const finalOrders = await getAllOpenOrders();
  const finalBids = finalOrders.filter((o) => normalizeSide(o.side) === "BUY").length;
  const finalAsks = finalOrders.filter((o) => normalizeSide(o.side) === "SELL").length;
  const imbalance = finalBids - finalAsks;

  log(`[BOOK] bids=${finalBids} asks=${finalAsks} imbalance=${imbalance >= 0 ? "+" : ""}${imbalance}`);
  log("---");
}

async function main() {
  log(`Starting market maker for ${MARKET}`);
  await nukeAllOrders();
  log("---");

  while (true) {
    try {
      await populateMarketOnce();
    } catch (err: any) {
      log(`[LOOP-ERROR] ${JSON.stringify(err?.response?.data ?? err?.message ?? err)}`);
    }
    await sleep(LOOP_MS);
  }
}

main();