import { Router } from "express";
import RedisClient from "../configs/RedisClient";
import { CANCEL_ORDER, CREATE_ORDER, GET_OPEN_ORDERS } from "../types/types";


export const ordersRouter = Router();
const redis = RedisClient.getInstance();
ordersRouter.post("/", async (req, res) => {
  try {
    const { market, side, kind, price, quantity, userId } = req.body;

    if (!market || !side || !kind || !quantity || !userId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const response:any=await redis.sendAndawait({
      type: CREATE_ORDER,
      data: {
        market,
        side,
        kind,
        price: price ?? null,
        quantity,
        userId,
        timestamp: Date.now()
      }
    });

    res.json(response.payload)

  } catch (err) {
    console.error("Create order error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

ordersRouter.get("/open",async(req,res)=>{
    try{
        const response:any=await redis.sendAndawait({
            type:GET_OPEN_ORDERS,
            data:{
                userId:req.query.userId,
                market:req.query.market  
            }
        })
        res.json(response.payload);
    }catch(err){
        console.error("Get open orders error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
})
ordersRouter.delete("/",async(req,res)=>{
    try{
        const response:any=await redis.sendAndawait({
            type:CANCEL_ORDER,
            data:{
                orderId:req.body.orderId,
                userId:req.body.userId
            }
        })
        res.json(response.payload);
    }catch(err){
        console.error("Cancel order error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
