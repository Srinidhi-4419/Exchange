"use client";

import { cancelOrder } from "@/lib/api";
import { useOrdersStore } from "@/stores/orders-store";
import { Market } from "@/types/api";
import { formatNumber } from "@/lib/utils";

export default function OpenOrdersPanel({ market }: { market: Market }) {
  const { openOrders } = useOrdersStore();

  async function onCancel(orderId: string) {
    try {
      await cancelOrder(orderId, market);
    } catch (error) {
      console.error("Cancel failed", error);
      alert("Cancel failed");
    }
  }

  return (
    <div className="exchange-panel overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-medium">
        Open Orders
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-[var(--muted)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Qty</th>
              <th className="px-4 py-3 font-medium">Filled</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {openOrders.map((order) => (
              <tr key={order.orderId} className="border-b border-[var(--border)]">
                <td className={`px-4 py-3 ${order.side.toUpperCase() === "BUY" ? "text-bid" : "text-ask"}`}>
                  {order.side}
                </td>
                <td className="px-4 py-3">{order.type}</td>
                <td className="px-4 py-3">{formatNumber(order.price, 2)}</td>
                <td className="px-4 py-3">{formatNumber(order.quantity, 5)}</td>
                <td className="px-4 py-3">{formatNumber(order.filledQuantity, 5)}</td>
                <td className="px-4 py-3">{order.status}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onCancel(order.orderId)}
                    className="rounded-md bg-[var(--panel-3)] px-3 py-1 text-xs hover:bg-[var(--panel-2)]"
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}

            {openOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted)]">
                  No open orders
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}