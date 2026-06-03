import { Client } from "pg";
import "dotenv/config";

const client = new Client({
  connectionString: process.env.POSTGRES_URL,
});

async function initializeDB() {
  await client.connect();

  console.log("Connected to Postgres DB");

  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `);

  await client.query(`
    CREATE EXTENSION IF NOT EXISTS timescaledb;
  `);

  // Users table
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE users
    ALTER COLUMN id
    SET DEFAULT gen_random_uuid();
  `);

  // Trades table
  await client.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id BIGSERIAL PRIMARY KEY,
      market VARCHAR(20) NOT NULL,
      buyer_user_id UUID NOT NULL,
      seller_user_id UUID NOT NULL,
      price NUMERIC(30,10) NOT NULL,
      quantity NUMERIC(30,10) NOT NULL,
      quote_quantity NUMERIC(30,10) NOT NULL,
      is_buyer_maker BOOLEAN NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Orders table
  await client.query(`
    CREATE TABLE IF NOT EXISTS trade_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      market VARCHAR(20) NOT NULL,
      side VARCHAR(4) NOT NULL,
      type VARCHAR(10) NOT NULL,
      price NUMERIC(30,10),
      quantity NUMERIC(30,10) NOT NULL,
      filled_quantity NUMERIC(30,10) DEFAULT 0,
      remaining_quantity NUMERIC(30,10) NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Balances table
  await client.query(`
    CREATE TABLE IF NOT EXISTS balances (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      asset VARCHAR(20) NOT NULL,
      available NUMERIC(30,10) DEFAULT 0,
      locked NUMERIC(30,10) DEFAULT 0,

      UNIQUE(user_id, asset),

      CONSTRAINT fk_user
        FOREIGN KEY(user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );
  `);

  // Market ticks table
  await client.query(`
    CREATE TABLE IF NOT EXISTS market_ticks (
      id BIGSERIAL PRIMARY KEY,
      market VARCHAR(20) NOT NULL,
      price NUMERIC(30,10) NOT NULL,
      volume NUMERIC(30,10) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Drop old materialized views
  await client.query(`
    DROP MATERIALIZED VIEW IF EXISTS klines_1m;
  `);

  await client.query(`
    DROP MATERIALIZED VIEW IF EXISTS klines_5m;
  `);

  await client.query(`
    DROP MATERIALIZED VIEW IF EXISTS klines_1h;
  `);

  // Drop old regular views
  await client.query(`
    DROP VIEW IF EXISTS klines_1m;
  `);

  await client.query(`
    DROP VIEW IF EXISTS klines_5m;
  `);

  await client.query(`
    DROP VIEW IF EXISTS klines_1h;
  `);

  // 1 minute klines
  await client.query(`
    CREATE VIEW klines_1m AS
    SELECT
      time_bucket('1 minute', created_at) AS bucket,
      first(price, created_at) AS open,
      max(price) AS high,
      min(price) AS low,
      last(price, created_at) AS close,
      sum(volume) AS volume,
      market
    FROM market_ticks
    GROUP BY
      time_bucket('1 minute', created_at),
      market;
  `);

  // 5 minute klines
  await client.query(`
    CREATE VIEW klines_5m AS
    SELECT
      time_bucket('5 minutes', created_at) AS bucket,
      first(price, created_at) AS open,
      max(price) AS high,
      min(price) AS low,
      last(price, created_at) AS close,
      sum(volume) AS volume,
      market
    FROM market_ticks
    GROUP BY
      time_bucket('5 minutes', created_at),
      market;
  `);

  // 1 hour klines
  await client.query(`
    CREATE VIEW klines_1h AS
    SELECT
      time_bucket('1 hour', created_at) AS bucket,
      first(price, created_at) AS open,
      max(price) AS high,
      min(price) AS low,
      last(price, created_at) AS close,
      sum(volume) AS volume,
      market
    FROM market_ticks
    GROUP BY
      time_bucket('1 hour', created_at),
      market;
  `);

  // Indexes
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_trade_orders_user_id
    ON trade_orders(user_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_balances_user_asset
    ON balances(user_id, asset);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_trades_buyer
    ON trades(buyer_user_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_trades_seller
    ON trades(seller_user_id);
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_market_ticks_market_created_at
    ON market_ticks(market, created_at DESC);
  `);

  console.log("Tables and views ensured.");

  await client.end();

  console.log("Disconnected from Postgres.");
}

initializeDB().catch(async (err) => {
  console.error("DB init failed:", err);

  await client.end();

  process.exit(1);
});