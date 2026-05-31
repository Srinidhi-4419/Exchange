import RedisManager from "../RedisManager";
import fs from "fs";
import { Orderbook } from "./Orderbook";
import { Fills, KIND, Order, SIDE } from "../types/Orderbook.types";
import { v4 as uuidv4 } from "uuid";
import { getOpenOrders } from "../db/query";

export const BASE_CURRENCY = "BTC";

interface UserBalance {
  [key: string]: {
    available: number;
    locked: number;
  };
}

class Engine {
  private orderbooks: Map<string, Orderbook> = new Map();
  private userBalances: Map<string, UserBalance> = new Map();

  constructor() {
    let snapshot = null;

    try {
      if (process.env.WITH_SNAPSHOT) {
        snapshot = fs.readFileSync("./snapshot.json", "utf-8");
      }
    } catch (e) {
      console.log("No snapshot found", e);
    }

    if (snapshot) {
      const data = JSON.parse(snapshot.toString());
      console.log(snapshot);

      this.orderbooks = new Map(
        (data.orderbooks as [string, any][]).map(([market, o]) => [
          market,
          new Orderbook(o.baseAsset, o.bids, o.asks, o.lastTradeId, o.currentPrice),
        ])
      );

      this.userBalances = new Map(
        (data.userBalances as [string, any][]).map(([userId, balances]) => [
          userId,
          this.normalizeUserBalance(balances),
        ])
      );
    } else {
      this.orderbooks = new Map();
      this.orderbooks.set("BTC_USDT", new Orderbook("BTC", [], [], 0, 0));
      this.orderbooks.set("ETH_USDT", new Orderbook("ETH", [], [], 0, 0));
      this.orderbooks.set("SOL_USDT", new Orderbook("SOL", [], [], 0, 0));
    }

    setInterval(() => {
      this.saveSnapshot();
    }, 1000 * 3);
  }

