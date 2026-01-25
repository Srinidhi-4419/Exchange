import RedisManager from "../RedisManager";
import fs from "fs";
import { Orderbook } from "./Orderbook";
import { SIDE } from "../types/Orderbook.types";
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
      setBaseBalances() {
        this.userBalances.set("1", {
            [BASE_CURRENCY]: {
                available: 10000000,
                locked: 0
            },
            "USTD": {
                available: 10000000,
                locked: 0
            }
        });
    }
};