import express from "express"
import { ordersRouter } from "./routes/orders.route"
const app=express();
app.use(express.json());
const PORT=process.env.PORT || 3000;

app.use("/api/v1/orders",ordersRouter);
app.listen(PORT,()=>{
    console.log(`Server running on port ${PORT}`);
}
);