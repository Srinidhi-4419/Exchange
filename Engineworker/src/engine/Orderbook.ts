import { Fills, Order } from "../types/Orderbook.types"
export class Orderbook{
    bids:Order[];
    asks:Order[];
    baseAsset:string;
    quoteAsset:string="USDT";
    lastTradeId:number;
    currentPrice:number;

    constructor(baseAsset:string,bids:Order[],asks:Order[],lastTradeId:number,currentPrice:number){
        this.bids=bids;
        this.asks=asks;
        this.baseAsset=baseAsset;
        this.lastTradeId=lastTradeId;
        this.currentPrice=currentPrice;
    } 

    ticker(){
        return `${this.baseAsset}/${this.quoteAsset}`;
    }
    getSnapshot(){
        return {
            baseAsset: this.baseAsset,
            bids: this.bids,
            asks: this.asks,
            lastTradeId: this.lastTradeId,
            currentPrice: this.currentPrice
        }
    }
    addOrder(order:Order){
        if(order.side=="BUY"){
            const result=this.matchBids(order);
            if(!result) return;
            const {executedqty,fills}=result;
            order.filledQuantity=executedqty;
            if(executedqty==order.quantity){
                return {
                    executedqty,
                    fills
                }
            }
            this.bids.push(order);
            return {
                executedqty,
                fills
            }
                
        }else{
            const result=this.mactchAsks(order);
            if(!result) return;
            const {executedqty,fills}=result;
            order.filledQuantity=executedqty;
            if(executedqty==order.quantity){
                return {
                    executedqty,
                    fills
                }
            }
            this.asks.push(order);
            return {
                executedqty,
                fills
            }
        }
    }

    matchBids(order:Order){
        const fills:Fills[]=[];
        let executedqty:number=0;
        for(const ask of this.asks){
            
      if (order.kind === "LIMIT" && order.price < ask.price) break;
            if(order.kind=="LIMIT"){
                if(order.price>=ask.price && executedqty<order.quantity){
                    const filledqty=Math.min(order.quantity-executedqty,ask.quantity-ask.filledQuantity);
                    ask.filledQuantity+=filledqty;
                    executedqty+=filledqty;
                    fills.push({
                        price:ask.price,
                        quantity:filledqty,
                        tradeId:this.lastTradeId+1,
                        marketOrderId:order.orderId,
                        otheruserId:ask.userId,
                    })
                    
                }
                for(let i=0;i<this.asks.length;i++){
                    if(this.asks[i].filledQuantity==this.asks[i].quantity){
                        this.asks.splice(i,1);
                        i--;
                }
                }
               return {fills,executedqty};
            }
        }
    }
    mactchAsks(order:Order){
        let fills:Fills[]=[];
        let executedqty:number=0;
        for(let i=0;i<this.bids.length;i++){
            if(this.bids[i].price>=order.price && executedqty<order.quantity){
                const remainingqty=Math.min(order.quantity-executedqty,this.bids[i].quantity-this.bids[i].filledQuantity);
                this.bids[i].filledQuantity+=remainingqty;
                executedqty+=remainingqty;
                fills.push({
                    price:this.bids[i].price,
                    quantity:remainingqty,
                    tradeId:this.lastTradeId+1,
                    marketOrderId:order.orderId,
                    otheruserId:this.bids[i].userId,
                })
                for(let i=0;i<this.bids.length;i++){
                    if(this.bids[i].filledQuantity==this.bids[i].quantity){
                        this.bids.splice(i,1);
                        i--;
                    }
                }
                return {fills,executedqty};
            }
        }
    }

}