  logEvent = (event: string, data: Record<string, any> = {}) => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        service: "engine",
        event,
        ...data,
      })
    );
  };

  private toNumber(value: any): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid numeric value: ${value}`);
    }
    return n;
  }

  private round8(value: number): number {
    return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
  }

  private add(a: any, b: any): number {
    return this.round8(this.toNumber(a) + this.toNumber(b));
  }

  private sub(a: any, b: any): number {
    return this.round8(this.toNumber(a) - this.toNumber(b));
  }

  private mul(a: any, b: any): number {
    return this.round8(this.toNumber(a) * this.toNumber(b));
  }

  private normalizeUserBalance(balances: any): UserBalance {
    return Object.fromEntries(
      Object.entries(balances || {}).map(([asset, balance]: any) => [
        asset,
        {
          available: this.round8(this.toNumber(balance?.available ?? 0)),
          locked: this.round8(this.toNumber(balance?.locked ?? 0)),
        },
      ])
    );
  }

  private getUserBalanceOrThrow(userId: string): UserBalance {
    const balance = this.userBalances.get(userId);
    if (!balance) {
      throw new Error(`User balance not found for userId=${userId}`);
    }
    return balance;
  }

  private getAssetBalanceOrThrow(userId: string, asset: string) {
    const userBalance = this.getUserBalanceOrThrow(userId);
    const assetBalance = userBalance[asset];
    if (!assetBalance) {
      throw new Error(`Asset balance not found for userId=${userId}, asset=${asset}`);
    }
    return assetBalance;
  }

  saveSnapshot() {
    console.log("SNAPSHOT SAVED", Date.now());

    const snap = {
      orderbooks: Array.from(this.orderbooks.entries()).map(([market, o]) => [
        market,
        o.getSnapshot(),
      ]),
      userBalances: Array.from(this.userBalances.entries()).map(([userId, balances]) => [
        userId,
        this.normalizeUserBalance(balances),
      ]),
    };

    fs.writeFileSync("./snapshot.json", JSON.stringify(snap));
  }

  async processOrders({ message, clientId }: { message: any; clientId: string }) {
    const typeOfOrder = message.type.toUpperCase();
    const traceId = uuidv4();

    this.logEvent("process_orders_received", {
      traceId,
      clientId,
      type: message.type,
      market: message?.data?.market,
      userId: message?.data?.userId,
      orderId: message?.data?.orderId,
    });

    this.logEvent("market_lookup", {
      traceId,
      rawMarket: message?.data?.market,
      orderbookFound: !!this.orderbooks.get(message?.data?.market),
      knownMarkets: [...this.orderbooks.keys()],
    });

    switch (typeOfOrder) {
      case "CREATE_ORDER":
        try {
          const { executedQty, fills, orderId } = this.createOrder(
            message.data.market,
            message.data.side,
            message.data.kind,
            this.toNumber(message.data.price),
            this.toNumber(message.data.quantity),
            message.data.userId,
            traceId
          );

          RedisManager.getInstance().sendToApi(clientId, {
            type: "ORDER_PLACED",
            payload: { orderId, executedQty, fills },
          });
        } catch (err) {
          console.error("Create order error:", err);
          this.logEvent("create_order_error", { traceId, error: String(err) });
        }
        break;

      case "CANCEL_ORDER":
        try {
          const { orderId, market, userId } = message.data;
          const cancelledOrder = this.cancelOrder(orderId, market, userId, traceId);

          RedisManager.getInstance().sendToApi(clientId, {
            type: "ORDER_CANCELLED",
            payload: cancelledOrder,
          });
          RedisManager.getInstance().pushMessageToDB({
            type: "ORDER_CANCELLED",
            data: cancelledOrder,
          });
        } catch (err) {
          console.error("Error in cancelling order", err);
          this.logEvent("cancel_order_error", { traceId, error: String(err) });
        }
        break;

      case "GET_ORDERS":
        try {
          const { userId, market } = message.data;
          const orderbook = this.orderbooks.get(market);
          if (!orderbook) throw new Error("No OrderBook found");

          const orders = await getOpenOrders(userId, market);

          const formattedOrders = orders.map((order) => ({
            orderId: order.id,
            market: order.market,
            side: order.side,
            type: order.type,
            price: Number(order.price),
            quantity: Number(order.quantity),
            filledQuantity: Number(order.filled_quantity),
            remainingQuantity: Number(order.remaining_quantity),
            status: order.status,
            createdAt: order.created_at,
          }));

          RedisManager.getInstance().sendToApi(clientId, {
            type: "OPEN_ORDERS",
            payload: formattedOrders,
          });
        } catch (error) {
          console.error("error while getting open orders", error);
        }
        break;

      case "GET_DEPTH":
        try {
          const market = message.data.market;
          const orderbook = this.orderbooks.get(market);
          if (!orderbook) throw new Error("No Orderbook found");

          RedisManager.getInstance().sendToApi(clientId, {
            type: "DEPTH",
            payload: orderbook.getDepth(),
          });
        } catch (error) {
          console.log("GET_DEPTH error", error);
          RedisManager.getInstance().sendToApi(clientId, {
            type: "DEPTH",
            payload: { bids: [], asks: [] },
          });
        }
        break;

      case "USER_CREATED": {
        const { userId, balances } = message.data;
        const normalizedBalances = this.normalizeUserBalance(balances);
        this.userBalances.set(userId, normalizedBalances);
        this.logEvent("user_created", {
          traceId,
          userId,
          assets: Object.keys(normalizedBalances),
        });
        console.log("New user added to engine");
        break;
      }
    }
  }

  checklockfunds(
    userId: string,
    baseAsset: string,
    quoteAsset: string,
    side: SIDE,
    price: number,
    quantity: number,
    traceId: string
  ) {
    const userbalance = this.getUserBalanceOrThrow(userId);

    this.logEvent("balance_lock_before", {
      traceId,
      userId,
      side,
      baseAsset,
      quoteAsset,
      price,
      quantity,
      balances: userbalance,
    });

    if (side === "BUY") {
      const cost = this.mul(price, quantity);
      const quoteBalance = this.getAssetBalanceOrThrow(userId, quoteAsset);

      if (this.toNumber(quoteBalance.available) < cost) {
        throw new Error("Insufficient Funds");
      }

      quoteBalance.available = this.sub(quoteBalance.available, cost);
      quoteBalance.locked = this.add(quoteBalance.locked, cost);
      this.persistBalance(userId, quoteAsset, traceId);
    } else {
      const qty = this.toNumber(quantity);
      const baseBalance = this.getAssetBalanceOrThrow(userId, baseAsset);

      if (this.toNumber(baseBalance.available) < qty) {
        throw new Error("Insufficient Funds");
      }

      baseBalance.available = this.sub(baseBalance.available, qty);
      baseBalance.locked = this.add(baseBalance.locked, qty);
      this.persistBalance(userId, baseAsset, traceId);
    }

    this.logEvent("balance_lock_after", {
      traceId,
      userId,
      side,
      baseAsset,
      quoteAsset,
      balances: this.userBalances.get(userId),
    });
  }

  createOrder(
    market: string,
    side: SIDE,
    kind: string,
    price: number,
    quantity: number,
    userId: string,
    traceId: string
  ) {
    const [baseAsset, quoteAsset] = market.split("_");
    this.checklockfunds(userId, baseAsset, quoteAsset, side, price, quantity, traceId);

    const orderbook = this.orderbooks.get(market);
    if (!orderbook) throw new Error("Market not found");

    const order: Order = {
      price: this.round8(this.toNumber(price)),
      quantity: this.round8(this.toNumber(quantity)),
      filledQuantity: 0,
      side,
      kind: kind as KIND,
      userId,
      orderId: uuidv4(),
    };

    this.logEvent("add_order_before", {
      traceId,
      market,
      userId,
      orderId: order.orderId,
      side,
      kind,
      price: order.price,
      quantity: order.quantity,
      bestBid: orderbook.bids[0]?.price ?? null,
      bestAsk: orderbook.asks[0]?.price ?? null,
      bidCount: orderbook.bids.length,
      askCount: orderbook.asks.length,
    });

    console.log("BEFORE ADD ORDER", market, {
      bids: orderbook.bids.map((o) => ({
        id: o.orderId,
        side: o.side,
        price: o.price,
        qty: o.quantity,
        filled: o.filledQuantity,
        userId: o.userId,
      })),
      asks: orderbook.asks.map((o) => ({
        id: o.orderId,
        side: o.side,
        price: o.price,
        qty: o.quantity,
        filled: o.filledQuantity,
        userId: o.userId,
      })),
    });

    // @ts-ignore
    const { executedQty, fills } = orderbook.addOrder(order);
    const remainingQuantity = Math.max(0, this.sub(order.quantity, executedQty));
    const status =
      remainingQuantity <= 0
        ? ("FILLED" as const)
        : executedQty > 0
        ? ("PARTIALLY_FILLED" as const)
        : ("OPEN" as const);

    this.logEvent("add_order_after", {
      traceId,
      market,
      userId,
      orderId: order.orderId,
      side,
      price: order.price,
      quantity: order.quantity,
      executedQty,
      remainingQuantity,
      status,
      fillCount: fills.length,
      bestBid: orderbook.bids[0]?.price ?? null,
      bestAsk: orderbook.asks[0]?.price ?? null,
    });

    fills.forEach((fill: any, idx: number) => {
      this.logEvent("fill_generated", {
        traceId,
        fillIndex: idx,
        takerOrderId: order.orderId,
        makerOrderId: fill.marketOrderId,
        takerUserId: userId,
        makerUserId: fill.otheruserId,
        tradeId: fill.tradeId,
        price: fill.price,
        quantity: fill.quantity,
        makerRemainingQuantity: fill.marketRemainingQuantity,
        makerFilledQuantity: fill.marketFilledQuantity,
      });
    });

    RedisManager.getInstance().pushMessageToDB({
      type: "ORDER_CREATED",
      data: {
        orderId: order.orderId,
        userId: order.userId,
        market,
        side: order.side,
        kind: order.kind,
        price: order.price,
        quantity: order.quantity,
        remainingQuantity,
        status,
      },
    });

    RedisManager.getInstance().publishMessage(`orders@${userId}`, {
      stream: `orders@${userId}`,
      data: {
        event: "ORDER_CREATED",
        order: {
          orderId: order.orderId,
          market,
          side: order.side,
          kind: order.kind,
          price: order.price,
          quantity: order.quantity,
          filledQuantity: executedQty,
          remainingQuantity,
          status,
          createdAt: new Date().toISOString(),
        },
      },
    });

    console.log("AFTER ADD ORDER", {
      incoming: order,
      executedQty,
      fills,
      bids: orderbook.bids,
      asks: orderbook.asks,
    });

    this.updateBalances(userId, baseAsset, quoteAsset, side, fills, traceId);

    fills.forEach((fill: any) => {
      RedisManager.getInstance().pushMessageToDB({
        type: "MARKET_TICK_ADDED",
        data: {
          market,
          price: fill.price,
          volume: fill.quantity,
          createdAt: Date.now(),
        },
      });
    });

    this.createDBOrder(fills, market, userId, side);

    if (fills.length > 0) {
      this.updateDBOrders(order, executedQty, fills, market);
      this.publishWsDepthUpdates(fills, order.price, side, market);
    } else {
      const depth = orderbook.getDepth();

      RedisManager.getInstance().publishMessage(`depth@${market}`, {
        stream: `depth@${market}`,
        data: {
          a: depth.asks,
          b: depth.bids,
          e: "depth",
        },
      });
    }

    this.publishWsTrades(fills, userId, market);

    return { orderId: order.orderId, executedQty, fills };
  }

  publishWsDepthUpdates(fills: Fills[], price: number, side: "BUY" | "SELL", market: string) {
    const orderbook = this.orderbooks.get(market);
    if (!orderbook) throw new Error("No orderbook found");

    const depth = orderbook.getDepth();
    const filledPrices = fills.map((f) => f.price.toString());

    if (side === "BUY") {
      const updatedAsks: [string, string][] = filledPrices.map((fp) => {
        const surviving = depth.asks.find((x) => x[0] === fp);
        return surviving ?? [fp, "0"];
      });

      const updatedBid = depth.bids.find((x) => Number(x[0]) === price);

      RedisManager.getInstance().publishMessage(`depth@${market}`, {
        stream: `depth@${market}`,
        data: {
          a: updatedAsks,
          b: updatedBid ? [updatedBid] : [],
          e: "depth",
        },
      });
    }

    if (side === "SELL") {
      const updatedBids: [string, string][] = filledPrices.map((fp) => {
        const surviving = depth.bids.find((x) => x[0] === fp);
        return surviving ?? [fp, "0"];
      });

      const updatedAsk = depth.asks.find((x) => Number(x[0]) === price);

      RedisManager.getInstance().publishMessage(`depth@${market}`, {
        stream: `depth@${market}`,
        data: {
          a: updatedAsk ? [updatedAsk] : [],
          b: updatedBids,
          e: "depth",
        },
      });
    }
  }

  publishWsTrades(fills: Fills[], userId: string, market: string) {
    fills.forEach((fill) => {
      RedisManager.getInstance().publishMessage(`trade@${market}`, {
        stream: `trade@${market}`,
        data: {
          e: "trade",
          t: fill.tradeId,
          s: market,
          p: fill.price.toString(),
          q: fill.quantity.toString(),
          m: fill.otheruserId == userId,
          T: Date.now(),
        },
      });

      RedisManager.getInstance().publishMessage(`trades@${userId}`, {
        stream: `trades@${userId}`,
        data: {
          tradeId: fill.tradeId,
          market,
          price: fill.price,
          quantity: fill.quantity,
          side: fill.otheruserId === userId ? "SELL" : "BUY",
          timestamp: Date.now(),
        },
      });

      RedisManager.getInstance().publishMessage(`trades@${fill.otheruserId}`, {
        stream: `trades@${fill.otheruserId}`,
        data: {
          tradeId: fill.tradeId,
          market,
          price: fill.price,
          quantity: fill.quantity,
          side: fill.otheruserId === userId ? "BUY" : "SELL",
          timestamp: Date.now(),
        },
      });
    });
  }

  cancelOrder(orderId: string, market: string, userId: string, traceId: string) {
    const orderbook = this.orderbooks.get(market);
    if (!orderbook) throw new Error("No orderbook found for this market");

    const [baseAsset, quoteAsset] = market.split("_");

    this.logEvent("cancel_order_start", {
      traceId,
      orderId,
      market,
      userId,
    });

    const order =
      orderbook.bids.find((bid) => bid.orderId == orderId) ||
      orderbook.asks.find((ask) => ask.orderId == orderId);

    if (!order) throw new Error("No order found in the orderbook");
    if (order.userId != userId) throw new Error("Unauthorized");

    const remainingQuantity = this.sub(order.quantity, order.filledQuantity);

    this.logEvent("cancel_order_found", {
      traceId,
      orderId,
      market,
      userId,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      remainingQuantity,
    });

    let pricelevel: any;

    if (order.side === "BUY") {
      pricelevel = orderbook.cancelBid(order);
      const refund = this.mul(remainingQuantity, order.price);
      const quoteBalance = this.getAssetBalanceOrThrow(userId, quoteAsset);

      quoteBalance.available = this.add(quoteBalance.available, refund);
      quoteBalance.locked = this.sub(quoteBalance.locked, refund);
      this.persistBalance(userId, quoteAsset, traceId);

      this.logEvent("cancel_order_balance_after", {
        traceId,
        userId,
        asset: quoteAsset,
        refund,
        balances: this.userBalances.get(userId),
      });

      if (pricelevel) this.sendUpdatedDepthAt(pricelevel.toString(), market);
    } else {
      pricelevel = orderbook.cancelAsk(order);
      const leftQuantity = this.sub(order.quantity, order.filledQuantity);
      const baseBalance = this.getAssetBalanceOrThrow(userId, baseAsset);

      baseBalance.available = this.add(baseBalance.available, leftQuantity);
      baseBalance.locked = this.sub(baseBalance.locked, leftQuantity);
      this.persistBalance(userId, baseAsset, traceId);

      this.logEvent("cancel_order_balance_after", {
        traceId,
        userId,
        asset: baseAsset,
        refund: leftQuantity,
        balances: this.userBalances.get(userId),
      });

      if (pricelevel) this.sendUpdatedDepthAt(pricelevel.toString(), market);
    }

    RedisManager.getInstance().publishMessage(`orders@${userId}`, {
      stream: `orders@${userId}`,
      data: { event: "ORDER_CANCELLED", orderId },
    });

    return {
      orderId: order.orderId,
      executedQty: order.filledQuantity,
      remainingQuantity,
      status: "CANCELLED" as const,
    };
  }

  sendUpdatedDepthAt(price: string, market: string) {
    const orderbook = this.orderbooks.get(market);
    if (!orderbook) return;

    const depth = orderbook.getDepth();
    const updatedBids = depth?.bids.filter((x) => x[0] === price);
    const updatedAsks = depth?.asks.filter((x) => x[0] === price);

    RedisManager.getInstance().publishMessage(`depth@${market}`, {
      stream: `depth@${market}`,
      data: {
        a: updatedAsks.length ? updatedAsks : [[price, "0"]],
        b: updatedBids.length ? updatedBids : [[price, "0"]],
        e: "depth",
      },
    });
  }

  createDBOrder(fills: Fills[], market: string, userId: string, side: SIDE) {
    fills.forEach((fill) => {
      RedisManager.getInstance().pushMessageToDB({
        type: "TRADE_CREATED",
        data: {
          tradeId: fill.tradeId,
          market,
          buyerUserId: side === "BUY" ? userId : fill.otheruserId,
          sellerUserId: side === "SELL" ? userId : fill.otheruserId,
          price: fill.price,
          isBuyerMaker: fill.otheruserId === userId,
          quantity: fill.quantity.toString(),
          quoteQuantity: this.mul(fill.price, fill.quantity).toString(),
          timestamp: Date.now(),
        },
      });
    });
  }

  updateDBOrders(order: Order, executedQty: number, fills: Fills[], market: string) {
    fills.forEach((fill) => {
      const makerRemaining = Math.max(0, this.toNumber(fill.marketRemainingQuantity));
      const makerFilledQuantity = this.toNumber(fill.marketFilledQuantity);
      const makerStatus =
        makerRemaining <= 0 ? ("FILLED" as const) : ("PARTIALLY_FILLED" as const);

      RedisManager.getInstance().pushMessageToDB({
        type: "ORDER_UPDATED",
        data: {
          orderId: fill.marketOrderId,
          filledQuantity: makerFilledQuantity,
          remainingQuantity: makerRemaining,
          status: makerStatus,
        },
      });

      RedisManager.getInstance().publishMessage(`orders@${fill.otheruserId}`, {
        stream: `orders@${fill.otheruserId}`,
        data: {
          event: "ORDER_UPDATED",
          orderId: fill.marketOrderId,
          filledQuantity: makerFilledQuantity,
          remainingQuantity: makerRemaining,
          status: makerStatus,
        },
      });
    });
  }

  updateBalances(
    userId: string,
    baseAsset: string,
    quoteAsset: string,
    side: SIDE,
    fills: Fills[],
    traceId: string
  ) {
    const touched = new Set<string>();

    const mark = (uid: string, asset: string) => touched.add(`${uid}:${asset}`);
    const bal = (uid: string, asset: string) => this.getAssetBalanceOrThrow(uid, asset);

    this.logEvent("update_balances_start", {
      traceId,
      market: `${baseAsset}_${quoteAsset}`,
      userId,
      side,
      fillCount: fills.length,
      touchedUsers: [...new Set([userId, ...fills.map((f) => f.otheruserId)])],
    });

    for (const fill of fills) {
      const quote = this.mul(fill.price, fill.quantity);
      const qty = this.toNumber(fill.quantity);

      this.logEvent("balance_delta", {
        traceId,
        fillTradeId: fill.tradeId,
        side,
        buyerUserId: side === "BUY" ? userId : fill.otheruserId,
        sellerUserId: side === "SELL" ? userId : fill.otheruserId,
        baseAsset,
        quoteAsset,
        qty,
        quote,
      });

      if (side === "BUY") {
        bal(fill.otheruserId, quoteAsset).available = this.add(
          bal(fill.otheruserId, quoteAsset).available,
          quote
        );
        bal(fill.otheruserId, baseAsset).locked = this.sub(
          bal(fill.otheruserId, baseAsset).locked,
          qty
        );
        bal(userId, quoteAsset).locked = this.sub(
          bal(userId, quoteAsset).locked,
          quote
        );
        bal(userId, baseAsset).available = this.add(
          bal(userId, baseAsset).available,
          qty
        );

        mark(fill.otheruserId, quoteAsset);
        mark(fill.otheruserId, baseAsset);
        mark(userId, quoteAsset);
        mark(userId, baseAsset);
      } else {
        bal(fill.otheruserId, baseAsset).available = this.add(
          bal(fill.otheruserId, baseAsset).available,
          qty
        );
        bal(fill.otheruserId, quoteAsset).locked = this.sub(
          bal(fill.otheruserId, quoteAsset).locked,
          quote
        );
        bal(userId, baseAsset).locked = this.sub(
          bal(userId, baseAsset).locked,
          qty
        );
        bal(userId, quoteAsset).available = this.add(
          bal(userId, quoteAsset).available,
          quote
        );

        mark(fill.otheruserId, baseAsset);
        mark(fill.otheruserId, quoteAsset);
        mark(userId, baseAsset);
        mark(userId, quoteAsset);
      }
    }

    this.logEvent("update_balances_end", {
      traceId,
      balances: {
        [userId]: this.userBalances.get(userId),
        ...Object.fromEntries(
          fills.map((f) => [f.otheruserId, this.userBalances.get(f.otheruserId)])
        ),
      },
    });

    for (const key of touched) {
      const [uid, asset] = key.split(":");
      this.persistBalance(uid, asset, traceId);
    }
  }

  persistBalance(userId: string, asset: string, traceId?: string) {
    const balance = this.userBalances.get(userId)?.[asset];
    if (!balance) return;

    this.logEvent("persist_balance", {
      traceId: traceId ?? "n/a",
      userId,
      asset,
      available: balance.available,
      locked: balance.locked,
    });

    RedisManager.getInstance().pushMessageToDB({
      type: "BALANCE_UPDATED",
      data: {
        userId,
        asset,
        available: balance.available,
        locked: balance.locked,
      },
    });

    RedisManager.getInstance().publishMessage(`balances@${userId}`, {
      stream: `balances@${userId}`,
      data: { asset, available: balance.available, locked: balance.locked },
    });
  }

  setBaseBalances() {
    this.userBalances.set("6f8c7c4e-3c5a-4e4c-9c72-8c9a6d2f7b11", {
      [BASE_CURRENCY]: { available: 10000000, locked: 0 },
      ETH: { available: 100, locked: 0 },
      SOL: { available: 1000, locked: 0 },
      USDT: { available: 10000000, locked: 0 },
    });

    this.userBalances.set("b2e4f5a1-91c7-4e7d-8c8f-5f0a2d4b9a33", {
      [BASE_CURRENCY]: { available: 10000000, locked: 0 },
      ETH: { available: 100, locked: 0 },
      SOL: { available: 1000, locked: 0 },
      USDT: { available: 10000000, locked: 0 },
    });
  }
}

export default Engine;