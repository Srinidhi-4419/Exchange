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
      // No snapshot found
    }

    if (snapshot) {
      const data = JSON.parse(snapshot.toString());

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
          // Create order failed silently
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
          // Cancel order failed silently
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
          // Get orders failed silently
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

    if (side === "BUY") {
      const cost = this.mul(price, quantity);
      const quoteBalance = this.getAssetBalanceOrThrow(userId, quoteAsset);

      if (this.toNumber(quoteBalance.available) < cost) {
        throw new Error("Insufficient Funds");
      }

      quoteBalance.available = this.sub(quoteBalance.available, cost);
      quoteBalance.locked = this.add(quoteBalance.locked, cost);
      this.persistBalance(userId, quoteAsset);
    } else {
      const qty = this.toNumber(quantity);
      const baseBalance = this.getAssetBalanceOrThrow(userId, baseAsset);

      if (this.toNumber(baseBalance.available) < qty) {
        throw new Error("Insufficient Funds");
      }

      baseBalance.available = this.sub(baseBalance.available, qty);
      baseBalance.locked = this.add(baseBalance.locked, qty);
      this.persistBalance(userId, baseAsset);
    }
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

    // @ts-ignore
    const { executedQty, fills } = orderbook.addOrder(order);
    const remainingQuantity = Math.max(0, this.sub(order.quantity, executedQty));
    const status =
      remainingQuantity <= 0
        ? ("FILLED" as const)
        : executedQty > 0
        ? ("PARTIALLY_FILLED" as const)
        : ("OPEN" as const);

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

    this.publishWsTrades(fills, userId, market, side);

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

  publishWsTrades(fills: Fills[], userId: string, market: string, side: SIDE) {
    fills.forEach((fill) => {
      RedisManager.getInstance().publishMessage(`trade@${market}`, {
        stream: `trade@${market}`,
        data: {
          e: "trade",
          t: fill.tradeId,
          s: market,
          p: fill.price.toString(),
          q: fill.quantity.toString(),
          m: side === "SELL",
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
          side: side,
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
          side: side === "BUY" ? "SELL" : "BUY",
          timestamp: Date.now(),
        },
      });
    });
  }

  cancelOrder(orderId: string, market: string, userId: string, traceId: string) {
    const orderbook = this.orderbooks.get(market);
    if (!orderbook) throw new Error("No orderbook found for this market");

    const [baseAsset, quoteAsset] = market.split("_");

    const order =
      orderbook.bids.find((bid) => bid.orderId == orderId) ||
      orderbook.asks.find((ask) => ask.orderId == orderId);

    if (!order) throw new Error("No order found in the orderbook");
    if (order.userId != userId) throw new Error("Unauthorized");

    const remainingQuantity = this.sub(order.quantity, order.filledQuantity);

    let pricelevel: any;

    if (order.side === "BUY") {
      pricelevel = orderbook.cancelBid(order);
      const refund = this.mul(remainingQuantity, order.price);
      const quoteBalance = this.getAssetBalanceOrThrow(userId, quoteAsset);

      quoteBalance.available = this.add(quoteBalance.available, refund);
      quoteBalance.locked = this.sub(quoteBalance.locked, refund);
      this.persistBalance(userId, quoteAsset);

      if (pricelevel) this.sendUpdatedDepthAt(pricelevel.toString(), market, order.side);
    } else {
      pricelevel = orderbook.cancelAsk(order);
      const leftQuantity = this.sub(order.quantity, order.filledQuantity);
      const baseBalance = this.getAssetBalanceOrThrow(userId, baseAsset);

      baseBalance.available = this.add(baseBalance.available, leftQuantity);
      baseBalance.locked = this.sub(baseBalance.locked, leftQuantity);
      this.persistBalance(userId, baseAsset);

      if (pricelevel) this.sendUpdatedDepthAt(pricelevel.toString(), market, order.side);
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

  sendUpdatedDepthAt(price: string, market: string, side: SIDE) {
    const orderbook = this.orderbooks.get(market);
    if (!orderbook) return;

    const depth = orderbook.getDepth();

    const updatedBids = depth.bids.filter((x) => x[0] === price);
    const updatedAsks = depth.asks.filter((x) => x[0] === price);

    RedisManager.getInstance().publishMessage(`depth@${market}`, {
      stream: `depth@${market}`,
      data: {
        a: side === "SELL" ? (updatedAsks.length ? updatedAsks : [[price, "0"]]) : [],
        b: side === "BUY" ? (updatedBids.length ? updatedBids : [[price, "0"]]) : [],
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
          isBuyerMaker: side === "SELL",
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

    for (const fill of fills) {
      const quote = this.mul(fill.price, fill.quantity);
      const qty = this.toNumber(fill.quantity);

      if (side === "BUY") {
        bal(fill.otheruserId, quoteAsset).available = this.add(
          bal(fill.otheruserId, quoteAsset).available,
          quote
        );
        bal(fill.otheruserId, baseAsset).locked = this.sub(
          bal(fill.otheruserId, baseAsset).locked,
          qty
        );
        bal(userId, quoteAsset).locked = this.sub(bal(userId, quoteAsset).locked, quote);
        bal(userId, baseAsset).available = this.add(bal(userId, baseAsset).available, qty);

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
        bal(userId, baseAsset).locked = this.sub(bal(userId, baseAsset).locked, qty);
        bal(userId, quoteAsset).available = this.add(bal(userId, quoteAsset).available, quote);

        mark(fill.otheruserId, baseAsset);
        mark(fill.otheruserId, quoteAsset);
        mark(userId, baseAsset);
        mark(userId, quoteAsset);
      }
    }

    for (const key of touched) {
      const [uid, asset] = key.split(":");
      this.persistBalance(uid, asset);
    }
  }

  persistBalance(userId: string, asset: string, traceId?: string) {
    const balance = this.userBalances.get(userId)?.[asset];
    if (!balance) return;

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
}

export default Engine;