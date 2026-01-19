
type SIDE="BUY"|"SELL";
type KIND="LIMIT"|"MARKET";
export interface Order{
    price:number;
    quantity:number;
    filledQuantity:number;
    side:SIDE;
    kind:KIND;
    orderId:string;
    userId:string;
}
export interface Fills{
    price:number;
    quantity:number;
    tradeId:number;
    marketOrderId:string;
    otheruserId:string;
}