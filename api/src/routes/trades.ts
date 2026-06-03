import { Router } from "express";
import { pool } from "../db";
import { authMiddleware } from "../middleware/middleware";

export const tradesRouter = Router();

// Public market trades
tradesRouter.get("/", async (req, res) => {
    try {
        const { market } = req.query;

        if (!market) {
            return res.status(400).json({
                message: "Market is required"
            });
        }

        const result = await pool.query(
            `
            SELECT 
                id,
                market,
                buyer_user_id,
                seller_user_id,
                price,
                quantity,
                quote_quantity,
                is_buyer_maker,
                created_at
            FROM trades
            WHERE market = $1
            ORDER BY created_at DESC
            LIMIT 50
            `,
            [market]
        );

        res.json({
            trades: result.rows
        });

    } catch (e) {
        console.error(e);

        res.status(500).json({
            message: "Internal server error"
        });
    }
});

// User specific trades
tradesRouter.get("/my-trades", authMiddleware, async (req: any, res) => {
    try {

        const result = await pool.query(
            `
            SELECT
                id,
                market,
                buyer_user_id,
                seller_user_id,
                price,
                quantity,
                quote_quantity,
                is_buyer_maker,
                created_at
            FROM trades
            WHERE
                buyer_user_id = $1
                OR seller_user_id = $1
            ORDER BY created_at DESC
            LIMIT 50
            `,
            [req.userId]
        );

        res.json({
            trades: result.rows
        });

    } catch (e) {
        console.error(e);

        res.status(500).json({
            message: "Internal server error"
        });
    }
});