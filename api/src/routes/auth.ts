import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { pool } from "../db";
import RedisClient from "../configs/RedisClient";

export const authroutes = Router();
const redis = RedisClient.getInstance();

authroutes.post("/signup", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required",
            });
        }

        const existingUser = await pool.query(
            `
            SELECT * FROM users
            WHERE email = $1
            `,
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                message: "User already exists",
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `
            INSERT INTO users (
                email,
                password
            )
            VALUES ($1, $2)
            RETURNING id
            `,
            [email, hashedPassword]
        );

        const userId = result.rows[0].id;

        await pool.query(
            `
            INSERT INTO balances (
                user_id,
                asset,
                available,
                locked
            )
            VALUES
                ($1, 'BTC', 10, 0),
                ($1, 'ETH', 100, 0),
                ($1, 'SOL', 1000, 0),
                ($1, 'USDT', 100000, 0)
            `,
            [userId]
        );

        // notify engine
        // Handles the scenaio where worker is already running and user signs up
        redis.sendMessage({
            type: "USER_CREATED",
            data: {
                userId,
                balances: {
                    BTC: {
                        available: 10,
                        locked: 0,
                    },
                    ETH: {
                        available: 100,
                        locked: 0,
                    },
                    SOL: {
                        available: 1000,
                        locked: 0,
                    },
                    USDT: {
                        available: 100000,
                        locked: 0,
                    },
                },
            },
        });

        const token = jwt.sign(
            {
                userId,
            },
            process.env.JWT_SECRET as string
        );

        return res.json({
            token,
        });

    } catch (err) {
        console.log(err);

        return res.status(500).json({
            message: "Internal Server Error",
        });
    }
});

authroutes.post("/signin", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required",
            });
        }

        const result = await pool.query(
            `
            SELECT * FROM users
            WHERE email = $1
            `,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({
                message: "Invalid credentials",
            });
        }

        const user = result.rows[0];

        const matched = await bcrypt.compare(
            password,
            user.password
        );

        if (!matched) {
            return res.status(400).json({
                message: "Invalid credentials",
            });
        }

        const token = jwt.sign(
            {
                userId: user.id,
            },
            process.env.JWT_SECRET as string
        );

        return res.json({
            token,
        });

    } catch (error) {
        console.log(error);

        return res.status(500).json({
            message: "Internal server error",
        });
    }
});