export type MessageToApi = {
  type: "ORDER_PLACED";
  payload: {
    orderId: string;
    executedqty: number;
    fills: {
      price: string;
      quantity: number;
      tradeId: number;
    }[];
  };
};
