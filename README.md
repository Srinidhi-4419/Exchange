# Exchange Platform

A low-latency exchange backend with order placement, balance management, market data handling, and realtime updates over WebSockets.

This project is designed to demonstrate the high-level architecture of an exchange system where users place orders, balances are validated and locked, the matching engine processes trades, market data is stored, and frontend clients receive live updates through WebSocket streams.

For a deeper walkthrough of the architecture, order flow, and implementation decisions, read the accompanying blog post:

📖 [Building a Low-Latency Exchange — Architecture, Orderbook & Real-Time Trading Flow](https://medium.com/@kulkarnisrinidhi85/building-a-low-latency-exchange-architecture-orderbook-and-real-time-trading-flow-dc46398d4fc5)
[Demo Video of Working](https://drive.google.com/file/d/1yLbnMhuhIDnkKFMwENYb_WEn0aq5WlIp/view?usp=sharing)

***

## Overview

The repository contains the core components required to simulate exchange behavior:

- User and balance management
- Order placement and tracking
- Matching engine with in-memory orderbooks
- Trade execution and market data generation
- WebSocket-based realtime streaming
- PostgreSQL / TimescaleDB persistence layer

At a high level, the system flow is:

1. A user places an order.
2. The API validates balances and locks required funds.
3. The matching engine processes the order.
4. Trades and balance updates are generated.
5. Database events are persisted asynchronously.
6. Realtime updates are pushed to frontend clients through WebSockets.

***

## Architecture

The platform is split into a few focused responsibilities:

### API Server
Handles user requests, authentication, order placement, and request validation.

### Matching Engine
Responsible for in-memory orderbooks, matching logic, balance updates, trade execution, and order lifecycle management.

### Redis Layer
Used for asynchronous communication between services, queue-based processing, and pub/sub event broadcasting.

### Database Processor
Consumes exchange events and persists orders, trades, market ticks, and balance updates.

### WebSocket Server
Streams public market data, private user updates, realtime orderbook depth, trade events, and balance changes.

### PostgreSQL / TimescaleDB
Stores users, balances, trades, orders, tick data, and K-line/candlestick data.

***

## Features

- Place buy and sell limit orders
- Maintain balances across multiple assets
- Lock balances for open orders
- Match orders using price-time priority
- Record executed trades
- Generate market ticks and K-line data
- Stream realtime orderbook depth updates
- Stream public and private WebSocket events
- Support authenticated private streams using JWT
- Snapshot-based engine recovery

***

## Database

The database layer creates the core tables and views used by the exchange.

### Core Tables

| Table | Description |
|---|---|
| `users` | User accounts |
| `balances` | Per-user asset balances |
| `trade_orders` | Order records |
| `trades` | Executed trade records |
| `market_ticks` | Price/volume tick data |

### K-line Views

| View | Interval |
|---|---|
| `klines_1m` | 1 minute |
| `klines_5m` | 5 minutes |
| `klines_1h` | 1 hour |

The initialization scripts create extensions, tables, indexes, and TimescaleDB continuous aggregate views. Seed/reset scripts can be used to create demo users and initialize balances for testing.

***

## Setup

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd <your-project-folder>
```

### 2. Install Dependencies

Install dependencies inside each service and the frontend:

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in each service folder as needed.

**Engine Worker / API / DB Processor**
```env
POSTGRES_URL=postgresql://user:password@localhost:5432/exchange
```

**API + WebSocket Server**
```env
JWT_SECRET=your_jwt_secret
```

**WebSocket Server**
```env
REDIS_URL=redis://localhost:6379
```

**Engine Worker**
```env
WITH_SNAPSHOT=true
```

### 4. Start PostgreSQL and Redis

Ensure PostgreSQL (with TimescaleDB) and Redis are running before starting any services.

### 5. Initialize the Database

```bash
cd dbprocessor
npx tsc
node dist/seed.js
```

This creates tables, indexes, extensions, TimescaleDB views, and optionally demo users and balances.

### 6. Start Backend Services

Compile TypeScript first in each service directory:

```bash
npx tsc
node dist/index.js
```

Start each of the following in a separate terminal:

- API
- Engine Worker
- DB Processor
- WebSocket Server

### 7. Start the Frontend

```bash
cd exchange-frontend
npm run dev
```

The frontend connects to the WebSocket server when the trading page loads.

***

## WebSocket Streams

### Public Streams

Open to all connected clients, no authentication required.

| Stream | Description |
|---|---|
| `depth@BTC_USDT` | Orderbook depth updates |
| `trade@BTC_USDT` | Recent trade events |

### Private Streams

Require an authenticated WebSocket connection with a valid JWT.

| Stream | Description |
|---|---|
| `orders@userId` | User order updates |
| `balances@userId` | User balance changes |
| `trades@userId` | User trade fills |

***

## Notes

- The matching engine uses in-memory orderbooks for low-latency execution.
- Database writes are handled asynchronously through the DB processor.
- Redis acts as the communication layer between services.
- Snapshots are used for restoring engine state during restarts.
- This project focuses on backend exchange architecture and realtime systems.

For detailed explanations of matching logic, order lifecycle, WebSocket stream architecture, depth generation, ticks and klines, fault isolation, and snapshots — refer to the [blog post](https://medium.com/@kulkarnisrinidhi85/building-a-low-latency-exchange-architecture-orderbook-and-real-time-trading-flow-dc46398d4fc5).

***

## License

MIT License


