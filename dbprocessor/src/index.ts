import { Pool } from "pg";
import Redis from "ioredis";
import "dotenv/config";

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected PG Pool Error", err);
});

async function main() {
  const redisClient = new Redis();

  console.log("Connected to Redis");

  while (true) {
    try {
      const res = await redisClient.blpop("db", 0);

      if (!res) continue;

      const message = JSON.parse(res[1]);

      console.log("DB Worker received message:", message.type);

      if (message.type === "TRADE_CREATED") {
        const trade = message.data;

        console.log("TRADE_CREATED payload", trade);

        const result = await pool.query(
          `
          INSERT INTO trades (
            market,
            buyer_user_id,
            seller_user_id,
            price,
            quantity,
            quote_quantity,
            is_buyer_maker,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            trade.market,
            trade.buyerUserId,
            trade.sellerUserId,
            trade.price,
            trade.quantity,
            trade.quoteQuantity,
            trade.isBuyerMaker,
            new Date(trade.timestamp),
          ]
        );

        console.log("insert rowCount", result.rowCount);
        console.log("Trade inserted successfully");
      } else if (message.type === "ORDER_CREATED") {
        const order = message.data;

        const quantity = Number(order.quantity);
        const remainingQuantity = Number(order.remainingQuantity);
        const filledQuantity = Math.max(
          0,
          quantity - remainingQuantity
        );

        const status = order.status;

        await pool.query(
          `
          INSERT INTO trade_orders (
            id,
            user_id,
            market,
            side,
            type,
            price,
            quantity,
            filled_quantity,
            remaining_quantity,
            status
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10
          )
          ON CONFLICT (id) DO UPDATE
          SET
            filled_quantity = GREATEST(
              trade_orders.filled_quantity,
              EXCLUDED.filled_quantity
            ),
            remaining_quantity = LEAST(
              trade_orders.remaining_quantity,
              EXCLUDED.remaining_quantity
            ),
            status = CASE
              WHEN trade_orders.status = 'CANCELLED'
                THEN 'CANCELLED'

              WHEN trade_orders.status = 'FILLED'
                THEN 'FILLED'

              WHEN EXCLUDED.status = 'CANCELLED'
                THEN 'CANCELLED'

              WHEN EXCLUDED.status = 'FILLED'
                THEN 'FILLED'

              WHEN EXCLUDED.status = 'PARTIALLY_FILLED'
                THEN 'PARTIALLY_FILLED'

              ELSE trade_orders.status
            END,
            updated_at = NOW()
          `,
          [
            order.orderId,
            order.userId,
            order.market,
            order.side,
            order.kind,
            order.price,
            quantity,
            filledQuantity,
            remainingQuantity,
            status,
          ]
        );

        console.log("Order created/upserted successfully");
      } else if (message.type === "ORDER_UPDATED") {
        const order = message.data;

        const nextFilled = Number(order.filledQuantity);
        const nextRemaining = Number(order.remainingQuantity);
        const nextStatus = order.status;

        await pool.query(
          `
          UPDATE trade_orders
          SET
            filled_quantity = GREATEST(
              filled_quantity,
              $1
            ),
            remaining_quantity = LEAST(
              remaining_quantity,
              $2
            ),
            status = CASE
              WHEN status = 'CANCELLED'
                THEN 'CANCELLED'

              WHEN status = 'FILLED'
                THEN 'FILLED'

              WHEN $3 = 'CANCELLED'
                THEN 'CANCELLED'

              WHEN $3 = 'FILLED'
                THEN 'FILLED'

              WHEN $3 = 'PARTIALLY_FILLED'
                THEN 'PARTIALLY_FILLED'

              ELSE status
            END,
            updated_at = NOW()
          WHERE id = $4
          `,
          [
            nextFilled,
            nextRemaining,
            nextStatus,
            order.orderId,
          ]
        );

        console.log("Order updated successfully");
      } else if (message.type === "ORDER_CANCELLED") {
        const order = message.data;

        const executedQty = Number(order.executedQty ?? 0);
        const remainingQuantity = Number(
          order.remainingQuantity ?? 0
        );

        await pool.query(
          `
          UPDATE trade_orders
          SET
            filled_quantity = GREATEST(
              filled_quantity,
              $1
            ),
            remaining_quantity = $2,
            status = 'CANCELLED',
            updated_at = NOW()
          WHERE id = $3
          `,
          [
            executedQty,
            remainingQuantity,
            order.orderId,
          ]
        );

        console.log("Order cancelled successfully");
      } else if (message.type === "MARKET_TICK_ADDED") {
        const tick = message.data;

        await pool.query(
          `
          INSERT INTO market_ticks (
            market,
            price,
            volume,
            created_at
          )
          VALUES ($1, $2, $3, $4)
          `,
          [
            tick.market,
            tick.price,
            tick.volume,
            new Date(tick.createdAt),
          ]
        );

        console.log("Market tick inserted successfully");
      } else if (message.type === "BALANCE_UPDATED") {
        const balance = message.data;

        await pool.query(
          `
          UPDATE balances
          SET
            available = $1,
            locked = $2
          WHERE
            user_id = $3
            AND asset = $4
          `,
          [
            balance.available,
            balance.locked,
            balance.userId,
            balance.asset,
          ]
        );

        console.log("Balance updated successfully");
      } else {
        console.warn(
          "Unknown message type:",
          message.type
        );
      }
    } catch (err) {
      console.error("DB Worker Error:", err);
    }
  }
}

main();