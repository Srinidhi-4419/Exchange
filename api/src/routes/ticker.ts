import { Router } from "express";
import {  pool } from "../db";

const tickerrouter = Router();

tickerrouter.get("/", async (req, res) => {
    try {

        const { market } = req.query;

        if (!market) {
            return res.status(400).json({
                message: "Market is required"
            });
        }

        // last price

        const lastPriceResult = await pool.query(
            `
            SELECT price
            FROM trades
            WHERE market = $1
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [market]
        );

        // 24h stats

        const statsResult = await pool.query(
            `
            SELECT
                MAX(price) AS high,
                MIN(price) AS low,
                SUM(quote_quantity) AS volume
            FROM trades
            WHERE market = $1
            AND created_at >= NOW() - INTERVAL '24 HOURS'
            `,
            [market]
        );

        // price 24h ago

        const oldPriceResult = await pool.query(
            `
            SELECT price
            FROM trades
            WHERE market = $1
            AND created_at <= NOW() - INTERVAL '24 HOURS'
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [market]
        );

        const lastPrice =
            Number(lastPriceResult.rows[0]?.price || 0);

        const high24h =
            Number(statsResult.rows[0]?.high || 0);

        const low24h =
            Number(statsResult.rows[0]?.low || 0);

        const volume24h =
            Number(statsResult.rows[0]?.volume || 0);

        const oldPrice =
            Number(oldPriceResult.rows[0]?.price || lastPrice);

        let change24h = 0;

        if (oldPrice > 0) {
            change24h =
                ((lastPrice - oldPrice) / oldPrice) * 100;
        }

        return res.json({
            market,
            lastPrice,
            high24h,
            low24h,
            volume24h,
            change24h
        });

    } catch (e) {

        console.error(e);

        return res.status(500).json({
            message: "Internal server error"
        });
    }
});

export default tickerrouter;