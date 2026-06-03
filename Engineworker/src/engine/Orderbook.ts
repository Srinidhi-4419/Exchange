import { Fills, Order } from "../types/Orderbook.types";

export class Orderbook {
  bids: Order[];
  asks: Order[];
  baseAsset: string;
  quoteAsset: string = "USDT";
  lastTradeId: number;
  currentPrice: number;

  constructor(
    baseAsset: string,
    bids: Order[],
    asks: Order[],
    lastTradeId: number,
    currentPrice: number,
  ) {
    this.bids = bids;
    this.asks = asks;
    this.baseAsset = baseAsset;
    this.lastTradeId = lastTradeId;
    this.currentPrice = currentPrice;
  }

  ticker() {
    return `${this.baseAsset}_${this.quoteAsset}`;
  }

  getSnapshot() {
    return {
      baseAsset: this.baseAsset,
      bids: this.bids,
      asks: this.asks,
      lastTradeId: this.lastTradeId,
      currentPrice: this.currentPrice,
    };
  }

  addOrder(order: Order) {
    order.price = Number(order.price);
    order.quantity = Number(order.quantity);
    order.filledQuantity = Number(order.filledQuantity || 0);

    if (order.side === "BUY") {
      const result = this.matchBids(order);
      if (!result) return;

      const { executedQty, fills } = result;
      order.filledQuantity = executedQty;

      if (executedQty >= order.quantity) {
        return { executedQty, fills };
      }

      this.bids.push(order);
      this.bids.sort((a, b) => b.price - a.price);

      return { executedQty, fills };
    } else {
      const result = this.matchAsks(order);
      if (!result) return;

      const { executedQty, fills } = result;
      order.filledQuantity = executedQty;

      if (executedQty >= order.quantity) {
        return { executedQty, fills };
      }

      this.asks.push(order);
      this.asks.sort((a, b) => a.price - b.price);

      return { executedQty, fills };
    }
  }

  matchBids(order: Order) {
    const fills: Fills[] = [];
    let executedQty = 0;

    this.asks.sort((a, b) => a.price - b.price);

    for (const ask of this.asks) {
      if (ask.userId === order.userId) continue;
      if (executedQty >= order.quantity) break;
      if (order.kind === "LIMIT" && Number(order.price) < Number(ask.price)) break;

      const askOpenQty = ask.quantity - ask.filledQuantity;
      if (askOpenQty <= 0) continue;

      const fillQty = Math.min(order.quantity - executedQty, askOpenQty);
      if (fillQty <= 0) continue;

      ask.filledQuantity += fillQty;
      executedQty += fillQty;
      this.lastTradeId++;
      this.currentPrice = ask.price;

      fills.push({
        price: ask.price,
        quantity: fillQty,
        tradeId: this.lastTradeId,
        //  i know name is ambiguous but this is the orderId of the order in market which got matched with incoming bid order
        marketOrderId: ask.orderId,
        otheruserId: ask.userId,
        marketRemainingQuantity: Math.max(0, ask.quantity - ask.filledQuantity),
        marketFilledQuantity: ask.filledQuantity,
      });
    }

    // remove fully filled asks
    this.asks = this.asks.filter((a) => a.filledQuantity < a.quantity);

    return { executedQty, fills };
  }

  matchAsks(order: Order) {
    const fills: Fills[] = [];
    let executedQty = 0;

    this.bids.sort((a, b) => b.price - a.price);

    for (const bid of this.bids) {
      if (bid.userId === order.userId) continue;
      if (executedQty >= order.quantity) break;
      if (order.kind === "LIMIT" && Number(bid.price) < Number(order.price)) break;

      const bidOpenQty = bid.quantity - bid.filledQuantity;
      if (bidOpenQty <= 0) continue;

      const fillQty = Math.min(order.quantity - executedQty, bidOpenQty);
      if (fillQty <= 0) continue;

      bid.filledQuantity += fillQty;
      executedQty += fillQty;
      this.lastTradeId++;
      this.currentPrice = bid.price;

      fills.push({
        price: bid.price,
        quantity: fillQty,
        tradeId: this.lastTradeId,
        marketOrderId: bid.orderId,
        otheruserId: bid.userId,
        marketRemainingQuantity: Math.max(0, bid.quantity - bid.filledQuantity),
        marketFilledQuantity: bid.filledQuantity,
      });
    }

    this.bids = this.bids.filter((b) => b.filledQuantity < b.quantity);

    return { executedQty, fills };
  }

  cancelBid(order: Order) {
    const index = this.bids.findIndex((x) => x.orderId === order.orderId);
    if (index !== -1) {
      const price = this.bids[index].price;
      this.bids.splice(index, 1);
      return price;
    }
  }

  cancelAsk(order: Order) {
    const index = this.asks.findIndex((x) => x.orderId === order.orderId);
    if (index !== -1) {
      const price = this.asks[index].price;
      this.asks.splice(index, 1);
      return price;
    }
  }

  getDepth() {
    const bids: [string, string][] = [];
    const asks: [string, string][] = [];

    const bidsObj = new Map<string, number>();
    const asksObj = new Map<string, number>();

    for (const order of this.bids) {
      const price = order.price.toString();
      const openQty = Number(order.quantity - order.filledQuantity);
      if (openQty <= 0) continue;

      bidsObj.set(price, (bidsObj.get(price) || 0) + openQty);
    }

    for (const order of this.asks) {
      const price = order.price.toString();
      const openQty = Number(order.quantity - order.filledQuantity);
      if (openQty <= 0) continue;

      asksObj.set(price, (asksObj.get(price) || 0) + openQty);
    }

    const sortedBids = Array.from(bidsObj.entries()).sort(
      (a, b) => Number(b[0]) - Number(a[0])
    );
    const sortedAsks = Array.from(asksObj.entries()).sort(
      (a, b) => Number(a[0]) - Number(b[0])
    );

    for (const [price, quantity] of sortedBids) {
      bids.push([price, quantity.toString()]);
    }

    for (const [price, quantity] of sortedAsks) {
      asks.push([price, quantity.toString()]);
    }

    return { bids, asks };
  }
}