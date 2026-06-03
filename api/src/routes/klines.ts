import { Router } from "express";
import { pool } from "../db";

export const klinesRouter = Router();

klinesRouter.get("/", async (req, res) => {
    try {
        const { market, interval } = req.query;

        if (!market || !interval) {
            return res.status(400).json({
                message: "market and interval are required"
            });
        }

        const allowedIntervals = ["1m", "5m", "1h"];

        if (!allowedIntervals.includes(interval as string)) {
            return res.status(400).json({
                message: "Invalid interval"
            });
        }

        const tableName = `klines_${interval}`;

        const result = await pool.query(
            `
            SELECT
                bucket,
                open,
                high,
                low,
                close,
                volume
            FROM ${tableName}
            WHERE market = $1
            ORDER BY bucket DESC
            LIMIT 100
            `,
            [market]
        );

        res.json({
            klines: result.rows
        });

    } catch (e) {
        console.error(e);

        res.status(500).json({
            message: "Internal server error"
        });
    }
});