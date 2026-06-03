import { Router } from "express";
import { authMiddleware } from "../middleware/middleware";
import { pool } from "../db";

export const balancesrouter = Router();

balancesrouter.get("/", authMiddleware, async (req: any, res) => {
  try {

    const result = await pool.query(
      `
      SELECT
        asset,
        available,
        locked
      FROM balances
      WHERE user_id = $1
      `,
      [req.userId]
    );

    res.json({
      balances: result.rows,
    });

  } catch (err) {
    console.error("Get balances error:", err);

    res.status(500).json({
      message: "Internal server error",
    });
  }
});