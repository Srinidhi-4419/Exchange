import RedisManager from "../RedisManager";
import fs from "fs";
import { Orderbook } from "./Orderbook";
import { Fills, KIND, Order, SIDE } from "../types/Orderbook.types";
import { v4 as uuidv4, v4 } from "uuid";
export const BASE_CURRENCY="BTC";

interface UserBalance{
    [key:string]:{
        available:number;
        locked:number;
    }
}

class Engine{
    private orderbooks:Orderbook[]=[];
    private userBalances:Map<string,UserBalance>=new Map();
    constructor(){
        let snapshot=null;
        try{
            if(process.env.WITH_SNAPSHOT){
                snapshot=fs.readFileSync("./snapshot.json","utf-8");
            }

        }catch(e){
            console.log("No shapshot found",e)
        }
        if(snapshot){
            const data=JSON.parse(snapshot.toString());
            this.orderbooks=data.orderbooks.map((o:any)=>new Orderbook(o.baseAsset,o.bids,o.asks,o.lastTradeId,o.currentPrice));
            this.userBalances=new Map(data.userBalances);
        }else{
            this.orderbooks=[new Orderbook("BTC",[],[],0,0)];
            this.setBaseBalances();
        }
        setInterval(() => {
            this.saveSnapshot();
        }, 1000*3);

    }
    saveSnapshot(){
        const snap={
            orderbooks:this.orderbooks.map(o=>o.getSnapshot()),
            userBalances:Array.from(this.userBalances.entries())
        }
        fs.writeFileSync("./snapshot.json",JSON.stringify(snap));
    }
    processOrders({message,clientId}:{message:any,clientId:string}){
        const typeofOrder=message.type;
        switch(typeofOrder){
            case "CREATE_ORDER":
                try{
                    const {executedqty,fills,orderId}=this.createOrder(message.payload.market,message.payload.side,message.payload.kind,message.payload.price,message.payload.quantity,message.payload.userId);
                    const redis=RedisManager.getInstance();
                    redis.sendToApi(clientId,{
                        type:"ORDER_PLACED",
                        payload:{
                            orderId,
                            executedqty,
                            fills
                        }
                    })
                }catch(err){
                    console.error("Create order error:", err);
                    // const redis=RedisManager.getInstance();
                    // redis.sendtoQueue(clientId,{
                    //     type:"ORDER_ERROR",
                    //     payload:{
                    //         error:(err as Error).message,
                    //         clientId
                    //     }
                    // })
                }
            
        }
    }
    checklockfunds(userId:string,baseAsset:string,quoteAsset:string,side:SIDE,price:number,quantity:number){
        const userbalance=this.userBalances.get(userId);
        if(side=="BUY"){
             if((userbalance![quoteAsset].available)<price*quantity){
                throw new Error("Insufficient Funds");
             }
             userbalance![quoteAsset].available-=quantity;
             userbalance![quoteAsset].locked+=quantity;
        }else{
            if((userbalance![baseAsset].available)<quantity){
                throw new Error("Insufficient Funds");
             }
             userbalance![baseAsset].available-=quantity;
             userbalance![baseAsset].locked+=quantity;
        }
    }
    createOrder(market:string,side:SIDE,kind:string,price:number,quantity:number,userId:string){
        const [baseAsset,quoteAsset]=market.split("_");
        this.checklockfunds(userId,baseAsset,quoteAsset,side,price,quantity);
        const orderbook=this.orderbooks.find(o=>o.ticker()===market);
        if(!orderbook){
            throw new Error("Market not found");
        }
        const order:Order={
            price,
            quantity,
            filledQuantity:0,
            side,
            kind:kind as KIND,
            userId,
            orderId:uuidv4()
        }
        // @ts-ignore
        const {executedqty,fills}=orderbook.addOrder(order);
        this.updateBalances(userId,baseAsset,quoteAsset,side,fills);
        return {
            orderId:order.orderId,
            executedqty,
            fills
        }
    }
    updateBalances(userId:string,baseAsset:string,quoteAsset:string,side:SIDE,fills:Fills[]){
        if(side=="BUY"){
            fills.forEach(fill=>{
                this.userBalances.get(fill.otheruserId)![quoteAsset].available+=fill.price*fill.quantity;
                this.userBalances.get(fill.otheruserId)![baseAsset].locked-=fill.quantity;
                this.userBalances.get(userId)![quoteAsset].locked-=fill.quantity;
                this.userBalances.get(userId)![baseAsset].available+=fill.quantity;
            })
        }else{
            fills.forEach(fill=>{
                this.userBalances.get(fill.otheruserId)![baseAsset].available+=fill.quantity;
                this.userBalances.get(fill.otheruserId)![quoteAsset].locked-=fill.price*fill.quantity;
                this.userBalances.get(userId)![baseAsset].locked-=fill.quantity;
                this.userBalances.get(userId)![quoteAsset].available+=fill.price*fill.quantity;
            })
        }
    }
     setBaseBalances() {
        this.userBalances.set("1", {
            [BASE_CURRENCY]: {
                available: 10000000,
                locked: 0
            },
            "USDT": {
                available: 10000000,
                locked: 0
            }
        });
    }
    
     
};